/**
 * Modal / Radix focus helpers — avoid Chrome "Blocked aria-hidden" when focus stays
 * on #root (or inside closing dialog) while an ancestor gets aria-hidden.
 */

export function blurFocusInsideRoot(): void {
  const root = document.getElementById("root");
  const active = document.activeElement as HTMLElement | null;
  if (root && active && root.contains(active) && typeof active.blur === "function") {
    active.blur();
  }
}

/** Blur if the active element is inside `container` (e.g. closing dialog content). */
export function blurFocusInside(container: HTMLElement | null | undefined): void {
  const active = document.activeElement as HTMLElement | null;
  if (container && active && container.contains(active) && typeof active.blur === "function") {
    active.blur();
  }
}

/** Drop focus from any control inside `#dialog-container` (avoids aria-hidden + focused descendant warnings). */
export function blurFocusInsideDialogContainer(): void {
  const dc = document.getElementById("dialog-container");
  const active = document.activeElement as HTMLElement | null;
  if (dc && active && dc.contains(active) && typeof active.blur === "function") {
    active.blur();
  }
}
