---
name: playwright-companion
description: Operational companion for Playwright browser automation and testing. Curates general Playwright runtime experience (remote containers, extension relay, CDP, init-script impression protocol), and a suite of browser helper tools including the in-page overlay annotator (interactive multi-box visual annotation, element anchoring, live layout tracking, DOM selector extraction) and viewport screenshot cropping. Use instead of Playwright's built-in browser_annotate for in-page annotation, and whenever browser_annotate fails or hangs in extension, remote, container, or headless setups.
---

# Playwright Companion Skill

A dedicated operational companion for Playwright browser automation, testing, and human-in-the-loop debugging. Curates operational runtime knowledge for Playwright MCP (remote container / extension relay / CDP environments) and provides a suite of browser-side helper utilities.

---

## Why This Skill Exists

Under standard `@playwright/mcp --extension` and containerized developer setups:
1. **The Native Tool Limitation**: Playwright's built-in `browser_annotate` tool attempts to spawn an external desktop GUI app window (`playwright-core/lib/entry/dashboardApp.js`) on the backend host machine.
2. **Failure in Remote/Container Environments**: On remote servers, containers, or WSL without a local Chromium GUI installed or without an X11/Wayland display server, `browser_annotate` crashes immediately (`No chromium-based browser found on the system`) or hangs indefinitely until canceled.
3. **The Solution**: Rather than relying on host desktop windows or burning thousands of prompt tokens repeatedly injecting bulky JavaScript functions, this skill introduces:
   - **The Init-Script Impression Protocol**: Allows Playwright MCP servers to preload companion tools via `--init-script`. The agent detects active tools with **zero prompt token overhead**.
   - **Interactive Multi-Box Overlay Annotator**: In-page visual selection overlay with live element anchoring, pause/resume interaction, and DOM metadata extraction.
   - **Local Viewport Cropping**: Deterministic Pillow-based screenshot cropper for bounded visual reasoning.

---

## Tool Routing: `overlay_annotator` vs native `browser_annotate`

Playwright MCP ships a built-in `browser_annotate` tool. It is a **different product**: it spawns a separate desktop Dashboard window on the MCP host and lets the user draw rectangles on a **static screenshot** there. It injects nothing into the target page. This skill's **overlay annotator** draws **live, element-anchored boxes in the actual page**, with DOM metadata, layout tracking, and pause/resume.

| | Native `browser_annotate` | Companion `overlay_annotator` |
|---|---|---|
| Where the user draws | Separate desktop Dashboard window | In the actual page |
| Target | Static screenshot | Live DOM (element-anchored, re-fits on layout change) |
| Output | Annotated image + ARIA snapshot + rects | DOM selectors, metadata, page/viewport coordinates |
| Works in `--extension` / remote / container / headless | ❌ crashes or hangs (needs a host GUI) | ✅ |

**Routing rules:**
1. In `--extension`, remote, container, WSL-without-display, or headless setups: **never call `browser_annotate`** — use the overlay annotator workflow below.
2. Local headed desktop: either is acceptable. Prefer the overlay annotator when element identity (selectors, metadata) matters; native is fine for quick screenshot markup.
3. **Coexistence**: the two share no globals and no DOM, so they can run side by side. But a native dashboard screenshot taken while the overlay is visible bakes the overlay's boxes/FAB into the image — call `hide()` before the native capture and `show()` afterwards.

---

## Core Capabilities

- **Detectable Impression Protocol (`window.__playwright_companion__`)**:
  Agents query a standard global namespace to instantly acquire an impression of active companion tools. If loaded via `--init-script`, the agent operates with zero injection latency and zero prompt tokens.
- **Always-Present Floating Launcher (Folded by Default)**: The overlay annotator mounts as a small draggable ✎ button (bottom-right corner) and stays folded so the page remains fully interactive. Humans click it to unfold the annotation bar and start annotating themselves — no agent invocation required. Agents can fold/unfold programmatically via `setFolded(state)` / `toggleFolded()`.
- **`Alt+A` Summon Hotkey (Non-Destructive Close)**: The toolbar's `✕ Close` button only **hides** the entire UI — all annotations are preserved. Press `Alt+A` anywhere (even on a blank area of the page) to bring back the floating ✎ launcher **folded** (click it to open the bar); while the UI is visible, `Alt+A` dismisses it again. A hint toast appears after closing so the hotkey stays discoverable. Only the agent API `cleanup()` performs a full teardown.
- **Multi-Box Drag Selection**: Drag multiple persistent boxes across any page (numbered `#1`, `#2`, etc.).
- **Pause / Resume (Page Interaction Mode)**: The toolbar's `⏸ Pause` button releases the drag overlay so the underlying page is fully clickable — open menus, dropdowns, expand accordions — then `▶ Resume` to keep annotating. Essential for annotating content that only exists after interaction.
- **Element-Anchored Boxes (Online Layout Tracking)**: Each box anchors to the DOM elements captured at draw time. Its geometry is a normalized fit of the original box relative to the union bounding rect of the selected elements; a `ResizeObserver` + `MutationObserver` + scroll/resize listeners re-fit the box live when layout changes.
- **Precision DOM Metadata**: Extracts clean CSS selectors (`#id`, `tag[name=...]`, `tag[role=...]`, `:nth-of-type`), tags, ARIA labels, values, text, and bounding rectangles.
- **Dual Coordinate Systems**:
  - **Document (Page) Coordinates**: Annotations remain attached to elements across page scrolling.
  - **Viewport Coordinates**: `getViewportAnnotations()` converts coordinates live for viewport screenshot cropping.
- **Area Image Cropping**: `scripts/crop_box.py` crops exact pixel bounding boxes with DPR scaling.

---

## Operational Workflow for Agents

### Step 1: Ensure Browser Tab is Active
```json
{
  "ServerName": "playwright",
  "ToolName": "browser_tabs",
  "Arguments": { "action": "list" }
}
```

### Step 2: Acquire Impression of Loaded Companion Tools (Zero-Token Detection)
Before attempting any manual script injection, the agent **MUST** check whether the companion suite is already active (e.g. loaded via `--init-script`):

```json
{
  "ServerName": "playwright",
  "ToolName": "browser_evaluate",
  "Arguments": {
    "function": "() => window.__playwright_companion__ || null"
  }
}
```

#### Decision Logic:
1. **If `window.__playwright_companion__?.modules?.overlay_annotator?.ready === true`**:
   The tool is already active and listening on the page. **Proceed directly to Step 4.** Do not re-inject. (The bar may be folded — ask the user to click the floating ✎ button, or call `setFolded(false)` first.)
2. **If null / undefined**:
   Proceed to **Step 3** to load the utility.

---

### Step 3: Fallback Injection (Only If Not Already Loaded)

If the impression check returns null, inject the script using the most efficient available method:

> **Note**: The overlay annotator mounts **folded** by default (only the floating ✎ button appears). When injecting because the user is about to annotate, set `window.__playwright_companion_autostart__ = 'expanded'` first so the bar opens immediately (as shown below).

#### Method A: CDN Bootstrap (Recommended — 1 Line of Code)
```json
{
  "ServerName": "playwright",
  "ToolName": "browser_evaluate",
  "Arguments": {
    "function": "() => { window.__playwright_companion_autostart__ = 'expanded'; const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/gh/CodingManGit/playwright-companion@main/scripts/overlay_annotator.js'; document.head.appendChild(s); }"
  }
}
```

#### Method B: Local File via `browser_run_code_unsafe`
If working in a Windows-side MCP setup where files are locally accessible:
```json
{
  "ServerName": "playwright",
  "ToolName": "browser_run_code_unsafe",
  "Arguments": {
    "code": "async (page) => { await page.evaluate(() => { window.__playwright_companion_autostart__ = 'expanded'; }); await page.addScriptTag({ url: 'https://cdn.jsdelivr.net/gh/CodingManGit/playwright-companion@main/scripts/overlay_annotator.js' }); return 'loaded'; }"
  }
}
```

---

### Step 4: Read Back User Annotations
When the user indicates they have drawn boxes or left notes:

> If the user has not started yet, open the bar for them (or ask them to click the floating ✎ button): `() => window.__playwright_companion__?.modules?.overlay_annotator?.setFolded(false)`. While folded, the page stays fully interactive and existing boxes remain visible; `toggleFolded()` flips the state.

```json
{
  "ServerName": "playwright",
  "ToolName": "browser_evaluate",
  "Arguments": {
    "function": "() => window.__playwright_companion__?.modules?.overlay_annotator?.getViewportAnnotations() || window.__overlay_annotations__"
  }
}
```

#### Returned Annotation Structure:
```json
[
  {
    "id": "ovl_1793409029419_1",
    "number": 1,
    "createdAt": 1793409029419,
    "box": { "x": 834, "y": 233, "width": 263, "height": 112 },
    "viewport": { "width": 1280, "height": 648, "dpr": 2.0 },
    "comment": "Fix misalignment here",
    "elements": [
      {
        "tagName": "button",
        "id": "submit-btn",
        "name": null,
        "className": "btn-primary",
        "selector": "#submit-btn",
        "ariaLabel": "Submit Form",
        "role": null,
        "text": "Submit",
        "rect": { "x": 832, "y": 258, "width": 272, "height": 40 }
      }
    ]
  }
]
```

---

### Step 5: Interact with Selected Elements
Use the exact extracted `selector` with native Playwright MCP tools:
```json
{
  "ServerName": "playwright",
  "ToolName": "browser_click",
  "Arguments": {
    "target": "#submit-btn"
  }
}
```

---

### Step 6: Optional Area Image Cropping

The agent should decide **dynamically** whether a cropped image is needed:
- **Acquire Image**: Canvas games, charts, custom iconography, CSS rendering glitches, or when explicitly requested by user.
- **Skip Image**: Standard DOM elements (buttons, inputs, links) where text and selector metadata are already clear.

#### Cropping Workflow:
1. Capture viewport screenshot (omitting `filename` so Playwright saves it as an artifact):
   ```json
   {
     "ServerName": "playwright",
     "ToolName": "browser_take_screenshot",
     "Arguments": { "scale": "css" }
   }
   ```
2. Crop the exact box using `crop_box.py`:
   ```bash
   uv run --with pillow python <path-to-skill>/scripts/crop_box.py \
     --image /path/to/screenshot.png \
     --json '<annotation_json>' \
     --output /tmp/cropped_box_1.png
   ```

---

### Step 7: Clean Up Overlay
To remove the UI overlay when finished:
```json
{
  "ServerName": "playwright",
  "ToolName": "browser_evaluate",
  "Arguments": {
    "function": "() => window.__playwright_companion__?.modules?.overlay_annotator?.cleanup()"
  }
}
```

> **Note**: `cleanup()` is a **full teardown** (agent-initiated). The in-page `✕ Close` button and the `Alt+A` hotkey only hide/show the UI and never destroy annotations — use `hide()` instead of `cleanup()` if the user may still want to come back to their annotations.

---

## Server Setup: One-Liner `--init-script` Preloading

To operate with **100% zero-token injection overhead**, users can run Playwright MCP with `--init-script` preloading:

### PowerShell (Windows):
```powershell
curl.exe -sSL https://raw.githubusercontent.com/CodingManGit/playwright-companion/main/scripts/overlay_annotator.js -o "$env:TEMP\overlay_annotator.js"; npx @playwright/mcp@latest --extension --port 8931 --host 127.0.0.1 --caps=devtools --allowed-hosts "localhost:8931,127.0.0.1:8931,host.docker.internal:8931" --init-script "$env:TEMP\overlay_annotator.js"
```

### Bash / Linux / macOS:
```bash
curl -sSL https://raw.githubusercontent.com/CodingManGit/playwright-companion/main/scripts/overlay_annotator.js -o /tmp/overlay_annotator.js && npx @playwright/mcp@latest --extension --port 8931 --host 127.0.0.1 --caps=devtools --allowed-hosts "localhost:8931,127.0.0.1:8931,host.docker.internal:8931" --init-script /tmp/overlay_annotator.js
```

---

## Troubleshooting & Diagnostics Playbook

When `--init-script` is specified but the overlay annotator UI (`__overlay_fab__`) or `window.__playwright_companion__` does not appear, follow this checklist:

### 1. The Navigation Invariant (Pre-Existing Tabs vs. New Document)
* **Root Cause**: Playwright MCP's `--init-script` translates to `Page.addScriptToEvaluateOnNewDocument` under the hood. It executes **only upon a fresh navigation or page reload**.
* **Symptom**: If the browser tab was already open before Playwright MCP connected via `--extension`, the init script was never evaluated on that document.
* **Resolution**: Call `page.goto(url)` or reload the tab (`window.location.reload()`), or use the Step 3 fallback injection.

### 2. Chromium CSP Trusted Types Restriction (`require-trusted-types-for 'script'`)
* **Root Cause**: Modern web applications (e.g. Google Flow, Google Search, Angular enterprise apps) enforce strict CSP Trusted Types. Direct assignment to `.innerHTML = '...'` throws a fatal error and aborts script execution before `window.__playwright_companion__` is registered.
* **Symptom in Console**:
  ```text
  TypeError: Failed to set the 'innerHTML' property on 'Element': This document requires 'TrustedHTML' assignment.
  ```
* **Resolution**:
  - Always wrap HTML template strings with a Trusted Types policy:
    ```javascript
    let ttPolicy = null;
    if (window.trustedTypes && typeof window.trustedTypes.createPolicy === 'function') {
      try {
        ttPolicy = window.trustedTypes.createPolicy('playwright_companion', { createHTML: s => s });
      } catch (_) {
        ttPolicy = window.trustedTypes.defaultPolicy || null;
      }
    }
    const setHTML = (el, html) => { el.innerHTML = ttPolicy ? ttPolicy.createHTML(html) : html; };
    ```
  - For clearing containers (`el.innerHTML = ''`), use `el.textContent = ''` or `el.replaceChildren()`.
  - For plain text or Unicode symbols (`×`, `✎`, `▶ Resume`), always use `.textContent` instead of `.innerHTML`.

### 3. DOM Lifecycle Timing at `document-start`
* **Root Cause**: `--init-script` fires at `document-start` before `<body>` has been parsed. Unconditional `document.body.appendChild(...)` calls will throw `TypeError: Cannot read properties of null (reading 'appendChild')`.
* **Resolution**: Defer UI DOM mounting to `DOMContentLoaded` (or execute immediately if `document.readyState !== 'loading'`), and use `(document.body || document.documentElement)` as fallback container targets.

### 4. Process-Level File Caching in Playwright MCP
* **Root Cause**: `@playwright/mcp` reads `--init-script` files into memory **once at server startup**. Modifying `overlay_annotator.js` on disk while the MCP daemon is running has no effect until the server process is killed and restarted.
* **Resolution**: Always syntax-check scripts via `node -c <script_path>` before launch, and restart the Playwright MCP daemon whenever modifying initialization scripts.

---

## Bundled Resources

- `scripts/overlay_annotator.js`: Core interactive visual multi-box overlay annotator with `__playwright_companion__` integration.
- `scripts/loader.js`: Zero-config bootstrap loader for `--init-script`.
- `scripts/crop_box.py`: High-performance Pillow cropping utility supporting DPR and document/viewport coordinate conversion.
