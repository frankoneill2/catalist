# Catalist / wardround.app — agent notes

## Orientation (read first)

**[docs/architecture.md](docs/architecture.md) describes what is actually deployed.**
Do not infer the running app from a branch or from `README` text alone — between
May and September 2026 this repo described an architecture that was never live,
and that misled a security review.

The app is two layers on one page: a React auth/workspace layer (`src/auth/`,
mounted by `src/main.tsx` as a full-screen gate) over a large vanilla-JS clinical
UI (`src/script.js`). They communicate by the `auth:ready` DOM event, not imports.
`script.js` assumes the gate has already run.

## Icons

**IBM Carbon is the icon system for this app.** Source the icons exclusively from
[`@carbon/icons`](https://github.com/carbon-design-system/carbon/tree/main/packages/icons/src/svg/32) (32×32 viewBox).

- Add new icons to `src/icons.js` by copying the path/polygon/rect content from the Carbon SVG (without the wrapping `<svg>`, `<defs>`, or transparent rect).
- Render via `icon(name, opts)` / `iconString(name, opts)` / `setIcon(el, name, opts)` from `src/icons.js`. They produce monochrome SVGs that inherit colour through `fill="currentColor"`, so styling is driven by the parent element's `color` CSS.
- **Do not** introduce other icon families (Lucide, Heroicons, Material, Font Awesome, etc.) or Unicode glyphs (☐ ☑ ◐ ★ ☆ ▸ ▾ ✕ ✓ ➕) for new UI. Carbon-only.
- Inline SVGs in `index.html` (for icons present at first paint, e.g. the back button) should mirror the same path data with `class="cb-icon"`.

## Hosting / deploy

- Production hosting is Firebase Hosting → wardround.app (project `catalist-1`).
  Dev sandbox is catalist-dev.web.app (project `catalist-dev`).
- Deploys are manual. **Use `npm run deploy:prod` / `npm run deploy:dev`**, which
  build with the right config and then deploy. A bare `firebase deploy` ships
  whatever is already in `dist/` — and `dist/` is committed and shared between
  both targets, so a stale or wrong-environment build can reach production.
- Firestore rules deploy separately: see [docs/firestore-rules-deploy.md](docs/firestore-rules-deploy.md)
  and `npm run rules:check` for live-vs-repo parity.
- `dist/` is built output; don't hand-edit.
- **Never deploy from a dirty working tree, and tag every release.** The absence
  of that tag in May 2026 is why the repo and production diverged for four months.

## Status model

Tasks have an internal `status` field with values `open` | `in progress` | `complete`.
User-facing labels for these are **"To do"**, **"To follow"**, and **"Complete"** respectively.
Keep the data values; only translate at the rendering layer.
