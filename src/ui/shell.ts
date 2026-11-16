import { sameOrigin } from '../net/account';
import { followScene, initMusic, nudgeMusic, playClick, primeMusic, syncMusic } from './music';
import { portrait } from './portraits';
import { loadPreferences, preferences, savePreferences, type PreferenceKey } from './preferences';
import { CLASSIC_SELECTION, type MatchSelection } from '../net/messages';
import {
  POWERUPS_V1,
  POWERUPS_V1_ID,
  VARIANT_PROFILE_IDS,
  type VariantProfileId,
} from '../game/variant/config/profiles';
import { ABILITY_IDS } from '../game/variant/types';
import { abilityRegistry } from '../game/variant/abilities/registry';
import { localizedAbilityCopy } from './abilities/copy';
import { getLocale, pluralSuffix, setLocale, t, translateDOM, type Locale } from './i18n';
import type { PlaytestReport } from '../app/playtest-report';
import { parseOptionalSeed } from '../game/random';
import { clearHistory, loadHistory, type HistoryEntry } from '../app/history';
import {
  analyzePlaytestReports,
  parsePlaytestReport,
  type BalanceAnalysis,
} from '../app/playtest-analysis';

/** Callbacks filled in once the board and dice exist. */
export type Session = {
  onNewGame: () => void;
  canNewGame: () => boolean;
  onLocal: (selection: MatchSelection, seed?: number) => void;
  onMultiplayer: (selection: MatchSelection) => void;
  onSignOut: () => void;
  playtestReport: () => PlaytestReport | null;
};

let session: Session;

export function initShell(next: Session) {
  session = next;
  loadPreferences();
  applyMotionClass();
  initMusic();
  window.addEventListener('pointerdown', () => primeMusic(), { capture: true });
  window.addEventListener('pointerup', () => nudgeMusic(), { capture: true });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') primeMusic();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'Enter' || event.key === ' ') nudgeMusic();
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('button')) return;
    playClick();
  });
  document.querySelector('#portrait1')!.innerHTML = portrait(false);
  document.querySelector('#portrait2')!.innerHTML = portrait(true);
  document.querySelector('#waiting-portrait')!.innerHTML = portrait(false);

  const dialog = document.querySelector<HTMLDialogElement>('#overlay')!;
  const content = document.querySelector<HTMLElement>('#overlay-content')!;
  let opener: HTMLElement | null = null;

  document.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((button) =>
    button.addEventListener('click', () => {
      opener = button;
      const name = button.dataset.open;
      content.innerHTML = name === 'settings' ? settingsMarkup() : helpMarkup();
      if (name === 'settings') wireSettings(content, dialog);
      dialog.showModal();
    }),
  );
  document.querySelectorAll<HTMLButtonElement>('.close').forEach((button) => {
    if (button.id === 'account-close') return;
    button.addEventListener('click', () => dialog.close());
  });
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

  localButton = document.querySelector<HTMLButtonElement>('#start-local')!;
  multiplayerButton = document.querySelector<HTMLButtonElement>('#start-multiplayer')!;
  matchLabel = document.querySelector<HTMLElement>('#multiplayer-label')!;
  matchNote = document.querySelector<HTMLElement>('#match-note')!;
  startScreen = document.querySelector<HTMLElement>('#start-screen')!;
  rulesetPicker = document.querySelector<HTMLFieldSetElement>('#ruleset-picker')!;
  rulesetInputs = Array.from(
    rulesetPicker.querySelectorAll<HTMLInputElement>('input[name="ruleset"]'),
  );
  installPlaytestControls();
  waitingRuleset = document.querySelector<HTMLElement>('#waiting-ruleset')!;
  rulesetInputs.forEach((input) => input.addEventListener('change', updateRulesetCopy));
  updateRulesetCopy();
  localButton.addEventListener('click', () => {
    showNote(null);
    session.onLocal(selectedMatch(true), selectedPlaytestSeed());
    enterTable();
  });
  multiplayerButton.addEventListener('click', () => {
    multiplayerButton.classList.remove('mode-pressed');
    void multiplayerButton.offsetWidth;
    multiplayerButton.classList.add('mode-pressed');
    session.onMultiplayer(selectedMatch());
  });
  multiplayerButton.addEventListener('animationend', () =>
    multiplayerButton.classList.remove('mode-pressed'),
  );

  document.querySelector('#waiting-cancel')!.addEventListener('click', () => {
    if (searching) session.onMultiplayer(selectedMatch());
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && searching && !dialog.open) session.onMultiplayer(selectedMatch());
  });

  document.querySelector<HTMLButtonElement>('#roll')!.addEventListener('click', () => {
    const roll = document.querySelector<HTMLButtonElement>('#roll')!;
    roll.classList.remove('bounce');
    void roll.offsetWidth;
    roll.classList.add('bounce');
  });
}

let localButton: HTMLButtonElement;
let multiplayerButton: HTMLButtonElement;
let matchLabel: HTMLElement;
let matchNote: HTMLElement;
let startScreen: HTMLElement;
let rulesetPicker: HTMLFieldSetElement;
let rulesetInputs: HTMLInputElement[];
let waitingRuleset: HTMLElement;
let playtestProfile: HTMLSelectElement | null = null;
let playtestSeed: HTMLInputElement | null = null;
let playEnabled = false;
let searching = false;

export function enterTable() {
  document.body.classList.remove('on-title', 'is-waiting');
  document.querySelector<HTMLElement>('#waiting-screen')!.hidden = true;
  startScreen.hidden = true;
  window.dispatchEvent(new Event('resize'));
  document.querySelector<HTMLButtonElement>('#roll')!.focus();
  followScene('game');
}

export function showTitle() {
  document.body.classList.add('on-title');
  document.body.classList.remove('is-waiting');
  document.querySelector<HTMLElement>('#waiting-screen')!.hidden = true;
  startScreen.hidden = false;
  window.dispatchEvent(new Event('resize'));
  followScene('title');
}

export function setSearching(on: boolean) {
  searching = on;
  document.body.classList.toggle('is-waiting', on);
  document.querySelector<HTMLElement>('#waiting-screen')!.hidden = !on;
  startScreen.hidden = on || !document.body.classList.contains('on-title');
  window.dispatchEvent(new Event('resize'));
  if (on) document.querySelector<HTMLButtonElement>('#waiting-cancel')!.focus();
  else if (document.body.classList.contains('on-title')) multiplayerButton.focus();
  matchLabel.textContent = on ? t('menu.searching') : t('menu.multiplayer');
  multiplayerButton.setAttribute('aria-pressed', String(on));
  localButton.disabled = on || !playEnabled;
  rulesetPicker.disabled = on;
}

export function showNote(text: string | null) {
  matchNote.hidden = !text;
  matchNote.textContent = text ?? '';
}

export function enablePlay() {
  playEnabled = true;
  if (!searching) localButton.disabled = false;
  multiplayerButton.disabled = false;
}

export function syncShell() {
  const restart = document.querySelector<HTMLButtonElement>('#new-game');
  if (restart) restart.disabled = searching || !session.canNewGame();
}

function selectedMatch(localPlaytest = false): MatchSelection {
  return rulesetInputs.some((input) => input.checked && input.value === 'POWERUPS_V1')
    ? {
        ruleset: 'POWERUPS_V1',
        profileId:
          (localPlaytest && (playtestProfile?.value as VariantProfileId | undefined)) ||
          POWERUPS_V1_ID,
      }
    : CLASSIC_SELECTION;
}

function selectedPlaytestSeed(): number | undefined {
  if (!playtestSeed) return undefined;
  return parseOptionalSeed(playtestSeed.value);
}

function installPlaytestControls(): void {
  if (!import.meta.env.DEV) return;
  const tools = document.createElement('section');
  tools.className = 'playtest-tools';
  tools.setAttribute('aria-label', t('playtest.aria'));
  const profileOptions = VARIANT_PROFILE_IDS.map(
    (id) => `<option value="${id}">${id}</option>`,
  ).join('');
  tools.innerHTML = `<strong>${t('playtest.title')}</strong><label>${t('playtest.profile')} <select id="playtest-profile">${profileOptions}</select></label><label>${t('playtest.seed')} <input id="playtest-seed" type="number" min="0" max="4294967295" step="1" placeholder="${t('playtest.seedPlaceholder')}"></label><small>${t('playtest.note')}</small>`;
  rulesetPicker.insertAdjacentElement('afterend', tools);
  playtestProfile = tools.querySelector('#playtest-profile');
  playtestSeed = tools.querySelector('#playtest-seed');
  playtestProfile?.addEventListener('change', updateRulesetCopy);
}

function updateRulesetCopy() {
  const selection = selectedMatch();
  const powerups = selection.ruleset === 'POWERUPS_V1';
  if (playtestProfile) playtestProfile.disabled = !powerups;
  waitingRuleset.textContent = powerups
    ? `Powerups · ${POWERUPS_V1.id} v${POWERUPS_V1.version}`
    : t('menu.classic.matchmaking');
  document.body.dataset.ruleset = selection.ruleset;
}

function abilityHelp(): string {
  return ABILITY_IDS.map((abilityId) => {
    const copy = localizedAbilityCopy(abilityId, POWERUPS_V1);
    const kind =
      abilityRegistry[abilityId].kind === 'POWERUP'
        ? t('help.ability.powerup')
        : t('help.ability.passive');
    const details = [copy.summary, copy.benefit, copy.drawback].filter(Boolean).join(' ');
    return `<li><strong>${copy.name}</strong> <small>${kind}</small><br>${details}</li>`;
  }).join('');
}

function helpMarkup(): string {
  return `<p class="eyebrow">${t('help.eyebrow')}</p><h2>${t('help.title')}</h2><p>${t('help.intro')}</p><p>${t('help.pin')}</p><p>${t('help.opening')}</p><p>${t('help.movement')}</p><p>${t('help.bearing')}</p><h3>${t('help.powerups.title')}</h3><p>${t(
    'help.powerups.intro',
    {
      rounds: POWERUPS_V1.draft.intervalRounds,
      cards: POWERUPS_V1.draft.offer.powerups + POWERUPS_V1.draft.offer.passives,
      powerups: POWERUPS_V1.draft.offer.powerups,
      passives: POWERUPS_V1.draft.offer.passives,
      slots: POWERUPS_V1.inventory.powerupSlots,
      passiveSlots: POWERUPS_V1.inventory.passiveSlots,
      perTurn: POWERUPS_V1.inventory.powerupsPerTurn,
    },
  )}</p><ul class="ability-help">${abilityHelp()}</ul>`;
}

function settingsMarkup(): string {
  const languageOptions = (['en', 'el'] as Locale[])
    .map(
      (locale) =>
        `<option value="${locale}"${getLocale() === locale ? ' selected' : ''}>${locale === 'en' ? 'English' : 'Ελληνικά'}</option>`,
    )
    .join('');
  return `<p class="eyebrow">${t('settings.eyebrow')}</p><h2>${t('settings.title')}</h2><label>${t('settings.motion')} <input type="checkbox" data-pref="motion"></label><label>${t('settings.texture')} <input type="checkbox" data-pref="texture"></label><label>${t('settings.sound')} <input type="checkbox" data-pref="sound"></label><label>${t('settings.language')} <select id="language-select">${languageOptions}</select></label><label>${t('settings.history.save')} <input type="checkbox" data-pref="history"></label><p class="note">${t('settings.note')}</p><div class="match-controls"><button type="button" id="new-game">${t('settings.newGame')}</button>${import.meta.env.DEV ? `<button type="button" id="download-playtest">${t('settings.downloadPlaytest')}</button>` : ''}<button type="button" id="sign-out">${t('settings.signOut')}</button></div><section class="match-history"><h3>${t('settings.history.title')}</h3><ul id="match-history-list"></ul><div class="match-controls"><button type="button" id="clear-history">${t('settings.history.clear')}</button><button type="button" id="clear-all-data">${t('settings.history.clearAll')}</button></div></section>${import.meta.env.DEV ? `<section class="playtest-analysis"><h3>${t('settings.analysis')}</h3><p class="note">${t('settings.analysis.note')}</p><div class="match-controls"><button type="button" id="analyze-playtests">${t('settings.selectReports')}</button><button type="button" id="download-analysis" disabled>${t('settings.downloadAnalysis')}</button><input type="file" id="playtest-files" accept="application/json,.json" multiple hidden></div><output id="playtest-analysis-output" aria-live="polite">${t('settings.noReports')}</output></section>` : ''}`;
}

function applyMotionClass() {
  document.body.classList.toggle('still', !preferences.motion);
}

function renderHistoryList(root: HTMLElement) {
  const list = root.querySelector<HTMLUListElement>('#match-history-list');
  if (!list) return;
  const entries = loadHistory();
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'history-empty';
    empty.textContent = t('settings.history.empty');
    list.append(empty);
    return;
  }
  for (const entry of entries) list.append(historyItem(entry));
}

function historyItem(entry: HistoryEntry): HTMLElement {
  const item = document.createElement('li');
  const mode =
    entry.mode === 'LOCAL' ? t('settings.history.mode.local') : t('settings.history.mode.online');
  const ruleset =
    entry.ruleset === 'CLASSIC'
      ? t('settings.history.ruleset.classic')
      : t('settings.history.ruleset.powerups');
  const result =
    entry.winner === null
      ? t('settings.history.result.draw')
      : t('settings.history.result.win', { player: entry.winner + 1 });
  const date = new Date(entry.at).toLocaleDateString();
  const rounds = t('settings.history.rounds', { rounds: entry.rounds });
  item.textContent = `${date} · ${mode} · ${ruleset} · ${result} · ${rounds}`;
  return item;
}

function wireSettings(root: HTMLElement, dialog: HTMLDialogElement) {
  root.querySelectorAll<HTMLInputElement>('[data-pref]').forEach((input) => {
    const key = input.dataset.pref as PreferenceKey;
    input.checked = preferences[key];
    input.addEventListener('change', () => {
      preferences[key] = input.checked;
      savePreferences();
      if (key === 'motion') applyMotionClass();
      if (key === 'sound') syncMusic();
    });
  });
  const language = root.querySelector<HTMLSelectElement>('#language-select');
  language?.addEventListener('change', () => {
    setLocale(language.value as Locale);
    translateDOM();
    root.innerHTML = settingsMarkup();
    wireSettings(root, dialog);
  });
  renderHistoryList(root);
  root.querySelector<HTMLButtonElement>('#clear-history')?.addEventListener('click', () => {
    clearHistory();
    renderHistoryList(root);
  });
  root.querySelector<HTMLButtonElement>('#clear-all-data')?.addEventListener('click', () => {
    clearHistory();
    preferences.motion = true;
    preferences.texture = true;
    preferences.sound = true;
    preferences.history = true;
    savePreferences();
    setLocale('en');
    translateDOM();
    root.innerHTML = settingsMarkup();
    wireSettings(root, dialog);
  });
  const restart = root.querySelector<HTMLButtonElement>('#new-game')!;
  restart.disabled = searching || !session.canNewGame();
  restart.addEventListener('click', () => {
    if (searching || !session.canNewGame()) return;
    session.onNewGame();
    dialog.close();
  });
  const signOut = root.querySelector<HTMLButtonElement>('#sign-out')!;
  if (!sameOrigin()) signOut.hidden = true;
  else
    signOut.addEventListener('click', () => {
      session.onSignOut();
      dialog.close();
    });
  const download = root.querySelector<HTMLButtonElement>('#download-playtest');
  if (download) {
    download.disabled = session.playtestReport() === null;
    download.addEventListener('click', () => {
      const report = session.playtestReport();
      if (!report) return;
      downloadJson(`plakoto-playtest-${report.seed}.json`, report);
    });
  }
  const selectReports = root.querySelector<HTMLButtonElement>('#analyze-playtests');
  const files = root.querySelector<HTMLInputElement>('#playtest-files');
  const downloadAnalysis = root.querySelector<HTMLButtonElement>('#download-analysis');
  const analysisOutput = root.querySelector<HTMLOutputElement>('#playtest-analysis-output');
  let analysis: BalanceAnalysis | null = null;
  selectReports?.addEventListener('click', () => files?.click());
  files?.addEventListener('change', async () => {
    const reports: PlaytestReport[] = [];
    let rejected = 0;
    for (const file of Array.from(files.files ?? [])) {
      try {
        const report = parsePlaytestReport(JSON.parse(await file.text()));
        if (report) reports.push(report);
        else rejected++;
      } catch {
        rejected++;
      }
    }
    analysis = analyzePlaytestReports(reports, rejected);
    if (analysisOutput) analysisOutput.textContent = describeAnalysis(analysis);
    if (downloadAnalysis) downloadAnalysis.disabled = reports.length === 0;
  });
  downloadAnalysis?.addEventListener('click', () => {
    if (analysis) downloadJson('plakoto-balance-analysis.json', analysis);
  });
}

function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], {
    type: 'application/json',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function describeAnalysis(analysis: BalanceAnalysis): string {
  const heading = `${t('analysis.report', { count: analysis.reportCount, s: pluralSuffix(analysis.reportCount) })}${analysis.rejectedCount ? `${t('analysis.separator')}${t('analysis.rejected', { count: analysis.rejectedCount })}` : ''}`;
  const groups = analysis.groups.map((group) => {
    const identity = group.profileId ?? t('analysis.identity.classic');
    const activeAbilities = ABILITY_IDS.map((abilityId) => ({
      abilityId,
      metrics: group.abilities[abilityId],
    }))
      .filter(({ metrics }) => metrics.offered || metrics.picked || metrics.used)
      .sort((left, right) => right.metrics.picked - left.metrics.picked)
      .slice(0, 5)
      .map(({ abilityId, metrics }) => {
        const name = localizedAbilityCopy(abilityId, POWERUPS_V1).name;
        return t('analysis.picks', {
          name,
          picks: metrics.picked,
          rate: formatPercent(metrics.offerPickRate),
          uses: formatMetric(metrics.usesPerPick),
        });
      });
    return [
      `${identity} · ${group.configHash ?? t('analysis.noHash')}`,
      t('analysis.completed', {
        completed: group.completedGames,
        reports: group.reports,
      }) +
        `${t('analysis.separator')}${t('analysis.averageTurns', { turns: formatMetric(group.averageTurnsPerCompletedGame) })}`,
      `${t('analysis.openingWin', { rate: formatPercent(group.openingWinnerWinRate) })} · ${t('analysis.draftFirstWin', { rate: formatPercent(group.draftFirstPickWinRate) })}`,
      ...activeAbilities,
    ].join('\n');
  });
  return [heading, ...groups].join('\n\n');
}

function formatMetric(value: number | null): string {
  return value === null ? t('analysis.none') : value.toFixed(1);
}

function formatPercent(value: number | null): string {
  return value === null ? t('analysis.none') : `${(value * 100).toFixed(1)}%`;
}
