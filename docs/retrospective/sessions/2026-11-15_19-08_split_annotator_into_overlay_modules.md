# Session Log: Split annotator.js into overlay modules

- **Date**: 2026-11-15 19:08
- **Commit**: `0fd2ce4` — `refactor: split annotator.js into overlay.js and overlay_annotator.js`

## Changed Files

| File | Change |
|------|--------|
| scripts/annotator.js | Removed (766 lines); split into overlay.js and overlay_annotator.js |
| scripts/overlay.js | New overlay & DOM-inspector variant (direct evolution of annotator.js) |
| scripts/overlay_annotator.js | New annotator variant; now the loader's CDN entry point |
| scripts/loader.js | CDN URL and load-guard now target overlay_annotator |
| scripts/__smoke_test__.html | Smoke test updated for the new module layout |
| scripts/crop_box.py | Docstring title follows the rename |
| SKILL.md | Skill docs expanded (+87 lines) around the overlay annotator split |
| README.md | README updated for the new module layout |

## Details

The in-page annotator had grown into a single 766-line `annotator.js`; this pass replaces it with two standalone injection scripts — `overlay.js` (the overlay & DOM-inspector variant, a direct evolution of the old file) and `overlay_annotator.js` (the annotator variant) — so the two tool surfaces evolve independently. `loader.js` now fetches `scripts/overlay_annotator.js` from the jsDelivr CDN URL and guards on `window.__playwright_companion__.modules.overlay_annotator.ready` instead of the old `modules.annotator` key. The smoke-test page exercises the new layout, and `crop_box.py`'s docstring title is updated to "Browser Interactive Overlay Annotator" to match the rename. README.md and SKILL.md carry the user-facing description of the split so the documented tool surface matches the shipped scripts.
