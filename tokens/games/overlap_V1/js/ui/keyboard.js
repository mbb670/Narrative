/*
 * File Overview
 * Purpose: On-screen keyboard UI.
 * Controls: Key layout, key states, and input handling.
 * How: Binds key buttons to play actions and updates key styling.
 * Key interactions: Uses play/actions, selection, and warnings.
 */
// Touch + on-screen keyboard helpers and hidden input wiring.
import { VIEW } from "../core/config.js";

export function createKeyboard({
  els,
  isEditable,
  write,
  back,
  move,
  getCurrentView,
  isTouch,
} = {}) {
  const isTouchDevice = !!isTouch;
  const getView = typeof getCurrentView === "function" ? getCurrentView : () => null;
  const canEdit = typeof isEditable === "function" ? isEditable : () => false;
  const writeChar = typeof write === "function" ? write : () => {};
  const backspace = typeof back === "function" ? back : () => {};
  const moveCursor = typeof move === "function" ? move : () => {};

  let hasInteracted = true;
  const markInteracted = () => {
    hasInteracted = true;
  };

  const UA = navigator.userAgent || "";
  const UA_DESKTOP_HINT =
    /(Windows NT|Macintosh|CrOS|Linux|X11)/i.test(UA) && !/(Mobile|Tablet|iPad|iPhone|Android)/i.test(UA);
  const UA_DATA_DESKTOP = navigator.userAgentData ? navigator.userAgentData.mobile === false : false;

  // On touch devices default to virtual keyboard; on desktop honor detection.
  const DEFAULTS_TO_HARDWARE = UA_DESKTOP_HINT || UA_DATA_DESKTOP;
  let hasHardwareKeyboard = isTouchDevice ? false : DEFAULTS_TO_HARDWARE;
  let hardwareKeyboardLocked = false; // set true when we detect hardware during this session
  let lastHardwareKeyboardTs = 0;
  const HARDWARE_STALE_MS = 120000; // demote hardware flag after ~2 minutes of no keys
  const shouldUseCustomKeyboard = () => isTouchDevice && !hasHardwareKeyboard;

  // Hidden input used to receive native keyboard input on mobile.
  const kb = document.createElement("input");
  kb.type = "text";
  kb.setAttribute("autocomplete", "off");
  kb.setAttribute("autocapitalize", "none");
  kb.spellcheck = false;
  kb.setAttribute("autocorrect", "off");
  kb.inputMode = "text";
  kb.setAttribute("aria-hidden", "true");
  kb.tabIndex = -1;
  kb.style.cssText =
    "position:fixed;left:0;bottom:0;width:1px;height:1px;opacity:0;pointer-events:none;font-size:16px;";
  (document.body || document.documentElement).appendChild(kb);

  // Sentinel keeps selection range consistent for mobile IME input.
  const KB_SENTINEL = "\u200B";
  const kbReset = () => {
    kb.value = KB_SENTINEL;
    try {
      kb.setSelectionRange(1, 1);
    } catch {}
  };
  kbReset();

  const isKeyboardInputTarget = (el) => el === kb;
  const blurKeyboardInput = () => {
    try {
      kb.blur();
    } catch {}
  };

  // Focus the appropriate input target (stage or hidden input).
  const focusForTyping = () => {
    if (!hasInteracted) return;
    const currentView = getView();
    if (currentView && currentView !== VIEW.PLAY) return;
    if (!document.hasFocus()) return;

    const a = document.activeElement;
    if (a && a !== kb && canEdit(a)) return;

    // If using custom keyboard or hardware keyboard, keep focus on the stage for key handling.
    if (shouldUseCustomKeyboard() || hasHardwareKeyboard || !isTouchDevice) {
      try {
        els?.stage?.focus({ preventScroll: true });
      } catch {
        els?.stage?.focus();
      }
      return;
    }

    // Otherwise focus the hidden input so mobile keyboards appear.
    try {
      kb.focus({ preventScroll: true });
    } catch {
      kb.focus();
    }
    kbReset();
  };

  kb.addEventListener("input", () => {
    if (shouldUseCustomKeyboard()) return;

    const v = kb.value || "";
    if (!v) return;
    for (const ch of v) {
      if (/^[a-zA-Z]$/.test(ch)) writeChar(ch.toUpperCase());
    }
    kbReset();
  });

  kb.addEventListener("keydown", (e) => {
    if (shouldUseCustomKeyboard()) return;
    if (e.metaKey || e.ctrlKey) return;

    if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
      kbReset();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveCursor(-1);
      kbReset();
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      moveCursor(1);
      kbReset();
      return;
    }
  });

  const KB_ROWS = [
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "BACKSPACE"],
  ];

  // Build the custom on-screen keyboard and wire interactions (tap/hold repeat).
  function initOnScreenKeyboard() {
    const root = els?.keyboard;
    if (!root) return;

    root.addEventListener("contextmenu", (e) => e.preventDefault());

    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "On-screen keyboard");
    root.innerHTML = "";
    let lastPressTs = 0;
    let lastPointerHandledTs = 0;
    let suppressClicksUntil = 0;
    let repeatTimer = null;
    let repeatInterval = null;

    const stopRepeats = () => {
      if (repeatTimer) clearTimeout(repeatTimer);
      if (repeatInterval) clearInterval(repeatInterval);
      repeatTimer = null;
      repeatInterval = null;
    };

    // Build keys from the layout definition.
    KB_ROWS.forEach((rowKeys) => {
      const row = document.createElement("div");
      row.className = "keyboard-row text-system-semibold-sm";

      rowKeys.forEach((key) => {
        const btn = document.createElement("button");
        btn.type = "button";
        const isBackspace = key === "BACKSPACE";
        const isEnter = key === "ENTER";
        btn.className = `keyboard-key${isBackspace ? " keyboard-key--backspace" : ""}${isEnter ? " keyboard-key--enter" : ""}`;
        if (isBackspace) {
          btn.dataset.action = "backspace";
          btn.setAttribute("aria-label", "Backspace");
          btn.textContent = "";
        } else if (isEnter) {
          btn.dataset.action = "enter";
          btn.setAttribute("aria-label", "Next cell");
          btn.textContent = "";
        } else {
          btn.dataset.key = key;
          btn.setAttribute("aria-label", key);
          btn.textContent = key;
          const pv = document.createElement("div");
          pv.className = "keyboard-key-preview text-system-semibold-sm elevation-fixed-bottom";
          pv.textContent = key;
          btn.appendChild(pv);
        }
        row.appendChild(btn);
      });

      root.appendChild(row);
    });

    // Central action dispatch for key presses.
    const triggerAction = (btn) => {
      if (btn.dataset.key) writeChar(btn.dataset.key);
      else if (btn.dataset.action === "backspace") backspace();
      else if (btn.dataset.action === "enter") moveCursor(1);
    };

    const showPreview = (btn) => {
      if (!btn?.dataset?.key) return;
      const pv = btn.querySelector(".keyboard-key-preview");
      if (pv) pv.classList.add("is-visible");
    };

    const hidePreview = () => {
      if (!root) return;
      root.querySelectorAll(".keyboard-key-preview.is-visible").forEach((pv) => pv.classList.remove("is-visible"));
    };

    let pressedBtn = null;
    const clearPressed = () => {
      const pv = pressedBtn?.querySelector(".keyboard-key-preview");
      if (pv) pv.classList.remove("is-visible");
      if (pressedBtn) pressedBtn.classList.remove("is-pressed");
      pressedBtn = null;
      hidePreview();
      stopRepeats();
    };

    const handlePress = (e, { isRepeat = false } = {}) => {
      const btn = e.target.closest("[data-key], [data-action]");
      if (!btn || btn.disabled) return;
      e.preventDefault();
      markInteracted();
      lastPressTs = performance.now();
      lastPointerHandledTs = lastPressTs;
      suppressClicksUntil = lastPointerHandledTs + 1000;

      pressedBtn = btn;
      btn.classList.add("is-pressed");
      if (!btn.dataset.action) showPreview(btn);

      triggerAction(btn);

      focusForTyping();

      // Start repeat for actions only on initial pointer press.
      const allowRepeat = e.type && e.type.startsWith("pointer");
      if (!isRepeat && allowRepeat && btn.dataset.action) {
        stopRepeats();
        repeatTimer = setTimeout(() => {
          repeatInterval = setInterval(() => triggerAction(btn), 70);
        }, 350);
      }
    };

    root.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest("[data-key], [data-action]");
      if (!btn) return;
      pressedBtn = btn;
      btn.classList.add("is-pressed");
      if (!btn.dataset.action) showPreview(btn);
      handlePress(e);
    });

    const endEvents = ["pointerup", "pointercancel"];
    endEvents.forEach((ev) => {
      root.addEventListener(ev, () => {
        if (!pressedBtn) return;
        lastPointerHandledTs = performance.now();
        suppressClicksUntil = lastPointerHandledTs + 1000;
        clearPressed();
      });
    });

    // Fallback click handler (in case a pointer event is missed)
    root.addEventListener("click", (e) => {
      // Skip if a pointer press was just handled
      if (performance.now() < suppressClicksUntil) return;
      handlePress(e);
      clearPressed();
    });

    ["pointerup", "pointercancel"].forEach((ev) => {
      window.addEventListener(ev, () => {
        stopRepeats();
        clearPressed();
      });
    });

    // safety: if focus leaves keyboard, clear pressed state
    root.addEventListener("focusout", () => clearPressed());
  }

  // Toggle custom keyboard based on device and view.
  function updateKeyboardVisibility() {
    const root = els?.keyboard;
    if (!root) return;

    const currentView = getView();
    const show = shouldUseCustomKeyboard() && currentView === VIEW.PLAY;

    root.classList.toggle("is-visible", show);
    root.setAttribute("aria-hidden", show ? "false" : "true");
    document.body.classList.toggle("uses-custom-keyboard", show);

    if (show) blurKeyboardInput();
  }

  // If no hardware key use is detected for a while, revert to touch keyboard.
  function maybeDemoteHardwareKeyboard() {
    if (hardwareKeyboardLocked) return;
    if (!hasHardwareKeyboard) return;
    const stale = !lastHardwareKeyboardTs || Date.now() - lastHardwareKeyboardTs > HARDWARE_STALE_MS;
    if (!stale) return;

    // No recent hardware keys -> allow on-screen keyboard again.
    hasHardwareKeyboard = false;
    updateKeyboardVisibility();
  }

  // Once hardware keyboard is detected on touch, lock it in for the session.
  function noteHardwareKeyboard() {
    if (!isTouchDevice) return;
    if (hasHardwareKeyboard) return;
    hasHardwareKeyboard = true;
    hardwareKeyboardLocked = true; // never show virtual keyboard again until reload
    lastHardwareKeyboardTs = Date.now();
    updateKeyboardVisibility();
    focusForTyping();
  }

  const hasHardwareKeyboardState = () => hasHardwareKeyboard;

  return {
    markInteracted,
    focusForTyping,
    initOnScreenKeyboard,
    updateKeyboardVisibility,
    maybeDemoteHardwareKeyboard,
    noteHardwareKeyboard,
    hasHardwareKeyboard: hasHardwareKeyboardState,
    isKeyboardInputTarget,
    blurKeyboardInput,
  };
}
