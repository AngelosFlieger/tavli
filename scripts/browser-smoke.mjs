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

async function localSmoke(browser, errors) {
  const page = await openReadyPage(browser, 'local', errors);
  await signUp(page, 'Local');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#auth-screen')?.hasAttribute('hidden'));
  await page.waitForFunction(
    () => !document.querySelector('#start-local')?.hasAttribute('disabled'),
  );
  assert.equal(await page.locator('#start-screen').getAttribute('hidden'), null);
  await page.locator('#start-local').click();
  await page.waitForFunction(() => !document.body.classList.contains('on-title'));
  await page.waitForFunction(() => !document.querySelector('#roll')?.hasAttribute('disabled'));

  const canvas = page.locator('#scene canvas');
  await canvas.waitFor({ state: 'visible' });
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
  await first.locator('#start-multiplayer').click();
  await first.locator('#waiting-screen:not([hidden])').waitFor();
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
  assert.equal(
    await second.locator('.player.ivory').evaluate((panel) => panel.classList.contains('you')),
    true,
  );

  const pages = [first, second];
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
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-webgl'],
  });
  const browserErrors = [];
  await localSmoke(browser, browserErrors);
  await onlineSmoke(browser, browserErrors);
  assert.deepEqual(browserErrors, [], `browser errors:\n${browserErrors.join('\n')}`);
  console.log(
    'Browser smoke passed: local pickup/placement/undo and authoritative two-seat rolls.',
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
