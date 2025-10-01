import "../../token_switcher/switcher.js";
import "../../swatch_maker/swatch_maker.js";


// token-swatch-overlays.js
// Requires hooks in main script:
//   swatch:created
//   expander:before-append / expander:after-append
//   expander:before-replace / expander:after-replace

(() => {
  const SETTLE_MS = 24;  // let CSS settle (0–64 typical)
  const FADE_MS   = 120; // overlay fade-out

  // Offscreen probe (resolve var(--token) to a concrete color in page context)
  const PROBE = (() => {
    const el = document.createElement("div");
    el.style.cssText =
      "position:absolute;left:-99999px;top:-99999px;width:0;height:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(el);
    return el;
  })();

  const resolveTokenColor = (token) => {
    if (!token) return "";
    PROBE.style.background = `var(${token})`;
    return getComputedStyle(PROBE).backgroundColor || "";
  };

  const addSwapAllow = (sw) => {
    if (!sw || sw.dataset.swapAllowBound === "1") return;
    sw.setAttribute("data-swap-allow", "mode colorTheme");
    sw.dataset.swapAllowBound = "1";
  };

  // --- Overlay helpers ------------------------------------------------------

  const getOverlay = (sw) => sw?.querySelector?.(":scope > .swatch-freeze-overlay") || null;

  const ensureRelPos = (sw) => {
    if (!sw) return;
    const cs = getComputedStyle(sw).position;
    if (cs === "static") {
      // only set inline if needed, and remember to restore
      if (!sw.dataset._prevPos) sw.dataset._prevPos = sw.style.position || "";
      sw.style.position = "relative";
      sw.dataset._posHack = "1";
    }
  };

  const restorePos = (sw) => {
    if (!sw?.dataset?._posHack) return;
    sw.style.position = sw.dataset._prevPos || "";
    delete sw.dataset._prevPos;
    delete sw.dataset._posHack;
  };

  const makeOverlay = (sw, color) => {
    if (!sw) return null;
    // reuse if present
    const existing = getOverlay(sw);
    if (existing) {
      existing.style.background = color || existing.style.background;
      return existing;
    }
    ensureRelPos(sw);
    const fill = sw.querySelector(".swatch-fill");
    const br = fill ? getComputedStyle(fill).borderRadius : getComputedStyle(sw).borderRadius;

    const ov = document.createElement("div");
    ov.className = "swatch-freeze-overlay";
    ov.style.position = "absolute";
    ov.style.inset = "0";
    ov.style.zIndex = "1";
    ov.style.pointerEvents = "none";
    ov.style.background = color || "";
    ov.style.borderRadius = br || "";
    ov.style.opacity = "1";
    ov.style.willChange = "opacity";
    ov.style.transition = "none";

    sw.appendChild(ov);
    return ov;
  };

  const fadeOutAndRemove = (sw) => {
    const ov = getOverlay(sw);
    if (!ov) return;
    // fade and remove
    ov.style.transition = `opacity ${FADE_MS}ms ease`;
    requestAnimationFrame(() => {
      ov.style.opacity = "0";
      setTimeout(() => {
        ov.remove();
        // if we applied a relative position hack and no overlay remains, restore
        if (!getOverlay(sw)) restorePos(sw);
      }, FADE_MS + 16);
    });
  };

  // settle helper: microtask → 2 RAFs → small delay
  const settleThen = (fn) => {
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setTimeout(fn, SETTLE_MS));
      });
    });
  };

  // --- Hooks from your main script ------------------------------------------

  // Cards: just add the attribute (no overlay needed)
  document.addEventListener("swatch:created", (e) => {
    const sw = e.detail?.swatch;
    if (sw) addSwapAllow(sw);
  });

  // Expander: BEFORE append — create overlay with the *final* color
  document.addEventListener("expander:before-append", (e) => {
    const exp = e.detail?.exp;
    const token = e.detail?.token;
    if (!exp || !token) return;

    const sw = exp.querySelector(".swatch");
    addSwapAllow(sw);

    const color = resolveTokenColor(token);
    makeOverlay(sw, color);
  });

  // Expander: AFTER append — let CSS settle, then fade overlay away
  document.addEventListener("expander:after-append", (e) => {
    const exp = e.detail?.el;
    if (!exp) return;
    const sw = exp.querySelector(".swatch");
    settleThen(() => fadeOutAndRemove(sw));
  });

  // Expander refresh: BEFORE replace — prep the fresh swatch off-DOM
  document.addEventListener("expander:before-replace", (e) => {
    const fresh = e.detail?.fresh;
    const token = e.detail?.token;
    if (!fresh || !token) return;

    const sw = fresh.querySelector(".swatch");
    addSwapAllow(sw);

    const color = resolveTokenColor(token);
    makeOverlay(sw, color);
  });

  // Expander refresh: AFTER replace — fade overlay after settle
  document.addEventListener("expander:after-replace", (e) => {
    const fresh = e.detail?.el;
    if (!fresh) return;
    const sw = fresh.querySelector(".swatch");
    settleThen(() => fadeOutAndRemove(sw));
  });

  // Live theme/mode/colorTheme changes while expander is open:
  // Freeze current visible color instantly, then thaw after settle.
  const LIVE_EVENTS = [
    "themechange","modechange","colorthemechange","colorThemeChange","colorschemechange"
  ];
  const onLiveChange = () => {
    document.querySelectorAll(".expander .swatch").forEach((sw) => {
      const fill = sw.querySelector(".swatch-fill");
      const current = fill ? getComputedStyle(fill).backgroundColor : "";
      if (!current) return;
      const ov = makeOverlay(sw, current);
      // if another change comes fast, we’ll just update the overlay color; thaw once stable
      settleThen(() => fadeOutAndRemove(sw));
    });
  };
  LIVE_EVENTS.forEach((ev) => window.addEventListener(ev, onLiveChange));
})();
