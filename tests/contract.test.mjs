import assert from 'node:assert/strict';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveVisuals, validBounds } from '../screen/shared/logic/VisualConfig.ts';
import { discoverAreas } from '../screen/shared/logic/AreaDiscovery.ts';
import { validateScreenConfig, resolveChildren } from '../screen/shared/logic/ConfigValidation.ts';
import { createDiagnostics } from '../screen/shared/logic/Diagnostics.ts';
import {
  contract,
  createRequest,
  createState,
  parentBinding,
  connectParents,
  connectionProblems,
  retireParents,
} from '../screen/shared/logic/ParentConnections.ts';
import * as WindowsArea from '../screen/reader/windows-area/WindowsArea.tsx';
import * as Body from '../screen/reader/body/Body.tsx';
import * as ActionBar from '../screen/reader/action-bar/ActionBar.tsx';
import * as BottomBar from '../screen/reader/bottom-bar/BottomBar.tsx';
import * as Navigation from '../screen/reader/bottom-bar/BottomBarChapterNavigation.tsx';
import * as Status from '../screen/reader/bottom-bar/BottomBarStatus.tsx';
import * as Load from '../screen/reader/windows-area/WindowsAreaBtnLoad.tsx';
import * as Speed from '../screen/reader/windows-area/WindowsAreaBtnScrollSpeed.tsx';
import * as SettingScreen from '../screen/reader/windows-area/WindowsAreaBtnSettingScreen.tsx';
import * as SmoothSection from '../screen/reader/windows-area/setting-screen/WindowsAreaBtnSettingScreenSectionSmoothScroll.tsx';
import { discoverSettingSections } from '../screen/reader/windows-area/setting-screen/WindowsAreaBtnSettingScreenSections.ts';
import * as Close from '../screen/reader/windows-area/WindowsAreaBtnClose.tsx';
import * as DefaultSize from '../screen/reader/windows-area/WindowsAreaBtnDefaultSize.tsx';
import * as Title from '../screen/reader/windows-area/WindowsAreaTitle.tsx';
import * as Reader from '../screen/reader/body/reader/BodyReader.tsx';
import {
  advanceMomentum,
  momentumImpulse,
  advanceRenderDeadline,
  tileInViewport,
  horizontalRenderSpan,
  tileWorkNeeded,
  createWheelGesture,
  appendWheelTick,
  advanceWheelGesture,
  scaleWheelGesture,
  scaleWheelDuration,
} from '../screen/reader/body/reader/BodyReaderPixiWorkerPolicy.ts';
const require = createRequire(import.meta.url),
  { validateWindowConfig } = require('../electron-built/WindowConfig.cjs'),
  { createReaderPreferences } = require('../electron-built/reader/ReaderPreferences.cjs');
const source = {
  ...JSON.parse(await readFile(new URL('../screen/config.json', import.meta.url), 'utf8')),
  window: JSON.parse(await readFile(new URL('../electron/config.json', import.meta.url), 'utf8')),
};
const diagnostics = () => createDiagnostics(async () => ({ ok: true }));
const runtimeModule = (module) => module['module.exports'] ?? module;
const modules = {
  './reader/windows-area/WindowsArea.tsx': WindowsArea,
  './reader/windows-area/WindowsAreaBtnSettingScreen.tsx': SettingScreen,
  './reader/windows-area/WindowsAreaBtnScrollSpeed.tsx': Speed,
  './reader/windows-area/WindowsAreaBtnLoad.tsx': Load,
  './reader/windows-area/WindowsAreaBtnClose.tsx': Close,
  './reader/windows-area/WindowsAreaBtnDefaultSize.tsx': DefaultSize,
  './reader/windows-area/WindowsAreaTitle.tsx': Title,
  './reader/body/Body.tsx': Body,
  './reader/body/reader/BodyReader.tsx': Reader,
  './reader/action-bar/ActionBar.tsx': ActionBar,
  './reader/bottom-bar/BottomBar.tsx': BottomBar,
  './reader/bottom-bar/BottomBarChapterNavigation.tsx': Navigation,
  './reader/bottom-bar/BottomBarStatus.tsx': Status,
};
const catalogSink = diagnostics();
const catalog = await discoverAreas(
  Object.fromEntries(
    Object.entries(modules).map(([fileName, module]) => [
      fileName,
      async () => runtimeModule(module),
    ]),
  ),
  catalogSink,
);
assert.deepEqual(catalogSink.getSnapshot(), []);
const empty = { endpoints: {}, settle: async () => {}, dispose() {} };
// Native fixture reuses actual root port contracts, not fabricated permissive codecs.
const providers = validateScreenConfig(
  { ...source, connections: [] },
  catalog,
  diagnostics(),
  empty,
).areas;
const windows = providers.find((area) => area.config.id === 'windowsBar'),
  body = providers.find((area) => area.config.id === 'body'),
  bottom = providers.find((area) => area.config.id === 'bottomBar');
const native = {
  ...empty,
  endpoints: {
    windowAction: windows.endpoints.action,
    windowState: windows.endpoints.windowState,
    title: windows.endpoints.title,
    archiveOpen: body.endpoints.archiveOpen,
    dropOpen: body.endpoints.dropOpen,
    chapterOpen: body.endpoints.chapterOpen,
    prepare: body.endpoints.prepare,
    release: body.endpoints.release,
    readerMetrics: body.endpoints.readerMetrics,
    renderReserve: body.endpoints.renderReserve,
    readerPreferences: body.endpoints.readerPreferences,
    saveReaderPreference: body.endpoints.saveReaderPreference,
    issues: bottom.endpoints.issues,
    labels: bottom.endpoints.labels,
  },
};
function inspect(config = structuredClone(source), entries = catalog) {
  const sink = diagnostics();
  return { plan: validateScreenConfig(config, entries, sink, native), diagnostics: sink };
}
const area = (config, id) => config.areas.find((node) => node.id === id);
const group = (config) =>
  area(config, 'windowsBar').children.find((node) => node.id === 'windowControls');
const definitions = [
  ['WindowsAreaBtnSettingScreen.tsx', SettingScreen],
  ['WindowsAreaBtnLoad.tsx', Load],
  ['WindowsAreaBtnScrollSpeed.tsx', Speed],
  ['WindowsAreaBtnClose.tsx', Close],
  ['WindowsAreaBtnDefaultSize.tsx', DefaultSize],
  ['reader/BodyReader.tsx', Reader],
  ['BottomBarChapterNavigation.tsx', Navigation],
].map(([fileName, module]) => ({ ...module.child, fileName }));
const nodes = (config, id) => {
  const bound = inspect(config).plan.areas.find((node) => node.config.id === id);
  return resolveChildren(
    bound.config.children,
    definitions,
    bound.config,
    config.presets,
    diagnostics(),
  );
};

test('schema and real area roots preserve enabled area ownership', () => {
  const { plan, diagnostics } = inspect();
  assert.deepEqual(diagnostics.getSnapshot(), []);
  assert.deepEqual(
    plan.areas.map((a) => a.config.id),
    ['windowsBar', 'body', 'bottomBar'],
  );
  assert.equal(plan.connections.length, 22);
  assert.equal(plan.areas[0].config.parentName, 'WindowsArea');
});
test('setting screen config validates icons, header parts and dimensions without moving existing controls', () => {
  const config = nodes(source, 'windowsBar').find(
    (node) => node.config?.id === 'settingScreen',
  ).config;
  assert.equal(
    SettingScreen.validateConfig(config, () => {}),
    true,
  );
  assert.equal(config.icon, 'settings');
  assert.deepEqual(config.order, ['title', 'close']);
  assert.equal(config.bounds.x, 0.75);
  assert.ok(
    Array.isArray(config.sections) && config.sections.length > 0,
    'setting screen needs at least one section card',
  );
  assert.ok(
    config.sections.every(
      (section) =>
        typeof section.id === 'string' &&
        typeof section.componentId === 'string' &&
        typeof section.label === 'string' &&
        typeof section.expanded === 'boolean',
    ),
  );
  for (const patch of [
    { icon: 'unknown' },
    { closeIcon: 'unknown' },
    { order: ['title', 'title'] },
    { gap: 90 },
    { popup: { ...config.popup, height: 30 } },
    { labels: { ...config.labels, title: '' } },
    {
      sections: [
        { id: 'same', componentId: 'settings.one', label: 'A', expanded: true },
        { id: 'same', componentId: 'settings.two', label: 'B', expanded: false },
      ],
    },
    {
      sections: [{ id: 'bad id', componentId: 'settings.bad', label: 'A', expanded: true }],
    },
    { sections: 'not-a-list' },
  ])
    assert.equal(
      SettingScreen.validateConfig({ ...config, ...patch }, () => {}),
      false,
    );
  const bar = area(source, 'windowsBar');
  assert.equal(bar.children.find((child) => child.id === 'readerScrollSpeed').bounds.x, 80.25);
  assert.equal(bar.children.find((child) => child.id === 'readerOpen').bounds.x, 85);
  assert.equal(group(source).bounds.x, 89.75);
});
test('setting screen sections self-declare shared-card bodies without duplicate identities', () => {
  const sections = discoverSettingSections({ SmoothSection });
  assert.deepEqual([...sections.keys()], ['reader.smoothScroll']);
  const config = nodes(source, 'windowsBar').find(
    (node) => node.config?.id === 'settingScreen',
  ).config;
  for (const section of config.sections)
    assert.equal(
      sections.get(section.componentId).validate(section, () => {}),
      true,
    );
  assert.throws(() => discoverSettingSections({ SmoothSection, copy: SmoothSection }));
});
test('setting screen retained position clamps only to the available viewport', () => {
  assert.deepEqual(
    SettingScreen.clampSettingScreenPosition({ x: 80, y: 120 }, 440, 320, 900, 700),
    { x: 80, y: 120 },
  );
  assert.deepEqual(
    SettingScreen.clampSettingScreenPosition({ x: 1000, y: -50 }, 440, 320, 900, 700),
    { x: 460, y: 0 },
  );
  assert.deepEqual(
    SettingScreen.clampSettingScreenPosition({ x: 80, y: 120 }, 440, 320, 300, 200),
    { x: 0, y: 0 },
  );
});
test('reader preferences persist only validated overrides and Reset restores configured defaults', async () => {
  const directory = fileURLToPath(
    new URL(`../.agents-temp/reader-preferences-${process.pid}`, import.meta.url),
  );
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  const config = {
    controls: [
      {
        preference: {
          id: 'scrollSpeed',
          kind: 'number',
          default: 10,
          min: 10,
          max: 100,
          step: 1,
        },
      },
      {
        preference: {
          id: 'smoothScrollDurationMs',
          kind: 'number',
          default: 250,
          min: 100,
          max: 2000,
          step: 10,
        },
      },
    ],
  };
  try {
    const preferences = createReaderPreferences(directory, config);
    assert.deepEqual(preferences.snapshot().values, {
      scrollSpeed: 10,
      smoothScrollDurationMs: 250,
    });
    assert.deepEqual(await preferences.update({ id: 'scrollSpeed', value: 37.4 }), { ok: true });
    assert.deepEqual(await preferences.update({ id: 'smoothScrollDurationMs', value: 604 }), {
      ok: true,
    });
    assert.deepEqual(await preferences.update({ id: 'scrollSpeed', value: null }), { ok: true });
    await preferences.flush();
    assert.deepEqual(
      JSON.parse(await readFile(`${directory}/reader-preferences.json`, 'utf8')).values,
      { smoothScrollDurationMs: 600 },
    );
    const restored = createReaderPreferences(directory, config);
    assert.deepEqual(restored.snapshot().values, {
      scrollSpeed: 10,
      smoothScrollDurationMs: 600,
    });
    assert.equal((await restored.update({ id: 'unknown', value: 1 })).ok, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test('load folder settings stay owned by the Load child and validate optional fields', () => {
  const config = nodes(source, 'windowsBar').find(
    (node) => node.config?.id === 'readerOpen',
  ).config;
  assert.equal(
    Load.validateConfig({ ...config, folderPath: 'D:/Manga', rememberFolder: true }, () => {}),
    true,
  );
  for (const patch of [{ folderPath: 123 }, { folderPath: 'bad\0path' }, { rememberFolder: 'yes' }])
    assert.equal(
      Load.validateConfig({ ...config, ...patch }, () => {}),
      false,
    );
});
test('load activation forwards its configured folder and remember policy', async () => {
  const config = nodes(source, 'windowsBar').find(
    (node) => node.config?.id === 'readerOpen',
  ).config;
  let request;
  const component = typeof Load.default === 'function' ? Load.default : Load.default.default;
  const button = component({
    config: { ...config, folderPath: 'D:/Manga', rememberFolder: false },
    input: {
      reader: { phase: '', total: 0 },
      requestOpen: async (value) => {
        request = value;
        return { ok: true, canceled: true };
      },
      report: () => {},
    },
  });
  await button.props.onClick();
  assert.deepEqual(request.picker, { folderPath: 'D:/Manga', rememberFolder: false });
  assert.equal(request.componentId, 'reader.open');
});
test('row retains two independent child contracts and original part geometry', () => {
  const row = nodes(source, 'windowsBar').find((node) => node.kind === 'row');
  assert.deepEqual(row.config.order, ['maximize', 'close']);
  assert.deepEqual(
    row.children.map((node) => node.config.componentId),
    ['window.defaultSize', 'window.close'],
  );
  assert.equal(row.config.parts.close.visual.states.hover.colors.background, '#b82c40');
  assert.equal(row.config.parts.maximize.size.width, 48.648648);
});
test('shared preset changes both row children without changing body', () => {
  const config = structuredClone(source);
  config.presets.captionButton.colors = { background: '#234567' };
  const row = nodes(config, 'windowsBar').find((node) => node.kind === 'row');
  for (const part of Object.values(row.config.parts))
    assert.equal(part.visual.colors.background, '#234567');
  assert.equal(
    inspect(config).plan.areas.find((a) => a.config.id === 'body').config.visual.colors.background,
    '#0f131a',
  );
});
test('malformed child or row overflow rejects only the configured group', () => {
  for (const change of [
    (config) => (group(config).children[1].colors = { background: 'invalid' }),
    (config) => (group(config).gap = 50),
    (config) => (group(config).children[1].action = 'unsupported'),
    (config) => (group(config).children[1].size.width = 101),
    (config) => group(config).children.pop(),
  ]) {
    const config = structuredClone(source);
    change(config);
    const accepted = nodes(config, 'windowsBar');
    assert.equal(
      accepted.some((node) => node.kind === 'row'),
      false,
    );
    assert.equal(
      accepted.some((node) => node.config.id === 'readerOpen'),
      true,
    );
    assert.ok(inspect(config).plan.areas.some((a) => a.config.id === 'body'));
  }
});
test('duplicate area roots reject every conflict regardless of catalog order', () => {
  const windowsRoot = catalog.find((entry) => entry.areaId === 'windowsBar');
  assert.ok(windowsRoot);
  const bad = {
    ...windowsRoot,
    valid: false,
    bind: null,
    filePath: 'reader/windows-area/Conflict.tsx',
  };
  for (const entries of [
    [bad, ...catalog],
    [...catalog, bad],
  ])
    assert.equal(
      inspect(structuredClone(source), entries).plan.areas.some(
        (a) => a.config.id === 'windowsBar',
      ),
      false,
    );
});
test('duplicate child IDs remain invalid even when the duplicate is disabled', () => {
  const config = structuredClone(source),
    windows = area(config, 'windowsBar');
  windows.children.push({
    ...structuredClone(windows.children.find((c) => c.id === 'readerOpen')),
    enabled: false,
  });
  assert.equal(
    nodes(config, 'windowsBar').some((node) => node.config.id === 'readerOpen'),
    false,
  );
});
test('disabled absent area/child modules do not mount or diagnose missing implementations', () => {
  const config = structuredClone(source);
  area(config, 'windowsBar').children.find((c) => c.id === 'appTitle').componentId =
    'not.installed';
  const { diagnostics } = inspect(
    config,
    catalog.filter((a) => a.areaId !== 'actionBar'),
  );
  assert.deepEqual(diagnostics.getSnapshot(), []);
});
test('wrong folder ownership and child filename prefixes are rejected', () => {
  const entries = catalog.map((entry) =>
    entry.areaId === 'body' ? { ...entry, folder: 'windows-area' } : entry,
  );
  assert.equal(
    inspect(structuredClone(source), entries).plan.areas.some((a) => a.config.id === 'body'),
    false,
  );
  const bound = inspect().plan.areas.find((a) => a.config.id === 'body');
  const sink = diagnostics();
  const accepted = resolveChildren(
    bound.config.children,
    definitions.map((d) =>
      d.componentId === 'reader.cbz' ? { ...d, fileName: 'reader/Wrong.tsx' } : d,
    ),
    bound.config,
    source.presets,
    sink,
  );
  assert.equal(accepted.length, 0);
  assert.ok(sink.getSnapshot().some((issue) => issue.code === 'CHILD_NAME_MISMATCH'));
});
test('a child can live in a named parent subfolder without a top-level registry edit', () => {
  const bound = inspect().plan.areas.find((a) => a.config.id === 'body'),
    sink = diagnostics();
  const result = resolveChildren(
    bound.config.children,
    definitions.map((d) =>
      d.componentId === 'reader.cbz' ? { ...d, fileName: 'reader/renamed/BodyReader.tsx' } : d,
    ),
    bound.config,
    source.presets,
    sink,
  );
  assert.equal(result[0].config.filePath, 'reader/body/reader/renamed/BodyReader.tsx');
  assert.deepEqual(sink.getSnapshot(), []);
});
test('discovery loads root metadata, ignores leaves, and retains invalid identities', async () => {
  const sink = diagnostics();
  const result = await discoverAreas(
    {
      './reader/windows-area/WindowsArea.tsx': async () => runtimeModule(WindowsArea),
      './reader/windows-area/WindowsAreaBtnLoad.tsx': async () => runtimeModule(Load),
      './bad/Bad.tsx': async () => ({ areaId: 'windowsBar', parentName: 'Bad' }),
      './failed/Failed.tsx': async () => {
        throw new Error('fixture failure');
      },
    },
    sink,
  );
  assert.equal(result.length, 2);
  assert.equal(result.filter((entry) => entry.areaId === 'windowsBar').length, 2);
  assert.ok(result.some((entry) => entry.valid === false));
  assert.ok(sink.getSnapshot().some((issue) => issue.code === 'AREA_LOAD_FAILED'));
});
test('native settings, bounds and circular presets still reject invalid inputs', () => {
  assert.deepEqual(validateWindowConfig(source.window), source.window);
  assert.throws(() => validateWindowConfig({ ...source.window, width: 0 }));
  assert.equal(validBounds({ x: 0, y: 0, width: 101, height: 100 }), false);
  assert.throws(
    () => resolveVisuals({ preset: 'a' }, { a: { preset: 'b' }, b: { preset: 'a' } }),
    /Circular/,
  );
});
const string = contract('fixture.string', (value) => typeof value === 'string');
test('parent forwarding preserves typed requests and state without sibling references', async () => {
  const source = createRequest(string, string, 'unavailable'),
    target = createRequest(string, string, 'unavailable'),
    out = createState(string, 'initial'),
    input = createState(string, '');
  target.register((value) => 'handled ' + value);
  const bindings = new Map([
    ['source', parentBinding({ request: source, state: out })],
    ['target', parentBinding({ request: target, state: input })],
  ]);
  const disconnect = connectParents(
    [
      { from: { area: 'source', port: 'request' }, to: { area: 'target', port: 'request' } },
      { from: { area: 'source', port: 'state' }, to: { area: 'target', port: 'state' } },
    ],
    bindings,
  );
  assert.equal(await source.request('message'), 'handled message');
  assert.equal(input.getSnapshot(), 'initial');
  out.publish('next');
  assert.equal(input.getSnapshot(), 'next');
  disconnect();
  assert.equal(await source.request('message'), 'unavailable');
  out.publish('disconnected');
  assert.equal(input.getSnapshot(), 'next');
});
test('registration cleanup cannot clear a newer child and disposed targets are unavailable', async () => {
  const port = createRequest(string, string, 'unavailable');
  const old = port.register(() => 'old');
  port.register(() => 'new');
  old();
  assert.equal(await port.request('x'), 'new');
  port.dispose();
  assert.equal(await port.request('x'), 'unavailable');
});
test('parent retirement drains in-flight requests before detaching cleanup routes', async () => {
  const source = createRequest(string, string, 'unavailable'),
    target = createRequest(string, string, 'unavailable');
  let finish;
  target.register(() => new Promise((resolve) => (finish = resolve)));
  const bindings = new Map([
    ['source', parentBinding({ request: source })],
    ['target', parentBinding({ request: target })],
  ]);
  const disconnect = connectParents(
    [{ from: { area: 'source', port: 'request' }, to: { area: 'target', port: 'request' } }],
    bindings,
  );
  const request = source.request('pending');
  const retiring = retireParents([...bindings.values()], disconnect);
  finish('completed');
  assert.equal(await request, 'completed');
  await retiring;
  assert.equal(await source.request('late'), 'unavailable');
});
test('duplicate providers and circular parent forwarding are rejected, not first-wins', () => {
  const a = parentBinding({ request: createRequest(string, string, 'missing') }),
    b = parentBinding({ request: createRequest(string, string, 'missing') });
  const parents = new Map([
      ['a', a],
      ['b', b],
    ]),
    edge = { from: { area: 'a', port: 'request' }, to: { area: 'b', port: 'request' } };
  assert.equal(connectionProblems([edge, edge], parents).size, 2);
  const cycle = [edge, { from: edge.to, to: edge.from }];
  assert.equal(connectionProblems(cycle, parents).size, 2);
  assert.throws(() => connectParents(cycle, parents), /cyclic/);
});
test('diagnostics still deduplicate structured issue records', async () => {
  const sink = diagnostics(),
    issue = { code: 'TEST', expected: 'valid', actual: 'invalid' };
  sink.report(issue);
  sink.report(issue);
  assert.equal(sink.getSnapshot().length, 1);
  assert.equal(sink.getSnapshot()[0].count, 2);
  await sink.flush();
});
test('phase2 prepared-page acceptance rejects identity/revision/width mismatches', () => {
  const page = {
    id: 'page-id',
    index: 0,
    name: 'page',
    width: 1600,
    height: 2000,
    targetWidth: 400,
    targetHeight: 500,
  };
  const chapter = {
    id: 'chapter-id',
    sourceRevision: 'revision',
    name: 'chapter',
    pages: [page],
    estimatedBytes: 800000,
  };
  const result = {
    ok: true,
    id: chapter.id,
    index: page.index,
    pageId: page.id,
    sourceRevision: chapter.sourceRevision,
    requestedWidth: 800,
    width: 800,
    height: 1000,
    url: 'yuzread-page://page/token/0-800.png',
  };
  assert.equal(Reader.acceptsPreparedPage(chapter, page, 800, result), true);
  for (const patch of [
    { id: 'other' },
    { pageId: 'other' },
    { sourceRevision: 'old' },
    { index: 1 },
    { requestedWidth: 700 },
    { width: 1600 },
    { height: 2000 },
  ])
    assert.equal(Reader.acceptsPreparedPage(chapter, page, 800, { ...result, ...patch }), false);
});
test('phase2 equal or lower-quality completions retain the accepted surface', () => {
  assert.equal(Reader.retainsAcceptedWidth(undefined, 400), false);
  assert.equal(Reader.retainsAcceptedWidth(800, 400), true);
  assert.equal(Reader.retainsAcceptedWidth(800, 800), true);
  assert.equal(Reader.retainsAcceptedWidth(800, 1200), false);
});
test('phase3 zoom normalizes configured steps around an exact 100% reset', () => {
  assert.equal(Reader.normalizeZoom(1, 0.5, 3, 0.3), 1);
  assert.equal(Reader.normalizeZoom(1.31, 0.5, 3, 0.3), 1.3);
  assert.equal(Reader.normalizeZoom(0.69, 0.5, 3, 0.3), 0.7);
  assert.equal(Reader.normalizeZoom(100, 0.5, 3, 0.1), 3);
  assert.equal(Reader.normalizeZoom(-100, 0.5, 3, 0.1), 0.5);
  assert.equal(Reader.normalizeZoom(NaN, 0.5, 3, 0.1), 1);
  let value = 1;
  for (let i = 0; i < 7; i++) value = Reader.normalizeZoom(value + 0.1, 0.5, 3, 0.1);
  assert.equal(value, 1.7);
  for (let i = 0; i < 7; i++) value = Reader.normalizeZoom(value - 0.1, 0.5, 3, 0.1);
  assert.equal(value, 1);
});
test('phase4 catalog acceptance rejects crossed IDs, names and page order', () => {
  const list = { id: 'catalog', chapters: [{ id: 'entry', name: 'chapter2.cbz' }] },
    chapter = {
      id: 'session',
      catalogId: 'catalog',
      entryId: 'entry',
      name: 'chapter2.cbz',
      sourceRevision: 'revision',
      pages: [{ index: 0 }],
      estimatedBytes: 0,
    };
  assert.equal(Reader.acceptsCatalogChapter(list, 'entry', chapter), true);
  for (const patch of [
    { catalogId: 'other' },
    { entryId: 'other' },
    { name: 'chapter10.cbz' },
    { pages: [] },
    { pages: [{ index: 1 }] },
  ])
    assert.equal(Reader.acceptsCatalogChapter(list, 'entry', { ...chapter, ...patch }), false);
});
test('phase4 native chapter order is natural and deterministic', () => {
  const { compareChapterNames } = require('../electron-built/reader/CbzArchive.cjs');
  assert.deepEqual(['chapter10.cbz', 'chapter2.CBZ', 'chapter1.cbz'].sort(compareChapterNames), [
    'chapter1.cbz',
    'chapter2.CBZ',
    'chapter10.cbz',
  ]);
  assert.equal(Math.sign(compareChapterNames('chapter2.cbz', 'Chapter2.cbz')), 1);
});
test('phase5 native queue finishes one active page then selects demand before visible/background', async () => {
  const { createReaderScheduler } = require('../electron-built/reader/CbzArchive.cjs'),
    queue = createReaderScheduler(3),
    events = [];
  let finish;
  const gate = new Promise((resolve) => (finish = resolve));
  const active = queue.run('active', 'a', 'background', async () => {
    events.push('active');
    await gate;
    events.push('finished');
  });
  await new Promise(setImmediate);
  const background = queue.run('next', 'n', 'background', async () => events.push('next')),
    visible = queue.run('current', 'c', 'visible', async () => events.push('visible')),
    demand = queue.run('back', 'b', 'demand', async () => events.push('demand'));
  assert.deepEqual(queue.snapshot(), { activeJobs: 1, queuedJobs: 3 });
  await assert.rejects(
    queue.run('overflow', 'x', 'demand', async () => {}),
    /queue is full/,
  );
  finish();
  await Promise.all([active, background, visible, demand]);
  await new Promise(setImmediate);
  assert.deepEqual(events, ['active', 'finished', 'demand', 'visible', 'next']);
  assert.deepEqual(queue.snapshot(), { activeJobs: 0, queuedJobs: 0 });
  queue.dispose();
});
test('phase5 native queue promotes queued work and cancels owners without interrupting an active page', async () => {
  const { createReaderScheduler } = require('../electron-built/reader/CbzArchive.cjs'),
    queue = createReaderScheduler(),
    events = [];
  const background = queue.run('upgrade', 'n', 'background', async () => events.push('upgraded')),
    visible = queue.run('current', 'c', 'visible', async () => events.push('visible'));
  queue.promote('upgrade', 'demand');
  await Promise.all([background, visible]);
  await new Promise(setImmediate);
  assert.deepEqual(events, ['upgraded', 'visible']);
  let finish;
  const gate = new Promise((resolve) => (finish = resolve));
  const active = queue.run('active', 'same', 'background', async () => {
    events.push('active');
    await gate;
    events.push('finished');
  });
  await new Promise(setImmediate);
  const queued = queue.run('cancel', 'same', 'demand', async () => events.push('wrong'));
  const rejection = assert.rejects(queued, /owner released/);
  queue.cancel('same');
  await rejection;
  assert.equal(queue.snapshot().activeJobs, 1);
  finish();
  await active;
  await new Promise(setImmediate);
  assert.equal(events.includes('wrong'), false);
  queue.dispose();
  await assert.rejects(
    queue.run('late', 'x', 'visible', async () => {}),
    /closed/,
  );
});
test('phase5 page-offset lookup locates demanded history pages without changing natural DOM order', () => {
  for (const [point, index] of [
    [-50, 0],
    [0, 0],
    [99, 0],
    [100, 1],
    [249, 1],
    [250, 2],
    [10000, 2],
  ])
    assert.equal(Reader.pageAtOffset([0, 100, 250], point), index);
});
test('momentum ramps in, coasts and settles with comparable travel at 60/120/165 Hz', () => {
  const distances = [];
  for (const hz of [60, 120, 165]) {
    let velocity = 0,
      target = momentumImpulse(120),
      distance = 0;
    for (let n = 0; n < hz * 3; n++) {
      const step = advanceMomentum(velocity, target, 1 / hz);
      velocity = step.velocity;
      target = step.target;
      distance += step.distance;
      if (!step.moving) break;
    }
    assert.equal(velocity, 0);
    assert.equal(target, 0);
    assert.ok(distance > 175 && distance < 181);
    distances.push(distance);
  }
  assert.ok(Math.max(...distances) - Math.min(...distances) < 0.15);
  const first = advanceMomentum(0, momentumImpulse(120), 1 / 165);
  assert.ok(first.velocity > 0 && first.velocity < momentumImpulse(120));
});
test('momentum handles reversed input and rejects unbounded/non-finite speed', () => {
  assert.equal(momentumImpulse(NaN), 0);
  assert.equal(momentumImpulse(1e9), 9000);
  const step = advanceMomentum(0, momentumImpulse(-120), 1 / 60);
  assert.ok(step.distance < 0 && step.velocity < 0);
  assert.deepEqual(advanceMomentum(NaN, NaN, NaN), {
    distance: 0,
    velocity: 0,
    target: 0,
    moving: false,
  });
});
test('wheel gesture starts immediately, joins same-direction ticks inside 150 ms and retains velocity', () => {
  const first = appendWheelTick(createWheelGesture(), 120, 0, 1, 150, 250);
  const started = advanceWheelGesture(first, 0.006, 6, 1, 150, 250);
  assert.ok(started.distance > 0);
  assert.ok(started.state.velocity > 0);
  const joined = appendWheelTick(started.state, 120, 100, 1, 150, 250);
  assert.equal(joined.velocity, started.state.velocity);
  assert.ok(joined.rate > first.rate);
  assert.equal(appendWheelTick(first, 120, 150, 1, 150, 250).rate, 960);
  assert.equal(appendWheelTick(first, 120, 151, 1, 150, 250).rate, first.rate);
  const config = nodes(source, 'body').find((node) => node.config?.id === 'reader').config;
  assert.equal(
    Reader.validateConfig({ ...config, momentum: { enabled: true, tickWindowMs: 150 } }, () => {}),
    true,
  );
  for (const value of [0, 49, 301, 150.5, '150'])
    assert.equal(
      Reader.validateConfig(
        { ...config, momentum: { enabled: true, tickWindowMs: value } },
        () => {},
      ),
      false,
    );
});
test('wheel gesture preserves isolated/stream travel and suppresses the old per-notch velocity ripple', () => {
  const totals = [];
  for (const hz of [60, 120, 165]) {
    let state = createWheelGesture(),
      velocity = 0,
      target = 0,
      position = 0,
      index = 0;
    const modern = [],
      legacy = [];
    for (let n = 0; n < hz * 5; n++) {
      const time = (n * 1000) / hz;
      while (index < 20 && index * 100 <= time + 1e-8) {
        state = appendWheelTick(state, 120, index * 100, 1, 150, 250);
        target += momentumImpulse(120);
        index++;
      }
      const next = advanceWheelGesture(state, 1 / hz, ((n + 1) * 1000) / hz, 1, 150, 250);
      state = next.state;
      position += next.distance;
      const old = advanceMomentum(velocity, target, 1 / hz);
      velocity = old.velocity;
      target = old.target;
      if (time >= 1000 && time < 1800) {
        modern.push(state.velocity);
        legacy.push(velocity);
      }
    }
    const ripple = (a) =>
      (Math.max(...a) - Math.min(...a)) / (a.reduce((sum, value) => sum + value, 0) / a.length);
    assert.ok(
      ripple(modern) < 0.05 && ripple(modern) < ripple(legacy) / 4,
      'joined ticks must not retain the old sawtooth acceleration',
    );
    assert.ok(position > 3598 && position <= 3600);
    assert.deepEqual(state, createWheelGesture());
    totals.push(position);
    let single = appendWheelTick(createWheelGesture(), 120, 0, 1, 150, 250),
      travel = 0;
    for (let n = 0; n < hz * 3; n++) {
      const next = advanceWheelGesture(single, 1 / hz, ((n + 1) * 1000) / hz, 1, 150, 250);
      single = next.state;
      travel += next.distance;
    }
    assert.ok(travel > 178 && travel <= 180);
    assert.deepEqual(single, createWheelGesture());
  }
  assert.ok(Math.max(...totals) - Math.min(...totals) < 0.1);
});
test('wheel gesture discards old-direction credit, reverses promptly and scales active speed without a jump', () => {
  let state = appendWheelTick(createWheelGesture(), 120, 0, 1, 150, 250);
  for (let n = 0; n < 16; n++)
    state = advanceWheelGesture(state, 0.006, (n + 1) * 6, 1, 150, 250).state;
  const reversed = appendWheelTick(state, -120, 100, 1, 150, 250);
  assert.equal(reversed.remaining, -180);
  assert.equal(reversed.velocity, state.velocity);
  let back = reversed;
  for (let n = 0; n < 20; n++)
    back = advanceWheelGesture(back, 0.006, 106 + n * 6, 1, 150, 250).state;
  assert.ok(back.velocity < 0, 'opposing ticks must not wait for old coasting to finish');
  const normal = advanceWheelGesture(state, 0.006, 102, 1, 150, 250),
    fast = advanceWheelGesture(scaleWheelGesture(state, 10, 10, 250), 0.006, 102, 10, 150, 250);
  assert.ok(Math.abs(fast.distance - normal.distance * 10) < 1e-8);
  assert.ok(Math.abs(fast.state.velocity - normal.state.velocity * 10) < 1e-8);
  assert.equal(appendWheelTick(state, NaN, 100, 1, 150, 250), state);
  assert.equal(appendWheelTick(state, 120, NaN, 1, 150, 250), state);
  const slower = scaleWheelDuration(state, 250, 2000, 1);
  assert.equal(slower.remaining, state.remaining);
  assert.ok(Math.abs(slower.velocity) < Math.abs(state.velocity));
});
test('smooth-scroll duration changes delivery time without changing wheel distance', () => {
  const run = (durationMs) => {
    let state = appendWheelTick(createWheelGesture(), 120, 0, 1, 150, durationMs),
      distance = 0,
      early = 0;
    for (let frame = 1; frame <= 2400; frame++) {
      const next = advanceWheelGesture(state, 1 / 120, (frame * 1000) / 120, 1, 150, durationMs);
      state = next.state;
      distance += next.distance;
      if (frame === 24) early = distance;
      if (!next.moving) break;
    }
    return { distance, early, state };
  };
  const quick = run(100),
    soft = run(2000);
  assert.ok(quick.early > soft.early * 4);
  assert.ok(quick.distance > 178 && quick.distance <= 180);
  assert.ok(soft.distance > 178 && soft.distance <= 180);
  assert.deepEqual(quick.state, createWheelGesture());
  assert.deepEqual(soft.state, createWheelGesture());
});
test('speed control clamps configured values and retains tenth-step multipliers', () => {
  assert.equal(Speed.normalizeScrollSpeed(5, 10, 100, 1), 10);
  assert.equal(Speed.normalizeScrollSpeed(999, 10, 100, 1), 100);
  assert.equal(Speed.normalizeScrollSpeed(57, 10, 100, 1) / 10, 5.7);
  assert.equal(Speed.normalizeScrollSpeed(14, 10, 100, 3), 13);
  const config = nodes(source, 'windowsBar').find(
    (node) => node.config.id === 'readerScrollSpeed',
  ).config;
  assert.equal(
    Speed.validateConfig(config, () => {}),
    true,
  );
  assert.equal(
    Speed.validateConfig(
      { ...config, preference: { ...config.preference, default: 101 } },
      () => {},
    ),
    false,
  );
  assert.equal(
    Speed.validateConfig({ ...config, slider: { thumbSize: 0, trackSize: 3 } }, () => {}),
    false,
  );
});
test('speed control scales ongoing momentum exactly without an old 1x velocity ceiling', () => {
  const normal = advanceMomentum(500, 600, 1 / 60, 1),
    fast = advanceMomentum(5000, 6000, 1 / 60, 10);
  assert.ok(Math.abs(fast.distance - normal.distance * 10) < 1e-8);
  assert.ok(Math.abs(fast.velocity - normal.velocity * 10) < 1e-8);
  assert.equal(momentumImpulse(1e9, 10), 90000);
});
test('resource frame ceiling follows 60 updates without high-refresh or catch-up bursts', () => {
  for (const hz of [60, 120, 165]) {
    let deadline = 0,
      frames = 0;
    for (let n = 0; n < hz; n++) {
      const next = advanceRenderDeadline((n * 1000) / hz, deadline, 60);
      if (next.ready) {
        frames++;
        deadline = next.deadline;
      }
    }
    assert.ok(frames >= 59 && frames <= 61);
  }
  const delayed = advanceRenderDeadline(10000, 16, 60);
  assert.ok(delayed.deadline > 10000);
  assert.equal(advanceRenderDeadline(10000, delayed.deadline, 60).ready, false);
});
test('resource disabled ceiling admits every refresh slot and discards old capped deadlines', () => {
  for (const hz of [60, 120, 165]) {
    let deadline = 100000,
      frames = 0;
    for (let n = 0; n < hz; n++) {
      const next = advanceRenderDeadline((n * 1000) / hz, deadline, 0);
      if (next.ready) frames++;
      deadline = next.deadline;
    }
    assert.equal(frames, hz);
    assert.equal(deadline, 0);
  }
  assert.deepEqual(advanceRenderDeadline(1, 100000), { ready: true, deadline: 0 });
  const config = nodes(source, 'body').find((node) => node.config?.id === 'reader').config;
  assert.equal(
    Reader.validateConfig({ ...config, maxFPS: 0 }, () => {}),
    true,
  );
  assert.equal(
    Reader.validateConfig({ ...config, maxFPS: 60 }, () => {}),
    true,
  );
  assert.equal(
    Reader.validateConfig({ ...config, maxFPS: -1 }, () => {}),
    false,
  );
});
test('resource tile culling preserves edge pixels and excludes distant tiles', () => {
  assert.equal(tileInViewport(0, 0, 1024, 1024, 800, 800, 1), true);
  assert.equal(tileInViewport(800.5, 0, 1024, 1024, 800, 800, 1), true);
  assert.equal(tileInViewport(802, 0, 1024, 1024, 800, 800, 1), false);
  assert.equal(tileInViewport(0, 1600, 1024, 1024, 800, 800, 1), false);
});
test('resource raster removes empty margins without cropping the column or sampling border', () => {
  assert.deepEqual(horizontalRenderSpan(1320, 1, 260, 800), { left: 259, width: 802 });
  assert.deepEqual(horizontalRenderSpan(800, 1, -100, 1200), { left: 0, width: 800 });
  assert.deepEqual(horizontalRenderSpan(1320, 1, 16, 1288), { left: 15, width: 1290 });
});
test('resource raster stays aligned at fractional DPI and preserves narrow-window edges', () => {
  for (const ratio of [1, 1.25, 1.5, 2])
    for (const width of [799, 900, 1320]) {
      const left = 16.3,
        column = width - 32.6,
        span = horizontalRenderSpan(width, ratio, left, column);
      assert.ok(Math.abs(span.left * ratio - Math.round(span.left * ratio)) < 1e-8);
      assert.ok(Math.abs(span.width * ratio - Math.round(span.width * ratio)) < 1e-8);
      assert.ok(span.left <= left && span.left + span.width >= left + column);
      assert.ok(span.left + span.width <= Math.round(width * ratio) / ratio + 1e-8);
    }
});
test('resource obsolete tile work stops without discarding current pixels or warm demand', () => {
  assert.equal(tileWorkNeeded(5, false), false);
  assert.equal(tileWorkNeeded(5, true), true);
  for (const rank of [0, 1, 2]) assert.equal(tileWorkNeeded(rank, false), true);
});
test('resource prepared tiles cannot cross catalog or entry authority', () => {
  const page = {
    id: 'page',
    index: 0,
    name: 'page',
    width: 1600,
    height: 2000,
    targetWidth: 800,
    targetHeight: 1000,
  };
  const chapter = {
    id: 'chapter',
    catalogId: 'catalog',
    entryId: 'entry',
    sourceRevision: 'source',
    name: 'chapter',
    pages: [page],
    estimatedBytes: 0,
  };
  const result = {
    ok: true,
    id: 'chapter',
    catalogId: 'catalog',
    entryId: 'entry',
    index: 0,
    pageId: 'page',
    sourceRevision: 'source',
    requestedWidth: 800,
    width: 800,
    height: 1000,
    url: 'yuzread-page://page/chapter/0-800.png',
    tiles: [
      {
        index: 0,
        left: 0,
        top: 0,
        width: 800,
        height: 1000,
        encodedWidth: 800,
        encodedHeight: 1000,
        offsetX: 0,
        offsetY: 0,
        bytes: 42,
        url: 'yuzread-page://tile/catalog/entry/page-800/0.png',
      },
    ],
  };
  assert.equal(Reader.acceptsPreparedPage(chapter, page, 800, result), true);
  for (const patch of [
    { catalogId: 'other' },
    { entryId: 'other' },
    { catalogId: undefined },
    { entryId: undefined },
  ])
    assert.equal(Reader.acceptsPreparedPage(chapter, page, 800, { ...result, ...patch }), false);
});
test('chapter navigation uses catalog order and disables absent directions', () => {
  const chapters = [
      { id: 'one', name: 'chapter1' },
      { id: 'two', name: 'chapter2' },
      { id: 'ten', name: 'chapter10' },
    ],
    state = { catalogId: 'catalog', chapters, currentId: 'one', busy: false };
  assert.deepEqual(Navigation.navigationAvailability(state), {
    previous: false,
    next: true,
    list: true,
  });
  assert.equal(
    Reader.chapterNavigationIndex(chapters, 'one', { catalogId: 'catalog', action: 'previous' }),
    -1,
  );
  assert.equal(
    Reader.chapterNavigationIndex(chapters, 'two', { catalogId: 'catalog', action: 'next' }),
    2,
  );
  assert.equal(
    Reader.chapterNavigationIndex(chapters, 'one', {
      catalogId: 'catalog',
      action: 'select',
      entryId: 'ten',
    }),
    2,
  );
  assert.deepEqual(Navigation.navigationAvailability({ ...state, currentId: 'ten', busy: true }), {
    previous: false,
    next: false,
    list: false,
  });
});
test('phase6 continuity distinguishes recent input/layout from unexplained displacement', () => {
  const sample = Reader.createScrollContinuity();
  sample.reset(0, 0);
  assert.equal(sample.observe(0, 1.9, 100).unexpected, false);
  sample.reset(0, 0);
  assert.equal(sample.observe(0, 2, 100).unexpected, true);
  sample.expect(1000);
  assert.equal(sample.observe(0, 200, 1200).unexpected, false);
  assert.equal(sample.observe(0, 220, 1800).unexpected, true);
  sample.reset(10, 20);
  assert.equal(sample.observe(10, 20, 2000).unexpected, false);
});
test('phase6 diagnostics require literal opt-in and reject malformed metric envelopes', () => {
  const {
    readerDiagnosticsEnabled,
    isReaderMetricEvent,
  } = require('../electron-built/reader/CbzArchive.cjs');
  const config = {
    areas: [
      {
        enabled: true,
        children: [{ enabled: true, componentId: 'reader.cbz', diagnostics: true }],
      },
    ],
  };
  assert.equal(readerDiagnosticsEnabled(config), true);
  assert.equal(readerDiagnosticsEnabled({}), false);
  for (const v of [false, 'true', 1, undefined]) {
    config.areas[0].children[0].diagnostics = v;
    assert.equal(readerDiagnosticsEnabled(config), false);
  }
  const metric = {
    kind: 'image',
    clockMs: 10,
    values: { durationMs: 5, chapterId: 'id', cached: false },
  };
  assert.equal(isReaderMetricEvent(metric), true);
  for (const patch of [
    { kind: 'gpu' },
    { clockMs: NaN },
    { clockMs: -1 },
    { extra: true },
    { values: { nested: {} } },
    { values: { name: 'x'.repeat(129) } },
  ])
    assert.equal(isReaderMetricEvent({ ...metric, ...patch }), false);
});
test('phase6 native log is bounded and filesystem failure remains a diagnostic result', async () => {
  const { mkdir, stat, readFile } = await import('node:fs/promises');
  const { createReaderDiagnosticLog } = require('../electron-built/reader/CbzArchive.cjs');
  const directory = new URL(`../.runtime/reader-diag-unit-${Date.now()}/`, import.meta.url);
  await mkdir(directory, { recursive: true });
  const file = new URL('reader-diagnostics.log', directory),
    log = createReaderDiagnosticLog(file.pathname.replace(/^\/([A-Za-z]:)/, '$1'), 2048);
  for (let i = 0; i < 100; i++)
    log.record('native', { kind: 'unit', clockMs: i, values: { text: 'x'.repeat(100) } });
  assert.equal((await log.close()).ok, true);
  assert.ok((await stat(file)).size <= 2048);
  assert.match(await readFile(file, 'utf8'), /log-cap/);
  const unavailable = createReaderDiagnosticLog(directory.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  unavailable.record('native', { kind: 'unit', clockMs: 0, values: {} });
  assert.equal((await unavailable.close()).ok, false);
});
