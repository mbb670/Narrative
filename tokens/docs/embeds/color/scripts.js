import "../../token_switcher/switcher.js";
import "../../swatch_maker/swatch_maker.js";

(() => {
  const ATTR = "data-swap-allow";
  const VALUE = "mode colorTheme";

  const setSwapAllow = (el) => {
    if (!el || el.nodeType !== 1) return;
    if (!el.classList.contains("swatch")) return;
    if (el.getAttribute(ATTR) === VALUE) return; // already set as desired
    el.setAttribute(ATTR, VALUE);
  };

  // Tag any existing .swatch on load
  const sweep = () => document.querySelectorAll(".swatch").forEach(setSwapAllow);

  // Watch for future .swatch insertions (cards, expanders, etc.)
  const startObserver = () => {
    const obs = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList?.contains("swatch")) setSwapAllow(node);
          node.querySelectorAll?.(".swatch").forEach(setSwapAllow);
        }
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { sweep(); startObserver(); }, { once: true });
  } else {
    sweep();
    startObserver();
  }
})();

