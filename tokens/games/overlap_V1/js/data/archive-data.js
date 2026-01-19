/*
 * File Overview
 * Purpose: Archive view data shaping.
 * Controls: Calendar groupings, labels, and archive metadata.
 * How: Transforms puzzle lists into date-based structures for rendering.
 * Key interactions: Used by ui/archive.js.
 */
// Archive data fetch + cache for daily chain puzzles.
import { DEV_MODE } from "../core/config.js";
import { isDailyChainPuzzle, normalizePuzzleId, isDateId } from "../utils/index.js";
import { fetchJson } from "./defaults.js";
import { normPuzzle } from "../core/model.js";

export function createArchiveData({ getPuzzles, devMode = DEV_MODE } = {}) {
  const state = {
    ready: false,
    loadingPromise: null,
    years: [],
    monthsByYear: new Map(),
    availableMonths: [],
    monthCache: new Map(),
  };

  const pad2 = (n) => String(n).padStart(2, "0");
  const archiveMonthKey = (year, month) => `${year}-${pad2(month)}`;
  const archiveDateKey = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

  const getPuzzleList = () => (typeof getPuzzles === "function" ? (getPuzzles() || []) : []);

  // Load the available years/months for daily puzzles (from JSON index files).
  async function loadArchiveIndex() {
    if (state.ready) return;
    if (state.loadingPromise) return state.loadingPromise;

    state.loadingPromise = (async () => {
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;

      const idxUrl = new URL("../../data/chain/daily/index.json", import.meta.url);
      const idx = await fetchJson(idxUrl, null);
      let years = [];
      if (Array.isArray(idx?.years)) years = idx.years;
      else if (Array.isArray(idx?.files)) years = idx.files;

      years = years
        .map((y) => String(y).split("/")[0])
        .map((y) => Number.parseInt(y, 10))
        .filter((y) => Number.isFinite(y));

      // If index data is missing, derive years from loaded puzzles.
      if (!years.length) {
        const derived = getPuzzleList()
          .filter(isDailyChainPuzzle)
          .map((p) => normalizePuzzleId(p).id)
          .filter(isDateId);
        years = derived
          .map((id) => Number.parseInt(String(id).slice(0, 4), 10))
          .filter((y) => Number.isFinite(y));
      }

      years = Array.from(new Set(years))
        .filter((y) => devMode || y <= currentYear)
        .sort((a, b) => a - b);

      const monthsByYear = new Map();
      for (const year of years) {
        const yearIdxUrl = new URL(`../../data/chain/daily/${year}/index.json`, import.meta.url);
        const yearIdx = await fetchJson(yearIdxUrl, null);
        let months = [];
        if (Array.isArray(yearIdx?.months)) months = yearIdx.months;
        else if (Array.isArray(yearIdx?.files)) months = yearIdx.files;

        months = months
          .map((m) => {
            const raw = String(m);
            const match = raw.match(/(\d{2})(?:\.json)?$/);
            return match ? Number.parseInt(match[1], 10) : Number.parseInt(raw, 10);
          })
          .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);

        if (!months.length) {
          months = getPuzzleList()
            .filter(isDailyChainPuzzle)
            .map((p) => normalizePuzzleId(p).id)
            .filter((id) => String(id).startsWith(`${year}-`))
            .map((id) => Number.parseInt(String(id).slice(5, 7), 10))
            .filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
        }

        months = Array.from(new Set(months))
          .filter((m) => devMode || year < currentYear || (year === currentYear && m <= currentMonth))
          .sort((a, b) => a - b);

        if (months.length) monthsByYear.set(year, months);
      }

      const availableMonths = [];
      monthsByYear.forEach((months, year) => {
        months.forEach((month) => availableMonths.push({ year, month }));
      });
      availableMonths.sort((a, b) => (a.year - b.year) || (a.month - b.month));

      state.years = Array.from(monthsByYear.keys()).sort((a, b) => a - b);
      state.monthsByYear = monthsByYear;
      state.availableMonths = availableMonths;
      state.ready = true;
      state.loadingPromise = null;
    })();

    return state.loadingPromise;
  }

  // Load a single month's daily puzzles and map them by date ID.
  async function loadArchiveMonth(year, month) {
    const key = archiveMonthKey(year, month);
    if (state.monthCache.has(key)) return state.monthCache.get(key);

    const url = new URL(`../../data/chain/daily/${year}/${pad2(month)}.json`, import.meta.url);
    const data = await fetchJson(url, []);
    const list = Array.isArray(data) ? data : [];
    const byDate = new Map();
    list.forEach((raw) => {
      const p = normPuzzle(raw);
      const id = normalizePuzzleId(p).id;
      if (isDateId(id)) byDate.set(id, p);
    });

    const monthData = { year, month, puzzles: list, byDate };
    state.monthCache.set(key, monthData);
    return monthData;
  }

  return {
    state,
    pad2,
    archiveMonthKey,
    archiveDateKey,
    loadArchiveIndex,
    loadArchiveMonth,
  };
}
