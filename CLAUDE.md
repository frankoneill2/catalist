# Catalist / wardround.app — agent notes

## Icons

**IBM Carbon is the icon system for this app.** Source the icons exclusively from
[`@carbon/icons`](https://github.com/carbon-design-system/carbon/tree/main/packages/icons/src/svg/32) (32×32 viewBox).

- Add new icons to `src/icons.js` by copying the path/polygon/rect content from the Carbon SVG (without the wrapping `<svg>`, `<defs>`, or transparent rect).
- Render via `icon(name, opts)` / `iconString(name, opts)` / `setIcon(el, name, opts)` from `src/icons.js`. They produce monochrome SVGs that inherit colour through `fill="currentColor"`, so styling is driven by the parent element's `color` CSS.
- **Do not** introduce other icon families (Lucide, Heroicons, Material, Font Awesome, etc.) or Unicode glyphs (☐ ☑ ◐ ★ ☆ ▸ ▾ ✕ ✓ ➕) for new UI. Carbon-only.
- Inline SVGs in `index.html` (for icons present at first paint, e.g. the back button) should mirror the same path data with `class="cb-icon"`.

## Hosting / deploy

- Production hosting is Firebase Hosting → wardround.app (project `catalist-1`).
- Deploys are manual: `npm run build` then `firebase deploy --only hosting`. There is no Firebase deploy GitHub Action; pushing to GitHub does not deploy.
- `dist/` is built output; don't hand-edit.

## Status model

Tasks have an internal `status` field with values `open` | `in progress` | `complete`.
User-facing labels for these are **"To do"**, **"To follow"**, and **"Complete"** respectively.
Keep the data values; only translate at the rendering layer.
