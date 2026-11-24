import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { _electron } from 'playwright-core';

// LOGIC — focused proof of configured feature blocks; never changes normal profiles/pins.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime/checks/window-controls');
await mkdir(evidence, { recursive: true });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const run = promisify(execFile);
const application = await _electron.launch({ args: [root, '--qa'], cwd: root, env, timeout: 15000 });
const checks = [], errors = [];
try {
  const page = await application.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('[data-ready]');
  await application.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window.isVisible()) await new Promise((resolve) => window.once('show', resolve));
  });
  const points = await application.evaluate(({ BrowserWindow, screen }) => {
    const area = BrowserWindow.getAllWindows()[0].getContentBounds();
    return [0.02, 0.25].map((y) => screen.dipToScreenPoint({ x: area.x + Math.round(area.width / 2), y: area.y + Math.round(area.height * y) }));
  });
  const move = async ({ x, y }) => {
    const command = `Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public class ProofPointer { [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); }'; if (-not [ProofPointer]::SetCursorPos(${x},${y})) { exit 1 }`;
    await run('pwsh', ['-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { timeout: 10000 });
  };
  const reconfigure = (change) => page.evaluate((operation) => {
    const config = structuredClone(window.shellDev.config);
    const group = config.areas.find((node) => node.id === 'windowsBar').children.find((node) => node.id === 'windowControls');
    if (operation === 'reverse') group.order.reverse();
    if (operation === 'preset') config.presets.captionButton.colors = { background: '#234567' };
    if (operation === 'invalid') group.children.find((node) => node.id === 'close').colors = { background: 'invalid' };
    if (operation === 'overflow') group.gap = 50;
    if (operation === 'action') group.children.find((node) => node.id === 'close').action = 'unsupported';
    if (operation === 'disabled') group.enabled = false;
    window.shellDev.reconfigure(config);
  }, change);
  const reveal = async () => { await move(points[0]); await page.getByRole('button', { name: 'Close window' }).waitFor({ state: 'visible', timeout: 4000 }); };
  const before = await page.locator('#body').boundingBox();
  assert.deepEqual(await page.evaluate(() => window.shellDev.records()), []);
  await reveal();
  const windowControls = page.locator('[data-instance="windowControls"]');
  assert.equal(await windowControls.getByRole('button').count(), 2);
  assert.equal(await page.locator('[data-instance="appTitle"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Minimize window' }).count(), 0);
  assert.equal(await page.locator('[data-instance="windowControls"]').count(), 1);
  assert.equal(await page.locator('[data-instance="minimize"], [data-instance="maximize"], [data-instance="close"]').count(), 0);
  for (const name of ['maximize', 'close']) {
    const relative = await windowControls.locator(`[data-part="${name}"]`).evaluate((element) => {
      const section = document.querySelector('#windowsBar');
      const bar = section.getBoundingClientRect();
      const bounds = element.getBoundingClientRect();
      return { x: (bounds.x - bar.x - section.clientLeft) / section.clientWidth * 100,
        width: bounds.width / section.clientWidth * 100 };
    });
    assert.ok(Math.abs(relative.width - 4.5) < 0.05);
    assert.ok(Math.abs(relative.x - { maximize: 89.75, close: 94.5 }[name]) < 0.05,
      `${name}: unexpected position ${JSON.stringify(relative)}`);
  }
  checks.push('one discovered group; preserved original button positions and sizes');
  await page.screenshot({ path: path.join(evidence, 'hover.png') });
  await move(points[1]);
  await page.getByRole('button', { name: 'Close window' }).waitFor({ state: 'detached' });
  assert.deepEqual(await page.locator('#body').boundingBox(), before);
  await reveal();
  checks.push('native hover reveals/hides the group without moving the body');
  await reconfigure('reverse');
  await page.waitForFunction(() => document.querySelector('[data-instance="windowControls"] [data-part]')?.dataset.part === 'close');
  await reconfigure('preset');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-instance="windowControls"] [data-part="maximize"] button')).backgroundColor === 'rgb(35, 69, 103)');
  assert.equal(await windowControls.locator('[data-part="close"] button').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(35, 69, 103)');
  checks.push('JSON order and shared visual preset change internal parts');
  for (const operation of ['invalid', 'overflow', 'action', 'disabled']) {
    await reconfigure(operation);
    await page.locator('[data-instance="windowControls"]').waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-instance="readerOpen"]').count(), 1);
    assert.equal(await page.locator('[data-instance="reader"]').count(), 1);
    await reconfigure('reset');
    await page.getByRole('button', { name: 'Close window' }).waitFor();
  }
  checks.push('bad part, row overflow, invalid action and disabled group isolate only the group');
  await move(points[1]);
  await page.getByRole('button', { name: 'Close window' }).waitFor({ state: 'detached' });
  // Use actual button clicks for native operations, not direct action injection.
  await reveal();
  await page.getByRole('button', { name: 'Restore default window size' }).click();
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()), false);
  await reveal();
  const closed = application.waitForEvent('close');
  await page.getByRole('button', { name: 'Close window' }).click();
  await closed;
  checks.push('group buttons perform return-to-default and close');
  assert.deepEqual(errors, []);
  const result = { verdict: 'PASS', checks };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await application.close().catch(() => {}); }
