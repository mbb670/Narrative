/*
 * File Overview
 * Purpose: HTML and attribute escaping helpers.
 * Controls: Safe text generation for share and results output.
 * How: Replaces unsafe characters to prevent HTML injection.
 * Key interactions: Used by share/results modules and any string-to-HTML output.
 */
// Safe text/attribute helpers for HTML injection.

export function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
}

export function escapeAttr(s) {
  return String(s).replace(
    /[&<>"']/g,
    (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m])
  );
}
