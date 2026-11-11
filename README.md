# Playwright Companion (`playwright-companion`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![jsDelivr](https://data.jsdelivr.com/v1/package/gh/CodingManGit/playwright-companion/badge)](https://www.jsdelivr.com/package/gh/CodingManGit/playwright-companion)

A dedicated operational companion and browser utility suite for **Playwright**, **Playwright MCP**, and AI coding agents (Antigravity, Cursor, VS Code Copilot, Claude Desktop).

---

## Highlights

- **⚡ Zero-Token Impression Protocol (`window.__playwright_companion__`)**: Preload utilities via `--init-script`. AI agents detect active tools automatically, completely avoiding bulky multi-thousand-token prompt script injections.
- **🖱 Always-Present Floating Launcher**: A small draggable ✎ button lives on every page, folded by default — the page stays fully interactive, and humans can open the annotation bar themselves without any agent invocation.
- **⌨️ Alt+A Summon Hotkey (Non-Destructive Close)**: The `✕ Close` button only hides the UI — every annotation is kept. Press `Alt+A` anywhere to bring back the folded ✎ button (click it to open the bar) — or dismiss the UI again. A hint toast appears after closing so the hotkey is discoverable.
- **🎯 Multi-Box Visual Selection Overlay**: Drag selection boxes directly across any web page to select elements, inspect CSS selectors, and attach instructions.
- **⏸ Pause / Resume (Page Interaction Mode)**: Temporarily unblock the page to open menus, expand dropdowns, and navigate before resuming annotation.
- **🔗 Online Element Anchoring**: Captured boxes automatically track DOM elements live across scrolling, CSS reflows, and window resizing via `ResizeObserver` & `MutationObserver`.
- **✂️ Deterministic Screenshot Cropping**: Fast Pillow-based bounding box cropper supporting HiDPI device pixel ratios.

---

## Quick Start: One-Liner Server Launch

Launch Playwright MCP with the companion preloaded on every page:

### Windows (PowerShell):
```powershell
curl.exe -sSL https://raw.githubusercontent.com/CodingManGit/playwright-companion/main/scripts/annotator.js -o "$env:TEMP\annotator.js"; npx @playwright/mcp@latest --extension --port 8931 --host 127.0.0.1 --caps=devtools --allowed-hosts "localhost:8931,127.0.0.1:8931,host.docker.internal:8931" --init-script "$env:TEMP\annotator.js"
```

### Linux / macOS / WSL (Bash):
```bash
curl -sSL https://raw.githubusercontent.com/CodingManGit/playwright-companion/main/scripts/annotator.js -o /tmp/annotator.js && npx @playwright/mcp@latest --extension --port 8931 --host 127.0.0.1 --caps=devtools --allowed-hosts "localhost:8931,127.0.0.1:8931,host.docker.internal:8931" --init-script /tmp/annotator.js
```

---

## Impression Protocol Specification

Every companion utility exposes its presence under `window.__playwright_companion__`:

```javascript
window.__playwright_companion__ = {
  version: "1.0.0",
  modules: {
    annotator: {
      version: "1.4.1",
      ready: true,
      paused: false,
      folded: true,
      hidden: false,
      activeBoxCount: 0,
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
2. If `modules.annotator.ready` is true, the agent proceeds immediately with **zero injection latency**.
3. If absent, the agent executes a single-line CDN bootstrap:
   ```javascript
   () => {
     const s = document.createElement('script');
     s.src = 'https://cdn.jsdelivr.net/gh/CodingManGit/playwright-companion@main/scripts/annotator.js';
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
    ├── annotator.js    # Interactive visual multi-box overlay
    ├── loader.js       # Bootstrap loader for --init-script
    └── crop_box.py     # Pillow-based screenshot cropper
```

---

## License

MIT © CodingManGit
