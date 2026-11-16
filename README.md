# Playwright Companion (`playwright-companion`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![jsDelivr](https://data.jsdelivr.com/v1/package/gh/CodingManGit/playwright-companion/badge)](https://www.jsdelivr.com/package/gh/CodingManGit/playwright-companion)

A dedicated operational companion and browser utility suite for **Playwright**, **Playwright MCP**, and AI coding agents (Antigravity, Cursor, VS Code Copilot, Claude Desktop).

---

## Highlights

- **⚡ Zero-Token Impression Protocol (`window.__playwright_companion__`)**: Preload utilities via `--init-script`. AI agents detect active tools automatically, completely avoiding bulky multi-thousand-token prompt script injections.
- **🖱 Always-Present Unified Morphing Launcher**: A compact draggable ✎ circular button lives on every page. Clicking it expands the button directly into the full annotation toolbar right in place; clicking `▾ Fold` collapses the toolbar back into the button with zero visual clutter.
- **⌨️ Alt+A Summon Hotkey (Non-Destructive Close)**: Press `Alt+A` anywhere to toggle between the folded button and the expanded toolbar, or unhide if dismissed. The rightmost `✕` button dismisses the UI non-destructively — every annotation is kept — and a hint toast after closing points back at `Alt+A`.
- **🎯 Multi-Box Visual Selection Overlay**: Drag selection boxes directly across any web page to select elements, inspect CSS selectors, and attach instructions.

> **Not Playwright's `browser_annotate`**: the built-in tool draws on a static screenshot inside a separate desktop Dashboard window and needs a host GUI (it fails in `--extension`/remote/container/headless setups). The companion's **overlay annotator** draws live, element-anchored boxes in the actual page. They share no globals or DOM and can coexist — but `hide()` the overlay before a native dashboard screenshot so its boxes aren't baked into the image.
- **⏸ Pause / Resume (Page Interaction Mode)**: Temporarily unblock the page to open menus, expand dropdowns, and navigate before resuming annotation.
- **🔗 Online Element Anchoring**: Captured boxes automatically track DOM elements live across scrolling, CSS reflows, and window resizing via `ResizeObserver` & `MutationObserver`.
- **✂️ Deterministic Screenshot Cropping**: Fast Pillow-based bounding box cropper supporting HiDPI device pixel ratios.

---

## Quick Start: One-Liner Server Launch

Launch Playwright MCP with the companion preloaded on every page:

### Windows (PowerShell):
```powershell
curl.exe -sSL https://raw.githubusercontent.com/CodingManGit/playwright-companion/main/scripts/overlay_annotator.js -o "$env:TEMP\overlay_annotator.js"; npx @playwright/mcp@latest --extension --port 8931 --host 127.0.0.1 --caps=devtools --allowed-hosts "localhost:8931,127.0.0.1:8931,host.docker.internal:8931" --init-script "$env:TEMP\overlay_annotator.js"
```

### Linux / macOS / WSL (Bash):
```bash
curl -sSL https://raw.githubusercontent.com/CodingManGit/playwright-companion/main/scripts/overlay_annotator.js -o /tmp/overlay_annotator.js && npx @playwright/mcp@latest --extension --port 8931 --host 127.0.0.1 --caps=devtools --allowed-hosts "localhost:8931,127.0.0.1:8931,host.docker.internal:8931" --init-script /tmp/overlay_annotator.js
```

---

## Impression Protocol Specification

Every companion utility exposes its presence under `window.__playwright_companion__`:

```javascript
window.__playwright_companion__ = {
  version: "1.0.0",
  modules: {
    overlay_annotator: {
      version: "2.0.0",
      ready: true,
      paused: false,
      folded: true,
      hidden: false,
      getActiveBoxCount: () => 0,
      getAnnotations: () => [...],
      getViewportAnnotations: () => [...],
      setPaused: (state) => {...},
      setFolded: (state) => {...},
      toggleFolded: () => {...},
      show: () => {...},        // summon bar (unhide + expand)
      hide: () => {...},        // hide UI, keep annotations
      toggleVisibility: () => {...},
      clear: () => {...},
      cleanup: () => {...}      // full teardown (agent-only)
    }
  }
};
```

When an agent needs visual selection or DOM inspection:
1. It queries `() => window.__playwright_companion__`.
2. If `modules.overlay_annotator.ready` is true, the agent proceeds immediately with **zero injection latency**.
3. If absent, the agent executes a single-line CDN bootstrap:
   ```javascript
   () => {
     const s = document.createElement('script');
     s.src = 'https://cdn.jsdelivr.net/gh/CodingManGit/playwright-companion@main/scripts/overlay_annotator.js';
     document.head.appendChild(s);
   }
   ```

---

## Repository Structure

```text
playwright-companion/
├── SKILL.md            # Agent operational skill instructions
├── README.md           # Quick start & documentation
├── LICENSE             # MIT License
└── scripts/
    ├── overlay_annotator.js  # Interactive visual multi-box overlay annotator
    ├── loader.js             # Bootstrap loader for --init-script
    └── crop_box.py           # Pillow-based screenshot cropper
```

---

## License

MIT © CodingManGit
