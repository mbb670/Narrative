/*
 * File Overview
 * Purpose: Shared dialog dismissal behavior.
 * Controls: Backdrop clicks and ESC handling.
 * How: Binds close events to a provided callback.
 */
export function bindDialogDismiss(dialog, onClose) {
  if (!dialog || typeof dialog.addEventListener !== "function") return;
  const handleClose = () => {
    if (typeof onClose === "function") onClose();
  };
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    handleClose();
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    handleClose();
  });
  dialog.addEventListener("click", (e) => {
    if (e.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    const isBackdropClick =
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom;
    if (!isBackdropClick) return;
    handleClose();
  });
}
