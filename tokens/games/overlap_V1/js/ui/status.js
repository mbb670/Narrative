// Status bar helpers for invalid puzzles.
import { escapeHtml } from "../utils/escape.js";

export function createStatusUI({ els } = {}) {
  // Update status bar for conflicts/gaps when a puzzle is invalid.
  function setStatus(m) {
    const gaps = m?.gaps || [];
    const hasError = !m?.ok || gaps.length;
    if (els?.status) {
      if (!m?.ok) {
        els.status.className = "status bad";
        els.status.textContent = `Conflict at column ${m.conf.idx + 1}: “${m.conf.a}” vs “${m.conf.b}”.`;
      } else if (gaps.length) {
        els.status.className = "status bad";
        els.status.textContent = `Uncovered columns: ${gaps.slice(0, 18).map((x) => x + 1).join(", ")}${gaps.length > 18 ? "…" : ""}`;
      } else {
        const total = escapeHtml(m.total);
        const count = escapeHtml(m.entries?.length ?? 0);
        els.status.className = "status";
        els.status.innerHTML = `Total columns: <strong>${total}</strong> • Words: <strong>${count}</strong>`;
      }
    }
    if (els?.toastErrorPuzzle) {
      els.toastErrorPuzzle.classList.toggle("is-showing", hasError);
    }
  }

  return { setStatus };
}
