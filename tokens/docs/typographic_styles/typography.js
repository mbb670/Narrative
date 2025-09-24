(() => {
  "use strict";

  // ---------- CONFIG ----------
  const CONTAINER_ID = "typography-sections";
  const SWITCHER_ID = "type-weight-switcher";
  const GROUP_H2_CL = "text-group-heading";
  const DEFAULT_WEIGHT = "regular"; // render Regular only on load

  const GROUPS = [
    { key: "display", label: "Display", sizes: ["lg", "md", "sm"] },
    { key: "headline", label: "Headline", sizes: ["lg", "md", "sm"] },
    {
      key: "subheadline",
      label: "Subheadline",
      sizes: ["lg", "md", "sm", "xs"]
    },
    { key: "body", label: "Body", sizes: ["lg", "md", "sm", "xs"] },
    { key: "system", label: "System", sizes: ["lg", "md", "sm", "xs"] },
    { key: "uppercase", label: "Uppercase", sizes: ["lg", "md", "sm"] }
  ];

  const WEIGHTS = {
    regular: {
      key: "regular",
      label: "Regular",
      token: "regular",
      classPart: "regular"
    },
    semibold: {
      key: "semibold",
      label: "SemiBold",
      token: "strong",
      classPart: "semibold"
    }
  };

  // ---------- MOUNT CONTAINER ----------
  const container =
    document.getElementById(CONTAINER_ID) ||
    (() => {
      const div = document.createElement("div");
      div.id = CONTAINER_ID;
      document.body.appendChild(div);
      return div;
    })();
  container.innerHTML = "";

  // ---------- SWITCHER ----------
  (function buildSwitcher() {
    const prev = document.getElementById(SWITCHER_ID);
    if (prev) prev.remove();

    const rg = document.createElement("div");
    rg.id = SWITCHER_ID;
    rg.className =
      "type-weight-switcher fixed-control elevation-elevation-fixed-top";
    rg.setAttribute("role", "radiogroup");
    rg.setAttribute(
      "data-swap-exclude",
      "theme fontTheme colorTheme breakpoint"
    );
    rg.setAttribute("aria-label", "Font weight");

    const mk = (value, label, checked) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "switcher-btn";
      b.setAttribute("role", "radio");
      b.dataset.value = value;
      b.setAttribute("aria-checked", checked ? "true" : "false");
      b.tabIndex = checked ? 0 : -1;
      b.textContent = label;
      return b;
    };

    rg.appendChild(mk("regular", "Regular", true));
    rg.appendChild(mk("semibold", "SemiBold", false));
    container.insertAdjacentElement("beforebegin", rg);
  })();

  // ---------- RENDER (REGULAR ONLY) ----------
  function uppercaseExtrasHTML(groupKey) {
    if (groupKey !== "uppercase") return "";
    // Text Transform (static), Letter Spacing (token), Font Stretch (static)
    return `
          <li>
        <p>Letter Spacing</p>
        <div class="card" data-token="--letterspacing-xl"></div>
      </li>
      <li>
        <p>Text Transform</p>
        <span class="copyable chip interactive-background" data-copy="uppercase">uppercase</span>
      </li>
      <li>
        <p>Font Stretch</p>
        <span class="copyable chip interactive-background" data-copy="75%">75%</span>
      </li>
    `.trim();
  }

  function sectionHTML(groupKey, groupLabel, size) {
    const cls = `text-${groupKey}-${WEIGHTS.regular.classPart}-${size}`;
    const title = `${groupLabel} ${WEIGHTS.regular.label} ${size}`;
    return `
      <div class="text-parent">
        <span class="copyable text-title interactive-background text-system-semibold-sm token" data-copy="${cls}">${title}</span>
        <section class="text-container elevation-elevation-fixed-top"
                 data-group="${groupKey}" data-size="${size}" data-label="${groupLabel}">
          <h2 data-swap-allow="fontTheme breakpoint" class="text-sample ${cls}" >Sample</h2>
          <ul class="grid text-system-regular-sm">
            <li>
              <p>Font Family</p>
              <div class="card" data-token="--${groupKey}-fontfamily"></div>
            </li>
            <li>
              <p>Font Size</p>
              <div class="card" data-token="--${groupKey}-fontsize-${size}"></div>
            </li>
            <li>
              <p>Line Height</p>
              <div class="card" data-token="--${groupKey}-lineheight"></div>
            </li>
            <li>
              <p>Font Weight</p>
              <div class="card" data-token="--${groupKey}-${
      WEIGHTS.regular.token
    }" data-role="font-weight-card"></div>
            </li>
            ${uppercaseExtrasHTML(groupKey)}
          </ul>
        </section>
      </div>
    `.trim();
  }

  (function renderAllRegular() {
    const frag = document.createDocumentFragment();

    for (const g of GROUPS) {
      // Group heading
      const h2 = document.createElement("h2");
      h2.className = [GROUP_H2_CL, "text-display-semibold-md"]
        .filter(Boolean)
        .join(" ");
      h2.id = `group-${g.key}`;
      h2.textContent = g.label;
      frag.appendChild(h2);

      // Group wrapper to flex
      const groupWrap = document.createElement("div");
      groupWrap.className = "text-group";
      groupWrap.dataset.group = g.key;
      groupWrap.setAttribute("role", "group");
      groupWrap.setAttribute("aria-labelledby", h2.id);

      // Children (.text-parent blocks)
      for (const size of g.sizes) {
        const tpl = document.createElement("template");
        tpl.innerHTML = sectionHTML(g.key, g.label, size);
        groupWrap.appendChild(tpl.content);
      }

      frag.appendChild(groupWrap);
    }

    container.appendChild(frag);
  })();

  // ---------- HELPERS ----------
  function setRadioChecked(value) {
    const radios = document.querySelectorAll(`#${SWITCHER_ID} [role="radio"]`);
    radios.forEach((btn) => {
      const checked = btn.dataset.value === value;
      btn.setAttribute("aria-checked", checked ? "true" : "false");
      btn.tabIndex = checked ? 0 : -1;
    });
  }

  // Update the visible label + data-copy for the main token chip inside a card
  function updateCardMainTokenChip(cardEl, newToken) {
    const mainline = cardEl.querySelector(".mainline");
    if (!mainline) return;
    const copyable = mainline.querySelector(".copyable");
    const chip = mainline.querySelector(".token");
    if (chip) chip.textContent = newToken;
    if (copyable) copyable.dataset.copy = newToken;
  }

  // Ensure expander toggle points at the current token
  function updateCardToggleToken(cardEl, newToken) {
    const toggleBtn = cardEl.querySelector(".toggle");
    if (toggleBtn) {
      toggleBtn.dataset.token = newToken;
      toggleBtn.setAttribute("aria-expanded", "false");
    }
  }

  // ---- expander sync helpers ----
  function cssEscToken(v) {
    return window.CSS && CSS.escape
      ? CSS.escape(v)
      : String(v).replace(/"/g, '\\"');
  }

  function syncOpenExpanderWeight(currentWeightDef) {
    const exp = document.querySelector('.expander[role="dialog"]');
    if (!exp) return; // nothing open

    const oldToken = exp.getAttribute("data-for") || "";
    const m = oldToken.match(/^--([a-z]+)-(regular|strong)$/i);
    if (!m) return;

    const groupKey = m[1];
    const newToken = `--${groupKey}-${currentWeightDef.token}`;
    if (newToken === oldToken) return;

    const card = document.querySelector(
      `[data-role="font-weight-card"][data-token="${cssEscToken(newToken)}"]`
    );
    const toggle = card?.querySelector(".toggle");
    if (toggle) toggle.click();
  }

  // ---------- TOGGLE: REGULAR ↔ SEMIBOLD ----------
  function applyWeight(weightKey) {
    const W = WEIGHTS[weightKey] || WEIGHTS.regular;

    container.querySelectorAll("section.text-container").forEach((sec) => {
      const groupKey = sec.dataset.group;
      const size = sec.dataset.size;
      const groupLabel = sec.dataset.label;

      // Swap sample class
      const sample = sec.querySelector(".text-sample");
      if (sample) {
        const old = Array.from(sample.classList).filter((c) =>
          /^text-[a-z]+-(regular|semibold)-[a-z]+$/.test(c)
        );
        old.forEach((c) => sample.classList.remove(c));
        sample.classList.add(`text-${groupKey}-${W.classPart}-${size}`);
      }

      // Optional: update the title chip (only if you want the label to change)
      const titleEl = sec.parentElement?.querySelector(".text-title.copyable");
      if (titleEl) {
        const className = `text-${groupKey}-${W.classPart}-${size}`;
        titleEl.textContent = `${groupLabel} ${W.label} ${size}`;
        titleEl.setAttribute("data-copy", className);
      }

      // Update font-weight card
      const weightCard = sec.querySelector('[data-role="font-weight-card"]');
      if (weightCard) {
        const newVar = `--${groupKey}-${W.token}`;
        weightCard.setAttribute("data-token", newVar);
        updateCardMainTokenChip(weightCard, newVar);
        updateCardToggleToken(weightCard, newVar);
        const fill = weightCard.querySelector(".swatch-fill");
        if (fill) fill.style.background = `var(${newVar})`;
      }
    });

    // Keep an open expander in sync
    syncOpenExpanderWeight(W);

    // Recompute resolved values/chains without a page refresh
    if (typeof window.updateAllDisplays === "function") {
      window.updateAllDisplays();
    } else {
      window.dispatchEvent(new Event("themechange"));
    }

    setRadioChecked(W.key);
  }

  // Bind the switcher
  (function bindSwitcher() {
    const switcher = document.getElementById(SWITCHER_ID);
    const radios = Array.from(switcher.querySelectorAll('[role="radio"]'));

    radios.forEach((btn) =>
      btn.addEventListener("click", () => applyWeight(btn.dataset.value))
    );

    switcher.addEventListener("keydown", (e) => {
      const currentIndex = radios.findIndex(
        (b) => b.getAttribute("aria-checked") === "true"
      );
      let next = currentIndex;

      if (e.key === "ArrowRight" || e.key === "ArrowDown")
        next = (currentIndex + 1) % radios.length;
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp")
        next = (currentIndex - 1 + radios.length) % radios.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = radios.length - 1;
      else return;

      e.preventDefault();
      radios[next].focus();
      radios[next].click();
    });
  })();

  // ---------- INIT ----------
  applyWeight(DEFAULT_WEIGHT);
})();

// ---------- FOR TEXT INPUTS ----------//

(() => {
  const CLASS = "text-sample";
  const DEFAULT_PLACEHOLDER = "Sample";

  function initExisting() {
    document.querySelectorAll("." + CLASS).forEach(enable);
  }
  function watchForNew() {
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof Element)) return;
          if (n.classList?.contains(CLASS)) enable(n);
          n.querySelectorAll?.("." + CLASS).forEach(enable);
        });
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  function enable(el) {
    if (el.dataset._textSampleReady) return;
    el.dataset._textSampleReady = "1";

    el.setAttribute("contenteditable", "plaintext-only");
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-label", "Sample text");
    el.style.whiteSpace = "nowrap";
    el.style.overflow = "hidden";

    if (!el.textContent.trim()) showPlaceholder(el);

    // Mark intent before focus so broadcast doesn't clobber the click target
    el.addEventListener("mousedown", () =>
      el.classList.add("ts-editing-intent")
    );

    el.addEventListener("focus", () => {
      el.classList.add("ts-focused");
      el.classList.remove("ts-editing-intent");
      if (!el.textContent.trim()) hidePlaceholder(el); // caret at start of empty field
    });

    // single-line only
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.preventDefault();
    });

    // paste/drop as plain text; flatten newlines to spaces
    el.addEventListener("paste", (e) => {
      e.preventDefault();
      const txt =
        (e.clipboardData || window.clipboardData).getData("text/plain") || "";
      document.execCommand("insertText", false, txt.replace(/[\r\n]+/g, " "));
    });
    el.addEventListener("drop", (e) => {
      e.preventDefault();
      const txt = e.dataTransfer?.getData("text/plain") || "";
      document.execCommand("insertText", false, txt.replace(/[\r\n]+/g, " "));
    });

    // typing
    el.addEventListener("input", () => {
      const clean = sanitize(el.textContent || "");
      if (el.textContent !== clean) {
        el.textContent = clean; // ensures plain text only
        placeCaretAtEnd(el);
      }
      const emptyish = !clean.trim();
      if (emptyish && document.activeElement !== el) showPlaceholder(el);
      else if (!emptyish) hidePlaceholder(el);
      broadcast(clean, el);
    });

    // blur (no selection/scroll manipulation here)
    el.addEventListener("blur", () => {
      el.classList.remove("ts-focused", "ts-editing-intent");
      const val = (el.textContent || "").trim();
      if (!val) {
        el.textContent = "";
        showPlaceholder(el);
        broadcast("", el);
      }
      // Only reset the element’s own horizontal scroll if needed (no page jump)
      if (el.scrollWidth > el.clientWidth) el.scrollLeft = 0;
    });
  }

  // Sync text to peers without stomping the one being edited or clicked
  function broadcast(text, sourceEl) {
    const emptyish = !text.trim();
    document.querySelectorAll("." + CLASS).forEach((node) => {
      if (node === document.activeElement) return;
      if (node === sourceEl) return;
      if (node.classList.contains("ts-editing-intent")) return;
      node.textContent = text;
      node.style.whiteSpace = "nowrap";
      node.style.overflow = "hidden";
      if (emptyish) showPlaceholder(node);
      else hidePlaceholder(node);
    });
  }

  function sanitize(s) {
    return s.replace(/[\u0000-\u001F\u007F]/g, "").replace(/[\r\n]+/g, " ");
  }

  function showPlaceholder(el) {
    el.classList.add("is-placeholder");
    el.dataset.placeholder = DEFAULT_PLACEHOLDER;
  }
  function hidePlaceholder(el) {
    el.classList.remove("is-placeholder");
    el.removeAttribute("data-placeholder");
  }

  function placeCaretAtEnd(el) {
    const range = document.createRange();
    const sel = window.getSelection();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // boot
  const start = () => {
    initExisting();
    watchForNew();
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", start);
  else start();
})();
