import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, setLocale, t } from '../src/ui/i18n';
import { en } from '../src/ui/i18n/en';
import { el } from '../src/ui/i18n/el';

test('localization catalogs cover the same keys and interpolate', () => {
  assert.deepEqual(Object.keys(el).sort(), Object.keys(en).sort());

  setLocale('en');
  assert.equal(t('menu.rules'), 'Rules');
  assert.equal(
    t('status.winner', { player: 2, reason: t('outcome.BEAR_OFF') }),
    'Player 2 wins · bear off',
  );
  assert.equal(t('draft.choice', { current: 1, total: 2 }), 'Choice 1 of 2');

  setLocale('el');
  assert.equal(getLocale(), 'el');
  assert.equal(t('menu.rules'), 'Κανόνες');
  assert.equal(t('draft.choice', { current: 1, total: 2 }), 'Επιλογή 1 από 2');

  setLocale('en');
});
