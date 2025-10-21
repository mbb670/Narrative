(() => {
  const minW = 320;
  const minH = 360;
  const maxW = 1920;
  const maxH = 1400;
  const topBar = 40;

  const ASPECTS = {
    "16:9": 16 / 9,
    "9:16": 9 / 16,
    "4:3": 4 / 3,
    "3:2": 3 / 2,
    "1:1": 1,
    "21:9": 21 / 9,
    "4:5": 4 / 5,
    "2:3": 2 / 3,
  };

  const state = {
    vpWidth: 1200,
    vpHeight: 800,
    vpX: 0,
    vpY: 0,
    maxWStr: "1600px",
    maxHStr: "85svh",
    aspectKey: "16:9",
    intrinsic: { w: 1280, h: 720 },
  };

  const dragState = {
    mode: null,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
    startVX: 0,
    startVY: 0,
  };

  const elements = {};

  function init() {
    elements.vpWidthInput = document.querySelector("#vp-width");
    elements.vpHeightInput = document.querySelector("#vp-height");
    elements.maxWidthInput = document.querySelector("#max-width-input");
    elements.maxHeightInput = document.querySelector("#max-height-input");
    elements.aspectSelect = document.querySelector("#aspect-select");
    elements.viewport = document.querySelector("#viewport-shell");
    elements.videoShell = document.querySelector("#video-shell");
    elements.videoSize = document.querySelector("#video-size");
    elements.viewportSummary = document.querySelector("#viewport-summary");
    elements.toolbarSize = document.querySelector("#viewport-toolbar-size");
    elements.maxSummary = document.querySelector("#max-summary");
    elements.aspectSummary = document.querySelector("#aspect-summary");
    elements.resetButton = document.querySelector("#viewport-reset");
    elements.video = document.querySelector("#demo-video");

    if (!elements.viewport) return;

    elements.vpWidthInput.addEventListener("input", handleWidthChange);
    elements.vpHeightInput.addEventListener("input", handleHeightChange);
    elements.maxWidthInput.addEventListener("input", handleMaxWidthChange);
    elements.maxHeightInput.addEventListener("input", handleMaxHeightChange);
    elements.aspectSelect.addEventListener("change", handleAspectChange);
    elements.resetButton.addEventListener("click", handleReset);

    registerDragHandle("#drag-left", "left");
    registerDragHandle("#drag-right", "right");
    registerDragHandle("#drag-top", "top");
    registerDragHandle("#drag-bottom", "bottom");
    registerDragHandle("#drag-move", "move");

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", endDrag);

    if (elements.video) {
      elements.video.addEventListener("loadedmetadata", () => {
        if (elements.video.videoWidth && elements.video.videoHeight) {
          state.intrinsic = {
            w: elements.video.videoWidth,
            h: elements.video.videoHeight,
          };
        }
      });
    }

    updateUI();
  }

  function registerDragHandle(selector, mode) {
    const el = document.querySelector(selector);
    if (!el) return;
    el.addEventListener("mousedown", (event) => beginDrag(event, mode));
  }

  function handleWidthChange(event) {
    const value = clamp(Number(event.target.value) || minW, minW, maxW);
    state.vpWidth = value;
    updateUI();
  }

  function handleHeightChange(event) {
    const value = clamp(Number(event.target.value) || minH, minH, maxH);
    state.vpHeight = value;
    updateUI();
  }

  function handleMaxWidthChange(event) {
    state.maxWStr = event.target.value;
    updateUI();
  }

  function handleMaxHeightChange(event) {
    state.maxHStr = event.target.value;
    updateUI();
  }

  function handleAspectChange(event) {
    state.aspectKey = event.target.value;
    updateUI();
  }

  function handleReset() {
    state.vpWidth = 1200;
    state.vpHeight = 800;
    state.vpX = 0;
    state.vpY = 0;
    updateUI();
  }

  function beginDrag(event, mode) {
    event.preventDefault();
    dragState.mode = mode;
    dragState.startX = event.clientX;
    dragState.startY = event.clientY;
    dragState.startW = state.vpWidth;
    dragState.startH = state.vpHeight;
    dragState.startVX = state.vpX;
    dragState.startVY = state.vpY;
    document.body.classList.add("dragging");
  }

  function onMouseMove(event) {
    if (!dragState.mode) return;
    if (dragState.mode === "move") {
      state.vpX = dragState.startVX + (event.clientX - dragState.startX);
      state.vpY = dragState.startVY + (event.clientY - dragState.startY);
    } else if (dragState.mode === "right") {
      state.vpWidth = clamp(
        dragState.startW + (event.clientX - dragState.startX),
        minW,
        maxW
      );
    } else if (dragState.mode === "left") {
      state.vpWidth = clamp(
        dragState.startW - (event.clientX - dragState.startX),
        minW,
        maxW
      );
    } else if (dragState.mode === "bottom") {
      state.vpHeight = clamp(
        dragState.startH + (event.clientY - dragState.startY),
        minH,
        maxH
      );
    } else if (dragState.mode === "top") {
      state.vpHeight = clamp(
        dragState.startH - (event.clientY - dragState.startY),
        minH,
        maxH
      );
    }
    updateUI();
  }

  function endDrag() {
    if (!dragState.mode) return;
    dragState.mode = null;
    document.body.classList.remove("dragging");
  }

  function updateUI() {
    if (!elements.viewport) return;

    const aspect = ASPECTS[state.aspectKey] || ASPECTS["16:9"];
    const parsedMaxW = parseUserLength(
      state.maxWStr,
      "w",
      state.vpWidth,
      state.vpHeight
    );
    const parsedMaxH = parseUserLength(
      state.maxHStr,
      "h",
      state.vpWidth,
      state.vpHeight
    );
    const videoDims = computeDims(
      state.vpWidth,
      state.vpHeight,
      parsedMaxW,
      parsedMaxH,
      aspect,
      topBar
    );

    elements.vpWidthInput.value = state.vpWidth;
    elements.vpHeightInput.value = state.vpHeight;
    elements.maxWidthInput.value = state.maxWStr;
    elements.maxHeightInput.value = state.maxHStr;
    elements.aspectSelect.value = state.aspectKey;

    elements.viewport.style.width = `${state.vpWidth}px`;
    elements.viewport.style.height = `${state.vpHeight}px`;
    elements.viewport.style.transform = `translate(${state.vpX}px, ${state.vpY}px)`;

    elements.videoShell.style.width = `${videoDims.width}px`;
    elements.videoShell.style.height = `${videoDims.height}px`;

    elements.videoSize.textContent = `${videoDims.width} × ${videoDims.height}px`;
    elements.viewportSummary.textContent = `${state.vpWidth} × ${state.vpHeight}px`;
    elements.toolbarSize.textContent = `${state.vpWidth} × ${state.vpHeight}px`;
    elements.maxSummary.textContent = `Max-W: ${fmt(
      parsedMaxW
    )}px, Max-H: ${fmt(parsedMaxH)}px.`;
    elements.aspectSummary.textContent = `Aspect ratio: ${state.aspectKey} (${aspect.toFixed(
      3
    )}:1)`;
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  function parseUserLength(str, axis, vpW, vpH) {
    if (!str) return null;
    const raw = String(str).trim().toLowerCase();
    if (raw === "none") return null;
    const num = parseFloat(raw);
    if (Number.isNaN(num)) return null;
    if (raw.endsWith("px")) return num;
    if (raw.endsWith("vh") || raw.endsWith("svh")) return (num / 100) * vpH;
    if (raw.endsWith("vw")) return (num / 100) * vpW;
    if (raw.endsWith("%")) {
      return axis === "w" ? (num / 100) * vpW : (num / 100) * vpH;
    }
    return num;
  }

  function computeDims(vpW, vpH, maxWpx, maxHpx, aspect, topBarHeight) {
    const contentW = vpW;
    const contentH = Math.max(1, vpH - topBarHeight);
    let allowedW = contentW;
    if (isNum(maxWpx)) allowedW = Math.min(allowedW, maxWpx);
    if (isNum(maxHpx)) allowedW = Math.min(allowedW, maxHpx * aspect);
    allowedW = Math.min(allowedW, contentH * aspect);
    const width = Math.floor(Math.max(1, allowedW));
    const height = Math.floor(Math.max(1, width / aspect));
    return { width, height };
  }

  function isNum(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function fmt(v) {
    return isNum(v) ? Math.round(v) : "—";
  }

  function runTests() {
    console.assert(
      parseUserLength("100px", "w", 1000, 800) === 100,
      "px parsing"
    );
    console.assert(
      Math.round(parseUserLength("50vh", "h", 1000, 800)) === 400,
      "vh parsing"
    );
    console.assert(
      Math.round(parseUserLength("25vw", "w", 1000, 800)) === 250,
      "vw parsing"
    );
    console.assert(
      Math.round(parseUserLength("100%", "w", 1200, 800)) === 1200,
      "% width parsing"
    );
    const d1 = computeDims(1200, 800, 1600, null, 16 / 9, 40);
    console.assert(
      d1.width <= 1200 && d1.height <= 760,
      "dims within viewport"
    );
    const d2 = computeDims(800, 800, null, null, 1, 40);
    console.assert(
      d2.width === d2.height && d2.width <= 760,
      "square aspect fits"
    );
    console.log("Tests passed");
  }

  runTests();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
