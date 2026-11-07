export function initStartScreen() {
  const local = document.querySelector<HTMLButtonElement>('#start-local')!;
  const multiplayer = document.querySelector<HTMLButtonElement>('#start-multiplayer')!;
  const screen = document.querySelector<HTMLElement>('#start-screen')!;
  local.disabled = false;
  local.addEventListener('click', () => {
    document.body.classList.remove('on-title');
    screen.hidden = true;
    window.dispatchEvent(new Event('resize'));
    document.querySelector<HTMLButtonElement>('#roll')!.focus();
  });
  multiplayer.addEventListener('click', () => {
    multiplayer.classList.remove('mode-pressed');
    void multiplayer.offsetWidth;
    multiplayer.classList.add('mode-pressed');
  });
  multiplayer.addEventListener('animationend', () => multiplayer.classList.remove('mode-pressed'));
}
