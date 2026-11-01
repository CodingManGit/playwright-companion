/**
 * Playwright Companion - Init Script Bootstrap Loader
 * 
 * Used with Playwright MCP's `--init-script` flag to automatically mount
 * the companion suite into every browser page and tab upon navigation.
 * 
 * Usage in Playwright MCP command:
 *   npx @playwright/mcp@latest ... --init-script ./loader.js
 */
(function() {
  if (typeof window === 'undefined') return;

  // Prevent multiple executions in the same execution context
  if (window.__playwright_companion_loader_initialized__) return;
  window.__playwright_companion_loader_initialized__ = true;

  const COMPANION_CDN_URL = 'https://cdn.jsdelivr.net/gh/CodingManGit/playwright-companion@main/scripts/annotator.js';

  function mountCompanion() {
    // If annotator is already loaded, skip
    if (window.__playwright_companion__?.modules?.annotator?.ready) return;

    // Strategy 1: Attempt standard script injection from CDN
    const script = document.createElement('script');
    script.src = COMPANION_CDN_URL;
    script.async = false;
    script.onerror = () => {
      // Fallback Strategy 2: If strict webpage CSP blocks external CDN tags, attempt fetch + eval
      fetch(COMPANION_CDN_URL)
        .then(res => res.text())
        .then(code => (0, eval)(code))
        .catch(err => {
          console.warn('[Playwright Companion] Failed to load companion scripts:', err);
        });
    };

    const target = document.head || document.documentElement || document.body;
    if (target) {
      target.appendChild(script);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        (document.head || document.documentElement || document.body).appendChild(script);
      }, { once: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountCompanion, { once: true });
  } else {
    mountCompanion();
  }
})();
