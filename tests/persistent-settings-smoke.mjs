import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright-core';

// Focused UI/native proof for config-owned values and one override file; no Reader archive work.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const stamp = Date.now();
const evidence = path.join(root, '.runtime', `persistent-settings-${stamp}`);
const profileName = `persistent-settings-${stamp}`;
const profile = path.join(root, '.runtime', `qa-profile-${profileName}`);
await mkdir(evidence, { recursive: true });
await mkdir(profile, { recursive: true });
await writeFile(
  path.join(profile, 'reader-preferences.json'),
  `${JSON.stringify({ version: 1, values: { scrollSpeed: 37, smoothScrollDurationMs: 600 } }, null, 2)}\n`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const errors = [];
let application;
const readValues = async () =>
  JSON.parse(await readFile(path.join(profile, 'reader-preferences.json'), 'utf8')).values;
const waitForValues = async (accept) => {
  const deadline = Date.now() + 3000;
  do {
    try {
      const values = await readValues();
      if (accept(values)) return values;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for persisted Reader preferences');
};
try {
  application = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, '--qa', `--qa-profile=${profileName}`],
    cwd: root,
    env,
    timeout: 15000,
  });
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.waitForSelector('[data-reader]');
  const runtimeProfile = await application.evaluate(async ({ app, BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
    window.setContentSize(900, 700);
    window.focus();
    screen.getCursorScreenPoint = () => {
      const bounds = window.getContentBounds();
      return { x: bounds.x + 30, y: bounds.y + 15 };
    };
    return app.getPath('userData');
  });
  assert.equal(runtimeProfile, profile);
  await page.waitForFunction(() => innerWidth === 900 && innerHeight === 700);
  await page.waitForFunction(
    () =>
      document.querySelector('[data-reader-viewport]').dataset.smoothScrollDuration === '600' &&
      document.querySelector('[data-reader-viewport]').dataset.scrollSpeed === '3.7',
  );

  const gear = page.getByRole('button', { name: 'Setting Screen', exact: true });
  await gear.waitFor({ state: 'visible' });
  await gear.click();
  const settings = page.getByRole('dialog', { name: 'Setting Screen', exact: true });
  await settings.waitFor({ state: 'visible' });
  const cards = settings.locator('[data-setting-section]');
  assert.equal(await cards.count(), 1);
  assert.deepEqual(await cards.locator('[data-setting-section-header]').allTextContents(), [
    'Smooth scroll',
  ]);
  const smooth = settings.locator('[data-setting-section="smoothScroll"]');
  const smoothSlider = smooth.getByRole('slider', { name: 'Smooth-scroll duration' });
  assert.equal(await smooth.locator('[data-configured-value-slider]').count(), 1);
  assert.equal(await smoothSlider.getAttribute('min'), '100');
  assert.equal(await smoothSlider.getAttribute('max'), '2000');
  assert.equal(await smoothSlider.getAttribute('aria-valuenow'), '600');
  await smoothSlider.focus();
  await smoothSlider.press('End');
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.smoothScrollDuration === '2000',
  );
  assert.equal(
    (await waitForValues((values) => values.smoothScrollDurationMs === 2000))
      .smoothScrollDurationMs,
    2000,
  );
  await smooth.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.smoothScrollDuration === '250',
  );
  await waitForValues((values) => !('smoothScrollDurationMs' in values));
  await settings.getByRole('button', { name: 'Close Setting Screen', exact: true }).click();

  const speedButton = page.getByRole('button', { name: 'Scroll speed', exact: true });
  await speedButton.click();
  const speedPanel = page.getByRole('dialog', { name: 'Scroll speed', exact: true });
  await speedPanel.waitFor({ state: 'visible' });
  const speedValue = speedPanel.getByRole('spinbutton', { name: 'Speed value' });
  assert.equal(await speedPanel.locator('[data-configured-value-slider]').count(), 1);
  assert.equal(await speedValue.inputValue(), '37');
  await speedValue.fill('42');
  await speedValue.press('Tab');
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.scrollSpeed === '4.2',
  );
  assert.equal((await waitForValues((values) => values.scrollSpeed === 42)).scrollSpeed, 42);
  await speedPanel.getByRole('button', { name: 'Reset', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[data-reader-viewport]').dataset.scrollSpeed === '1',
  );
  await waitForValues((values) => !('scrollSpeed' in values));
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'Smooth scroll is the only visible JSON-declared section card',
      'Smooth scroll and Scroll speed render the shared configured slider',
      'saved 600 ms and 3.7× overrides load before the Reader worker starts',
      '100–2000 ms duration updates the live worker and Reset restores 250 ms',
      'smooth duration and scroll speed save only overrides in Reader userData',
      'both Reset controls remove their saved override',
    ],
    preferenceFile: 'reader-preferences.json',
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, errors, evidence }, null, 2),
  );
  throw error;
} finally {
  if (application) await application.close();
  await rm(profile, { recursive: true, force: true });
}
