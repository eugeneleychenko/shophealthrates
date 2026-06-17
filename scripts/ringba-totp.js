#!/usr/bin/env node
// Prints the CURRENT Ringba MFA (TOTP) code to stdout — nothing else.
//
// Used by .github/workflows/telegram-call-check.yml so the headless login can
// answer Ringba's 2FA prompt without a human. Reads the base32 seed from the
// RINGBA_TOTP_SECRET env var (a GitHub Actions secret); the seed is NEVER
// printed or committed. RFC 6238: HMAC-SHA1, 6 digits, 30-second step.
//
// Run it the instant the MFA field appears (codes rotate every 30s):
//   agent-browser type @e5 "$(node scripts/ringba-totp.js)"
//
// This is intentionally a standalone copy of the same algorithm in
// api/telegram.js (getRingbaMfa) — keeping the live Vercel webhook untouched is
// worth the small duplication. If you change one, change both.

"use strict";

const crypto = require("crypto");

function getRingbaMfa(secret) {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // base32 (RFC 4648)
  const clean = String(secret).toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = "";
  for (const ch of clean) {
    const val = ALPHABET.indexOf(ch);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  const key = Buffer.from(bytes);

  // 8-byte big-endian counter = floor(unixTime / 30).
  let counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }

  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1000000).padStart(6, "0");
}

const secret = process.env.RINGBA_TOTP_SECRET;
if (!secret) {
  process.stderr.write("RINGBA_TOTP_SECRET not set\n");
  process.exit(1);
}
process.stdout.write(getRingbaMfa(secret));
