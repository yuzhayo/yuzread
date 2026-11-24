import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  discoverSuiteApplications,
  isSuiteApplication,
  loadSuiteScreenConfiguration,
  selectSuiteApplication,
} from '../electron-built/SuiteApplications.cjs';
import { suiteVersionResource } from '../electron-built/SuiteRuntime.cjs';
import { createSuiteIcons, encodeSuiteIcon } from '../electron-built/SuiteRuntimeIcons.cjs';
import sharp from 'sharp';

// CONFIG AND CONTRACT — isolated launch/identity checks, no application launch or global mutation.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const applications = discoverSuiteApplications(root);

test('suite declarations have distinct process names, identities and userData while preserving Reader data', () => {
  assert.deepEqual(
    applications.map(({ processName }) => processName),
    ['yuzread-downloader', 'yuzread-library', 'yuzread-reader'],
  );
  assert.equal(new Set(applications.map(({ appId }) => appId)).size, 3);
  assert.equal(new Set(applications.map(({ userDataFolder }) => userDataFolder)).size, 3);
  const reader = applications.find(({ id }) => id === 'reader');
  assert.equal(reader.userDataFolder, 'Yuzread');
  assert.equal(reader.appId, 'com.yuzread.desktop');
  assert.equal(isSuiteApplication({ ...reader, processName: 'electron' }), false);
  assert.equal(isSuiteApplication({ ...reader, userDataFolder: '../other' }), false);
  assert.equal(isSuiteApplication({ ...reader, undeclared: true }), false);
});

test('each branded executable selects only its declared role; development flags are validated', () => {
  for (const application of applications) {
    assert.equal(
      selectSuiteApplication(applications, `C:\\runtime\\${application.processName}.exe`, []).id,
      application.id,
    );
    assert.equal(
      selectSuiteApplication(applications, 'C:\\runtime\\electron.exe', [`--app=${application.id}`])
        .id,
      application.id,
    );
    assert.throws(() =>
      selectSuiteApplication(applications, `C:\\runtime\\${application.processName}.exe`, [
        '--app=unknown',
      ]),
    );
  }
  assert.equal(selectSuiteApplication(applications, 'electron.exe', []).id, 'reader');
  assert.throws(() =>
    selectSuiteApplication(applications, 'electron.exe', ['--app=library', '--app=reader']),
  );
  assert.throws(() => selectSuiteApplication(applications, 'electron.exe', ['--app=unknown']));
});

test('native discovery rejects duplicate identities and cross-application configuration paths', () => {
  const temporary = path.join(root, '.agents-temp');
  fs.mkdirSync(temporary, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(temporary, 'suite-declarations-'));
  try {
    const library = applications.find(({ id }) => id === 'library');
    const downloader = applications.find(({ id }) => id === 'downloader');
    for (const application of [library, downloader]) {
      fs.mkdirSync(path.join(fixture, 'electron', application.id), { recursive: true });
      fs.writeFileSync(
        path.join(fixture, 'electron', application.id, 'application.json'),
        JSON.stringify(application),
      );
    }
    const declaration = path.join(fixture, 'electron/downloader/application.json');
    fs.writeFileSync(declaration, JSON.stringify({ ...downloader, appId: library.appId }));
    assert.throws(() => discoverSuiteApplications(fixture), /Duplicate application appId/);
    fs.writeFileSync(
      declaration,
      JSON.stringify({ ...downloader, userDataFolder: library.userDataFolder }),
    );
    assert.throws(() => discoverSuiteApplications(fixture), /Duplicate application userDataFolder/);
    fs.writeFileSync(
      declaration,
      JSON.stringify({ ...downloader, screenConfig: library.screenConfig }),
    );
    assert.throws(() => discoverSuiteApplications(fixture), /crosses ownership/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    if (!fs.readdirSync(temporary).length) fs.rmdirSync(temporary);
  }
});

test('Library and Downloader load only their own screen layout with shared appearance and no Reader features', () => {
  for (const application of applications) {
    const config = loadSuiteScreenConfiguration(root, application);
    assert.ok(config.presets.base);
    if (application.id === 'reader') {
      const reader = config.areas.find(({ id }) => id === 'body').children[0];
      assert.equal(reader.maxFPS, 0);
      assert.equal(reader.renderer, 'pixi');
    } else {
      assert.equal(config.areas.length, 2);
      assert.ok(config.areas.every(({ folder }) => folder.startsWith(`${application.id}/`)));
      assert.deepEqual(config.areas.find(({ folder }) => folder.endsWith('/body')).children, []);
      assert.equal(JSON.stringify(config.connections).includes('reader'), false);
    }
  }
});

test('suite version resources keep one product/version and distinct executable descriptions', () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  for (const { processName } of applications) {
    const resource = suiteVersionResource(version, processName);
    assert.equal(resource.readUInt16LE(0), resource.length);
    assert.ok(resource.includes(Buffer.from(`${processName}.exe\0`, 'utf16le')));
    assert.ok(resource.includes(Buffer.from(`Yuzread\0`, 'utf16le')));
    assert.ok(resource.includes(Buffer.from(`${version}\0`, 'utf16le')));
  }
  assert.throws(() => suiteVersionResource('invalid', 'yuzread-reader'));
  assert.throws(() => suiteVersionResource('65536.0.0', 'yuzread-reader'));
  assert.throws(() => suiteVersionResource('0.1.0', '../electron'));
});

test('native ICO directory contains all nine sizes with valid offsets', () => {
  const icons = Array.from({ length: 9 }, (_, index) => Buffer.alloc(index + 1));
  const ico = encodeSuiteIcon(icons);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 9);
  for (let index = 0; index < 9; index++) {
    const entry = 6 + index * 16;
    const length = ico.readUInt32LE(entry + 8),
      offset = ico.readUInt32LE(entry + 12);
    assert.equal(length, icons[index].length);
    assert.deepEqual(ico.subarray(offset, offset + length), icons[index]);
  }
  assert.throws(() => encodeSuiteIcon([]));
});

test('sibling appearance uses full-window workspaces, hover-only captions and matching native colors', () => {
  for (const [id, background] of [
    ['library', '#240f18'],
    ['downloader', '#0b1730'],
  ]) {
    const application = applications.find((candidate) => candidate.id === id);
    const config = loadSuiteScreenConfiguration(root, application);
    const caption = config.areas.find(({ folder }) => folder.endsWith('/windows-area'));
    const body = config.areas.find(({ folder }) => folder.endsWith('/body'));
    const native = JSON.parse(fs.readFileSync(path.join(root, application.windowConfig), 'utf8'));
    assert.equal(caption.enabled, true);
    assert.equal(caption.draggable, true);
    assert.equal(caption.overlay, true);
    assert.equal(caption.hoverPreset, 'titleBar');
    assert.equal(caption.preset, 'base');
    assert.equal(
      caption.children.find(({ componentId }) => componentId === `${id}.title`).enabled,
      false,
    );
    assert.deepEqual(body.bounds, { x: 0, y: 0, width: 100, height: 100 });
    assert.equal(config.presets.workspace.colors.background, background);
    assert.equal(native.background, background);
  }
});

test('Reader icon is standalone artwork, independent of the shared suite image', async () => {
  const temporary = path.join(root, '.agents-temp');
  fs.mkdirSync(temporary, { recursive: true });
  const fixture = fs.mkdtempSync(path.join(temporary, 'reader-icon-'));
  try {
    const assets = path.join(fixture, 'electron/assets');
    fs.mkdirSync(assets, { recursive: true });
    const reader = applications.find(({ id }) => id === 'reader');
    const source = path.join(assets, 'app-icon.png');
    const first = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(source, first);
    await createSuiteIcons(fixture, [reader]);
    const iconPath = path.join(assets, 'yuzread-reader.png');
    const independent = fs.readFileSync(iconPath);
    assert.deepEqual(fs.readFileSync(source), first, 'source artwork must never be rewritten');
    const second = await sharp({
      create: { width: 512, height: 512, channels: 4, background: '#00ff00' },
    })
      .png()
      .toBuffer();
    fs.writeFileSync(source, second);
    await createSuiteIcons(fixture, [reader]);
    assert.deepEqual(
      fs.readFileSync(iconPath),
      independent,
      'Reader must not inherit the suite image or a suite-image badge',
    );
    const { data, info } = await sharp(independent)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 512);
    assert.equal(info.height, 512);
    assert.equal(data[3], 0, 'native icon corners remain transparent');
    const ico = fs.readFileSync(path.join(assets, 'yuzread-reader.ico'));
    assert.equal(ico.readUInt16LE(4), 9);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    if (!fs.readdirSync(temporary).length) fs.rmdirSync(temporary);
  }
});
