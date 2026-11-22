import { loadHistory, type HistoryEntry } from '../app/history';
import { t } from './i18n';

/** Saved-match list markup. Settings owns the destructive buttons that sit beside it. */
export function matchHistoryMarkup(): string {
  return `<section class="match-history"><h3>${t('settings.history.title')}</h3><ul id="match-history-list"></ul><div class="match-controls"><button type="button" id="clear-history">${t('settings.history.clear')}</button><button type="button" id="clear-all-data">${t('settings.history.clearAll')}</button></div></section>`;
}

/** Render the stored entries newest-first from `loadHistory()`, or an empty-state line. */
export function renderMatchHistory(root: HTMLElement): void {
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
