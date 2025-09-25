(() => {
  /* ================= Icons ================= */
  const ICONS = {
    chevronDown: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.1 4.6l3.9 3.9c.14.14.37.14.51 0l3.4-3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    chevronUp: `<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d="M2.1 7.4l3.9-3.9c.14-.14.37-.14.51 0l3.4 3.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  };
  const iconEl = (name) => {
    const span = document.createElement("span");
    span.innerHTML = ICONS[name] || "";
    return span.firstElementChild || document.createTextNode("");
  };

  /* ================= Settings ================= */
  const TOKEN_CSS_URL =
    window.TOKEN_CSS_URL || "../../resolved/extended_tokens.css";
  const THEME_UPDATE_DELAY_MS = 150;
  let CURRENT_FORMAT = "HEX";
  const NO_CLOSE_SELECTORS = [
    ".token-swap",
    ".format-switcher",
    ".switcher-breakpoint"
  ];

  /* Manual breakpoint guard (added) */
  const isManualBreakpointActive = () =>
    document.documentElement.hasAttribute("data-breakpoint") &&
    document.documentElement.getAttribute("data-breakpoint") !== "" &&
    document.documentElement.getAttribute("data-breakpoint") !== "auto";

  /* Attribute watch list */
  const WATCH_ATTRS = [
    "class",
    "style",
    "data-theme",
    "data-color-mode",
    "data-mode",
    "data-colorTheme",
    "data-colortheme",
    "data-fontTheme",
    "data-fonttheme",
    "data-breakpoint"
  ];
  const WATCH_EVENTS = [
    "themechange",
    "modechange",
    "colorthemechange",
    "colorThemeChange",
    "colorschemechange"
  ];

  /* ================= Type registry (autodetect) ================= */
  const VAR_TYPE_OVERRIDES = new Map();
  const TYPE_REGISTRY = new Map();
  function registerType(name, def) {
    TYPE_REGISTRY.set(name, { detect: def?.detect || (() => false) });
  }
  window.TokenSwatch = Object.assign(window.TokenSwatch || {}, {
    registerType,
    setVarType: (t, ty) => VAR_TYPE_OVERRIDES.set(t, ty),
    clearVarType: (t) => VAR_TYPE_OVERRIDES.delete(t)
  });
  registerType("color", {
    detect: ({ terminal }) =>
      /^#([0-9a-f]{3,8})$/i.test(terminal) ||
      /^(rgb|hsl)a?\(/i.test(terminal) ||
      /^(lab|lch|oklab|oklch|color)\(/i.test(terminal)
  });
  const DIMENSION_RE = /^-?\d*\.?\d+(px|rem|em|vh|vw|vmin|vmax|%|ch|ex|cm|mm|in|pt|pc|q)$/i;
  registerType("dimension", {
    detect: ({ terminal }) => DIMENSION_RE.test(terminal)
  });
  const NUMBER_RE = /^-?\d*\.?\d+$/;
  registerType("number", {
    detect: ({ terminal }) => NUMBER_RE.test(terminal)
  });
  registerType("string", { detect: () => true }); // fallback

  /* ================= State ================= */
  let openExpander = null;
  let lastSnapshotKey = "";
  let themeDelayTimer = null;
  let snapTimer = null;
  let tokenSheet = null;

  /* PERF: one reusable probe for resolving colors */
  const COLOR_PROBE = (() => {
    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.opacity = "0";
    el.style.pointerEvents = "none";
    el.style.width = "0";
    el.style.height = "0";
    document.documentElement.appendChild(el);
    return el;
  })();

  /* ================= Init ================= */
  function runWhenReady(fn) {
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
  }
  runWhenReady(async function init() {
    if (TOKEN_CSS_URL) {
      try {
        const css = await (await fetch(TOKEN_CSS_URL, { mode: "cors" })).text();
        tokenSheet = injectDisabledSheet(css);
      } catch {}
    }

    ensureFormatSwitcher();
    ensureToast();
    enhanceAllCards();

    // ✅ First-time: let switcher mirror scopes, then flush styles, then hydrate
    flushScopesThenHydrate();

    startObservers();
    watchAllMediaQueries(); // respond to @media changes

    // Resize: in auto mode the switcher updates via media queries; make sure it scopes first
    window.addEventListener(
      "resize",
      () => {
        if (isManualBreakpointActive()) return; // <-- ignore while forced (added)
        flushScopesThenHydrate();
      },
      { passive: true }
    );

    // Also listen for manual breakpoint select changes without touching the switcher code
    document.addEventListener("change", (e) => {
      const sel = e.target?.closest?.("#bp-select");
      if (sel) flushScopesThenHydrate();
    });

    // Global copy handler for ANY .copyable[data-copy] anywhere
    document.addEventListener("click", (e) => {
      const el = e.target.closest(".copyable");
      if (!el) return;
      if (el.hasAttribute("data-copy-bound")) return; // wrapped by copyWrap already
      const payload = el.getAttribute("data-copy") || el.dataset.copy || "";
      if (!payload) return;
      navigator.clipboard.writeText(payload).then(() => showToast("Copied!"));
    });
  });

  /* ===== let the switcher finish scoping, then give the browser time to apply styles ===== */
  function refreshScopesIfAvailable() {
    try {
      if (
        window.tokenSwap &&
        typeof window.tokenSwap.refreshScopes === "function"
      ) {
        window.tokenSwap.refreshScopes();
      }
    } catch {}
  }
  function flushScopesThenHydrate() {
    // 1) ask switcher to mirror scopes
    refreshScopesIfAvailable();
    // 2) next frame: force a style flush so [data-breakpoint]/theme/colorTheme rules apply
    requestAnimationFrame(() => {
      // forcing a reflow ensures the new attribute-based rules are committed
      void document.documentElement.offsetWidth;
      // 3) slight delay so your tokens cascade fully, then hydrate swatches
      clearTimeout(themeDelayTimer);
      themeDelayTimer = setTimeout(() => {
        hydrateAll();
      }, THEME_UPDATE_DELAY_MS);
    });
  }

  /* ================= Format switcher ================= */
  function ensureFormatSwitcher() {
    let root = document.querySelector("#format-switcher");
    if (!root) {
      root = document.createElement("div");
      root.id = "format-switcher";
      root.className = "format-switcher";
      document.body.prepend(root);
    }
    if (!root.querySelector("select")) {
      const label = document.createElement("label");
      label.textContent = "Resolved Format";
      label.style.marginRight = "8px";
      const select = document.createElement("select");
      ["HEX", "RGBA", "HSLA"].forEach((v) => {
        const o = document.createElement("option");
        o.value = o.textContent = v;
        select.appendChild(o);
      });
      select.value = CURRENT_FORMAT;
      select.addEventListener("change", () => {
        CURRENT_FORMAT = select.value;
        updateAllDisplays();
        if (openExpander?.token) {
          refreshOpenExpander(buildVarMapSpecified());
          repositionOpenExpander();
        }
      });
      root.appendChild(label);
      root.appendChild(select);
    }
  }

  /* ================= Cards authored in HTML ================= */
  const getAllCards = () =>
    Array.from(document.querySelectorAll("[data-token]"));

  function enhanceAllCards() {
    getAllCards().forEach(enhanceCardStructure);
  }

  function enhanceCardStructure(card) {
    if (!card.querySelector(".swatch")) {
      const sw = document.createElement("div");
      sw.className = "swatch";
      const fill = document.createElement("div");
      fill.className = "swatch-fill";
      sw.appendChild(fill);
      card.appendChild(sw);
    }
    if (!card.querySelector(".info")) {
      const info = document.createElement("div");
      info.className = "info";
      const main = document.createElement("div");
      main.className = "mainline";
      const hexl = document.createElement("div");
      hexl.className = "hexline";
      info.appendChild(main);
      info.appendChild(hexl);
      card.appendChild(info);
    }
    const main = card.querySelector(".mainline");
    if (!main.querySelector(".token")) {
      const token = card.getAttribute("data-token");
      const tok = badge(token, "token");
      tok.classList.add("interactive-background");
      main.appendChild(copyWrap(tok, token));
    }
    const hexl = card.querySelector(".hexline");
    if (!hexl.querySelector(".arrow")) {
      const a = document.createElement("span");
      a.className = "arrow";
      a.textContent = "↳";
      hexl.appendChild(a);
    }
    if (!hexl.querySelector(".hex-wrap")) {
      const hb = badge("—", "hex");
      const wrap = copyWrap(hb, "");
      wrap.classList.add("hex-wrap", "interactive-foreground");
      hexl.appendChild(wrap);
    }
    if (!hexl.querySelector(".toggle")) {
      const token = card.getAttribute("data-token");
      const btn = document.createElement("button");
      btn.className = "toggle";
      btn.setAttribute("aria-expanded", "false");
      btn.setAttribute("aria-label", "Expand details");
      btn.dataset.token = token;
      btn.appendChild(iconEl("chevronDown"));
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // make sure scopes & styles are current before building the overlay
        refreshScopesIfAvailable();
        requestAnimationFrame(() => {
          void document.documentElement.offsetWidth;
          const specified = buildVarMapSpecified();
          const latest = resolveVarChainSmart(token, specified, document.body);
          toggleExpander(card, token, latest.chain);
        });
      });
      hexl.appendChild(btn);
    }
    const token = card.getAttribute("data-token");
    card.querySelector(".swatch-fill").style.background = `var(${token})`;
  }

  /* ================= Hydration ================= */
  function hydrateAll() {
    const specified = buildVarMapSpecified(); // build ONCE from rules that currently match
    getAllCards().forEach((card) => {
      const token = card.getAttribute("data-token");
      hydrateCardValue(card, token, specified);
    });
    if (openExpander?.token) {
      refreshOpenExpander(specified);
      repositionOpenExpander();
    }
    lastSnapshotKey = snapshotKey(specified); // cheap snapshot
  }

  function decideType(token, specifiedMap) {
    const override = VAR_TYPE_OVERRIDES.get(token);
    if (override) return override;
    const { terminal } = resolveChainAndTerminal(
      token,
      specifiedMap,
      document.body
    );
    for (const [name, def] of TYPE_REGISTRY.entries()) {
      if (name === "string") continue;
      try {
        if (def.detect?.({ terminal })) return name;
      } catch {}
    }
    return "string";
  }

  function hydrateCardValue(card, varName, specifiedMap) {
    // keep consistent data-type on base and overlay
    let type = card.getAttribute("data-type");
    if (!type || !TYPE_REGISTRY.has(type)) {
      type = decideType(varName, specifiedMap);
      card.setAttribute("data-type", type);
    }

    const wrap = card.querySelector(".hex-wrap");
    const badge = wrap?.querySelector(".hex");
    if (!wrap || !badge) return;

    const text = resolvedDisplayForType(type, varName);
    badge.textContent = text;
    wrap.dataset.copy = text;

    card.querySelector(".swatch-fill").style.background = `var(${varName})`;
  }

  /* ================= Expander (overlay) ================= */
  function toggleExpander(card, token, chainMaybe) {
    if (openExpander?.token === token) return closeExpander(true);
    closeExpander(true);

    const specifiedMap = buildVarMapSpecified();
    const chain =
      chainMaybe ||
      resolveVarChainSmart(token, specifiedMap, document.body).chain;

    const exp = buildExpander(card, token, chain, specifiedMap);
    exp.classList.add("elevation-elevation-overlay");
    document.body.appendChild(exp);
    positionExpanderOverCard(exp, card);

    exp.animate(
      [
        { opacity: 0, transform: "scale(0.98)" },
        { opacity: 1, transform: "scale(1)" }
      ],
      { duration: 160, easing: "ease-out" }
    );

    openExpander = { el: exp, token };
    card.querySelector(".toggle")?.setAttribute("aria-expanded", "true");

    setTimeout(() => {
      document.addEventListener("click", outsideClose, { capture: true });
      window.addEventListener("resize", repositionOpenExpander);
      window.addEventListener("scroll", repositionOpenExpander, {
        passive: true
      });
      window.addEventListener("keydown", onKeyClose);
    }, 0);
  }

  function buildExpander(sourceCard, token, chain, specifiedMap) {
    const exp = el("div", "expander", {
      role: "dialog",
      "aria-modal": "false",
      "data-for": token
    });

    // keep data-type identical to the base card (auto or override)
    const typeFromCard =
      sourceCard.getAttribute("data-type") || decideType(token, specifiedMap);
    exp.setAttribute("data-type", typeFromCard);

    const swatch = el("div", "swatch");
    const fill = el("div", "swatch-fill");
    fill.style.background = `var(${token})`;
    swatch.appendChild(fill);

    const info = el("div", "info");

    const top = el("div", "mainline");
    const tokenBadge = badge(token, "token");
    tokenBadge.classList.add("interactive-background");
    top.appendChild(copyWrap(tokenBadge, token));

    // reference chain chips
    const chainBlock = el("div", "chainblock");
    const rail = el("div", "rail");
    const stack = el("div", "chainstack");
    const nested = extractNestedVarNamesALL(chain);
    nested.forEach((n, idx) => {
      const chipBadge = badge(n, "chip indent");
      chipBadge.classList.add("interactive-background");
      const chip = copyWrap(chipBadge, n);
      chip.dataset.depth = String(idx + 1);
      stack.appendChild(chip);
    });

    const hexline = el("div", "hexline");
    const shortHook = document.createElement("span");
    shortHook.className = "arrow";
    shortHook.textContent = "↳";

    const valueText = resolvedDisplayForType(typeFromCard, token);
    const valueBadge = badge(valueText, "hex");
    const valueWrap = copyWrap(valueBadge, valueText);
    valueWrap.classList.add("hex-wrap", "interactive-foreground");

    const collapse = el("button", "toggle", { "aria-label": "Collapse" });
    collapse.appendChild(iconEl("chevronUp"));
    collapse.addEventListener("click", (e) => {
      e.stopPropagation();
      closeExpander();
    });

    hexline.appendChild(shortHook);
    hexline.appendChild(valueWrap);
    hexline.appendChild(collapse);

    chainBlock.appendChild(rail);
    chainBlock.appendChild(stack);

    info.appendChild(top);
    if (nested.length) info.appendChild(chainBlock);
    info.appendChild(hexline);

    exp.appendChild(swatch);
    exp.appendChild(info);
    return exp;
  }

  function refreshOpenExpander(specifiedMap) {
    if (!openExpander?.token) return;
    const token = openExpander.token;
    const card = document.querySelector(`[data-token="${cssEsc(token)}"]`);
    if (!card) return closeExpander(true);

    const latestChain = resolveVarChainSmart(token, specifiedMap, document.body)
      .chain;
    const fresh = buildExpander(card, token, latestChain, specifiedMap);
    fresh.classList.add("elevation-elevation-overlay");

    const s = openExpander.el.style;
    fresh.style.top = s.top;
    fresh.style.left = s.left;
    fresh.style.width = s.width;

    openExpander.el.replaceWith(fresh);
    openExpander.el = fresh;
  }

  function positionExpanderOverCard(exp, card) {
    const r = card.getBoundingClientRect();
    exp.style.top = `${r.top + window.scrollY}px`;
    exp.style.left = `${r.left + window.scrollX}px`;
    exp.style.width = `${r.width}px`;
  }
  function repositionOpenExpander() {
    if (!openExpander?.token) return;
    const card = document.querySelector(
      `[data-token="${cssEsc(openExpander.token)}"]`
    );
    if (!card) return closeExpander(true);
    positionExpanderOverCard(openExpander.el, card);
  }
  function onKeyClose(e) {
    if (e.key === "Escape") closeExpander();
  }
  function outsideClose(e) {
    if (!openExpander) return;
    const inExpander = openExpander.el.contains(e.target);
    const isToggle = e.target.closest?.(".toggle");
    const safe = NO_CLOSE_SELECTORS.some((sel) => e.target.closest?.(sel));
    if (!inExpander && !isToggle && !safe) closeExpander();
  }
  function closeExpander(silent = false) {
    if (!openExpander) return;
    const { el, token } = openExpander;
    const anim = el.animate(
      [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(0.985)" }
      ],
      { duration: 140, easing: "ease-in" }
    );
    anim.addEventListener("finish", () => el.remove());
    document
      .querySelector(`[data-token="${cssEsc(token)}"] .toggle`)
      ?.setAttribute("aria-expanded", "false");
    openExpander = null;
    if (!silent) {
      document.removeEventListener("click", outsideClose, { capture: true });
      window.removeEventListener("resize", repositionOpenExpander);
      window.removeEventListener("scroll", repositionOpenExpander);
      window.removeEventListener("keydown", onKeyClose);
    }
  }

  /* ================= Copy + toast ================= */
  function ensureToast() {
    if (!document.getElementById("toast")) {
      const t = document.createElement("div");
      t.id = "toast";
      t.className = "toast";
      t.setAttribute("aria-live", "polite");
      document.body.appendChild(t);
    }
  }
  function copyWrap(node, initialPayload = "") {
    const w = document.createElement("span");
    w.className = "copyable";
    w.appendChild(node);
    w.dataset.copy = initialPayload;
    w.setAttribute("data-copy-bound", "1");
    w.addEventListener("click", (e) => {
      e.stopPropagation();
      const payload = w.dataset.copy || "";
      if (!payload) return;
      navigator.clipboard.writeText(payload).then(() => showToast("Copied!"));
    });
    return w;
  }
  function badge(text, cls) {
    const s = document.createElement("span");
    s.className = cls;
    s.textContent = text;
    return s;
  }
  let toastTimerLocal = null;
  function showToast(msg) {
    const toastEl = document.getElementById("toast");
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimerLocal);
    toastTimerLocal = setTimeout(() => toastEl.classList.remove("show"), 900);
  }

  /* ================= Var maps / chain / values ================= */
  function buildVarMapSpecified() {
    const map = new Map();
    const root = document.documentElement;
    const body = document.body;

    const matchesRootOrBody = (sel) => {
      try {
        return root.matches(sel) || body.matches(sel);
      } catch {
        return false;
      }
    };
    const pushDecls = (style) => {
      for (let i = 0; i < style.length; i++) {
        const name = style[i];
        if (name.startsWith("--"))
          map.set(name, style.getPropertyValue(name).trim());
      }
    };
    const visitRules = (rules) => {
      for (const rule of rules) {
        try {
          if (rule.type === CSSRule.STYLE_RULE) {
            const sels = (rule.selectorText || "")
              .split(",")
              .map((s) => s.trim());
            if (sels.some(matchesRootOrBody)) pushDecls(rule.style);
          } else if (rule.type === CSSRule.MEDIA_RULE) {
            if (!rule.media || matchMedia(rule.media.mediaText).matches)
              visitRules(rule.cssRules);
          } else if (
            rule.type === CSSRule.SUPPORTS_RULE ||
            rule.type === CSSRule.DOCUMENT_RULE
          ) {
            if (rule.cssRules) visitRules(rule.cssRules);
          } else if (rule.type === CSSRule.IMPORT_RULE) {
            rule.styleSheet?.cssRules && visitRules(rule.styleSheet.cssRules);
          } else if (rule.cssRules) {
            visitRules(rule.cssRules);
          }
        } catch {}
      }
    };

    // external token sheet FIRST (order within preserved)
    if (tokenSheet && tokenSheet.cssRules) {
      try {
        visitRules(tokenSheet.cssRules);
      } catch {}
    }

    // page stylesheets in source order
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        sheet.cssRules && visitRules(sheet.cssRules);
      } catch {}
    }

    // fill unknowns from computed (root & body)
    const fillFromComputed = (target) => {
      const cs = getComputedStyle(target);
      for (let i = 0; i < cs.length; i++) {
        const name = cs[i];
        if (name.startsWith("--") && !map.has(name)) {
          const v = cs.getPropertyValue(name).trim();
          if (v) map.set(name, v);
        }
      }
    };
    fillFromComputed(root);
    fillFromComputed(body);
    return map;
  }

  function buildVarMapComputed() {
    const map = new Map();
    const cs = getComputedStyle(document.documentElement);
    for (let i = 0; i < cs.length; i++) {
      const name = cs[i];
      if (name.startsWith("--"))
        map.set(name, cs.getPropertyValue(name).trim());
    }
    return map;
  }

  function resolveVarChainSmart(
    varName,
    varMapSpecified,
    contextEl = document.body
  ) {
    const chain = [`var(${varName})`];
    let current = varName,
      seen = new Set(),
      safety = 0;

    while (safety++ < 64 && !seen.has(current)) {
      seen.add(current);
      let specified =
        varMapSpecified.get(current) ||
        getComputedStyle(document.documentElement)
          .getPropertyValue(current)
          .trim() ||
        getComputedStyle(document.body).getPropertyValue(current).trim() ||
        getComputedStyle(contextEl).getPropertyValue(current).trim();
      if (!specified) break;

      const next = parseVar(specified);
      chain.push(specified); // keep full string
      if (next?.name) current = next.name;
      else break;
    }
    return { chain };
  }
  function resolveChainAndTerminal(
    varName,
    varMapSpecified,
    contextEl = document.body
  ) {
    const out = resolveVarChainSmart(varName, varMapSpecified, contextEl);
    return { ...out, terminal: out.chain[out.chain.length - 1] || "" };
  }

  function resolvedDisplayForType(type, token) {
    if (type === "color") {
      const fmt = computeAllFormats(token, "", document.body);
      return formatDisplay(fmt) || "—";
    }
    const term = resolveChainAndTerminal(
      token,
      buildVarMapSpecified(),
      document.body
    ).terminal;
    return term || "—";
  }

  /* Parse all nested var() refs (including fallbacks) */
  function extractNestedVarNamesALL(chainArr) {
    if (!Array.isArray(chainArr)) return [];
    const names = [];
    for (let i = 1; i < chainArr.length - 1; i++) {
      const s = String(chainArr[i]);
      const re = /var\(\s*([^) ,]+)(?:\s*,\s*([^)]+))?\)/g;
      let m;
      while ((m = re.exec(s))) {
        if (m[1]) names.push(m[1]);
        if (m[2]) {
          const sub = String(m[2]);
          const re2 = /var\(\s*([^) ,]+)\s*/g;
          let n;
          while ((n = re2.exec(sub))) names.push(n[1]);
        }
      }
    }
    const seen = new Set();
    return names.filter((n) => !seen.has(n) && seen.add(n));
  }

  /* ====== color resolving ====== */
  function resolveCssColor(varName, terminal, contextEl = document.body) {
    const measure = (prop, value) => {
      COLOR_PROBE.style[prop] = value;
      const css = getComputedStyle(COLOR_PROBE)[prop];
      COLOR_PROBE.style[prop] = ""; // reset
      return css;
    };
    const tries = [
      () => measure("backgroundColor", `var(${varName})`),
      () => measure("backgroundColor", `rgb(var(${varName}))`),
      () => terminal && measure("backgroundColor", terminal),
      () => measure("color", `var(${varName})`),
      () => measure("color", `rgb(var(${varName}))`),
      () => terminal && measure("color", terminal)
    ];
    for (const t of tries) {
      const css = t();
      if (css && css !== "rgba(0, 0, 0, 0)" && css !== "transparent")
        return css;
    }
    return "";
  }
  function computeAllFormats(
    varName,
    terminal = "",
    contextEl = document.body
  ) {
    const css = resolveCssColor(varName, terminal, contextEl);
    const hex = css ? toHex(css) : "";
    const { r, g, b, a } = cssToRgba(css);
    const rgba = r != null ? `rgba(${r}, ${g}, ${b}, ${round(a, 3)})` : "";
    const { h, s, l } = rgbaToHsl(r, g, b);
    const hsla =
      h != null
        ? `hsla(${Math.round(h)}, ${round(s, 1)}%, ${round(l, 1)}%, ${round(
            a,
            3
          )})`
        : "";
    return { hex, rgba, hsla };
  }
  function formatDisplay(fmt) {
    if (!fmt) return "—";
    if (CURRENT_FORMAT === "RGBA") return fmt.rgba || "—";
    if (CURRENT_FORMAT === "HSLA") return fmt.hsla || "—";
    return fmt.hex || "—";
  }

  /* ================= Media/breakpoint watch ================= */
  function watchAllMediaQueries() {
    const seen = new Set();
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      if (!rules) continue;
      const walk = (list) => {
        for (const r of list) {
          if (r.type === CSSRule.MEDIA_RULE) {
            const mediaText = r.media?.mediaText;
            if (mediaText && !seen.has(mediaText)) {
              seen.add(mediaText);
              try {
                const mql = matchMedia(mediaText);
                const handler = () => {
                  if (isManualBreakpointActive()) return; // <-- respect forced BP (added)
                  flushScopesThenHydrate();
                };
                mql.addEventListener("change", handler);
              } catch {}
            }
          }
          if (r.cssRules) walk(r.cssRules);
        }
      };
      walk(rules);
    }
  }

  /* ================= Observers / refresh ================= */
  function startObservers() {
    const opts = {
      attributes: true,
      attributeFilter: WATCH_ATTRS,
      subtree: false
    };
    const obsHtml = new MutationObserver(() => flushScopesThenHydrate());
    const obsBody = new MutationObserver(() => flushScopesThenHydrate());
    obsHtml.observe(document.documentElement, opts);
    obsBody.observe(document.body, opts);

    // Head observer with guards (added)
    const obsHead = new MutationObserver((mutations) => {
      // Ignore flicker-guard style toggles from the switcher
      const onlyFlickerGuard =
        mutations.length > 0 &&
        mutations.every((m) => {
          // attributes on the guard itself
          if (
            m.type === "attributes" &&
            m.target &&
            m.target.id === "token-swap-no-transitions"
          )
            return true;
          // childList additions/removals that are just the guard
          if (m.type === "childList") {
            const nodes = [...m.addedNodes, ...m.removedNodes];
            if (!nodes.length) return false;
            return nodes.every(
              (n) => n.nodeType === 1 && n.id === "token-swap-no-transitions"
            );
          }
          return false;
        });
      if (onlyFlickerGuard) return;

      // While manual BP is active, ignore head churn
      if (isManualBreakpointActive()) return;

      flushScopesThenHydrate();
    });
    obsHead.observe(document.head, {
      childList: true,
      subtree: true,
      attributes: true
    });

    WATCH_EVENTS.forEach((ev) =>
      window.addEventListener(ev, () => flushScopesThenHydrate())
    );
    startSnapshotWatch();
  }
  function startSnapshotWatch() {
    stopSnapshotWatch();
    snapTimer = setInterval(() => {
      if (document.hidden) return;
      if (isManualBreakpointActive()) return; // <-- skip while forced (added)
      // scopes might have shifted; make sure they are current before sampling
      refreshScopesIfAvailable();
      const specified = buildVarMapSpecified();
      const key = snapshotKey(specified);
      if (key !== lastSnapshotKey) flushScopesThenHydrate();
    }, 500);
  }
  function stopSnapshotWatch() {
    if (snapTimer) clearInterval(snapTimer);
    snapTimer = null;
  }

  /** Build a small hash from a SAMPLE of tokens using specified values. */
  function snapshotKey(specifiedMap) {
    const cards = getAllCards();
    if (!cards.length) return "";
    const tokens = cards.map((c) => c.getAttribute("data-token"));
    const sampleCount = Math.min(24, tokens.length);
    const step = Math.max(1, Math.floor(tokens.length / sampleCount));
    const parts = [];
    for (let i = 0; i < tokens.length; i += step) {
      const t = tokens[i];
      parts.push(specifiedMap.get(t) || "");
    }
    return parts.join("|");
  }

  /* ================= Utils ================= */
  function el(tag = "div", className = "", attrs) {
    const t = String(tag).toLowerCase();
    const e = document.createElement(t);
    if (className) e.className = className;
    if (attrs)
      for (const [k, v] of Object.entries(attrs))
        if (v != null) e.setAttribute(k, String(v));
    return e;
  }
  function injectDisabledSheet(cssText) {
    const style = document.createElement("style");
    style.setAttribute("data-token-sheet", "true");
    style.disabled = true;
    style.textContent = cssText;
    document.head.appendChild(style);
    return style.sheet || null;
  }
  function toHex(input) {
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.fillStyle = input;
    const parsed = ctx.fillStyle;
    if (parsed.startsWith("#")) return normalizeHex(parsed);
    const m = parsed.match(
      /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*(\d*\.?\d+))?\)$/
    );
    if (!m) return input;
    const [, r, g, b, a] = m;
    const h2 = (v) => Number(v).toString(16).padStart(2, "0");
    const alpha = a == null ? "" : h2(Math.round(parseFloat(a) * 255));
    return ("#" + h2(r) + h2(g) + h2(b) + alpha).toUpperCase();
  }
  function normalizeHex(hex) {
    if (hex.length === 4)
      return (
        "#" + [...hex.slice(1)].map((ch) => ch + ch).join("")
      ).toUpperCase();
    if (hex.length === 5)
      return (
        "#" + [...hex.slice(1)].map((ch) => ch + ch).join("")
      ).toUpperCase();
    return hex.toUpperCase();
  }
  function parseVar(input) {
    const m = String(input).match(/var\(\s*([^) ,]+)\s*(?:,\s*([^)]+)\s*)?\)/);
    if (!m) return null;
    return { name: m[1], fallback: m[2]?.trim() };
  }
  function cssToRgba(css) {
    const m = String(css).match(
      /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/
    );
    if (!m) return { r: null, g: null, b: null, a: null };
    const r = parseInt(m[1], 10),
      g = parseInt(m[2], 10),
      b = parseInt(m[3], 10);
    const a = m[4] != null ? parseFloat(m[4]) : 1;
    return { r, g, b, a };
  }
  function rgbaToHsl(r, g, b) {
    if (r == null) return { h: null, s: null, l: null };
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b);
    let h,
      s,
      l = (max + min) / 2;
    if (max === min) {
      h = 0;
      s = 0;
    } else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r:
          h = (g - b) / d + (g < b ? 6 : 0);
          break;
        case g:
          h = (b - r) / d + 2;
          break;
        case b:
          h = (r - g) / d + 4;
          break;
      }
      h *= 60;
    }
    return { h, s: s * 100, l: l * 100 };
  }
  function round(n, p) {
    return Math.round(n * 10 ** p) / 10 ** p;
  }
  function cssEsc(v) {
    return window.CSS && CSS.escape
      ? CSS.escape(v)
      : String(v).replace(/"/g, '\\"');
  }

  /* ================= Public ================= */
  function updateAllDisplays() {
    hydrateAll();
  }
  window.updateAllDisplays = updateAllDisplays;
})();
