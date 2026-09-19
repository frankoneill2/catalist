# Hidden features

Features whose code is still in the tree but is hidden from end users while
they're being held back from production. Each is tagged in source with a
comment of the form:

```
HIDDEN-FEATURE: <feature-id>
```

To find every site that needs to be reverted, grep:

```
grep -rn "HIDDEN-FEATURE: <feature-id>" .
```

Each tag sits directly above the line(s) that hide the thing. Reinstate by
deleting the `hidden` attribute / unwrapping the `if (false)` block.

---

## ward-notes

The **Ward notes** feature (per-patient free-text clinical notes, plus the
print/export flow that depends on it). Held back 2026-05-06 — feature is
half-baked and not actively being worked on.

### What's hidden

| Surface | Element / location | File |
| --- | --- | --- |
| Header **Print** button | `#print-open-btn` | [index.html](../index.html) |
| Tabs-bar **Ward Notes** quick button | `#quick-ward-notes-btn` | [index.html](../index.html) |
| Table filter-bar **Ward Notes** print button | `#ward-notes-print-btn` | [index.html](../index.html) |
| Patient detail **Notes** mobile tab | `.case-mobile-tab[data-panel="wardnotes"]` | [index.html](../index.html) |
| Patient detail ward-notes drawer panel | `#ward-notes` section | [index.html](../index.html) |
| Per-row **New note** button on Patients table | `newNoteBtn` (created in JS) | [src/script.js](../src/script.js) |
| Case header **New Note** quick-action button | `#new-ward-note-header` (created in JS) | [src/script.js](../src/script.js) |
| Mobile overflow sheet **Ward notes** entry | inside `openOverflowSheet()` | [src/script.js](../src/script.js) |

### How to reinstate

```
grep -rn "HIDDEN-FEATURE: ward-notes" index.html src/
```

For each match:

- **HTML** — remove the `hidden` attribute on the element directly below the comment.
- **JS** — unwrap the `if (false) { … }` block (or remove the `&& false` clause), so the original code runs again.

Then delete the `HIDDEN-FEATURE: ward-notes` comments themselves and
rebuild (`npm run build`).

### Notes

- The underlying ward-notes data layer, Firestore listeners
  (`startRealtimeWardNotes`), composer (`openWardNoteComposerV2`), and print
  flow are all untouched — only the entry points are hidden. Re-enabling the
  buttons restores full functionality with no other changes required.
- The header **Print** button is bundled into this hide because the only
  thing it currently prints is the ward-notes report. If a non-ward-notes
  print target is added later, that surface should get its own visibility flag.
