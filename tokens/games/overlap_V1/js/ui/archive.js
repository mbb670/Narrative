/*
 * File Overview
 * Purpose: Archive modal and calendar navigation.
 * Controls: Open/close archive, month/day selection, and puzzle loading.
 * How: Renders archive data to the DOM and binds UI events.
 * Key interactions: Uses data/archive-data, data/store, view-state, and app callbacks.
 */
// Archive modal for daily chain puzzles.
import {
  ARCHIVE_RECENT_PLAY_TIMEOUT_MS,
  DEV_MODE,
  IS_IOS,
  MODE,
  VIEW,
} from "../core/config.js";
import {
  toDateKey,
  datePartsFromKey,
  normalizePuzzleId,
  isDailyChainPuzzle,
  getLastArchivePlayed,
  setLastScreen,
} from "../utils/index.js";
import { computed } from "../core/model.js";
import { createArchiveData } from "../data/archive-data.js";
import { chainPuzzleKey, loadChainProgressStore, todayKey } from "../data/chain-progress.js";

export function createArchiveUI({
  els,
  getPuzzles,
  addPuzzle,
  closeSplash,
  openSplash,
  getSplashState,
  setTab,
  loadPuzzle,
  getPlay,
  getChain,
  chainStartNow,
  chainResume,
  fmtTime,
  isAutoCheckEnabled,
} = {}) {
  const formatTime = typeof fmtTime === "function"
    ? fmtTime
    : (sec) => {
        const s = Math.max(0, Math.floor(sec || 0));
        const m = Math.floor(s / 60);
        const rem = s % 60;
        return `${String(m).padStart(2, "0")}:${String(rem).padStart(2, "0")}`;
      };
  const autoCheckEnabled =
    typeof isAutoCheckEnabled === "function" ? isAutoCheckEnabled : () => true;

  // Daily puzzle archive with month navigation and resume/admire actions.
  const ARCHIVE_MONTH_LABELS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Archive state tracks the current selection and UI state.
  const archiveState = {
    current: { year: null, month: null },
    monthData: null,
    selectedDateKey: null,
    selectedPuzzle: null,
    selectedPlayable: false,
    selectedAction: "none",
    renderToken: 0,
  };

  const getPuzzleList = () => (typeof getPuzzles === "function" ? (getPuzzles() || []) : []);
  const archiveData = createArchiveData({ getPuzzles: getPuzzleList });
  const archiveDataState = archiveData.state;
  const { pad2, archiveDateKey, loadArchiveIndex, loadArchiveMonth } = archiveData;

  // Choose a default date for a month (today if available, otherwise first day).
  function archiveDefaultSelection(year, month, monthData) {
    const today = toDateKey(new Date());
    const monthPrefix = `${year}-${pad2(month)}-`;
    if (today && today.startsWith(monthPrefix)) return today;
    const dates = Array.from(monthData?.byDate?.keys?.() || []).sort();
    if (dates.length) return dates[0];
    return archiveDateKey(year, month, 1);
  }

  // Populate year/month selectors and enable prev/next navigation.
  function renderArchiveControls() {
    const yearSel = els?.archiveYearSelect;
    const monthSel = els?.archiveMonthSelect;
    const prevBtn = els?.archivePrevMonth;
    const nextBtn = els?.archiveNextMonth;
    if (!yearSel || !monthSel || !prevBtn || !nextBtn) return;

    const years = [...archiveDataState.years].sort((a, b) => b - a);
    yearSel.innerHTML = "";
    years.forEach((y) => {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      yearSel.appendChild(opt);
    });

    const curYear = archiveState.current.year ?? years[0];
    const yearMonths = archiveDataState.monthsByYear.get(curYear) || [];
    const curMonth = archiveState.current.month ?? yearMonths[0];

    yearSel.value = curYear != null ? String(curYear) : "";
    monthSel.innerHTML = "";
    yearMonths.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = String(m);
      opt.textContent = ARCHIVE_MONTH_LABELS[m - 1] || String(m);
      monthSel.appendChild(opt);
    });
    monthSel.value = curMonth != null ? String(curMonth) : "";

    yearSel.disabled = !years.length;
    monthSel.disabled = !yearMonths.length;

    const idx = archiveDataState.availableMonths.findIndex(
      (m) => m.year === curYear && m.month === curMonth
    );
    prevBtn.disabled = idx <= 0;
    nextBtn.disabled = idx < 0 || idx >= archiveDataState.availableMonths.length - 1;
  }

  // Render the calendar grid with per-day progress states.
  function renderArchiveCalendar() {
    const grid = els?.archiveCalendar;
    if (!grid) return;
    grid.innerHTML = "";

    const data = archiveState.monthData;
    if (!data) return;

    const { year, month, byDate } = data;
    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay();
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

    const progressStore = loadChainProgressStore();
    const today = toDateKey(new Date());

    const frag = document.createDocumentFragment();
    for (let i = 0; i < totalCells; i++) {
      const dayNum = i - firstDay + 1;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "archive-day";

      if (dayNum < 1 || dayNum > daysInMonth) {
        btn.classList.add("is-empty");
        btn.setAttribute("aria-hidden", "true");
        btn.disabled = true;
        frag.appendChild(btn);
        continue;
      }

      const dateKey = archiveDateKey(year, month, dayNum);
      const puzzle = byDate.get(dateKey) || null;
      const hasPuzzle = !!puzzle;
      const isFuture = !!(today && dateKey > today);

      // state drives calendar visuals: hidden, complete, progress, or not-started.
      let state = "hidden";
      if (hasPuzzle && !isFuture) {
        const key = chainPuzzleKey(puzzle);
        const data = key ? progressStore.puzzles?.[key] : null;
        const hasInput = Array.isArray(data?.usr) && data.usr.some(Boolean);
        if (data?.done) state = "complete";
        else if (data?.started || hasInput) state = "progress";
        else state = "not-started";
        if (data?.done && data?.hardModeComplete) btn.dataset.hardMode = "true";
      }

      const isPlayable = hasPuzzle && (!isFuture || DEV_MODE);
      btn.dataset.archiveDate = dateKey;
      btn.dataset.state = state;
      btn.dataset.hasPuzzle = hasPuzzle ? "true" : "false";
      btn.dataset.future = isFuture ? "true" : "false";
      const metaSpan = document.createElement("span");
      metaSpan.className = "archive-day-meta";
      const labelSpan = document.createElement("span");
      labelSpan.className = "archive-day-label";
      labelSpan.textContent = String(dayNum);
      btn.append(metaSpan, labelSpan);
      btn.disabled = !isPlayable;

      if (today && dateKey === today) btn.classList.add("is-today");
      if (archiveState.selectedDateKey === dateKey) btn.classList.add("is-selected");

      frag.appendChild(btn);
    }

    grid.appendChild(frag);
  }

  // Update the CTA label based on progress (play/continue/admire).
  function updateArchiveAction() {
    const btn = els?.archiveActionBtn;
    if (!btn) return;
    const label = els?.archiveActionLabel;
    const meta = els?.archiveActionMeta;

    const dateKey = archiveState.selectedDateKey;
    const monthData = archiveState.monthData;
    const today = toDateKey(new Date());

    const puzzle = monthData?.byDate?.get?.(dateKey) || null;
    const isFuture = !!(today && dateKey && dateKey > today);
    const playable = !!puzzle && (!isFuture || DEV_MODE);

    archiveState.selectedPuzzle = puzzle;
    archiveState.selectedPlayable = playable;
    archiveState.selectedAction = "none";

    if (!puzzle) {
      if (label) label.textContent = "No puzzle";
      if (meta) meta.textContent = "";
      btn.disabled = true;
      return;
    }

    const store = loadChainProgressStore();
    const key = chainPuzzleKey(puzzle);
    const data = key ? store.puzzles?.[key] : null;
    const usr = Array.isArray(data?.usr) ? data.usr : [];
    const hasInput = usr.some(Boolean);
    const model = computed(puzzle);
    const total = model.entries?.length || 0;
    const solved = (model.entries || []).filter((e) => {
      for (let i = 0; i < e.len; i++) {
        const idx = e.start + i;
        if (!usr[idx]) return false;
        if (usr[idx] !== model.exp[idx]) return false;
      }
      return true;
    }).length;

    if (data?.done) {
      archiveState.selectedAction = "admire";
      if (label) label.textContent = "Admire puzzle";
      const timeSec = Math.max(0, Math.floor(data?.stats?.timeSec || data?.lastFinishElapsedSec || 0));
      if (meta) meta.textContent = formatTime(timeSec);
    } else if (data?.started || hasInput) {
      archiveState.selectedAction = "continue";
      if (label) label.textContent = "Continue puzzle";
      if (meta) meta.textContent = autoCheckEnabled() ? `(${solved}/${total})` : "";
    } else {
      archiveState.selectedAction = "play";
      if (label) label.textContent = "Play";
      if (meta) meta.textContent = "";
    }

    btn.disabled = !playable;
  }

  // Set month/year selection and render calendar.
  async function setArchiveMonth(year, month, opts = {}) {
    const token = ++archiveState.renderToken;
    await loadArchiveIndex();
    if (token !== archiveState.renderToken) return;

    if (!archiveDataState.availableMonths.length) {
      archiveState.current = { year: null, month: null };
      archiveState.monthData = null;
      archiveState.selectedDateKey = null;
      renderArchiveControls();
      renderArchiveCalendar();
      updateArchiveAction();
      return;
    }

    const requestedParts = opts.selectDateKey ? datePartsFromKey(opts.selectDateKey) : null;
    const targetYear = requestedParts?.year ?? year;
    const targetMonth = requestedParts?.month ?? month;
    const exact = archiveDataState.availableMonths.find((m) => m.year === targetYear && m.month === targetMonth);
    const fallback = exact || archiveDataState.availableMonths[archiveDataState.availableMonths.length - 1];

    archiveState.current = { year: fallback.year, month: fallback.month };
    renderArchiveControls();

    const monthData = await loadArchiveMonth(fallback.year, fallback.month);
    if (token !== archiveState.renderToken) return;
    archiveState.monthData = monthData;

    const nextSelection = opts.selectDateKey || archiveDefaultSelection(fallback.year, fallback.month, monthData);
    archiveState.selectedDateKey = nextSelection;

    renderArchiveCalendar();
    updateArchiveAction();
  }

  // Select a day in the archive calendar.
  function selectArchiveDate(dateKey) {
    if (!dateKey) return;
    archiveState.selectedDateKey = dateKey;
    els?.archiveCalendar?.querySelectorAll?.(".archive-day.is-selected")
      ?.forEach((el) => el.classList.remove("is-selected"));
    const btn = els?.archiveCalendar?.querySelector?.(`[data-archive-date="${dateKey}"]`);
    btn?.classList.add("is-selected");
    updateArchiveAction();
  }

  // Ensure an archive puzzle exists in the main puzzles list; return its index.
  function ensurePuzzleInList(puzzle) {
    const puzzles = getPuzzleList();
    const id = normalizePuzzleId(puzzle).id;
    const idx = puzzles.findIndex((p) => normalizePuzzleId(p).id === id);
    if (idx >= 0) return idx;
    if (typeof addPuzzle === "function") return addPuzzle(puzzle);
    puzzles.push(normPuzzle(puzzle));
    return puzzles.length - 1;
  }

  const isArchiveDailyPuzzle = (p) => {
    const id = normalizePuzzleId(p).id;
    const today = todayKey();
    return isDailyChainPuzzle(p) && id && today && id !== today;
  };

  // Open the archive modal and load the requested date/month.
  async function openArchiveModal(opts = {}) {
    if (!els?.archiveModal) return;
    const now = new Date();
    if (!els.archiveModal.hidden) return;
    if (els.splash && !els.splash.hidden && typeof closeSplash === "function") closeSplash();
    setLastScreen("archive");
    els.archiveModal.hidden = false;
    els.archiveModal.setAttribute("aria-hidden", "false");
    // Lock scroll while modal is open.
    document.documentElement.classList.add("is-modal-open");
    if (!IS_IOS) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    }
    requestAnimationFrame(() => els.archiveModal?.classList.add("is-open"));
    const recentArchive = getLastArchivePlayed();
    const recentAt = Number.isFinite(recentArchive?.at) ? recentArchive.at : null;
    const recentDateKey =
      recentArchive?.id &&
      (recentAt == null || Date.now() - recentAt <= ARCHIVE_RECENT_PLAY_TIMEOUT_MS)
        ? recentArchive.id
        : null;
    const dateKey = typeof opts.dateKey === "string" ? opts.dateKey : (recentDateKey || toDateKey(now));
    const parts = dateKey ? datePartsFromKey(dateKey) : null;
    const targetYear = parts?.year ?? now.getFullYear();
    const targetMonth = parts?.month ?? (now.getMonth() + 1);
    setArchiveMonth(targetYear, targetMonth, { selectDateKey: dateKey });
  }

  function closeArchiveModal() {
    if (!els?.archiveModal) return;
    setLastScreen(null);
    els.archiveModal.classList.remove("is-open");
    els.archiveModal.setAttribute("aria-hidden", "true");
    els.archiveModal.hidden = true;
    document.documentElement.classList.remove("is-modal-open");
    if (!IS_IOS) {
      document.body.style.overflow = "";
      document.body.style.touchAction = "";
    }
  }

  function bindEvents() {
    els?.archiveBackBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      closeArchiveModal();
      if (typeof openSplash === "function" && typeof getSplashState === "function") {
        openSplash(getSplashState());
      }
    });
    els?.archivePrevMonth?.addEventListener("click", (e) => {
      e.preventDefault();
      const list = archiveDataState.availableMonths;
      const cur = archiveState.current;
      const idx = list.findIndex((m) => m.year === cur.year && m.month === cur.month);
      if (idx <= 0) return;
      const prev = list[idx - 1];
      setArchiveMonth(prev.year, prev.month);
    });
    els?.archiveNextMonth?.addEventListener("click", (e) => {
      e.preventDefault();
      const list = archiveDataState.availableMonths;
      const cur = archiveState.current;
      const idx = list.findIndex((m) => m.year === cur.year && m.month === cur.month);
      if (idx < 0 || idx >= list.length - 1) return;
      const next = list[idx + 1];
      setArchiveMonth(next.year, next.month);
    });
    els?.archiveYearSelect?.addEventListener("change", (e) => {
      const year = Number.parseInt(e.target.value, 10);
      if (Number.isNaN(year)) return;
      const months = archiveDataState.monthsByYear.get(year) || [];
      const currentMonth = archiveState.current.month;
      const nextMonth = months.includes(currentMonth) ? currentMonth : months[months.length - 1];
      setArchiveMonth(year, nextMonth);
    });
    els?.archiveMonthSelect?.addEventListener("change", (e) => {
      const month = Number.parseInt(e.target.value, 10);
      if (Number.isNaN(month)) return;
      const year = archiveState.current.year;
      if (!year) return;
      setArchiveMonth(year, month);
    });
    els?.archiveCalendar?.addEventListener("click", (e) => {
      const btn = e.target.closest(".archive-day");
      if (!btn || btn.disabled) return;
      const dateKey = btn.dataset.archiveDate;
      if (!dateKey) return;
      selectArchiveDate(dateKey);
    });
    els?.archiveTodayBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;
      const dateKey = toDateKey(now);
      setArchiveMonth(year, month, { selectDateKey: dateKey });
    });
    els?.archiveActionBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      if (!archiveState.selectedPuzzle || !archiveState.selectedPlayable) return;
      const action = archiveState.selectedAction;
      const idx = ensurePuzzleInList(archiveState.selectedPuzzle);
      closeArchiveModal();
      if (typeof setTab === "function") setTab(VIEW.PLAY);
      if (typeof loadPuzzle === "function") loadPuzzle(idx);

      const play = typeof getPlay === "function" ? getPlay() : null;
      const chain = typeof getChain === "function" ? getChain() : null;
      if (action === "play" || action === "continue") {
        if (play?.mode === MODE.CHAIN && !play?.done) {
          if (!chain?.started && typeof chainStartNow === "function") chainStartNow();
          else if (!chain?.running && typeof chainResume === "function") chainResume();
        }
      }
    });
  }

  function init() {
    bindEvents();
  }

  return {
    openArchiveModal,
    closeArchiveModal,
    isArchiveDailyPuzzle,
    init,
  };
}
