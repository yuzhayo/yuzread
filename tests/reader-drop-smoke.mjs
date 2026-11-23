import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { _electron } from 'playwright-core';

// Focused real disk-backed File -> preload -> shared reader Open check; no settings tests.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const evidence = path.join(root, '.runtime', `reader-drop-${Date.now()}`);
await mkdir(path.join(evidence, 'one'), { recursive: true });
await mkdir(path.join(evidence, 'two'), { recursive: true });
for (const [name, color] of [
  ['red', '#b84e3b'],
  ['green', '#438c62'],
  ['blue', '#4363bd'],
])
  await sharp({ create: { width: 512, height: 1536, channels: 3, background: color } })
    .png()
    .toFile(path.join(evidence, `${name}.png`));
await promisify(execFile)('python', [
  '-c',
  'import pathlib,sys,zipfile; p=pathlib.Path(sys.argv[1]); [(lambda z,c:([z.write(p/(c+".png"),"%d.png"%n) for n in (1,2)],z.close()))(zipfile.ZipFile(p/f,"w",zipfile.ZIP_DEFLATED),c) for f,c in [("one/chapter1.CBZ","red"),("one/chapter2.cbz","green"),("two/replacement.cbz","blue")]]',
  evidence,
]);
await writeFile(path.join(evidence, 'bad.txt'), 'not an archive');
await writeFile(path.join(evidence, 'corrupt.cbz'), 'not a ZIP');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const errors = [];
try {
  app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, '--qa', '--force-device-scale-factor=1'],
    cwd: root,
    env,
    timeout: 15000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForSelector('[data-reader]');
  await app.evaluate(async ({ BrowserWindow, dialog, screen }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.webContents.isLoading())
      await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    if (!win.isVisible()) await new Promise((resolve) => win.once('show', resolve));
    win.setContentSize(900, 700);
    win.focus();
    globalThis.dropDialogs = 0;
    dialog.showOpenDialog = async () => {
      globalThis.dropDialogs++;
      throw new Error('Drop must not open the picker');
    };
    screen.getCursorScreenPoint = () => {
      const b = win.getContentBounds();
      return { x: b.x + b.width * 0.83, y: b.y + 15 };
    };
  });
  await page.evaluate(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.id = 'drop-input';
    input.hidden = true;
    document.body.append(input);
  });
  const drop = async (files) => {
    await page.locator('#drop-input').setInputFiles(files);
    return await page.evaluate(() => {
      const data = new DataTransfer();
      for (const file of document.querySelector('#drop-input').files) data.items.add(file);
      const view = document.querySelector('[data-reader-viewport]'),
        over = new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true }),
        event = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
      view.dispatchEvent(over);
      view.dispatchEvent(event);
      return { overPrevented: over.defaultPrevented, dropPrevented: event.defaultPrevented };
    });
  };
  const first = path.join(evidence, 'one', 'chapter1.CBZ');
  assert.deepEqual(await drop(first), { overPrevented: true, dropPrevented: true });
  await page.waitForFunction(
    () =>
      document.querySelector('[data-reader-status]').textContent.includes('chapter1.CBZ') &&
      document.querySelector('[data-reader-pixi]').dataset.readerPixi === 'ready',
    null,
    { timeout: 15000 },
  );
  const canvas = page.locator('[data-reader-pixi]');
  const color = async (expected) => {
    const bytes = await sharp(await page.locator('[data-reader-viewport]').screenshot())
      .extract({ left: 450, top: 300, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.ok(
      expected.every((value, index) => Math.abs(bytes[index] - value) <= 2),
      `displayed pixel is ${[...bytes]}`,
    );
  };
  await color([184, 78, 59]);
  await page.getByRole('button', { name: 'Scroll speed', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Speed value' }).fill('37');
  await page.keyboard.press('Enter');
  await page.mouse.click(850, 300);
  await page.mouse.move(450, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -120);
  await page.keyboard.up('Control');
  await page.waitForFunction(
    () => Number(document.querySelector('[data-reader-pages]').dataset.zoom) === 1.1,
  );
  const old = await page.evaluate(() => ({
    id: document.querySelector('[data-reader-chapter]').dataset.readerSession,
    top: document.querySelector('[data-reader-viewport]').scrollTop,
  }));
  await drop(path.join(evidence, 'bad.txt'));
  await drop([first, path.join(evidence, 'one', 'chapter2.cbz')]);
  assert.equal(
    await page.evaluate(
      () => document.querySelector('[data-reader-chapter]').dataset.readerSession,
    ),
    old.id,
  );
  assert.equal(
    await page.evaluate(() => document.querySelector('[data-reader-viewport]').scrollTop),
    old.top,
  );
  await drop(path.join(evidence, 'corrupt.cbz'));
  await page.waitForFunction(
    () => document.querySelector('[data-reader-status]').textContent.includes('Cannot load CBZ'),
    null,
    { timeout: 15000 },
  );
  assert.equal(
    await page.evaluate(
      () => document.querySelector('[data-reader-chapter]').dataset.readerSession,
    ),
    old.id,
  );
  await color([184, 78, 59]);
  const fake = await page.evaluate(async () => {
    const file = new File(['bytes'], 'fake.cbz');
    Object.defineProperty(file, 'path', { value: 'C:/arbitrary.cbz' });
    return await window.shellHost.reader.drop(file, {
      renderWidth: 512,
      maxDecodeWidth: 4096,
      maxDecodedMB: 1536,
      tileCache: true,
    });
  });
  assert.equal(fake.ok, false, 'fabricated File/path must not authorize native file opening');
  await page.waitForFunction(
    () => document.querySelectorAll('[data-reader-chapter]').length >= 2,
    null,
    { timeout: 15000 },
  );
  const chapterRevision = Number(await canvas.getAttribute('data-pixi-revision'));
  await page.evaluate(() => {
    const v = document.querySelector('[data-reader-viewport]');
    const chapters = [...document.querySelectorAll('[data-reader-chapter]')];
    const target = chapters.find((node) => node.dataset.readerIndex === '1');
    v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    v.scrollTop += target.getBoundingClientRect().top - v.getBoundingClientRect().top + 40;
  });
  await page.waitForFunction(
    revision => Number(document.querySelector('[data-reader-pixi]').dataset.pixiRevision) > revision,
    chapterRevision,
    { timeout: 5000 },
  );
  await color([67, 140, 98]);
  await drop(path.join(evidence, 'two', 'replacement.cbz'));
  await page.waitForFunction(
    () =>
      document.querySelector('[data-reader-status]').textContent.includes('replacement.cbz') &&
      document.querySelector('[data-reader-status]').dataset.prepared === '2',
    null,
    { timeout: 15000 },
  );
  await color([67, 99, 189]);
  assert.equal(
    await page.evaluate(() => Number(document.querySelector('[data-reader-pages]').dataset.zoom)),
    1.1,
  );
  assert.equal(
    await page.evaluate(() =>
      Number(document.querySelector('[data-reader-viewport]').dataset.scrollSpeed),
    ),
    3.7,
  );
  assert.equal(await canvas.count(), 1);
  assert.equal(await app.evaluate(() => globalThis.dropDialogs), 0);
  assert.deepEqual(errors, []);
  const result = {
    verdict: 'PASS',
    checks: [
      'disk-backed uppercase CBZ drag/drop opens without picker or browser navigation',
      'invalid/multiple/corrupt drops and fabricated File preserve readable old content',
      'same-folder next chapter loads without picker',
      'replacement retains zoom/speed and one GPU canvas',
    ],
    evidence,
  };
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    await writeFile(
      path.join(evidence, 'state.json'),
      JSON.stringify(
        await page.evaluate(() => ({
          status: document.querySelector('[data-reader-status]')?.textContent,
          canvas: document.querySelector('[data-reader-pixi]')?.outerHTML,
        })),
        null,
        2,
      ),
    );
  }
  await writeFile(
    path.join(evidence, 'result.json'),
    JSON.stringify({ verdict: 'FAIL', error: error.stack, errors, evidence }, null, 2),
  );
  throw error;
} finally {
  if (app) await app.close();
}
