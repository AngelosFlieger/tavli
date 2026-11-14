import { login, register, sameOrigin, whoami } from '../net/account';

type AuthHooks = { onSignedIn: () => void };

let creating = true;
let hooks: AuthHooks = { onSignedIn() {} };

export function initAuthScreen(next: AuthHooks) {
  hooks = next;
  const form = document.querySelector<HTMLFormElement>('#auth-form')!;
  document.querySelector('#auth-switch')!.addEventListener('click', () => {
    creating = !creating;
    renderMode();
    setError('');
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(form);
  });
  renderMode();
}

export async function restoreSession() {
  if (!sameOrigin()) {
    revealGame();
    return false;
  }
  const user = await whoami();
  document.body.classList.remove('auth-pending');
  if (!user) {
    showAuth();
    return false;
  }
  revealGame();
  return true;
}

export function showAuth() {
  document.body.classList.remove('auth-pending');
  document.body.classList.add('signed-out');
  document.querySelector<HTMLElement>('#auth-screen')!.hidden = false;
}

export function revealGame() {
  document.body.classList.remove('auth-pending', 'signed-out');
  document.querySelector<HTMLElement>('#auth-screen')!.hidden = true;
}

function renderMode() {
  document.querySelector('#auth-title')!.textContent = creating ? 'Create account' : 'Sign in';
  document.querySelector<HTMLButtonElement>('#auth-submit')!.textContent = creating
    ? 'Create account'
    : 'Sign in';
  document.querySelector('#auth-switch')!.textContent = creating
    ? 'I have an account'
    : 'Create an account';
  const username = document.querySelector<HTMLElement>('#auth-username-label')!;
  const email = document.querySelector<HTMLElement>('#auth-email-label')!;
  const identifier = document.querySelector<HTMLElement>('#auth-identifier-label')!;
  username.hidden = !creating;
  email.hidden = !creating;
  identifier.hidden = creating;
  const usernameInput = field('username');
  const emailInput = field('email');
  const identifierInput = field('identifier');
  if (usernameInput) usernameInput.required = creating;
  if (emailInput) emailInput.required = creating;
  if (identifierInput) identifierInput.required = !creating;
  const password = field('password');
  if (password) password.autocomplete = creating ? 'new-password' : 'current-password';
}

async function submit(form: HTMLFormElement) {
  const data = new FormData(form);
  const password = String(data.get('password') ?? '');
  const button = document.querySelector<HTMLButtonElement>('#auth-submit')!;
  button.disabled = true;
  const result = creating
    ? await register(String(data.get('email') ?? ''), String(data.get('username') ?? ''), password)
    : await login(String(data.get('identifier') ?? ''), password);
  button.disabled = false;
  if (!result.ok) {
    setError(result.error);
    return;
  }
  setError('');
  revealGame();
  hooks.onSignedIn();
}

function setError(message: string) {
  document.querySelector('#auth-error')!.textContent = message;
}

function field(name: string) {
  return document.querySelector<HTMLInputElement>(`#auth-form [name="${name}"]`);
}
