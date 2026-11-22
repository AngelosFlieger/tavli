import {
  analyzePlaytestReports,
  parsePlaytestReport,
  type BalanceAnalysis,
} from '../app/playtest-analysis';
import type { PlaytestReport } from '../app/playtest-report';
import { POWERUPS_V1 } from '../game/variant/config/profiles';
import { ABILITY_IDS } from '../game/variant/types';
import { localizedAbilityCopy } from './abilities/copy';
import { downloadJson } from './download';
import { pluralSuffix, t } from './i18n';

/** Import, aggregate, and export controls for development balance reports. */
export function playtestAnalysisMarkup(): string {
  if (!import.meta.env.DEV) return '';
  return `<section class="playtest-analysis"><h3>${t('settings.analysis')}</h3><p class="note">${t('settings.analysis.note')}</p><div class="match-controls"><button type="button" id="analyze-playtests">${t('settings.selectReports')}</button><button type="button" id="download-analysis" disabled>${t('settings.downloadAnalysis')}</button><input type="file" id="playtest-files" accept="application/json,.json" multiple hidden></div><output id="playtest-analysis-output" aria-live="polite">${t('settings.noReports')}</output></section>`;
}

/** Bind the report picker and its download button. Reports never leave the browser. */
export function wirePlaytestAnalysis(root: HTMLElement): void {
  const selectReports = root.querySelector<HTMLButtonElement>('#analyze-playtests');
  const files = root.querySelector<HTMLInputElement>('#playtest-files');
  const downloadAnalysis = root.querySelector<HTMLButtonElement>('#download-analysis');
  const analysisOutput = root.querySelector<HTMLOutputElement>('#playtest-analysis-output');
  let analysis: BalanceAnalysis | null = null;
  selectReports?.addEventListener('click', () => files?.click());
  files?.addEventListener('change', () => void analyzeSelectedReports());

  async function analyzeSelectedReports() {
    const reports: PlaytestReport[] = [];
    let rejected = 0;
    for (const file of Array.from(files?.files ?? [])) {
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
  }
  downloadAnalysis?.addEventListener('click', () => {
    if (analysis) downloadJson('plakoto-balance-analysis.json', analysis);
  });
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
