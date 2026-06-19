// Vercel cron — runs daily at 9:15am ET (13:15 UTC), deliberately AFTER the
// hourly lead-reconcile.yml run at :07 so the lifecycle columns are fresh.
// Reads the Sheety lead log and posts a lifecycle summary to the Telegram group.
//
// The log is back-filled by scripts/lead-reconcile.mjs (run hourly in CI through
// Fixie), which adds txid (Boberdoo lead_id or 'no-match'), boberdooStatus
// (Matched/Unmatched/not-found), and trustedForm (cert URL or 'no') to each row.
// This cron does NOT call Boberdoo directly — Vercel's egress IP isn't on the
// Boberdoo whitelist — so report accuracy depends on reconcile having run recently.

const SHEETY_URL = (process.env.SHEETY_URL || "").replace(/\\n$/, "").trim();
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = (process.env.ALLOWED_CHAT_IDS || "").split(",")[0].trim();

const DAY_MS = 24 * 60 * 60 * 1000;

function isLead(r) { return r.event === "lead_submitted"; }
function hasClickId(r) { return r.clickId && r.clickId.length > 5; }
function reconciled(r) { return r.txid && r.txid !== "no-match"; }
function statusIs(r, s) { return (r.boberdooStatus || "").toLowerCase() === s; }
function hasTrustedForm(r) { return r.trustedForm && r.trustedForm !== "no"; }
function payout(r) { const n = parseFloat(r.payout); return Number.isFinite(n) ? n : 0; }

// Snapshot of one 24h window's funnel metrics.
function snapshot(leads) {
  const matched = leads.filter(function (r) { return statusIs(r, "matched"); });
  const unmatched = leads.filter(function (r) { return statusIs(r, "unmatched"); });
  const inBoberdoo = leads.filter(reconciled);
  // Dropped = old enough to have been reconciled, but never found in Boberdoo.
  const dropped = leads.filter(function (r) {
    return !reconciled(r) && (r.txid === "no-match" || statusIs(r, "not-found"));
  });
  const pending = leads.filter(function (r) {
    return !reconciled(r) && r.txid !== "no-match" && !statusIs(r, "not-found");
  });
  return {
    total: leads.length,
    withClickId: leads.filter(hasClickId).length,
    inBoberdoo: inBoberdoo.length,
    matched: matched.length,
    unmatched: unmatched.length,
    dropped: dropped.length,
    pending: pending.length,
    trustedForm: matched.filter(hasTrustedForm).length,
    revenue: matched.reduce(function (s, r) { return s + payout(r); }, 0),
    droppedRows: dropped,
  };
}

function pct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

// Up/down arrow comparing today vs. yesterday for a metric.
function delta(today, yest, prefix) {
  const p = prefix || "";
  const d = today - yest;
  if (d === 0) return "";
  return d > 0 ? " (▲ +" + p + d + ")" : " (▼ -" + p + Math.abs(d) + ")";
}

module.exports = async (req, res) => {
  let rows = [];
  try {
    const resp = await fetch(SHEETY_URL);
    const json = await resp.json();
    const key = Object.keys(json).find(function (k) { return Array.isArray(json[k]); });
    rows = key ? json[key] : [];
  } catch (err) {
    console.error("Sheety fetch failed:", err.message);
  }

  const now = Date.now();
  const tsOf = function (r) { return r.timestamp ? new Date(r.timestamp).getTime() : 0; };

  const todayLeads = rows.filter(function (r) {
    return isLead(r) && tsOf(r) >= now - DAY_MS;
  });
  const yestLeads = rows.filter(function (r) {
    const t = tsOf(r);
    return isLead(r) && t >= now - 2 * DAY_MS && t < now - DAY_MS;
  });

  const t = snapshot(todayLeads);
  const y = snapshot(yestLeads);

  const lines = [
    "📊 Lead Funnel Summary (last 24h)",
    "—",
    "Submitted: " + t.total + delta(t.total, y.total),
    "  ↳ With click_id: " + t.withClickId + "/" + t.total + " (" + pct(t.withClickId, t.total) + "%)",
    "  ↳ In Boberdoo: " + t.inBoberdoo + " (" + pct(t.inBoberdoo, t.total) + "%)",
    "  ↳ Matched (sold): " + t.matched + delta(t.matched, y.matched),
    "  ↳ Unmatched: " + t.unmatched,
    "  ↳ ⚠️ Dropped (never reached Boberdoo): " + t.dropped + delta(t.dropped, y.dropped),
    "—",
    "💰 Revenue (matched): $" + t.revenue.toFixed(2) + delta(Math.round(t.revenue), Math.round(y.revenue), "$"),
    "🛡️ TrustedForm on sold: " + t.trustedForm + "/" + t.matched + " (" + pct(t.trustedForm, t.matched) + "%)",
  ];

  // Reconciliation freshness — if many rows are still pending, numbers are stale.
  if (t.pending > 0) {
    lines.push("⏳ Awaiting reconciliation: " + t.pending +
      (t.pending > t.total / 2 ? " — numbers may be incomplete, check reconcile CI" : ""));
  }

  if (t.droppedRows.length > 0) {
    lines.push("");
    lines.push("Dropped leads (submitted, no Boberdoo match):");
    t.droppedRows.slice(0, 5).forEach(function (r) {
      lines.push("  • " + r.timestamp + " — " + (r.email || r.rawQuery || "no details"));
    });
  }

  const msg = lines.join("\n");

  if (TG_TOKEN && CHAT_ID) {
    try {
      await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: CHAT_ID, text: msg })
      });
    } catch (_) {}
  }

  return res.status(200).json({ summary: msg });
};
