/** A panel shown inside the shared `#overlay` dialog. */
export type OverlayPanel = {
  /** Rendered into `#overlay-content` every time the panel opens, so copy follows the locale. */
  markup: () => string;
  /** Called after `markup()` so the panel can bind its freshly created controls. */
  wire?: (root: HTMLElement, dialog: HTMLDialogElement) => void;
};

/**
 * Owns the modal dialog mechanics: `[data-open]` launchers, close buttons, backdrop dismissal,
 * and returning focus to the button that opened it. Panels only supply markup and wiring.
 */
export function initOverlay(panels: Record<string, OverlayPanel>) {
  const dialog = document.querySelector<HTMLDialogElement>('#overlay')!;
  const content = document.querySelector<HTMLElement>('#overlay-content')!;
  let opener: HTMLElement | null = null;

  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) =>
    button.addEventListener('click', () => {
      const panel = panels[button.dataset.open ?? ''];

      if (!panel) return;

      opener = button;
      content.innerHTML = panel.markup();
      panel.wire?.(content, dialog);
      dialog.showModal();
    }),
  );
  document
    .querySelectorAll<HTMLButtonElement>('.close')
    .forEach((button) => button.addEventListener('click', () => dialog.close()));
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;

    const rect = dialog.getBoundingClientRect();
    const outside =
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom;

    if (outside) dialog.close();
  });
  dialog.addEventListener('close', () => opener?.focus());
}
