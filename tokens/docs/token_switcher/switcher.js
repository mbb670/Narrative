/* Token Swap (mode/colorTheme/fontTheme/breakpoint) */
/* Full drop-in script with DOM observer + rAF batching + flicker guards */

(function () {
  "use strict";

  // =======================
  // constants / config
  // =======================
  const KEYS = ["mode", "colorTheme", "fontTheme", "breakpoint"];
  const BREAKPOINTS = [
    { label: "desktop", min: 1024 },
    { label: "tablet", min: 640 },
    { label: "mobile", min: 0 }
  ];

  // token text class shapes (matches your CSS utilities)
  const TOKEN_TEXT_RE = /^text-(display|headline|subheadline|body|system|uppercase)-(regular|semibold)-(lg|md|sm|xs)$/;

  // =======================
  // defaults plumbing (works even if set later)
  // =======================
  let _extDefaults = null; // last-seen defaults object (normalized)
  let _defaultsAppliedOnce = false; // guard so we don't re-apply identical defaults
  let _pendingDefaults = null; // stash if UI not ready yet

  // Allow both global names
  defineReactiveDefaultsProp("tokenSwapDefaults");
  defineReactiveDefaultsProp("TOKEN_SWAP_DEFAULTS");

  // Public API
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
      // If defineProperty fails, we'll fall back to polling in run()
    }
  }

  // Normalize incoming defaults; accept legacy object key "theme" → "mode"
  function sanitizeDefaults(obj) {
    if (!obj || typeof obj !== "object") return null;
    const out = {};
    const modeVal = obj.mode ?? obj.theme; // accept both (object key only)
    if (typeof modeVal === "string" && /^(light|dark)$/.test(modeVal))
      out.mode = modeVal;

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
    if (!_extDefaults) return;

    const tray = document.querySelector("#token-swap-root");
    if (!tray) {
      _pendingDefaults = _extDefaults;
      return;
    }

    if (_defaultsAppliedOnce && _pendingDefaults == null) return;

    // Apply to UI as if the user selected them
    const root = document.documentElement;

    // MODE (segmented)
    if (_extDefaults.mode) {
      const btn = tray.querySelector(
        `#switch-theme [data-value="${_extDefaults.mode}"]`
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

  // native <select> flicker guard (scoped to the tray)
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

  <!-- Mode segmented toggle (UI id kept as switch-theme) -->
  <div id="switch-theme" class="switcher switcher-theme" role="radiogroup" aria-label="Mode">
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
  // attribute helpers (mode only)
  // =======================
  function getAxisAttrName(k) {
    return "data-" + (k === "mode" ? "mode" : k);
  }
  function readAxisAttr(node, k) {
    return node.getAttribute(getAxisAttrName(k));
  }
  function hasAxisAttr(node, k) {
    return node.hasAttribute(getAxisAttrName(k));
  }
  function setAxisAttr(node, k, v) {
    const attr = getAxisAttrName(k);
    if (!v) { removeAxisAttr(node, k); return; }
    if (node.getAttribute(attr) !== v) node.setAttribute(attr, v);
  }
  function removeAxisAttr(node, k) {
    const attr = getAxisAttrName(k);
    if (node.hasAttribute(attr)) node.removeAttribute(attr);
  }

  // =======================
  // env helpers
  // =======================
  function getEnv() {
    const r = document.documentElement;
    return {
      mode: r.getAttribute("data-mode") || "light",
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

  // Parse space-separated keys, normalize "theme" -> "mode" for data-swap-allow/exclude
  const parseKeys = (s) =>
    (s || "")
      .trim()
      .split(/\s+/)
      .map((k) => (k === "theme" ? "mode" : k))
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

  function applyPresentationRebind(el, allowSet, modeForEl) {
    if (allowSet.has("fontTheme") || allowSet.has("breakpoint")) {
      const explicit = el.getAttribute("data-swap-classes");
      if (explicit) {
        ensureClasses(el, explicit);
      } else {
        const fromAncestor = getNearestTokenTextClasses(el);
        fromAncestor.forEach((c) => el.classList.add(c));
      }
    }

    const wantsMode = allowSet.has("mode");
    const wantsColor = allowSet.has("colorTheme");

    if (wantsMode && wantsColor) {
      const bubble = ensureThemeBubble(el);
      const modeVal = modeForEl || "light";
      if (bubble.getAttribute("data-mode") !== modeVal) {
        bubble.setAttribute("data-mode", modeVal);
      }
      bindColorTarget(bubble, el);
    } else if (wantsMode || wantsColor) {
      bindColorTarget(el, el);
    }
  }

  // =======================
  // exclude / allow engine + flicker guards
  // =======================
  const pinnedExcludes = new WeakSet();

  let IN_APPLY = false;

  // Coalesce to next frame; optionally freeze transitions in content briefly
  function scheduleApply(opts = {}) {
    if (scheduleApply._pending) return;
    scheduleApply._pending = true;

    if (opts.freeze) freezeContentTransitions(140);

    requestAnimationFrame(() => {
      scheduleApply._pending = false;
      applyAllowsNow();
    });
  }

  const CONTENT_FREEZE_STYLE_ID = "token-swap-freeze-content";
  function freezeContentTransitions(ms = 140) {
    let styleEl = document.getElementById(CONTENT_FREEZE_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = CONTENT_FREEZE_STYLE_ID;
      styleEl.textContent = `
:root[data-swap-freeze] [data-swap-allow],
:root[data-swap-freeze] [data-swap-theme-bubble] {
  transition: none !important;
  animation: none !important;
}`;
      document.head.appendChild(styleEl);
    }
    const r = document.documentElement;
    r.setAttribute("data-swap-freeze", "");
    clearTimeout(freezeContentTransitions._t);
    freezeContentTransitions._t = setTimeout(() => {
      r.removeAttribute("data-swap-freeze");
    }, ms);
  }

  // Watch the DOM for new/edited swap annotations and re-apply immediately
  function watchDomForSwapAnnotations() {
    const root = document.documentElement;
    const mo = new MutationObserver((muts) => {
      let sawRelevant = false;
      let excludeAttrEdited = false;

      for (const m of muts) {
        if (m.type === "attributes") {
          if (m.attributeName === "data-swap-exclude" || m.attributeName === "data-swap-allow") {
            sawRelevant = true;
            if (m.attributeName === "data-swap-exclude") {
              // If someone changes the exclude list on an existing element,
              // unpin so we can reinitialize its pinned values.
              pinnedExcludes.delete(m.target);
              excludeAttrEdited = true;
            }
          }
        } else if (m.type === "childList") {
          for (const n of m.addedNodes) {
            if (!(n instanceof Element)) continue;
            if (
              n.matches?.("[data-swap-allow],[data-swap-exclude]") ||
              n.querySelector?.("[data-swap-allow],[data-swap-exclude]")
            ) {
              sawRelevant = true;
            }
          }
        }
      }

      if (excludeAttrEdited) applyExcludesOnce();
      if (sawRelevant) scheduleApply({ freeze: true });
    });

    mo.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-swap-allow", "data-swap-exclude"]
    });
  }

  // helper: read nearest attribute value up the tree; fallback to env
  function nearestAxisValue(el, k, env) {
    let n = el.parentElement;
    while (n) {
      const v = readAxisAttr(n, k);
      if (v != null) return v;
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
      if (readAxisAttr(el, "breakpoint") !== autoLabel) {
        setAxisAttr(el, "breakpoint", autoLabel);
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
        if (k === "breakpoint") {
          const autoLabel = currentAutoBreakpointLabel();
          if (readAxisAttr(el, k) !== autoLabel) setAxisAttr(el, k, autoLabel);
          return;
        }
        // Non-breakpoint keys: pin to initial env (unchanged)
        const v = e[k];
        if (!v) removeAxisAttr(el, k);
        else if (readAxisAttr(el, k) !== v) setAxisAttr(el, k, v);
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
        const wantsMode = allow.has("mode");
        const wantsColor = allow.has("colorTheme");
        const wantsBreakpoint = allow.has("breakpoint");

        // If this node explicitly allows breakpoint, mirror companion axes
        if (wantsBreakpoint) {
          ["mode", "colorTheme", "fontTheme"].forEach((k) => {
            const desired = nearestAxisValue(el, k, env);
            if (readAxisAttr(el, k) !== desired) setAxisAttr(el, k, desired);
          });
        }

        // Phase 1: write or clear attributes (but don't remove data-mode yet if both are allowed)
        const deferModeRemoval = wantsMode && wantsColor;

        KEYS.forEach((k) => {
          const isCompanion = (k === "mode" || k === "colorTheme" || k === "fontTheme");

          if (!allow.has(k)) {
            if (!(wantsBreakpoint && isCompanion)) {
              if (hasAxisAttr(el, k)) removeAxisAttr(el, k);
            }
            return;
          }

          // Allowed axis
          let v = env[k];
          if (k === "breakpoint") v = v && v !== "auto" ? v : currentAutoBreakpointLabel();

          if (k === "mode" && deferModeRemoval) {
            // Keep element's data-mode for now; we'll remove after bubble is set below
            if (v) {
              if (readAxisAttr(el, k) !== v) setAxisAttr(el, k, v);
            } else {
              if (hasAxisAttr(el, k)) removeAxisAttr(el, k);
            }
          } else {
            if (!v) {
              if (hasAxisAttr(el, k)) removeAxisAttr(el, k);
            } else if (readAxisAttr(el, k) !== v) {
              setAxisAttr(el, k, v);
            }
          }
        });

        // Phase 2: presentation & bubble
        const modeVal = env.mode || "light";
        applyPresentationRebind(el, allow, modeVal);

        // Phase 3: now it's safe to drop element's data-mode when both are allowed
        if (wantsMode && wantsColor) {
          if (hasAxisAttr(el, "mode")) removeAxisAttr(el, "mode");
        }
      });
    } finally {
      IN_APPLY = false;
    }
  }

  // expose refresh for dynamically added DOM
  window.tokenSwap = window.tokenSwap || {};
  window.tokenSwap.refreshScopes = function () {
    applyExcludesOnce(); // new excludes only (old ones are in WeakSet)
    scheduleApply({ freeze: true });
  };

  // =======================
  // switcher wiring
  // =======================
  function wireControls() {
    const root = document.documentElement;
    const tray = document.querySelector("#token-swap-root");
    if (!tray) return;

    // Mode segmented toggle (UI id kept as "switch-theme")
    (function initModeToggle() {
      const group = tray.querySelector("#switch-theme");
      if (!group) return;
      const btns = Array.from(group.querySelectorAll('[role="radio"]'));
      const setMode = (value) => {
        btns.forEach((b) =>
          b.setAttribute("aria-checked", String(b.dataset.value === value))
        );
        if (root.getAttribute("data-mode") !== value)
          root.setAttribute("data-mode", value);
        scheduleApply({ freeze: true });
      };

      // initial: prefer existing attr, else "light" (defaults may re-apply later)
      const initialMode = root.getAttribute("data-mode") || "light";

      group.addEventListener("click", (e) => {
        const b = e.target.closest('[role="radio"]');
        if (!b) return;
        setMode(b.dataset.value);
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
          setMode(btns[next].dataset.value);
        }
      });
      setMode(initialMode);
    })();

    // flicker guard on native selects
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
        if (!value) removeAxisAttr(root, name);
        else if (readAxisAttr(root, name) !== value) setAxisAttr(root, name, value);
      };

      if (group === "breakpoint") {
        const applyBreakpoint = (val) => {
          if (!val || val === "auto") removeAxisAttr(root, "breakpoint");
          else if (readAxisAttr(root, "breakpoint") !== val)
            setAxisAttr(root, "breakpoint", val);
          scheduleApply({ freeze: true });
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
          scheduleApply({ freeze: true });
        });
        // initial seed (we'll override later if defaults appear)
        setGroupAttr(group, select.value);
        scheduleApply({ freeze: true });
      }
    });

    // observe direct flips on <html> (e.g., external code)
    const mo = new MutationObserver(() => scheduleApply({ freeze: true }));
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
    scheduleApply({ freeze: true });

    // If defaults were defined earlier but UI wasn’t ready, apply now.
    if (_pendingDefaults || _extDefaults) tryApplyDefaults();

    // As a last resort for late defaults, poll briefly
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
        if (env.breakpoint === "auto") scheduleApply({ freeze: true });
      },
      { passive: true }
    );

    // Watch DOM for new/edited swap annotations
    watchDomForSwapAnnotations();
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

