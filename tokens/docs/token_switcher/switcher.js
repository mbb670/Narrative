// You can set any subset; all are optional.
// It's fine if this runs AFTER the external script loads.

// window.tokenSwapDefaults = {
//   // "auto" | "mobile" | "tablet" | "desktop"
//   breakpoint: "auto",

//   // "light" | "dark"
//   theme: "light",

//   // "default" | "slate"
//   colorTheme: "default",

//   // "default" | "opinion" | "lifestyle"
//   fontTheme: "default"
// };

(function () {
  "use strict";

  // =======================
  // constants / config
  // =======================
  const KEYS = ["theme", "colorTheme", "fontTheme", "breakpoint"];
  const BREAKPOINTS = [
    { label: "desktop", min: 1024 },
    { label: "tablet", min: 640 },
    { label: "mobile", min: 0 }
  ];

  // token text class shapes (matches your CSS utilities)
  const TOKEN_TEXT_RE = /^text-(display|headline|subheadline|body|system|uppercase)-(regular|semibold)-(lg|md|sm|xs)$/;

  // =======================
  // defaults plumbing (works even if set later in CodePen)
  // =======================
  let _extDefaults = null; // last-seen defaults object
  let _defaultsAppliedOnce = false; // guard so we don't re-apply identical defaults
  let _pendingDefaults = null; // stash if UI not ready yet

  // Allow both names, just in case
  defineReactiveDefaultsProp("tokenSwapDefaults");
  defineReactiveDefaultsProp("TOKEN_SWAP_DEFAULTS");

  // Public API as well
  window.tokenSwap = window.tokenSwap || {};
  window.tokenSwap.setDefaults = function (def) {
    _extDefaults = sanitizeDefaults(def);
    tryApplyDefaults(); // will update UI + styles
  };

  function defineReactiveDefaultsProp(name) {
    try {
      let _store;
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          return _store;
        },
        set(v) {
          _store = v;
          _extDefaults = sanitizeDefaults(v);
          // Defer to next microtask so UI has a chance to mount
          queueMicrotask(tryApplyDefaults);
        }
      });
    } catch (_) {
      // If defineProperty fails for any reason, we’ll fall back to polling in run()
    }
  }

  function sanitizeDefaults(obj) {
    if (!obj || typeof obj !== "object") return null;
    const out = {};
    if (typeof obj.theme === "string" && /^(light|dark)$/.test(obj.theme))
      out.theme = obj.theme;
    if (
      typeof obj.colorTheme === "string" &&
      /^(default|slate)$/.test(obj.colorTheme)
    )
      out.colorTheme = obj.colorTheme;
    if (
      typeof obj.fontTheme === "string" &&
      /^(default|opinion|lifestyle)$/.test(obj.fontTheme)
    )
      out.fontTheme = obj.fontTheme;
    if (
      typeof obj.breakpoint === "string" &&
      /^(auto|mobile|tablet|desktop)$/.test(obj.breakpoint)
    )
      out.breakpoint = obj.breakpoint;
    return Object.keys(out).length ? out : null;
  }

  function optionExists(select, value) {
    return !!(
      select && Array.from(select.options).find((o) => o.value === value)
    );
  }

  function tryApplyDefaults() {
    // If we haven't got anything to apply, stop.
    if (!_extDefaults) return;

    // If controls aren't in the DOM yet, stash & try later
    const tray = document.querySelector("#token-swap-root");
    if (!tray) {
      _pendingDefaults = _extDefaults;
      return;
    }

    // If we already applied the exact same object once, skip
    if (_defaultsAppliedOnce && _pendingDefaults == null) {
      // still allow explicit programmatic calls to re-apply:
      // you can call window.tokenSwap.setDefaults again with a new object
      return;
    }

    // Apply to UI as if the user selected them
    const root = document.documentElement;

    // THEME segmented
    if (_extDefaults.theme) {
      const btn = tray.querySelector(
        `#switch-theme [data-value="${_extDefaults.theme}"]`
      );
      if (btn) btn.click();
    }

    // COLOR THEME
    if (_extDefaults.colorTheme) {
      const sel = tray.querySelector("#switch-colorTheme select");
      if (optionExists(sel, _extDefaults.colorTheme)) {
        sel.value = _extDefaults.colorTheme;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // FONT THEME
    if (_extDefaults.fontTheme) {
      const sel = tray.querySelector("#switch-fontTheme select");
      if (optionExists(sel, _extDefaults.fontTheme)) {
        sel.value = _extDefaults.fontTheme;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    // BREAKPOINT
    if (_extDefaults.breakpoint) {
      const sel = tray.querySelector("#switch-breakpoint select");
      if (optionExists(sel, _extDefaults.breakpoint)) {
        sel.value = _extDefaults.breakpoint;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (_extDefaults.breakpoint === "auto" && sel) {
        sel.value = "auto";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    _defaultsAppliedOnce = true;
    _pendingDefaults = null;
  }

  // =======================
  // small utils
  // =======================
  function ensureLink(attrs, { prepend = false } = {}) {
    const exists = Array.from(
      document.head.querySelectorAll(`link[rel="${attrs.rel}"]`)
    ).some((l) => l.getAttribute("href") === attrs.href);
    if (exists) return;
    const el = document.createElement("link");
    for (const [k, v] of Object.entries(attrs)) {
      if (v === true || v === "") el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
    prepend ? document.head.prepend(el) : document.head.append(el);
  }

  function injectHeadLinks() {
    ensureLink(
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { prepend: true }
    );
    ensureLink(
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
      { prepend: true }
    );
    ensureLink({
      rel: "stylesheet",
      href:
        "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wdth,wght@0,62.5..100,100..900;1,62.5..100,100..900&family=Noto+Serif:ital,wdth,wght@0,62.5..100,100..900;1,62.5..100,100..900&family=Playfair+Display:ital,wght@0,400..900;1,400..900&display=swap"
    });
    ensureLink({
      rel: "stylesheet",
      href: "https://use.typekit.net/otq8kpk.css"
    });
  }

  // native <select> flicker guard (scoped)
  const NO_TRANSITION_STYLE_ID = "token-swap-no-transitions";
  function pauseTransitions(ms = 350) {
    let styleEl = document.getElementById(NO_TRANSITION_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = NO_TRANSITION_STYLE_ID;
      styleEl.textContent = `
#token-swap-root, #token-swap-root * {
  transition: none !important;
  animation: none !important;
}`;
      document.head.appendChild(styleEl);
    }
    styleEl.disabled = false;
    clearTimeout(pauseTransitions._t);
    pauseTransitions._t = setTimeout(() => {
      styleEl.disabled = true;
    }, ms);
  }

  // =======================
  // UI injection
  // =======================
  function injectBodyUI() {
    if (document.querySelector("#token-swap-root")) return;

    const html = `
<div id="token-swap-root" class="token-swap" data-swap-exclude="fontTheme breakpoint">

  <!-- Theme segmented toggle -->
  <div id="switch-theme" class="switcher switcher-theme" role="radiogroup" aria-label="Theme">
    <button type="button" class="switcher-btn" role="radio" aria-checked="true"  data-value="light">Light</button>
    <button type="button" class="switcher-btn" role="radio" aria-checked="false" data-value="dark">Dark</button>
  </div>

  <!-- fontTheme -->
  <div id="switch-fontTheme" class="switcher switcher-fontTheme other-switch" data-group="fontTheme">
    <label>fontTheme
      <select class="text-system-regular-sm token-swap-select">
        <option value="default">default</option>
        <option value="opinion">opinion</option>
        <option value="lifestyle">lifestyle</option>
      </select>
    </label>
  </div>

  <!-- colorTheme -->
  <div id="switch-colorTheme" class="switcher switcher-colorTheme other-switch" data-group="colorTheme">
    <label>colorTheme
      <select class="text-system-regular-sm token-swap-select">
        <option value="default">default</option>
        <option value="slate">slate</option>
      </select>
    </label>
  </div>

  <!-- breakpoint -->
  <div id="switch-breakpoint" class="switcher switcher-breakpoint other-switch" data-group="breakpoint">
    <label>breakpoint
      <select class="text-system-regular-sm token-swap-select" id="bp-select">
        <option value="auto" selected>auto</option>
        <option value="mobile">mobile</option>
        <option value="tablet">tablet</option>
        <option value="desktop">desktop</option>
      </select>
    </label>
  </div>

</div>`;
    (document.body || document.documentElement).insertAdjacentHTML(
      "afterbegin",
      html
    );
  }

  // =======================
  // env helpers
  // =======================
  function getEnv() {
    const r = document.documentElement;
    return {
      theme: r.getAttribute("data-mode") || "light",
      colorTheme: r.getAttribute("data-colorTheme") || "default",
      fontTheme: r.getAttribute("data-fontTheme") || "default",
      breakpoint: r.hasAttribute("data-breakpoint")
        ? r.getAttribute("data-breakpoint")
        : "auto"
    };
  }

  function currentAutoBreakpointLabel() {
    for (const bp of BREAKPOINTS) {
      if (bp.min === 0 || window.matchMedia(`(min-width:${bp.min}px)`).matches)
        return bp.label;
    }
    return "mobile";
  }

  const parseKeys = (s) =>
    (s || "")
      .trim()
      .split(/\s+/)
      .filter((k) => KEYS.includes(k));

  // =======================
  // presentation rebinds (fix inheritance)
  // =======================
  function getNearestTokenTextClasses(el) {
    let n = el.parentElement;
    while (n) {
      const matches = [...n.classList].filter((c) => TOKEN_TEXT_RE.test(c));
      if (matches.length) return matches;
      n = n.parentElement;
    }
    return [];
  }

  function ensureClasses(el, classListStr) {
    if (!classListStr) return;
    classListStr
      .trim()
      .split(/\s+/)
      .forEach((c) => {
        if (c) el.classList.add(c);
      });
  }

  function ensureThemeBubble(el) {
    let wrap = el.querySelector(":scope > [data-swap-theme-bubble]");
    if (!wrap) {
      wrap = document.createElement("span");
      wrap.setAttribute("data-swap-theme-bubble", "");
      wrap.style.display = "contents";
      while (el.firstChild) wrap.appendChild(el.firstChild);
      el.appendChild(wrap);
    }
    return wrap;
  }

  function bindColorTarget(target, el) {
    if (target.hasAttribute("data-swap-color-bound")) return;
    const varName = (
      el.getAttribute("data-swap-color-var") || "--brand-medium"
    ).trim();
    target.style.color = `var(${varName})`;
    target.setAttribute("data-swap-color-bound", "");
  }

  function applyPresentationRebind(el, allowSet, themeForEl) {
    if (allowSet.has("fontTheme") || allowSet.has("breakpoint")) {
      const explicit = el.getAttribute("data-swap-classes");
      if (explicit) {
        ensureClasses(el, explicit);
      } else {
        const fromAncestor = getNearestTokenTextClasses(el);
        fromAncestor.forEach((c) => el.classList.add(c));
      }
    }

    const wantsTheme = allowSet.has("theme");
    const wantsColor = allowSet.has("colorTheme");

    if (wantsTheme && wantsColor) {
      const bubble = ensureThemeBubble(el);
      const themeVal = themeForEl || "light";
      if (bubble.getAttribute("data-mode") !== themeVal) {
        bubble.setAttribute("data-mode", themeVal);
      }
      bindColorTarget(bubble, el);
    } else if (wantsTheme || wantsColor) {
      bindColorTarget(el, el);
    }
  }

  // =======================
  // exclude / allow engine
  // =======================
  const pinnedExcludes = new WeakSet();

  let IN_APPLY = false;
  let QUEUED = false;
  const scheduleApply = () => {
    if (QUEUED) return;
    QUEUED = true;
    queueMicrotask(() => {
      QUEUED = false;
      applyAllowsNow();
    });
  };

  // helper: is this element inside a container that excludes a given key?
  function isExcludedFor(el, key) {
    const anc = el.closest("[data-swap-exclude]");
    if (!anc) return false;
    const keys = parseKeys(anc.getAttribute("data-swap-exclude"));
    return keys.includes(key);
  }

  // helper: read nearest attribute value up the tree; fallback to env
  function nearestAxisValue(el, k, env) {
    const attr = "data-" + k;
    let n = el.parentElement;
    while (n) {
      if (n.hasAttribute(attr)) return n.getAttribute(attr);
      n = n.parentElement;
    }
    return env[k];
  }

  // Keep excluded containers' breakpoint ALWAYS synced to the current viewport label (acts like AUTO locally)
  function syncExcludedBreakpointAuto() {
    const autoLabel = currentAutoBreakpointLabel();
    document.querySelectorAll("[data-swap-exclude]").forEach((el) => {
      const keys = parseKeys(el.getAttribute("data-swap-exclude"));
      if (!keys.includes("breakpoint")) return;
      if (el.getAttribute("data-breakpoint") !== autoLabel) {
        el.setAttribute("data-breakpoint", autoLabel);
      }
    });
  }

  // EXCLUDE: initialize (one-time for non-breakpoint keys) + seed breakpoint to auto
  function applyExcludesOnce() {
    const e = getEnv();
    document.querySelectorAll("[data-swap-exclude]").forEach((el) => {
      if (pinnedExcludes.has(el)) return;
      const keys = parseKeys(el.getAttribute("data-swap-exclude"));

      keys.forEach((k) => {
        const attr = "data-" + k;
        if (k === "breakpoint") {
          const autoLabel = currentAutoBreakpointLabel();
          if (el.getAttribute(attr) !== autoLabel)
            el.setAttribute(attr, autoLabel);
          return;
        }
        // Non-breakpoint keys: pin to initial env (unchanged)
        let v = e[k];
        if (!v) el.removeAttribute(attr);
        else if (el.getAttribute(attr) !== v) el.setAttribute(attr, v);
      });

      pinnedExcludes.add(el);
    });
  }

  // ALLOW: mirror only listed keys; a child with allow="breakpoint" overrides ancestor exclude
  function applyAllowsNow() {
    if (IN_APPLY) return;
    IN_APPLY = true;
    try {
      const env = getEnv();

      // 0) Always keep excluded containers synced to viewport label
      syncExcludedBreakpointAuto();

      // 1) Apply allows
      document.querySelectorAll("[data-swap-allow]").forEach((el) => {
        if (el === document.documentElement) return;

        const allow = new Set(parseKeys(el.getAttribute("data-swap-allow")));
        const wantsTheme = allow.has("theme");
        const wantsColor = allow.has("colorTheme");
        const wantsBreakpoint = allow.has("breakpoint");

        // If this node explicitly allows breakpoint, mirror companion axes
        if (wantsBreakpoint) {
          ["theme", "colorTheme", "fontTheme"].forEach((k) => {
            const attr = "data-" + k;
            const desired = nearestAxisValue(el, k, env);
            if (el.getAttribute(attr) !== desired)
              el.setAttribute(attr, desired);
          });
        }

        // For each axis…
        KEYS.forEach((k) => {
          const attr = "data-" + k;

          // If not allowed, remove attribute except when breakpoint is allowed (keep companions)
          const isCompanion =
            k === "theme" || k === "colorTheme" || k === "fontTheme";
          if (!allow.has(k)) {
            if (!(wantsBreakpoint && isCompanion)) {
              if (el.hasAttribute(attr)) el.removeAttribute(attr);
            }
            return;
          }

          // Allowed axis:
          let v = env[k];
          if (k === "breakpoint") {
            // If global is auto, use current viewport label; else use manual selection
            v = v && v !== "auto" ? v : currentAutoBreakpointLabel();
          }

          // Avoid theme/colorTheme collision on same node (only if BOTH are allowed)
          if (k === "theme" && wantsTheme && wantsColor) {
            if (el.hasAttribute(attr)) el.removeAttribute(attr);
          } else {
            if (!v) {
              if (el.hasAttribute(attr)) el.removeAttribute(attr);
            } else if (el.getAttribute(attr) !== v) {
              el.setAttribute(attr, v);
            }
          }
        });

        // presentation & theme split (uses env.theme)
        const themeVal = env.theme || "light";
        applyPresentationRebind(el, allow, themeVal);
      });
    } finally {
      IN_APPLY = false;
    }
  }

  // expose refresh for dynamically added DOM
  window.tokenSwap = window.tokenSwap || {};
  window.tokenSwap.refreshScopes = function () {
    applyExcludesOnce(); // new excludes only (old ones are in WeakSet)
    scheduleApply();
  };

  // =======================
  // switcher wiring
  // =======================
  function wireControls() {
    const root = document.documentElement;
    const tray = document.querySelector("#token-swap-root");
    if (!tray) return;

    // theme segmented toggle
    (function initThemeToggle() {
      const group = tray.querySelector("#switch-theme");
      if (!group) return;
      const btns = Array.from(group.querySelectorAll('[role="radio"]'));
      const setTheme = (value) => {
        btns.forEach((b) =>
          b.setAttribute("aria-checked", String(b.dataset.value === value))
        );
        if (root.getAttribute("data-mode") !== value)
          root.setAttribute("data-mode", value);
        scheduleApply();
      };

      // initial: prefer existing attr, else "light" (we'll re-apply defaults later if provided)
      const initialTheme = root.getAttribute("data-mode") || "light";

      group.addEventListener("click", (e) => {
        const b = e.target.closest('[role="radio"]');
        if (!b) return;
        setTheme(b.dataset.value);
      });
      group.addEventListener("keydown", (e) => {
        const idx = btns.findIndex(
          (b) => b.getAttribute("aria-checked") === "true"
        );
        if (idx === -1) return;
        let next = idx;
        if (e.key === "ArrowRight" || e.key === "ArrowDown")
          next = (idx + 1) % btns.length;
        if (e.key === "ArrowLeft" || e.key === "ArrowUp")
          next = (idx - 1 + btns.length) % btns.length;
        if (next !== idx) {
          e.preventDefault();
          btns[next].focus();
          setTheme(btns[next].dataset.value);
        }
      });
      setTheme(initialTheme);
    })();

    // flicker guard
    tray.querySelectorAll("select.token-swap-select").forEach((sel) => {
      sel.addEventListener("pointerdown", () => pauseTransitions(350));
      sel.addEventListener("focus", () => pauseTransitions(350));
    });

    // selects (fontTheme, colorTheme, breakpoint)
    tray.querySelectorAll(".other-switch").forEach((block) => {
      const group = block.dataset.group;
      const select = block.querySelector("select");
      if (!group || !select) return;

      const setGroupAttr = (name, value) => {
        const attr = "data-" + name;
        if (!value) root.removeAttribute(attr);
        else if (root.getAttribute(attr) !== value)
          root.setAttribute(attr, value);
      };

      if (group === "breakpoint") {
        const applyBreakpoint = (val) => {
          if (!val || val === "auto") root.removeAttribute("data-breakpoint");
          else if (root.getAttribute("data-breakpoint") !== val)
            root.setAttribute("data-breakpoint", val);
          scheduleApply();
        };
        select.addEventListener("change", () => {
          setGroupAttr(group, select.value === "auto" ? "" : select.value);
          applyBreakpoint(select.value);
        });
        // initial seed (we'll override later if defaults appear)
        setGroupAttr(group, "");
        applyBreakpoint(select.value);
      } else {
        select.addEventListener("change", () => {
          setGroupAttr(group, select.value);
          scheduleApply();
        });
        // initial seed (we'll override later if defaults appear)
        setGroupAttr(group, select.value);
        scheduleApply();
      }
    });

    // observe direct flips on <html> (e.g., external code)
    const mo = new MutationObserver(() => scheduleApply());
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-mode",
        "data-colorTheme",
        "data-fontTheme",
        "data-breakpoint"
      ]
    });

    // initial scoping
    applyExcludesOnce();
    scheduleApply();

    // If defaults were defined earlier but UI wasn’t ready, apply now.
    if (_pendingDefaults || _extDefaults) tryApplyDefaults();

    // As a last resort for CodePen, poll briefly for late defaults (e.g., set after a delay)
    let polls = 0;
    const POLL_LIMIT = 60; // ~6s at 100ms
    const t = setInterval(() => {
      polls++;
      if (_extDefaults) {
        tryApplyDefaults();
        clearInterval(t);
      }
      if (polls >= POLL_LIMIT) clearInterval(t);
    }, 100);

    // keep excluded containers synced to viewport label; re-apply scopes in auto
    window.addEventListener(
      "resize",
      () => {
        const env = getEnv();
        syncExcludedBreakpointAuto();
        if (env.breakpoint === "auto") scheduleApply();
      },
      { passive: true }
    );
  }

  // =======================
  // boot
  // =======================
  function run() {
    injectHeadLinks();
    injectBodyUI();
    wireControls();
  }

  if (document.body) run();
  else if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", run, { once: true });
  else queueMicrotask(run);
})();
