# Repository Guidelines

## Overview

Static marketing site for **LeoSource Insurance Agency** (shophealthrates.com). Built with plain HTML, CSS, and jQuery. Deployed to Vercel.

## Project Structure

```
├── index.html          # Homepage with zip code quote form
├── quiz.html           # Multi-step insurance assessment wizard
├── thank-you.html      # Post-submission confirmation page
├── thank-you-v2.html   # Alternate confirmation page
├── privacy.html        # Privacy policy
├── term.html           # Terms of use
├── css/
│   ├── style.css       # Main site styles
│   ├── quiz.css        # Quiz page styles
│   └── *.woff/.woff2   # Inter & Public Sans font files
├── js/
│   ├── jquery-3.6.0.min.js
│   └── bookmarkscroll.js  # Smooth scroll for anchor links
├── images/             # All site images (webp, png, svg)
└── api_docs/           # API documentation and integration notes
```

## Deployment

Hosted on **Vercel** (project: `vyb/vyb-site`). Deploy with:

```bash
vercel --prod --yes
```

No build step — Vercel serves static files directly.

## Development

No package manager, bundler, or build tools. Edit HTML/CSS/JS files directly. Preview locally by opening `index.html` in a browser or using any static file server.

## Key Technical Notes

- **Forms must use `method="get"`** — all pages are static HTML. Using `method="post"` causes HTTP 405 errors on Vercel's static hosting.
- **Quiz flow**: `index.html` → `quiz.html?zip=<value>` → `thank-you.html`
- **No framework** — vanilla HTML with jQuery 3.6.0 for DOM manipulation and smooth scrolling.
- **Fonts** are self-hosted in `css/` (Inter, Public Sans) via `@font-face` in `style.css`.

## Coding Style

- HTML: 4-space indentation, kebab-case for CSS classes (e.g., `banner_form_box_inner`)
- CSS: Organized by page section, mobile breakpoints via `@media`
- No linter or formatter configured

## Commit Guidelines

- Keep commit messages short and descriptive (e.g., `fix form method to get`)
- Commit on `main` branch directly
