import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { chromium } from 'playwright-core';

const host = '127.0.0.1';
const webPort = 4173;
const gamePort = 4174;
const url = `http://${host}:${webPort}`;
const headed = process.argv.includes('--headed');

function start(command, args, options = {}) {
  const output = [];
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  return { child, output };
}

async function run(command, args) {
  const process = start(command, args);
  const code = await new Promise((resolve) => process.child.on('exit', resolve));
  if (code !== 0)
    throw new Error(
      `${command} ${args.join(' ')} exited with ${code}.\n${process.output.join('')}`,
    );
}

async function waitForServer(address, process, requireOk = true) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (process.child.exitCode !== null)
      throw new Error(`Server stopped before the smoke test started.\n${process.output.join('')}`);
    try {
      const response = await fetch(address);
      if (requireOk ? response.ok : response.status < 500) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${address}.\n${process.output.join('')}`);
}

async function chromePath() {
  const candidates = [
    process.env.PLAKOTO_CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next common browser path.
    }
  }
  throw new Error(
    'Chrome or Chromium was not found. Set PLAKOTO_CHROME_PATH to a compatible executable.',
  );
}

function watchErrors(page, label, errors) {
  page.on('pageerror', (error) => errors.push(`${label}: ${error.message}`));
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText;
    if (reason === 'net::ERR_ABORTED' && request.url().includes('/audio/')) return;
    errors.push(`${label}: ${request.method()} ${request.url()} ${reason}`);
  });
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 401 && path === '/auth/me') return;
    if (response.status() >= 400)
      errors.push(
        `${label}: ${response.status()} ${response.request().method()} ${response.url()}`,
      );
  });
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource'))
      errors.push(`${label}: ${message.text()}`);
  });
}

async function openReadyPage(browser, label, errors) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
    reducedMotion: 'reduce',
  });
  watchErrors(page, label, errors);
  await page.addInitScript((testProfileId) => {
    const NativeWebSocket = window.WebSocket;
    const smoke = { sockets: [], latest: null, variantConfig: null, revision: 0 };
    Object.defineProperty(window, '__plakotoSmoke', { value: smoke });
    window.WebSocket = new Proxy(NativeWebSocket, {
      construct(target, argumentsList) {
        const socket = Reflect.construct(target, argumentsList);
        smoke.sockets.push(socket);
        if (new URL(socket.url).pathname === '/ws') {
          const send = socket.send.bind(socket);
          socket.send = (data) => {
            if (typeof data !== 'string') return send(data);
            try {
              const message = JSON.parse(data);
              if (message.type === 'find' && message.selection?.ruleset === 'POWERUPS_V1') {
                message.selection.profileId = testProfileId;
                return send(JSON.stringify(message));
              }
            } catch {
              // Forward non-JSON data unchanged and let the application protocol ignore it.
            }
            return send(data);
          };
        }
        socket.addEventListener('message', (event) => {
          if (typeof event.data !== 'string') return;
          try {
            const message = JSON.parse(event.data);
            if (!message.state) return;
            smoke.latest = message.state;
            if (message.type === 'matched') smoke.variantConfig = message.variantConfig;
            smoke.revision++;
          } catch {
            // The application owns protocol validation; the smoke harness observes valid state only.
          }
        });
        return socket;
      },
    });
  }, 'fast-balance');
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('#auth-screen:not([hidden])').waitFor();
  return page;
}

async function signUp(page, username) {
  await page.locator('#auth-form [name="email"]').fill(`${username.toLowerCase()}@plakoto.test`);
  await page.locator('#auth-form [name="username"]').fill(username);
  await page.locator('#auth-form [name="password"]').fill('password1');
  await page.locator('#auth-submit').click();
  await page.waitForFunction(() => document.querySelector('#auth-screen')?.hasAttribute('hidden'));
  await page.waitForFunction(
    () => !document.querySelector('#start-local')?.hasAttribute('disabled'),
  );
}

async function smokeSnapshot(page) {
  return page.evaluate(() => {
    const smoke = window.__plakotoSmoke;
    return {
      revision: smoke.revision,
      latest: structuredClone(smoke.latest),
      variantConfig: structuredClone(smoke.variantConfig),
    };
  });
}

async function waitForSmokeRevision(page, revision) {
  await page.waitForFunction((previous) => window.__plakotoSmoke.revision > previous, revision);
}

async function actAndWait(pages, action) {
  const revisions = await Promise.all(
    pages.map(async (page) => (await smokeSnapshot(page)).revision),
  );
  await action();
  await Promise.all(pages.map((page, index) => waitForSmokeRevision(page, revisions[index])));
  const states = await Promise.all(pages.map(async (page) => (await smokeSnapshot(page)).latest));
  assert.deepEqual(states[1], states[0], 'online seats received different authoritative states');
  return states[0];
}

async function sendSocketCommand(page, command) {
  await page.evaluate((next) => {
    const socket = window.__plakotoSmoke.sockets.find(
      (candidate) =>
        candidate.readyState === WebSocket.OPEN && new URL(candidate.url).pathname === '/ws',
    );
    if (!socket) throw new Error('the smoke harness has no open game socket');
    socket.send(JSON.stringify(next));
  }, command);
}

async function waitForRoll(page) {
  await page.waitForFunction(() => document.querySelector('#roll')?.hasAttribute('aria-busy'));
  await page.waitForFunction(() => !document.querySelector('#roll')?.hasAttribute('aria-busy'));
}

async function boardState(page) {
  const canvas = page.locator('#scene canvas');
  return {
    phase: await canvas.getAttribute('data-phase'),
    active: await canvas.getAttribute('data-active'),
  };
}

async function authoritativeState(page) {
  const { latest } = await smokeSnapshot(page);
  assert.ok(latest, 'no authoritative online state was observed');
  return latest;
}

async function legalMovesFor(page, state) {
  return page.evaluate(async (current) => {
    const { legalMoves } = await import('/src/game/rules/moves.ts');
    return legalMoves(current, current.active, current.remaining);
  }, state);
}

async function waitForPresentedState(pages, state) {
  await Promise.all(
    pages.map((page) =>
      page.waitForFunction(
        (expected) => {
          const canvas = document.querySelector('#scene canvas');
          return (
            canvas?.dataset.phase === expected.phase &&
            canvas?.dataset.active === String(expected.active) &&
            canvas?.dataset.remaining === expected.remaining.join(',')
          );
        },
        { phase: state.phase, active: state.active, remaining: state.remaining },
      ),
    ),
  );
}

async function rollOnline(pages) {
  const before = await authoritativeState(pages[0]);
  assert.equal(before.phase, 'WAITING_FOR_ROLL');
  const active = before.active;
  assert.ok(active === 0 || active === 1, 'movement roll has no active player');
  const rolled = actAndWait(pages, () => pages[active].locator('#roll').click());
  await Promise.all(pages.map(waitForRoll));
  return rolled;
}

async function exhaustOnlineMoves(pages) {
  let state = await authoritativeState(pages[0]);
  while (state.phase === 'WAITING_FOR_MOVE') {
    const active = state.active;
    assert.ok(active === 0 || active === 1, 'movement state has no active player');
    const moves = await legalMovesFor(pages[active], state);
    assert.ok(moves.length, 'authoritative movement phase has no legal move');
    state = await actAndWait(pages, () =>
      sendSocketCommand(pages[active], { type: 'move', sequence: [moves[0]] }),
    );
    await waitForPresentedState(pages, state);
  }
  assert.equal(state.phase, 'TURN_COMPLETE');
  return state;
}

async function endOnlineTurn(pages) {
  const before = await authoritativeState(pages[0]);
  assert.equal(before.phase, 'TURN_COMPLETE');
  const active = before.active;
  assert.ok(active === 0 || active === 1, 'completed turn has no active player');
  await pages[active].waitForFunction(
    () => !document.querySelector('#roll')?.hasAttribute('disabled'),
  );
  return actAndWait(pages, () => pages[active].locator('#roll').click());
}

async function advanceToRound(pages, targetRound) {
  for (let turn = 0; turn < 30; turn++) {
    let state = await authoritativeState(pages[0]);
    if (state.powerups.completedRounds >= targetRound) return state;
    if (state.phase === 'WAITING_FOR_ROLL') state = await rollOnline(pages);
    if (state.phase === 'WAITING_FOR_MOVE') state = await exhaustOnlineMoves(pages);
    if (state.phase === 'TURN_COMPLETE') {
      state = await endOnlineTurn(pages);
      console.log(
        `Powerups browser path: round ${state.powerups.completedRounds}, phase ${state.phase}`,
      );
    }
  }
  assert.fail(`powerup match did not reach round ${targetRound}`);
}

async function pickDraftCard(pages, player, selector) {
  const card = pages[player].locator(selector).first();
  await card.waitFor({ state: 'visible' });
  assert.equal(await card.isEnabled(), true, `Player ${player + 1} cannot pick ${selector}`);
  return actAndWait(pages, () => card.click());
}

async function replaceDraftCard(pages, player, abilityId) {
  const page = pages[player];
  await page.locator(`.draft-card[data-ability="${abilityId}"]`).click();
  const prompt = page.locator('#draft-replacement');
  await prompt.getByText(/slots are full/i).waitFor();
  const replacement = prompt.getByRole('button', { name: /^Replace / }).first();
  assert.equal(await replacement.isEnabled(), true);
  return actAndWait(pages, () => replacement.click());
}

async function activateDraftedPower(pages, owner, ability) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let state = await authoritativeState(pages[0]);
    while (state.active !== owner) {
      if (state.phase === 'WAITING_FOR_ROLL') state = await rollOnline(pages);
      if (state.phase === 'WAITING_FOR_MOVE') state = await exhaustOnlineMoves(pages);
      if (state.phase === 'TURN_COMPLETE') state = await endOnlineTurn(pages);
    }

    if (state.phase === 'WAITING_FOR_ROLL') state = await rollOnline(pages);
    if (ability.abilityId === 'recast' || ability.abilityId === 'nudge') {
      const chip = pages[owner].locator(
        `button.ability-slot[data-instance="${ability.instanceId}"]`,
      );
      if (!(await chip.isVisible())) {
        state = await exhaustOnlineMoves(pages);
        state = await endOnlineTurn(pages);
        continue;
      }
      await chip.click();
      const use = pages[owner].locator('.ability-focus-card .ability-use');
      await use.waitFor({ state: 'visible' });
      assert.equal(await use.isEnabled(), true);
      await use.click();
      assert.equal(await chip.getAttribute('aria-pressed'), 'true');
      const option =
        ability.abilityId === 'recast'
          ? pages[owner].locator('.die-target:not([hidden])').first()
          : pages[owner]
              .locator('#move-choices button')
              .filter({ hasNotText: 'Cancel ability' })
              .first();
      await option.waitFor({ state: 'visible' });
      const rerolledDie = await option.getAttribute('data-die');
      state = await actAndWait(pages, async () => {
        if (ability.abilityId !== 'recast') {
          await option.click();
          return;
        }
        await option.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
      });
      if (ability.abilityId === 'recast') {
        assert.match(rerolledDie ?? '', /^[01]$/);
        await pages[owner].waitForFunction(
          (index) => document.querySelector('canvas')?.dataset.lastRollingDice === index,
          rerolledDie,
        );
      }
      assert.ok(
        state.diceModifiers.some((modifier) => modifier.abilityId === ability.abilityId),
        `${ability.abilityId} did not create a public dice modifier`,
      );
      return state;
    }

    if (state.phase === 'WAITING_FOR_MOVE') state = await exhaustOnlineMoves(pages);
    const chip = pages[owner].locator(`button.ability-slot[data-instance="${ability.instanceId}"]`);
    await chip.waitFor({ state: 'visible' });
    await chip.click();
    const use = pages[owner].locator('.ability-focus-card .ability-use');
    await use.waitFor({ state: 'visible' });
    assert.equal(await use.isEnabled(), true);
    await use.click();
    if (ability.abilityId === 'jinx') {
      assert.match((await pages[owner].locator('#roll').textContent()) ?? '', /USE & END/);
      state = await actAndWait(pages, () => pages[owner].locator('#roll').click());
    } else {
      const { variantConfig } = await smokeSnapshot(pages[owner]);
      const target = await pages[owner].evaluate(
        async ({ current, instanceId, config }) => {
          const { endTurnAbilityTargets } = await import('/src/game/variant/activation.ts');
          return endTurnAbilityTargets(current, current.active, instanceId, config)[0];
        },
        { current: state, instanceId: ability.instanceId, config: variantConfig },
      );
      assert.ok(target, `${ability.abilityId} has no legal end-turn target`);
      await pages[owner]
        .locator('#move-choices')
        .getByText(/Choose a highlighted point/)
        .waitFor();
      state = await actAndWait(pages, () =>
        sendSocketCommand(pages[owner], {
          type: 'end',
          ability: { instanceId: ability.instanceId, target },
        }),
      );
    }
    assert.ok(
      state.powerups.activeEffects.some((effect) => effect.abilityId === ability.abilityId),
      `${ability.abilityId} did not create a public active effect`,
    );
    return state;
  }
  assert.fail(`could not reach a playable window for ${ability.abilityId}`);
}

async function localSmoke(browser, errors) {
  const page = await openReadyPage(browser, 'local', errors);
  await signUp(page, 'Local');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#auth-screen')?.hasAttribute('hidden'));
  await page.waitForFunction(
    () => !document.querySelector('#start-local')?.hasAttribute('disabled'),
  );
  assert.equal(await page.locator('#start-screen').getAttribute('hidden'), null);
  assert.equal(
    await page.locator('input[name="ruleset"][value="CLASSIC"]').isChecked(),
    true,
    'Classic should be the default ruleset',
  );
  await page.setViewportSize({ width: 320, height: 568 });
  const compactOptions = await page.locator('.start-options').boundingBox();
  assert.ok(compactOptions, 'compact title options are not visible');
  assert.ok(
    compactOptions.y + compactOptions.height <= 568,
    'compact title options overflow the viewport',
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.locator('.playtest-tools').isVisible(), true);
  await page.locator('#playtest-seed').fill('24680');
  await page.locator('#start-local').click();
  await page.waitForFunction(() => !document.body.classList.contains('on-title'));
  await page.waitForFunction(() => !document.querySelector('#roll')?.hasAttribute('disabled'));

  const canvas = page.locator('#scene canvas');
  await canvas.waitFor({ state: 'visible' });
  assert.equal(await canvas.getAttribute('data-ruleset'), 'CLASSIC');
  assert.equal(await page.locator('#ruleset-badge').isHidden(), true);
  for (let rollCount = 0; ; rollCount++) {
    const phase = await canvas.getAttribute('data-phase');
    if (phase !== 'OPENING_ROLL') break;
    assert.ok(rollCount < 12, 'opening rolls did not produce a winner');
    await page.locator('#roll').click();
    await waitForRoll(page);
    if ((await canvas.getAttribute('data-phase')) === 'OPENING_ROLL')
      await page.waitForFunction(() => !document.querySelector('#roll')?.hasAttribute('disabled'));
  }

  assert.equal(await canvas.getAttribute('data-phase'), 'WAITING_FOR_ROLL');
  await page.locator('#roll').click();
  await waitForRoll(page);
  assert.equal(await canvas.getAttribute('data-phase'), 'WAITING_FOR_MOVE');

  const dice = (await page.locator('#dice-result').textContent())?.match(/[1-6]/g)?.map(Number);
  assert.equal(dice?.length, 2, 'movement dice were not presented');
  const active = Number(await canvas.getAttribute('data-active'));
  assert.ok(active === 0 || active === 1, 'active player was not exposed on the board');

  const bounds = await canvas.boundingBox();
  assert.ok(bounds, 'board canvas has no visible bounds');
  const pointX = [0.256, 0.295, 0.332, 0.369, 0.407, 0.445, 0.555];
  const rowY = active === 0 ? 0.25 : 0.66;
  await page.mouse.click(bounds.x + bounds.width * pointX[0], bounds.y + bounds.height * rowY);
  await page.locator('#move-choices').getByText('1 checker held').waitFor();

  await page.mouse.click(
    bounds.x + bounds.width * pointX[dice[0]],
    bounds.y + bounds.height * rowY,
  );
  await page.waitForFunction(() => !document.querySelector('#undo')?.hasAttribute('disabled'));
  assert.equal((await page.locator('#move-choices').textContent())?.trim(), '');

  await page.locator('#undo').click();
  await page.waitForFunction(() => document.querySelector('#undo')?.hasAttribute('disabled'));
  assert.equal(await canvas.getAttribute('data-phase'), 'WAITING_FOR_MOVE');
  await page.locator('.top-actions [data-open="settings"]').click();
  assert.equal(await page.locator('#download-playtest').isEnabled(), true);
  const [playtestDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#download-playtest').click(),
  ]);
  const playtestPath = await playtestDownload.path();
  assert.ok(playtestPath, 'playtest report download has no local path');
  await page.locator('#playtest-files').setInputFiles(playtestPath);
  await page.waitForFunction(() =>
    document.querySelector('#playtest-analysis-output')?.textContent?.includes('1 valid report'),
  );
  assert.equal(await page.locator('#download-analysis').isEnabled(), true);
  await page.close();
}

async function signIn(page, name) {
  await signUp(page, name);
}

async function onlineSmoke(browser, errors) {
  const [first, second] = await Promise.all([
    openReadyPage(browser, 'online player 1', errors),
    openReadyPage(browser, 'online player 2', errors),
  ]);
  await signIn(first, 'Ada');
  await signIn(second, 'Basil');
  await Promise.all(
    [first, second].map((page) =>
      page.locator('input[name="ruleset"][value="POWERUPS_V1"]').check(),
    ),
  );
  await first.locator('#start-multiplayer').click();
  await first.locator('#waiting-screen:not([hidden])').waitFor();
  assert.match(
    (await first.locator('#waiting-ruleset').textContent()) ?? '',
    /Powerups · powerups-v1 v1/,
  );
  await second.locator('#start-multiplayer').click();
  await Promise.all(
    [first, second].map((page) =>
      page.waitForFunction(() => !document.body.classList.contains('on-title')),
    ),
  );
  assert.equal(
    await first.locator('.player.red').evaluate((panel) => panel.classList.contains('you')),
    true,
  );

  for (const page of [first, second]) {
    const canvas = page.locator('#scene canvas');
    assert.equal(await canvas.getAttribute('data-ruleset'), 'POWERUPS_V1');
    assert.match((await page.locator('#ruleset-badge').textContent()) ?? '', /fast-balance v1/);
    assert.equal(await page.locator('#ruleset-badge').isVisible(), true);
  }
  assert.equal(
    await second.locator('.player.ivory').evaluate((panel) => panel.classList.contains('you')),
    true,
  );

  const pages = [first, second];
  const { variantConfig } = await smokeSnapshot(first);
  assert.equal(variantConfig.id, 'fast-balance');
  const draftInterval = variantConfig.draft.intervalRounds;
  for (let rollCount = 0; ; rollCount++) {
    const state = await boardState(first);
    assert.deepEqual(await boardState(second), state, 'online seats disagree about turn state');
    if (state.phase !== 'OPENING_ROLL') break;
    assert.ok(rollCount < 12, 'online opening rolls did not produce a winner');
    const active = Number(state.active);
    assert.ok(active === 0 || active === 1, 'online match has no active opening player');
    assert.equal(await pages[1 - active].locator('#roll').isDisabled(), true);
    await pages[active].locator('#roll').click();
    await Promise.all(pages.map(waitForRoll));
    assert.equal(
      await first.locator('#dice-result').getAttribute('aria-label'),
      await second.locator('#dice-result').getAttribute('aria-label'),
      'online seats received different opening dice',
    );
  }

  const ready = await boardState(first);
  assert.equal(ready.phase, 'WAITING_FOR_ROLL');
  assert.deepEqual(await boardState(second), ready);
  const active = Number(ready.active);
  await pages[active].locator('#roll').click();
  await Promise.all(pages.map(waitForRoll));
  const moving = await boardState(first);
  assert.equal(moving.phase, 'WAITING_FOR_MOVE');
  assert.deepEqual(await boardState(second), moving, 'online seats disagree after movement roll');
  assert.equal(
    await first.locator('#dice-result').getAttribute('aria-label'),
    await second.locator('#dice-result').getAttribute('aria-label'),
    'online seats received different movement dice',
  );

  let powerupState = await advanceToRound(pages, draftInterval);
  console.log('Powerups browser path: first draft opened');
  assert.equal(powerupState.phase, 'DRAFT_PICK');
  await Promise.all(
    pages.map((page) => page.locator('#draft-panel').waitFor({ state: 'visible' })),
  );
  await Promise.all(
    pages.map(async (page) => {
      await page.locator('.draft-contestant.is-picker').waitFor({ state: 'visible' });
      assert.equal(
        await page.locator('#draft-contestants').getAttribute('data-roll-presentations'),
        '1',
        'draft order should be presented exactly once when the dialog opens',
      );
      assert.equal(
        await page.locator('.draft-die-cube').count(),
        0,
        'draft dice should throw once, then leave only the chooser avatar',
      );
      assert.doesNotMatch((await page.locator('#draft-status').textContent()) ?? '', /Player \d/);
    }),
  );
  const powerPriority = ['recast', 'nudge', 'jinx', 'frostSeal', 'bastion'];
  const firstPower = powerPriority.find((abilityId) =>
    powerupState.powerups.draft.offer.includes(abilityId),
  );
  assert.ok(firstPower, 'the first draft did not offer a usable powerup');
  const firstPicker = powerupState.powerups.draft.pickOrder[0];
  powerupState = await pickDraftCard(
    pages,
    firstPicker,
    `.draft-card[data-ability="${firstPower}"]`,
  );
  const draftedPower = powerupState.powerups.loadouts[firstPicker].powerups.find(
    (instance) => instance.abilityId === firstPower,
  );
  assert.ok(draftedPower, `${firstPower} was not added to Player ${firstPicker + 1}'s inventory`);

  const passiveIds = new Set(['loadedKnuckles', 'quartermaster', 'homeGuard', 'opportunist']);
  const draftedPassiveId = powerupState.powerups.draft.offer.find((abilityId) =>
    passiveIds.has(abilityId),
  );
  assert.ok(draftedPassiveId, 'the first draft did not retain its passive for the second picker');
  const passiveOwner =
    powerupState.powerups.draft.pickOrder[powerupState.powerups.draft.currentPick];
  powerupState = await pickDraftCard(
    pages,
    passiveOwner,
    `.draft-card[data-ability="${draftedPassiveId}"]`,
  );
  assert.equal(powerupState.phase, 'WAITING_FOR_ROLL');
  const draftedPassive = powerupState.powerups.loadouts[passiveOwner].passives.find(
    (instance) => instance.abilityId === draftedPassiveId,
  );
  assert.ok(draftedPassive, 'the drafted passive was not added to inventory');
  await pages[firstPicker]
    .locator(`.ability-slot[data-instance="${draftedPower.instanceId}"]`)
    .waitFor({ state: 'visible' });

  powerupState = await activateDraftedPower(pages, firstPicker, draftedPower);
  console.log(`Powerups browser path: activated ${draftedPower.abilityId}`);
  assert.equal(
    powerupState.powerups.loadouts[firstPicker].powerups.some(
      (instance) => instance.instanceId === draftedPower.instanceId,
    ),
    false,
    'activated powerup remained in inventory',
  );

  powerupState = await advanceToRound(pages, draftInterval * 2);
  console.log('Powerups browser path: replacement draft opened');
  assert.equal(powerupState.phase, 'DRAFT_PICK');
  const replacementPassive = powerupState.powerups.draft.offer.find((abilityId) =>
    passiveIds.has(abilityId),
  );
  assert.ok(replacementPassive, 'the second draft did not offer a passive');
  const secondDraftFirst = powerupState.powerups.draft.pickOrder[0];
  if (secondDraftFirst === passiveOwner) {
    powerupState = await replaceDraftCard(pages, passiveOwner, replacementPassive);
    const other = powerupState.powerups.draft.pickOrder[powerupState.powerups.draft.currentPick];
    powerupState = await pickDraftCard(pages, other, '.draft-card[data-kind="POWERUP"]');
  } else {
    powerupState = await pickDraftCard(pages, secondDraftFirst, '.draft-card[data-kind="POWERUP"]');
    powerupState = await replaceDraftCard(pages, passiveOwner, replacementPassive);
  }
  assert.equal(powerupState.phase, 'WAITING_FOR_ROLL');
  assert.equal(
    powerupState.powerups.loadouts[passiveOwner].passives.some(
      (instance) => instance.instanceId === draftedPassive.instanceId,
    ),
    false,
    'replaced passive remained in inventory',
  );
  assert.ok(
    powerupState.powerups.loadouts[passiveOwner].passives.some(
      (instance) => instance.abilityId === replacementPassive,
    ),
    'replacement passive was not added to inventory',
  );
  await Promise.all(pages.map((page) => page.close()));
}

let browser;
let webServer;
let gameServer;
const databaseName = `plakoto-smoke-${randomUUID()}`;
const mongo = await MongoMemoryServer.create();
const mongoUrl = mongo.getUri();
try {
  await run(process.execPath, ['scripts/bundle-server.mjs']);
  gameServer = start(process.execPath, ['dist-server/index.mjs'], {
    env: {
      ...process.env,
      PORT: String(gamePort),
      PLAKOTO_MONGO_URL: mongoUrl,
      PLAKOTO_DB_NAME: databaseName,
      PLAKOTO_TEST_RANDOM_SEED: '2',
    },
  });
  webServer = start(
    process.execPath,
    ['node_modules/vite/bin/vite.js', '--host', host, '--port', String(webPort), '--strictPort'],
    { env: { ...process.env, PLAKOTO_SERVER_PORT: String(gamePort) } },
  );
  await Promise.all([
    waitForServer(url, webServer),
    waitForServer(`http://${host}:${gamePort}`, gameServer, false),
  ]);
  browser = await chromium.launch({
    executablePath: await chromePath(),
    headless: !headed,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl'],
  });
  const browserErrors = [];
  await localSmoke(browser, browserErrors);
  await onlineSmoke(browser, browserErrors);
  assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
  console.log(
    'Browser smoke passed: local play plus authoritative online drafts, replacement, and ability use.',
  );
} finally {
  await browser?.close();
  webServer?.child.kill('SIGTERM');
  gameServer?.child.kill('SIGTERM');
  const client = new MongoClient(mongoUrl);
  try {
    await client.connect();
    await client.db(databaseName).dropDatabase();
  } finally {
    await client.close();
  }
  await mongo.stop();
}
