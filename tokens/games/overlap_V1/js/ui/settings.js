// Settings panel + color mode persistence.
import { KEY } from "../config.js";

export function createSettingsUI({ els } = {}) {
  // Settings panel is a simple show/hide container.
  const isSettingsPanelOpen = () => !!els?.settingsPanel && !els.settingsPanel.hidden;
  function openSettingsPanel() {
    if (!els?.settingsPanel) return;
    els.settingsPanel.hidden = false;
    els.settingsPanel.setAttribute("aria-hidden", "false");
    els.settingsPanel.classList.add("is-open");
    els.settingsBtn?.setAttribute("aria-expanded", "true");
  }

  function closeSettingsPanel() {
    if (!els?.settingsPanel) return;
    els.settingsPanel.classList.remove("is-open");
    els.settingsPanel.setAttribute("aria-hidden", "true");
    els.settingsPanel.hidden = true;
    els.settingsBtn?.setAttribute("aria-expanded", "false");
  }

  function toggleSettingsPanel() {
    if (isSettingsPanelOpen()) closeSettingsPanel();
    else openSettingsPanel();
  }

  // Color mode persists per user and respects system preference for auto.
  const COLOR_MODE_KEY = `${KEY}__color_mode`;
  const ONSCREEN_KB_KEY = `${KEY}__show_onscreen_keyboard`;
  const COLOR_MODE_AUTO = "auto";
  const COLOR_MODE_LIGHT = "light";
  const COLOR_MODE_DARK = "dark";
  const COLOR_MODE_VALUES = new Set([COLOR_MODE_AUTO, COLOR_MODE_LIGHT, COLOR_MODE_DARK]);
  const colorModeTabs = Array.from(document.querySelectorAll(".settings-color-mode .tab[data-mode]"));
  const prefersColorQuery = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let currentColorMode = COLOR_MODE_AUTO;

  // Resolve "auto" to the current system preference.
  function resolveAutoColorMode() {
    return prefersColorQuery && prefersColorQuery.matches ? COLOR_MODE_DARK : COLOR_MODE_LIGHT;
  }

  // Apply resolved mode to the root for CSS theming.
  function applyColorMode(mode) {
    const resolved = mode === COLOR_MODE_AUTO ? resolveAutoColorMode() : mode;
    if (!resolved) return;
    document.documentElement.setAttribute("data-mode", resolved);
  }

  // Update tab UI to reflect the current selection.
  function updateColorModeUI(mode) {
    colorModeTabs.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  // Set and optionally persist a color mode.
  function setColorMode(mode, { persist = true } = {}) {
    const next = COLOR_MODE_VALUES.has(mode) ? mode : COLOR_MODE_AUTO;
    currentColorMode = next;
    updateColorModeUI(next);
    applyColorMode(next);
    if (persist) {
      try {
        localStorage.setItem(COLOR_MODE_KEY, next);
      } catch {}
    }
  }

  function loadColorMode() {
    let saved = null;
    try {
      saved = localStorage.getItem(COLOR_MODE_KEY);
    } catch {}
    setColorMode(saved || COLOR_MODE_AUTO, { persist: false });
  }

  // Restore user preference for the on-screen keyboard.
  function loadOnscreenKeyboardPref() {
    if (!els?.showOnscreenKeyboard) return;
    let enabled = false;
    try {
      enabled = localStorage.getItem(ONSCREEN_KB_KEY) === "1";
    } catch {}
    els.showOnscreenKeyboard.checked = enabled;
    els.showOnscreenKeyboard.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function bindEvents() {
    els?.settingsBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      toggleSettingsPanel();
    });
    els?.settingsCloseBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      closeSettingsPanel();
    });
    els?.showOnscreenKeyboard?.addEventListener("change", (e) => {
      const enabled = !!e.target.checked;
      try {
        if (enabled) localStorage.setItem(ONSCREEN_KB_KEY, "1");
        else localStorage.removeItem(ONSCREEN_KB_KEY);
      } catch {}
    });
    document.addEventListener("pointerdown", (e) => {
      if (!isSettingsPanelOpen()) return;
      const target = e.target;
      if (els?.settingsPanel?.contains(target)) return;
      if (els?.settingsBtn?.contains(target)) return;
      closeSettingsPanel();
    });
    colorModeTabs.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        const mode = btn.dataset.mode;
        setColorMode(mode);
      });
    });
    if (prefersColorQuery) {
      const handleSystemChange = () => {
        if (currentColorMode === COLOR_MODE_AUTO) applyColorMode(COLOR_MODE_AUTO);
      };
      if (typeof prefersColorQuery.addEventListener === "function") {
        prefersColorQuery.addEventListener("change", handleSystemChange);
      } else if (typeof prefersColorQuery.addListener === "function") {
        prefersColorQuery.addListener(handleSystemChange);
      }
    }
  }

  function init() {
    bindEvents();
    loadColorMode();
    loadOnscreenKeyboardPref();
  }

  return {
    isSettingsPanelOpen,
    openSettingsPanel,
    closeSettingsPanel,
    toggleSettingsPanel,
    applyColorMode,
    setColorMode,
    loadColorMode,
    loadOnscreenKeyboardPref,
    init,
  };
}
