/**
 * Browser Interactive Multi-Box Annotator & DOM Element Inspector
 * 
 * Injected into active web pages via Playwright (`browser_evaluate` or `--init-script`).
 * Provides an interactive UI for users to drag selection boxes over web elements,
 * attach instructions/comments to each box, and cleanly extract DOM metadata for the agent.
 */
(() => {
  // 0. Tear down any previous instance (DOM + listeners + observers) if present
  if (typeof window.__agent_annotator_cleanup__ === 'function') {
    try { window.__agent_annotator_cleanup__(); } catch (_) {}
  }

  let initialized = false;
  let domLoadedHandler = null;
  let bodyObserver = null;

  let teardown = () => {
    if (domLoadedHandler) {
      document.removeEventListener('DOMContentLoaded', domLoadedHandler);
      window.removeEventListener('load', domLoadedHandler);
      domLoadedHandler = null;
    }
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }
    if (window.__agent_annotator_cleanup__ === teardown) delete window.__agent_annotator_cleanup__;
    if (window.__playwright_companion__?.modules?.annotator) {
      delete window.__playwright_companion__.modules.annotator;
    }
  };
  window.__agent_annotator_cleanup__ = teardown;

  // Pre-register namespace for immediate discovery across all lifecycle stages
  window.__playwright_companion__ = window.__playwright_companion__ || {
    version: '1.0.0',
    modules: {}
  };

  // Provide early impression placeholder if queried before DOMContentLoaded
  if (!window.__playwright_companion__.modules.annotator) {
    window.__playwright_companion__.modules.annotator = {
      version: '1.5.0',
      get ready() {
        if (!initialized && document.body) {
          init();
        }
        return initialized;
      }
    };
  }

  function init() {
    if (initialized) return;
    if (document.getElementById('__agent_inspector_container__')) return;
    if (!document.body) return;

    initialized = true;
    if (domLoadedHandler) {
      document.removeEventListener('DOMContentLoaded', domLoadedHandler);
      window.removeEventListener('load', domLoadedHandler);
      domLoadedHandler = null;
    }
    if (bodyObserver) {
      bodyObserver.disconnect();
      bodyObserver = null;
    }

    // 2. Root Container — STATIC on purpose: it must NOT create a stacking context,
    // so child layers' z-indexes participate at document level and can interleave
    // with the document-anchored boxes layer (overlay < boxes < ghost < popup < toolbar).
    const root = document.createElement('div');
    root.id = '__agent_inspector_container__';
    root.style.cssText = 'pointer-events:none;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;user-select:none;';

    // Inject CSS Styles
    const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes agentPulse { 0%,100% { transform: scale(1); opacity:1; } 50% { transform: scale(1.2); opacity:0.8; } }
    .agent-btn { cursor:pointer; font-size:12px; font-weight:500; border-radius:6px; border:none; transition:all 0.15s ease; font-family:inherit; }
    .agent-btn:hover { filter: brightness(1.15); transform: translateY(-1px); }
    .agent-btn:active { transform: translateY(0); }
  `;
  root.appendChild(styleEl);

  // 3. Global Store
  // NOTE: `box` and `elements[].rect` are stored in PAGE (document) coordinates so
  // annotations survive scrolling. Use `window.__agent_annotations_viewport__()` to
  // get viewport-relative coordinates (e.g. for cropping a viewport screenshot).
  window.__agent_annotations__ = [];
  window.__selected_elements__ = window.__agent_annotations__;
  window.__agent_annotations_viewport__ = () => {
    const sx = window.scrollX, sy = window.scrollY;
    return window.__agent_annotations__.map(a => ({
      ...a,
      box: { x: a.box.x - sx, y: a.box.y - sy, width: a.box.width, height: a.box.height },
      elements: a.elements.map(el => ({
        ...el,
        rect: { x: el.rect.x - sx, y: el.rect.y - sy, width: el.rect.width, height: el.rect.height }
      })),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      }
    }));
  };
  let annotationCounter = 0;
  let paused = false; // Pause mode: overlay releases pointer events so the page is interactive
  let folded = true;  // Folded mode: only the floating launcher is visible; bar & drag overlay are hidden
  let hidden = false; // Hidden mode: the whole UI (incl. launcher) is dismissed — annotations are kept

  // 4. Unified Floating Control Bar (morphs between a compact circular launcher when folded, and full toolbar when expanded)
  const toolbar = document.createElement('div');
  toolbar.id = '__agent_toolbar__';
  toolbar.style.cssText = 'position:fixed;right:20px;bottom:20px;background:linear-gradient(135deg,#0f172a,#1e293b);color:#f8fafc;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.12);pointer-events:auto;z-index:2147483649;backdrop-filter:blur(8px);transition:width 0.22s cubic-bezier(0.16,1,0.3,1),height 0.22s cubic-bezier(0.16,1,0.3,1),border-radius 0.22s cubic-bezier(0.16,1,0.3,1),padding 0.22s cubic-bezier(0.16,1,0.3,1);box-sizing:border-box;user-select:none;display:flex;align-items:center;justify-content:center;';

  // Folded view: circular launcher button with pencil icon and badge
  const foldedView = document.createElement('div');
  foldedView.id = '__agent_folded_view__';
  foldedView.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:22px;user-select:none;cursor:pointer;';
  foldedView.title = 'Open annotator (Alt+A \u00b7 drag to move)';
  foldedView.innerHTML = `
    <span id="__agent_fab_icon__">&#x270E;</span>
    <span id="__agent_fab_badge__" style="position:absolute;top:-4px;right:-4px;min-width:18px;height:18px;padding:0 4px;border-radius:9999px;background:#2563eb;color:#fff;font-size:11px;font-weight:700;display:none;align-items:center;justify-content:center;box-sizing:border-box;"></span>
  `;
  toolbar.appendChild(foldedView);

  // Expanded view: full multi-box annotation control toolbar
  const expandedView = document.createElement('div');
  expandedView.id = '__agent_expanded_view__';
  expandedView.style.cssText = 'display:none;align-items:center;gap:12px;white-space:nowrap;font-size:13px;';
  expandedView.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;cursor:move;">
      <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#10b981;box-shadow:0 0 8px #10b981;animation:agentPulse 2s infinite;"></span>
      <span style="font-weight:600;letter-spacing:-0.2px;">Multi-Box Annotator</span>
    </div>
    <span style="color:#64748b;height:12px;border-left:1px solid #334155;"></span>
    <span id="__agent_status__" style="color:#94a3b8;font-size:12px;cursor:move;">Drag to draw Box #1</span>
    <button id="__agent_pause_btn__" class="agent-btn" style="background:#f59e0b;color:#1e293b;padding:4px 10px;font-weight:600;">&#x23F8; Pause</button>
    <button id="__agent_clear_btn__" class="agent-btn" style="background:#334155;color:#e2e8f0;padding:4px 10px;">Clear All</button>
    <button id="__agent_fold_btn__" class="agent-btn" title="Fold into button (Alt+A)" style="background:#334155;color:#f8fafc;padding:4px 10px;font-weight:600;display:flex;align-items:center;gap:4px;">&#x25BE; Fold</button>
    <button id="__agent_close_btn__" class="agent-btn" title="Dismiss annotator — press Alt+A to reopen" style="background:#dc2626;color:#fff;padding:4px 10px;">&#x2715; Close</button>
  `;
  toolbar.appendChild(expandedView);
  root.appendChild(toolbar);

  function updateBadge() {
    const badge = document.getElementById('__agent_fab_badge__');
    const count = window.__agent_annotations__.length;
    if (badge) {
      badge.style.display = (folded && count > 0) ? 'flex' : 'none';
      badge.textContent = count > 99 ? '99+' : String(count);
    }
    toolbar.title = folded ? 'Open annotator (Alt+A \u00b7 drag to move)' : 'Annotator toolbar (drag to move)';
  }

  // Fold/unfold the unified bar.
  function setFoldedState(next) {
    folded = !!next;
    overlay.style.pointerEvents = (folded || paused) ? 'none' : 'auto';
    overlay.style.cursor = (folded || paused) ? 'default' : 'crosshair';

    if (folded) {
      toolbar.style.width = '48px';
      toolbar.style.height = '48px';
      toolbar.style.padding = '0';
      toolbar.style.borderRadius = '9999px';
      toolbar.style.cursor = 'pointer';
      foldedView.style.display = 'flex';
      expandedView.style.display = 'none';

      ghostBox.style.display = 'none';
      isDragging = false;
      popupLayer.innerHTML = '';
      updateBadge();
    } else {
      toolbar.style.width = 'auto';
      toolbar.style.height = 'auto';
      toolbar.style.minHeight = '42px';
      toolbar.style.padding = '7px 16px';
      toolbar.style.borderRadius = '9999px';
      toolbar.style.cursor = 'move';
      foldedView.style.display = 'none';
      expandedView.style.display = 'flex';

      // Keep toolbar safely within viewport bounds if dragged
      if (toolbar.style.left && toolbar.style.left !== 'auto') {
        requestAnimationFrame(() => {
          const w = toolbar.offsetWidth || 560;
          const h = toolbar.offsetHeight || 44;
          const maxLeft = Math.max(8, window.innerWidth - w - 8);
          const maxTop = Math.max(8, window.innerHeight - h - 8);
          const curLeft = parseFloat(toolbar.style.left);
          const curTop = parseFloat(toolbar.style.top);
          if (curLeft > maxLeft) toolbar.style.left = maxLeft + 'px';
          if (curTop > maxTop) toolbar.style.top = maxTop + 'px';
        });
      }
      updateStatus();
    }
  }

  // Hidden mode: dismiss the ENTIRE UI (bar, overlay, boxes) without
  // tearing anything down. The Alt+A hotkey summons it back.
  function setHiddenState(next) {
    hidden = !!next;
    root.style.display = hidden ? 'none' : '';
    boxesLayer.style.display = hidden ? 'none' : '';
    if (hidden) { popupLayer.innerHTML = ''; ghostBox.style.display = 'none'; isDragging = false; }
    updateBadge();
    updateStatus();
  }

  // Summon = reveal the UI and expand the bar, ready to annotate.
  function summon() {
    setHiddenState(false);
    setFoldedState(false);
  }

  // Hotkey semantics: toggle between folded and expanded, or unhide if hidden.
  function toggleLauncher() {
    if (hidden) {
      setHiddenState(false);
      setFoldedState(false);
    } else {
      setFoldedState(!folded);
    }
  }

  // Brief, non-blocking hint toast (e.g. the hotkey reminder after closing).
  function showHint(msg) {
    const old = document.getElementById('__agent_hint_toast__');
    if (old) old.remove();
    const toast = document.createElement('div');
    toast.id = '__agent_hint_toast__';
    toast.style.cssText = 'position:fixed;right:20px;bottom:20px;background:#0f172a;color:#f8fafc;padding:10px 16px;border-radius:9999px;font-size:13px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.12);z-index:2147483649;pointer-events:none;transition:opacity 0.4s;opacity:1;';
    toast.textContent = msg;
    (document.body || document.documentElement).appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; }, 3200);
    setTimeout(() => toast.remove(), 3700);
  }

  // 5. Drag interaction layer
  const overlay = document.createElement('div');
  overlay.id = '__agent_drag_overlay__';
  overlay.style.cssText = 'position:fixed;inset:0;cursor:crosshair;pointer-events:auto;z-index:2147483645;';
  root.appendChild(overlay);

  // Active drawing ghost box
  const ghostBox = document.createElement('div');
  ghostBox.style.cssText = 'position:fixed;border:2px dashed #3b82f6;background:rgba(59,130,246,0.12);pointer-events:none;display:none;z-index:2147483647;border-radius:4px;';
  root.appendChild(ghostBox);

  // Popup layer for adding/editing notes (above boxes, below toolbar)
  const popupLayer = document.createElement('div');
  popupLayer.id = '__agent_popup_layer__';
  popupLayer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483648;';
  root.appendChild(popupLayer);

  (document.body || document.documentElement).appendChild(root);

  // Persistent Boxes layer — anchored to the DOCUMENT (page coordinates) so boxes
  // scroll with the page content instead of being glued to the viewport.
  const boxesLayer = document.createElement('div');
  boxesLayer.id = '__agent_boxes_layer__';
  boxesLayer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483646;';
  (document.body || document.documentElement).appendChild(boxesLayer);

  // Measure the layer's origin in page coordinates (robust against body margins
  // or positioned ancestors shifting the containing block).
  const layerRect = boxesLayer.getBoundingClientRect();
  const layerOriginX = layerRect.left + window.scrollX;
  const layerOriginY = layerRect.top + window.scrollY;

  // Helper: compute clean CSS selector
  function getUniqueCssSelector(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.getAttribute('name')) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.getAttribute('name'))}"]`;
    if (el.getAttribute('role')) return `${el.tagName.toLowerCase()}[role="${CSS.escape(el.getAttribute('role'))}"]`;
    if (el.getAttribute('aria-label')) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(el.getAttribute('aria-label'))}"]`;

    const parts = [];
    let curr = el;
    while (curr && curr.nodeType === Node.ELEMENT_NODE && curr !== document.documentElement && curr !== document.body) {
      if (curr.id) {
        parts.unshift(`#${CSS.escape(curr.id)}`);
        break;
      }
      let tag = curr.nodeName.toLowerCase();
      let parent = curr.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(item => item.nodeName.toLowerCase() === tag);
        if (siblings.length > 1) {
          const index = siblings.indexOf(curr) + 1;
          tag += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(tag);
      curr = parent;
    }
    return parts.join(' > ');
  }

  function getAriaDescription(el) {
    return el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt') || '';
  }

  function updateStatus() {
    updateBadge();
    const statusEl = document.getElementById('__agent_status__');
    if (!statusEl) return;
    if (paused) {
      statusEl.innerHTML = `<span style="color:#f59e0b;font-weight:600;">Paused</span> <span style="color:#64748b;">— page is interactive, Resume to draw again</span>`;
      return;
    }
    const count = window.__agent_annotations__.length;
    if (count === 0) {
      statusEl.innerHTML = `Drag to draw Box #1`;
    } else {
      statusEl.innerHTML = `<span style="color:#10b981;font-weight:600;">${count} box${count > 1 ? 'es' : ''} active</span> <span style="color:#64748b;">(drag to add #${count + 1})</span>`;
    }
  }

  function renderAnnotationBox(anno) {
    const boxWrapper = document.createElement('div');
    boxWrapper.id = `__anno_${anno.id}__`;
    // anno.box is in page (document) coordinates; offset by the layer origin so the
    // absolute box stays glued to the page content across scrolling.
    boxWrapper.style.cssText = `position:absolute;left:${anno.box.x - layerOriginX}px;top:${anno.box.y - layerOriginY}px;width:${anno.box.width}px;height:${anno.box.height}px;border:2px solid #3b82f6;background:rgba(59,130,246,0.08);border-radius:4px;box-sizing:border-box;pointer-events:none;`;

    // Render highlight for each matched element inside the box
    anno.elements.forEach(elInfo => {
      const relX = elInfo.rect.x - anno.box.x;
      const relY = elInfo.rect.y - anno.box.y;
      const elHl = document.createElement('div');
      elHl.style.cssText = `position:absolute;left:${relX}px;top:${relY}px;width:${elInfo.rect.width}px;height:${elInfo.rect.height}px;border:1.5px solid #10b981;background:rgba(16,185,129,0.15);box-sizing:border-box;border-radius:2px;`;
      boxWrapper.appendChild(elHl);
    });

    // Header badge
    const header = document.createElement('div');
    header.style.cssText = `position:absolute;bottom:100%;left:-2px;margin-bottom:4px;display:flex;align-items:center;gap:6px;pointer-events:auto;z-index:10;`;

    // Number Tag
    const numBadge = document.createElement('div');
    numBadge.style.cssText = `background:#2563eb;color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px;box-shadow:0 2px 4px rgba(0,0,0,0.3);`;
    numBadge.textContent = `#${anno.number}`;
    header.appendChild(numBadge);

    // Comment Badge (click or double-click to edit — works in both draw and pause modes)
    const commentBadge = document.createElement('div');
    commentBadge.style.cssText = `background:#0f172a;color:#f8fafc;font-size:11px;padding:2px 8px;border-radius:4px;border:1px solid #334155;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;box-shadow:0 2px 4px rgba(0,0,0,0.3);`;
    commentBadge.title = 'Double-click to edit comment';
    commentBadge.textContent = anno.comment ? `💬 ${anno.comment}` : `+ Add comment`;
    const openEditor = (e) => {
      e.stopPropagation();
      e.preventDefault();
      openCommentPopup(anno);
    };
    commentBadge.addEventListener('click', openEditor);
    commentBadge.addEventListener('dblclick', openEditor);
    header.appendChild(commentBadge);

    // Delete Button
    const delBtn = document.createElement('button');
    delBtn.style.cssText = `background:#475569;color:#fff;border:none;border-radius:4px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:11px;line-height:1;padding:0;`;
    delBtn.innerHTML = '×';
    delBtn.title = 'Remove this annotation';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.__agent_annotations__ = window.__agent_annotations__.filter(a => a.id !== anno.id);
      window.__selected_elements__ = window.__agent_annotations__;
      anchors.delete(anno.id);
      popupLayer.innerHTML = ''; // close any open comment popup for the deleted box
      boxWrapper.remove();
      updateStatus();
    });
    header.appendChild(delBtn);

    boxWrapper.appendChild(header);
    boxesLayer.appendChild(boxWrapper);
  }

  function openCommentPopup(anno) {
    popupLayer.innerHTML = '';
    const popup = document.createElement('div');
    // anno.box is in page coordinates; the popup is fixed to the viewport, so convert.
    const vpX = anno.box.x - window.scrollX;
    const vpY = anno.box.y - window.scrollY;
    // Place BELOW the badge row (not over it — a double-click's 2nd click must land on
    // the badge) and keep clear of the viewport edges.
    const posX = Math.max(10, Math.min(window.innerWidth - 300, vpX));
    const posY = Math.max(68, Math.min(window.innerHeight - 60, vpY + 22));

    popup.style.cssText = `position:fixed;left:${posX}px;top:${posY}px;background:#0f172a;padding:6px 10px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.15);display:flex;align-items:center;gap:6px;pointer-events:auto;z-index:2147483648;`;

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Instruction / note for Box #${anno.number}...`;
    input.value = anno.comment || '';
    input.style.cssText = `background:#1e293b;border:1px solid #475569;color:#f8fafc;padding:5px 8px;border-radius:4px;font-size:12px;width:220px;outline:none;`;

    const saveBtn = document.createElement('button');
    saveBtn.className = 'agent-btn';
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = `background:#2563eb;color:#fff;padding:5px 10px;`;

    const dismiss = () => { popupLayer.innerHTML = ''; };

    const save = () => {
      const val = input.value.trim();
      anno.comment = val || null;
      window.__selected_elements__ = window.__agent_annotations__;
      const existing = document.getElementById(`__anno_${anno.id}__`);
      if (existing) existing.remove();
      renderAnnotationBox(anno);
      dismiss();
    };

    saveBtn.addEventListener('click', save);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      if (e.key === 'Escape') dismiss();
    });

    popup.appendChild(input);
    popup.appendChild(saveBtn);
    popupLayer.appendChild(popup);

    setTimeout(() => input.focus(), 30);
  }

  let startX = 0, startY = 0, isDragging = false;

  // ===== Element Anchoring Engine (v1) =====
  // Boxes are anchored to the DOM elements captured at draw time. The box keeps its
  // original spatial relationship to the union bounding rect of those elements
  // (normalized fit ratios derived from the original box area vs element area) and is
  // re-fitted live when the layout changes (resizes, class/style mutations, inner scrolls).
  const anchors = new Map(); // annoId -> { anno, els: Element[], fit: {x,y,w,h} }

  function unionRectOf(els) {
    const live = els.filter(el => el && el.isConnected);
    if (!live.length) return null;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const el of live) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const px = r.x + window.scrollX, py = r.y + window.scrollY;
      x1 = Math.min(x1, px); y1 = Math.min(y1, py);
      x2 = Math.max(x2, px + r.width); y2 = Math.max(y2, py + r.height);
    }
    if (x1 > x2 || y1 > y2) return null;
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  }

  function registerAnchor(anno, els) {
    const u = unionRectOf(els);
    if (!u || u.width <= 0 || u.height <= 0) return;
    // Normalized relationship of the dragged box to the element union rect.
    const fit = {
      x: (anno.box.x - u.x) / u.width,
      y: (anno.box.y - u.y) / u.height,
      w: anno.box.width / u.width,
      h: anno.box.height / u.height
    };
    anchors.set(anno.id, { anno, els, fit });
    for (const el of els) { try { resizeObserver.observe(el); } catch (_) {} }
    anno.anchored = true;
    scheduleReanchor();
  }

  function reanchorAll() {
    for (const a of anchors.values()) {
      const u = unionRectOf(a.els);
      if (!u) continue; // all anchored elements detached/hidden — keep the box as-is
      const next = {
        x: u.x + a.fit.x * u.width,
        y: u.y + a.fit.y * u.height,
        width: a.fit.w * u.width,
        height: a.fit.h * u.height
      };
      // Always refresh the stored element rects so the agent store stays truthful.
      a.anno.elements.forEach((info, i) => {
        const el = a.els[i];
        if (!el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        info.rect = {
          x: Math.round(r.x + window.scrollX),
          y: Math.round(r.y + window.scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height)
        };
      });
      const b = a.anno.box;
      const changed = Math.abs(next.x - b.x) > 0.5 || Math.abs(next.y - b.y) > 0.5 ||
                      Math.abs(next.width - b.width) > 0.5 || Math.abs(next.height - b.height) > 0.5;
      if (!changed) continue;
      a.anno.box = {
        x: Math.round(next.x),
        y: Math.round(next.y),
        width: Math.round(next.width),
        height: Math.round(next.height)
      };
      const old = document.getElementById(`__anno_${a.anno.id}__`);
      if (old) old.remove();
      renderAnnotationBox(a.anno);
    }
  }

  let reanchorQueued = false;
  function scheduleReanchor() {
    if (reanchorQueued) return;
    reanchorQueued = true;
    requestAnimationFrame(() => { reanchorQueued = false; reanchorAll(); });
  }

  const resizeObserver = new ResizeObserver(() => scheduleReanchor());
  const mutationObserver = new MutationObserver((muts) => {
    for (const m of muts) {
      const t = m.target.nodeType === Node.ELEMENT_NODE ? m.target : m.target.parentElement;
      // Ignore mutations caused by our own overlay DOM (prevents feedback loops).
      if (t && (t.closest('#__agent_inspector_container__') || t.closest('#__agent_boxes_layer__'))) continue;
      scheduleReanchor();
      return;
    }
  });
  const targetToObserve = document.body || document.documentElement;
  if (targetToObserve) {
    mutationObserver.observe(targetToObserve, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden']
    });
  }
  window.addEventListener('scroll', scheduleReanchor, { capture: true, passive: true });
  window.addEventListener('resize', scheduleReanchor);

  overlay.addEventListener('mousedown', (e) => {
    if (e.target.closest('#__agent_toolbar__') || e.target.closest('#__agent_popup_layer__')) return;
    startX = e.clientX;
    startY = e.clientY;
    isDragging = true;
    ghostBox.style.left = startX + 'px';
    ghostBox.style.top = startY + 'px';
    ghostBox.style.width = '0px';
    ghostBox.style.height = '0px';
    ghostBox.style.display = 'block';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const currentX = e.clientX;
    const currentY = e.clientY;
    const left = Math.min(startX, currentX);
    const top = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);

    ghostBox.style.left = left + 'px';
    ghostBox.style.top = top + 'px';
    ghostBox.style.width = width + 'px';
    ghostBox.style.height = height + 'px';
  });

  window.addEventListener('mouseup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    const rect = ghostBox.getBoundingClientRect();
    ghostBox.style.display = 'none';

    if (rect.width < 10 || rect.height < 10) return;

    const boxArea = rect.width * rect.height;

    // Discover elements inside box
    const rawCandidates = Array.from(document.querySelectorAll('body *')).filter(el => {
      if (el.closest('#__agent_inspector_container__')) return false;
      if (['path', 'g', 'defs', 'clippath', 'polygon', 'polyline', 'circle', 'rect', 'line'].includes(el.tagName.toLowerCase())) {
        if (el.closest('svg')) return false;
      }
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;

      // Filter out giant containers
      const elArea = r.width * r.height;
      if (elArea > boxArea * 1.8 && (r.width > rect.width * 1.5 || r.height > rect.height * 1.5)) return false;

      // Center-in-box check
      const centerX = r.left + r.width / 2;
      const centerY = r.top + r.height / 2;
      const centerInBox = (centerX >= rect.left && centerX <= rect.right && centerY >= rect.top && centerY <= rect.bottom);

      // Overlap ratio check
      const overlapX = Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left));
      const overlapY = Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
      const overlapArea = overlapX * overlapY;

      if (!centerInBox && (overlapArea / elArea < 0.5)) return false;

      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;

      return true;
    });

    const filtered = rawCandidates.filter(el => {
      const hasContainedDescendant = rawCandidates.some(other => other !== el && el.contains(other));
      if (hasContainedDescendant) {
        return ['BUTTON', 'A'].includes(el.tagName);
      }
      return true;
    });

    const finalElements = filtered.filter(el => {
      if (el.tagName === 'SPAN' || el.tagName === 'DIV' || el.tagName === 'SVG') {
        const interactiveParent = el.closest('button, a, [role="button"]');
        if (interactiveParent && filtered.includes(interactiveParent)) return false;
      }
      return true;
    });

    // Element rects are stored in page (document) coordinates so they stay valid
    // across scrolling (convert back to viewport coords via __agent_annotations_viewport__).
    const elements = finalElements.map(el => {
      const r = el.getBoundingClientRect();
      return {
        tagName: el.tagName.toLowerCase(),
        id: el.id || null,
        name: el.getAttribute('name') || null,
        className: el.className ? String(el.className) : null,
        selector: getUniqueCssSelector(el),
        ariaLabel: getAriaDescription(el) || null,
        role: el.getAttribute('role') || null,
        text: (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 100) || null,
        value: el.value || null,
        href: el.href || null,
        rect: {
          x: Math.round(r.x + window.scrollX),
          y: Math.round(r.y + window.scrollY),
          width: Math.round(r.width),
          height: Math.round(r.height)
        }
      };
    });

    annotationCounter++;
    const anno = {
      id: `anno_${Date.now()}_${annotationCounter}`,
      number: annotationCounter,
      createdAt: Date.now(),
      // Box is in page (document) coordinates — survives scrolling.
      box: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      scroll: {
        x: Math.round(window.scrollX),
        y: Math.round(window.scrollY)
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio || 1
      },
      comment: null,
      elements
    };

    window.__agent_annotations__.push(anno);
    window.__selected_elements__ = window.__agent_annotations__;

    renderAnnotationBox(anno);
    // Anchor the box to the captured elements so it follows layout changes online.
    if (finalElements.length > 0) registerAnchor(anno, finalElements);
    updateStatus();

    // Auto-open comment input for newly added box
    openCommentPopup(anno);
  });

  // Toolbar button handlers
  // ---- Draggable unified control widget (drag to reposition; clicks on folded circle expand immediately) ----
  let barDrag = null, barMoved = false;
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button, input')) return; // buttons remain clickable
    e.preventDefault();
    e.stopPropagation();
    const r = toolbar.getBoundingClientRect();
    // Switch from right/bottom anchoring to absolute positioning at the grabbed point.
    toolbar.style.right = 'auto';
    toolbar.style.bottom = 'auto';
    toolbar.style.left = r.left + 'px';
    toolbar.style.top = r.top + 'px';
    barDrag = { dx: e.clientX - r.left, dy: e.clientY - r.top, startX: e.clientX, startY: e.clientY };
    barMoved = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!barDrag) return;
    if (Math.abs(e.clientX - barDrag.startX) > 4 || Math.abs(e.clientY - barDrag.startY) > 4) {
      barMoved = true;
    }
    const w = toolbar.offsetWidth, h = toolbar.offsetHeight;
    const x = Math.max(8, Math.min(window.innerWidth - w - 8, e.clientX - barDrag.dx));
    const y = Math.max(8, Math.min(window.innerHeight - h - 8, e.clientY - barDrag.dy));
    toolbar.style.left = x + 'px';
    toolbar.style.top = y + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!barDrag) return;
    const wasClick = !barMoved;
    barDrag = null;
    if (wasClick && folded) {
      setFoldedState(false);
    }
  });

  // ---- Global hotkey: Alt+A summons/dismisses the annotator from anywhere ----
  // While hidden it brings back the floating launcher FOLDED (click it to open
  // the bar); while the UI is visible it dismisses everything. Nothing is destroyed.
  function onGlobalHotkey(e) {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.code === 'KeyA') {
      e.preventDefault();
      e.stopPropagation();
      toggleLauncher();
    }
  }
  window.addEventListener('keydown', onGlobalHotkey, true);

  document.getElementById('__agent_pause_btn__').addEventListener('click', (e) => {
    e.stopPropagation();
    paused = !paused;
    // Release the drag overlay so the underlying page (menus, dropdowns, links) is interactive.
    overlay.style.pointerEvents = (paused || folded) ? 'none' : 'auto';
    overlay.style.cursor = (paused || folded) ? 'default' : 'crosshair';
    const btn = document.getElementById('__agent_pause_btn__');
    btn.innerHTML = paused ? '&#x25B6; Resume' : '&#x23F8; Pause';
    btn.style.background = paused ? '#10b981' : '#f59e0b';
    btn.style.color = paused ? '#fff' : '#1e293b';
    if (paused) { ghostBox.style.display = 'none'; isDragging = false; }
    updateStatus();
  });

  document.getElementById('__agent_clear_btn__').addEventListener('click', (e) => {
    e.stopPropagation();
    boxesLayer.innerHTML = '';
    popupLayer.innerHTML = '';
    window.__agent_annotations__ = [];
    window.__selected_elements__ = [];
    anchors.clear();
    annotationCounter = 0;
    updateStatus();
  });

  // Unified teardown — also exposed globally so re-injection can fully replace
  // a previous instance (DOM + observers + window listeners).
  teardown = () => {
    anchors.clear();
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener('keydown', onGlobalHotkey, true);
    document.getElementById('__agent_hint_toast__')?.remove();
    root.remove();
    boxesLayer.remove(); // boxes layer lives outside root (document-anchored)
    if (window.__agent_annotator_cleanup__ === teardown) delete window.__agent_annotator_cleanup__;
    if (window.__playwright_companion__?.modules?.annotator) {
      delete window.__playwright_companion__.modules.annotator;
    }
  };
  window.__agent_annotator_cleanup__ = teardown;

  // Register with Playwright Companion namespace
  window.__playwright_companion__ = window.__playwright_companion__ || {
    version: '1.0.0',
    modules: {}
  };

  window.__playwright_companion__.modules.annotator = {
    version: '1.5.0',
    ready: true,
    get paused() { return paused; },
    get folded() { return folded; },
    get hidden() { return hidden; },
    setPaused(state) {
      if (paused !== !!state) {
        document.getElementById('__agent_pause_btn__')?.click();
      }
    },
    setFolded(state) {
      if (hidden) setHiddenState(false);
      setFoldedState(!!state);
    },
    toggleFolded() {
      if (hidden) { summon(); return; }
      setFoldedState(!folded);
    },
    show() {
      summon();
    },
    hide() {
      setHiddenState(true);
    },
    toggleVisibility() {
      toggleLauncher();
    },
    clear() {
      document.getElementById('__agent_clear_btn__')?.click();
    },
    getAnnotations() {
      return window.__agent_annotations__;
    },
    getViewportAnnotations() {
      return typeof window.__agent_annotations_viewport__ === 'function'
        ? window.__agent_annotations_viewport__()
        : window.__agent_annotations__;
    },
    getActiveBoxCount() {
      return window.__agent_annotations__ ? window.__agent_annotations__.length : 0;
    },
    cleanup() {
      teardown();
    }
  };

  document.getElementById('__agent_fold_btn__').addEventListener('click', (e) => {
    e.stopPropagation();
    setFoldedState(true);
  });

  document.getElementById('__agent_close_btn__').addEventListener('click', (e) => {
    e.stopPropagation();
    // Close is non-destructive: it hides the whole UI but keeps every annotation
    // and the Alt+A hotkey alive. Full teardown stays available via cleanup().
    setHiddenState(true);
    showHint('Annotator closed \u2014 press Alt+A to reopen');
  });

  // Mounted folded by default (non-intrusive floating launcher). Explicit agent
  // injection can open the bar right away by setting
  // `window.__playwright_companion_autostart__ = 'expanded'` before loading.
  setFoldedState(window.__playwright_companion_autostart__ !== 'expanded');
  } // end init()

  if (!document.body) {
    domLoadedHandler = () => {
      if (document.body) init();
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', domLoadedHandler, { once: true });
      window.addEventListener('load', domLoadedHandler, { once: true });
    }
    if (document.documentElement) {
      bodyObserver = new MutationObserver(() => {
        if (document.body) {
          if (bodyObserver) {
            bodyObserver.disconnect();
            bodyObserver = null;
          }
          init();
        }
      });
      bodyObserver.observe(document.documentElement, { childList: true });
    }
  } else {
    init();
  }

  return initialized
    ? "Playwright Companion (Annotator v1.5.0) ready!"
    : "Playwright Companion (Annotator v1.5.0) initialized (waiting for DOM)";
})();
