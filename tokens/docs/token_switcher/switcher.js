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
      theme: r.getAttribute("data-theme") || "light",
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
      if (bubble.getAttribute("data-theme") !== themeVal) {
        bubble.setAttribute("data-theme", themeVal);
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

        // If this node explicitly allows breakpoint, we must also mirror companion axes
        // (theme/colorTheme/fontTheme) onto this element so compound selectors match locally.
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

          // If not allowed, normally we remove the attribute,
          // BUT if this node allows breakpoint and k is a companion axis,
          // we KEEP the mirrored static value.
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
        if (root.getAttribute("data-theme") !== value)
          root.setAttribute("data-theme", value);
        scheduleApply();
      };
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
      setTheme("light");
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
        setGroupAttr(group, "");
        applyBreakpoint(select.value);
      } else {
        select.addEventListener("change", () => {
          setGroupAttr(group, select.value);
          scheduleApply();
        });
        setGroupAttr(group, select.value);
        scheduleApply();
      }

      if (!window.tokenSet) {
        window.tokenSet = {
          set: (g, v) => {
            const attr = "data-" + g;
            if (g === "theme") {
              if (root.getAttribute(attr) !== (v || "light"))
                root.setAttribute(attr, v || "light");
              scheduleApply();
              return;
            }
            if (g === "breakpoint") {
              if (!v || v === "auto") root.removeAttribute("data-breakpoint");
              else if (root.getAttribute("data-breakpoint") !== v)
                root.setAttribute("data-breakpoint", v);
              scheduleApply();
              return;
            }
            if (KEYS.includes(g)) {
              if (v == null || v === "") root.removeAttribute(attr);
              else if (root.getAttribute(attr) !== v)
                root.setAttribute(attr, v);
              scheduleApply();
            }
          }
        };
      }
    });

    // observe direct flips on <html> (e.g., external code)
    const mo = new MutationObserver(() => scheduleApply());
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: [
        "data-theme",
        "data-colorTheme",
        "data-fontTheme",
        "data-breakpoint"
      ]
    });

    // initial scoping
    applyExcludesOnce();
    scheduleApply();

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
