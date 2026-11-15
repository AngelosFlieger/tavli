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
import { abilityRegistry, describeConfiguredAbility } from '../game/variant/abilities/registry';
import type { PlaytestReport } from '../app/playtest-report';
import { parseOptionalSeed } from '../game/random';
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
      content.innerHTML = name === 'settings' ? settingsMarkup : helpMarkup;
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
  matchLabel.textContent = on ? 'Searching…' : 'Multiplayer';
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
  tools.setAttribute('aria-label', 'Development playtest controls');
  const profileOptions = VARIANT_PROFILE_IDS.map(
    (id) => `<option value="${id}">${id}</option>`,
  ).join('');
  tools.innerHTML = `<strong>Balance playtest</strong><label>Profile <select id="playtest-profile">${profileOptions}</select></label><label>Seed <input id="playtest-seed" type="number" min="0" max="4294967295" step="1" placeholder="Random"></label><small>Local only · leave blank for fresh randomness, or enter a seed to reproduce dice, drafts, and abilities.</small>`;
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
    : 'Classic matchmaking';
  document.body.dataset.ruleset = selection.ruleset;
}

const abilityHelp = ABILITY_IDS.map((abilityId) => {
  const copy = describeConfiguredAbility(abilityId, POWERUPS_V1);
  const kind = abilityRegistry[abilityId].kind === 'POWERUP' ? 'Powerup' : 'Passive';
  const details = [copy.summary, copy.benefit, copy.drawback].filter(Boolean).join(' ');
  return `<li><strong>${copy.name}</strong> <small>${kind}</small><br>${details}</li>`;
}).join('');

const helpMarkup = `<p class="eyebrow">THE ART OF THE PIN</p><h2>How to play</h2><p>Plakoto is a backgammon variant for two players, with 15 checkers each. Players travel in opposite directions toward their home boards, then bear off. First to bear off all 15 wins.</p><p>A lone opposing checker can be pinned beneath yours. It stays pinned until your checker leaves. Points occupied by two opposing checkers, or an opposing checker pinning yours, are blocked.</p><p>To start, Player 1 rolls both dice, then Player 2. The higher total starts; ties repeat. The starter rolls again for their first turn.</p><p>Use both dice where possible; doubles give four moves. Click highlighted checkers to pick up several, then place them in pickup order. Each picked checker must have a legal move with the remaining dice. The held checkers follow your pointer, and a ghost shows the next landing. Use Put back last or Escape to release a pickup. Shift-click a source if it is also a destination. You may combine dice if intermediate landings are legal and later pickups remain placeable. Undo reverts a placement until End Turn.</p><p>Bear off only when all remaining checkers are home and none are pinned. Pinning the last checker on the opponent’s starting point wins when your own starting checkers have left. Two pinned mothers mean a draw.</p><h3>Powerups mode</h3><p>Every ${POWERUPS_V1.draft.intervalRounds} completed rounds, ${POWERUPS_V1.draft.offer.powerups + POWERUPS_V1.draft.offer.passives} cards appear: ${POWERUPS_V1.draft.offer.powerups} powerups and ${POWERUPS_V1.draft.offer.passives} passive. Both players roll for first pick. Each player normally holds ${POWERUPS_V1.inventory.powerupSlots} powerups and ${POWERUPS_V1.inventory.passiveSlots} passive, and may spend ${POWERUPS_V1.inventory.powerupsPerTurn} powerup per turn.</p><ul class="ability-help">${abilityHelp}</ul>`;

const settingsMarkup = `<p class="eyebrow">MAKE YOURSELF AT HOME</p><h2>Settings</h2><label>Ambient motion <input type="checkbox" data-pref="motion"></label><label>Retro grain & scanlines <input type="checkbox" data-pref="texture"></label><label>Sound <input type="checkbox" data-pref="sound"></label><p class="note">Sound covers the music and button clicks. Preferences are saved on this device. Motion also respects your system’s reduced-motion preference.</p><div class="match-controls"><button type="button" id="new-game">New game</button>${import.meta.env.DEV ? '<button type="button" id="download-playtest">Download playtest JSON</button>' : ''}<button type="button" id="sign-out">Sign out</button></div>${import.meta.env.DEV ? '<section class="playtest-analysis"><h3>Balance report analysis</h3><p class="note">Select multiple playtest JSON files. Analysis stays on this device and keeps different configuration hashes separate.</p><div class="match-controls"><button type="button" id="analyze-playtests">Select reports</button><button type="button" id="download-analysis" disabled>Download analysis</button><input type="file" id="playtest-files" accept="application/json,.json" multiple hidden></div><output id="playtest-analysis-output" aria-live="polite">No reports selected.</output></section>' : ''}`;

function applyMotionClass() {
  document.body.classList.toggle('still', !preferences.motion);
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
  const heading = `${analysis.reportCount} valid report${analysis.reportCount === 1 ? '' : 's'}${analysis.rejectedCount ? ` · ${analysis.rejectedCount} rejected` : ''}`;
  const groups = analysis.groups.map((group) => {
    const identity = group.profileId ?? 'classic';
    const activeAbilities = ABILITY_IDS.map((abilityId) => ({
      abilityId,
      metrics: group.abilities[abilityId],
    }))
      .filter(({ metrics }) => metrics.offered || metrics.picked || metrics.used)
      .sort((left, right) => right.metrics.picked - left.metrics.picked)
      .slice(0, 5)
      .map(({ abilityId, metrics }) => {
        const name = describeConfiguredAbility(abilityId, POWERUPS_V1).name;
        return `${name}: ${metrics.picked} picks (${formatPercent(metrics.offerPickRate)} of offers), ${formatMetric(metrics.usesPerPick)} uses/pick`;
      });
    return [
      `${identity} · ${group.configHash ?? 'no config hash'}`,
      `${group.completedGames}/${group.reports} completed · ${formatMetric(group.averageTurnsPerCompletedGame)} average turns`,
      `opening winner win rate ${formatPercent(group.openingWinnerWinRate)} · draft-first win rate ${formatPercent(group.draftFirstPickWinRate)}`,
      ...activeAbilities,
    ].join('\n');
  });
  return [heading, ...groups].join('\n\n');
}

function formatMetric(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(1);
}

function formatPercent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}
