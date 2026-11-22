import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// CONFIG AND CONTRACT — static-only; never launches the app or rewrites source.
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const normalize = (/** @type {string} */ file) =>
  path.resolve(file).replaceAll('\\', '/').toLowerCase();
const relative = (/** @type {string} */ file) => path.relative(root, file).replaceAll('\\', '/');
const nodePackages = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));
/** @typedef {{file: string, rule: string, line: number, message: string}} Violation */
/** @param {string} directory @returns {string[]} */
function inventory(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? inventory(file) : [file];
  });
}
/** @param {string} name */
function project(name) {
  const configFile = path.join(root, name);
  const config = ts.readConfigFile(configFile, ts.sys.readFile);
  assert.equal(config.error, undefined, `Cannot read ${name}`);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configFile);
  assert.deepEqual(parsed.errors, [], `Invalid ${name}`);
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
  return { parsed, program };
}
const screen = project('tsconfig.screen.json');
const native = project('tsconfig.electron.json');
const tools = project('tsconfig.tools.json');
for (const target of [screen, native, tools]) {
  for (const flag of [
    'strict',
    'noImplicitAny',
    'strictNullChecks',
    'noUncheckedIndexedAccess',
    'exactOptionalPropertyTypes',
    'useUnknownInCatchVariables',
    'forceConsistentCasingInFileNames',
  ])
    assert.equal(target.parsed.options[flag], true, `${flag} cannot be disabled`);
  assert.notEqual(
    target.parsed.options.skipLibCheck,
    true,
    'Declaration checking cannot be skipped',
  );
}
assert.equal(screen.parsed.options.allowJs, false);
assert.equal(native.parsed.options.allowJs, false);
assert.equal(native.parsed.options.noEmitOnError, true);
assert.equal(tools.parsed.options.checkJs, true);
const production = [
  ...inventory(path.join(root, 'screen')),
  ...inventory(path.join(root, 'electron')),
].filter((file) => /\.[cm]?[jt]sx?$/.test(file));
const covered = new Set(
  [...screen.program.getSourceFiles(), ...native.program.getSourceFiles()].map((source) =>
    normalize(source.fileName),
  ),
);
/** @type {Violation[]} */
const violations = [];
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    /\.[cm]?[jt]sx?$/.test(entry.name) &&
    !['ShellHost.d.ts', 'vite.config.mts'].includes(entry.name)
  )
    violations.push({
      file: entry.name,
      line: 1,
      rule: 'ROOT_EXECUTABLE',
      message:
        'Application source belongs in its native/screen owner; tools need an explicit checking scope',
    });
}
for (const file of production) {
  if (!covered.has(normalize(file)))
    violations.push({
      file: relative(file),
      line: 1,
      rule: 'UNCHECKED_SOURCE',
      message: 'Production file is outside compiler coverage',
    });
  if (/\.(jsx?|mjs|cjs)$/.test(file))
    violations.push({
      file: relative(file),
      line: 1,
      rule: 'LEGACY_SOURCE',
      message: 'Production execution must use typed source and generated builds',
    });
}
for (const file of ['vite.config.mts', 'tests/code-contract-check.mjs'])
  assert.ok(
    tools.program
      .getSourceFiles()
      .some((source) => normalize(source.fileName) === normalize(path.join(root, file))),
    `Tool is unchecked: ${file}`,
  );

// Declared area parents are discovered from source metadata, not a fixed folder list.
/** @type {Map<string,{file:string,name:string}>} */
const areaParents = new Map();
/** @param {ts.SourceFile} source @param {string} name */
function exportedString(source, name) {
  for (const statement of source.statements)
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    )
      for (const declaration of statement.declarationList.declarations)
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer &&
          ts.isStringLiteral(declaration.initializer)
        )
          return declaration.initializer.text;
  return undefined;
}
for (const source of screen.program.getSourceFiles()) {
  const file = relative(source.fileName),
    name = exportedString(source, 'parentName');
  if (
    file.startsWith('screen/') &&
    !file.startsWith('screen/shared/') &&
    exportedString(source, 'areaId') &&
    name
  )
    areaParents.set(path.posix.dirname(file), { file, name });
}
/** @param {string} file */
function ownerOf(file) {
  return [...areaParents.entries()]
    .filter(([folder]) => file.startsWith(folder + '/'))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1];
}

/** @param {ts.SourceFile} source @param {ts.CompilerOptions} options @param {boolean} [emission] @returns {Violation[]} */
function inspect(source, options, emission = false) {
  const file = relative(source.fileName),
    browser = file.startsWith('screen/'),
    desktop = file.startsWith('electron/');
  const preload = file === 'electron/preload.cts';
  const feature =
    browser &&
    !file.startsWith('screen/shared/') &&
    !['screen/main.tsx', 'screen/Screen.tsx', 'screen/environment.d.ts'].includes(file);
  const owner = ownerOf(file),
    isParent = owner?.file === file;
  /** @type {Violation[]} */
  const found = [];
  /** @param {ts.Node} node @param {string} rule @param {string} message */
  const report = (node, rule, message) =>
    found.push({
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      rule,
      message,
    });
  /** @param {ts.Node} node @param {string} specifier @param {boolean} typeOnly */
  function imported(node, specifier, typeOnly) {
    const resolved = ts.resolveModuleName(
      specifier,
      source.fileName,
      options,
      ts.sys,
    ).resolvedModule;
    const target = resolved
      ? relative(resolved.resolvedFileName)
      : specifier.startsWith('.')
        ? relative(path.resolve(path.dirname(source.fileName), specifier))
        : specifier;
    const builtin = specifier.startsWith('node:') || nodePackages.has(specifier);
    const targetFeature =
      /\.[cm]?[jt]sx?$/.test(target) &&
      target.startsWith('screen/') &&
      !target.startsWith('screen/shared/') &&
      !['screen/main.tsx', 'screen/Screen.tsx', 'screen/environment.d.ts'].includes(target);
    if (
      file.startsWith('screen/shared/') &&
      target.startsWith('screen/') &&
      !target.startsWith('screen/shared/')
    )
      report(node, 'SHARED_FEATURE_IMPORT', 'Shared mechanics cannot depend on a feature');
    if (['screen/main.tsx', 'screen/Screen.tsx'].includes(file) && targetFeature)
      report(
        node,
        'CENTRAL_AREA_REGISTRY',
        'Area registration must not require a top assembler import',
      );
    if (feature && targetFeature && target !== file) {
      const targetOwner = ownerOf(target),
        basename = path.posix.basename(target).replace(/\.[^.]+$/, '');
      const ownPrivate = basename.startsWith(path.posix.basename(file).replace(/\.[^.]+$/, ''));
      if (
        !owner ||
        targetOwner?.file !== owner.file ||
        (!isParent && !ownPrivate) ||
        (isParent && !basename.startsWith(owner.name))
      )
        report(
          node,
          'SIBLING_IMPORT',
          'Only a declared parent may import its direct feature children',
        );
    }
    if (
      feature &&
      !isParent &&
      !typeOnly &&
      ['screen/shared/logic/ParentConnections.ts', 'screen/shared/logic/AreaDiscovery.ts'].includes(
        target,
      )
    )
      report(
        node,
        'LEAF_ROUTING_ENGINE',
        'Leaf controls receive callbacks, not parent routing engines',
      );
    if (
      feature &&
      !isParent &&
      !typeOnly &&
      target === 'screen/shared/logic/ConfigValidation.ts' &&
      ts.isImportDeclaration(node)
    ) {
      const bindings = node.importClause?.namedBindings;
      if (
        (bindings && ts.isNamespaceImport(bindings)) ||
        (bindings &&
          ts.isNamedImports(bindings) &&
          bindings.elements.some((part) =>
            ['validateScreenConfig', 'resolveChildren'].includes(
              part.propertyName?.text ?? part.name.text,
            ),
          ))
      )
        report(
          node,
          'LEAF_ROUTING_ENGINE',
          'Leaf may reuse validators, not instantiate screen assembly',
        );
    }
    if (
      browser &&
      (builtin ||
        specifier === 'electron' ||
        specifier.startsWith('electron/') ||
        ['sharp', 'yauzl'].includes(specifier) ||
        target.startsWith('electron/') ||
        target.startsWith('electron-built/'))
    )
      report(node, 'SCREEN_NATIVE_IMPORT', `Screen cannot import ${specifier}`);
    if (
      desktop &&
      (/^(react(?:-dom)?(?:\/|$)|@mui\/|@emotion\/)/.test(specifier) ||
        target.startsWith('screen/'))
    )
      report(node, 'NATIVE_SCREEN_IMPORT', `Native cannot import ${specifier}`);
    if (
      browser &&
      /Worker\.ts$/.test(file) &&
      /^(react(?:-dom)?(?:\/|$)|@mui\/|@emotion\/)/.test(specifier)
    )
      report(node, 'WORKER_UI_IMPORT', 'Rendering workers cannot import UI frameworks');
    if ((browser || desktop) && target.startsWith('tests/'))
      report(node, 'PRODUCTION_TEST_IMPORT', 'Production cannot import test helpers');
    if (target === 'ShellHost.d.ts' && !typeOnly)
      report(node, 'RUNTIME_WIRE_IMPORT', 'Neutral wire contract is type-only');
    if (
      preload &&
      !typeOnly &&
      specifier !== 'electron' &&
      specifier !== 'electron/renderer' &&
      specifier !== 'electron/common'
    )
      report(node, 'PRELOAD_MODULE', `Sandbox cannot load ${specifier}`);
  }
  // Check directives in comments, not harmless strings in diagnostic messages.
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source.text,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      (token === ts.SyntaxKind.SingleLineCommentTrivia ||
        token === ts.SyntaxKind.MultiLineCommentTrivia) &&
      /@ts-(ignore|nocheck|expect-error)\b/.test(scanner.getTokenText())
    )
      found.push({
        file,
        line: source.getLineAndCharacterOfPosition(scanner.getTokenPos()).line + 1,
        rule: 'TYPE_SUPPRESSION',
        message: 'Production type suppressions are forbidden',
      });
  }
  // No text directives are read as instructions; the scanner above only classifies them.
  /** @param {ts.Node} node @param {ts.Node} [parent] */
  function visit(node, parent) {
    if (
      browser &&
      /Worker\.ts$/.test(file) &&
      ts.isIdentifier(node) &&
      ['window', 'document', 'Image', 'HTMLElement', 'HTMLImageElement'].includes(node.text) &&
      !(parent && ts.isPropertyAccessExpression(parent) && parent.name === node)
    )
      report(
        node,
        'WORKER_DOM_GLOBAL',
        'Rendering workers use OffscreenCanvas/ImageBitmap, not window/DOM APIs',
      );
    if (node.kind === ts.SyntaxKind.AnyKeyword)
      report(node, 'EXPLICIT_ANY', 'Use a real contract or narrow unknown');
    if (ts.isNonNullExpression(node))
      report(node, 'NON_NULL_ASSERTION', 'Guard resource presence instead');
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      const constant =
        ts.isTypeReferenceNode(node.type) &&
        ts.isIdentifier(node.type.typeName) &&
        node.type.typeName.text === 'const';
      if (!constant)
        report(node, 'TYPE_ASSERTION', 'Unchecked type assertions are not accepted in production');
    }
    if (ts.isModuleDeclaration(node) && ts.isStringLiteral(node.name))
      report(node, 'AMBIENT_MODULE', 'Do not fake dependency/module declarations');
    if (
      feature &&
      ((ts.isPropertyAccessExpression(node) &&
        ['shellHost', 'shellDev'].includes(node.name.text)) ||
        (ts.isElementAccessExpression(node) &&
          ts.isStringLiteralLike(node.argumentExpression) &&
          ['shellHost', 'shellDev'].includes(node.argumentExpression.text)))
    )
      report(node, 'FEATURE_GLOBAL_ACCESS', 'Feature communication must go through its parent');
    if (
      feature &&
      !isParent &&
      ts.isTypeReferenceNode(node) &&
      ts.isIdentifier(node.typeName) &&
      [
        'ShellHost',
        'AppSession',
        'ScreenState',
        'ParentBinding',
        'ParentPort',
        'RequestPort',
        'StatePort',
        'ScreenInput',
      ].includes(node.typeName.text)
    )
      report(node, 'BROAD_CHILD_SCOPE', 'Child contract must expose narrow data/callbacks');
    if (
      browser &&
      ts.isIdentifier(node) &&
      ['process', 'require', 'Buffer', '__dirname', '__filename'].includes(node.text) &&
      !(parent && ts.isPropertyAccessExpression(parent) && parent.name === node)
    ) {
      const symbol = screen.program.getTypeChecker().getSymbolAtLocation(node);
      if (
        !symbol?.declarations?.length ||
        symbol.declarations.some(
          (declaration) => !relative(declaration.getSourceFile().fileName).startsWith('screen/'),
        )
      )
        report(node, 'SCREEN_NATIVE_GLOBAL', `Screen cannot use native global ${node.text}`);
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause,
        named = clause?.namedBindings;
      const typeOnly = Boolean(
        clause?.isTypeOnly ||
        (named &&
          ts.isNamedImports(named) &&
          named.elements.length &&
          named.elements.every((part) => part.isTypeOnly) &&
          !clause?.name),
      );
      imported(node, node.moduleSpecifier.text, typeOnly);
    }
    if (
      browser &&
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Worker'
    ) {
      const url = node.arguments?.[0];
      if (
        !url ||
        !ts.isNewExpression(url) ||
        !ts.isIdentifier(url.expression) ||
        url.expression.text !== 'URL' ||
        !url.arguments?.[0] ||
        !ts.isStringLiteral(url.arguments[0])
      )
        report(node, 'WORKER_ENTRY', 'Worker source must use a statically checked local URL');
      else imported(node, url.arguments[0].text, false);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.exportClause;
      imported(
        node,
        node.moduleSpecifier.text,
        node.isTypeOnly ||
          Boolean(
            clause &&
            ts.isNamedExports(clause) &&
            clause.elements.length &&
            clause.elements.every((part) => part.isTypeOnly),
          ),
      );
    }
    if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal)
    )
      imported(node, node.argument.literal.text, true);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (!argument || !ts.isStringLiteralLike(argument))
        report(node, 'COMPUTED_IMPORT', 'Production module loading must be statically inspectable');
      else {
        imported(node, argument.text, false);
        if (ts.isIdentifier(node.expression) && node.expression.text === 'require') {
          const declaration = parent;
          const typed =
            declaration &&
            ts.isVariableDeclaration(declaration) &&
            declaration.type &&
            ts.isImportTypeNode(declaration.type) &&
            declaration.type.isTypeOf;
          if (!typed && !emission)
            report(
              node,
              'UNTYPED_REQUIRE',
              'Use typed imports or the documented typed Electron adapter',
            );
        }
      }
    }
    if (
      preload &&
      ts.isIdentifier(node) &&
      ['Buffer', 'setImmediate', 'clearImmediate', 'exports', 'module'].includes(node.text)
    )
      report(node, 'PRELOAD_GLOBAL', `Sandbox has no ${node.text} module/global`);
    ts.forEachChild(node, (child) => visit(child, node));
  }
  visit(source);
  if (feature && !owner)
    report(source, 'ORPHAN_FEATURE', 'Feature folder has no declared area parent');
  const featureId = source.statements.some(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'areaId',
      ),
  );
  if (featureId) {
    const component = source.statements.find(
      (statement) =>
        ts.isFunctionDeclaration(statement) &&
        statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword),
    );
    const binding = source.statements
      .filter(ts.isVariableStatement)
      .flatMap((statement) => statement.declarationList.declarations)
      .find((declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === 'bind');
    const call = binding?.initializer;
    if (
      !component ||
      !ts.isFunctionDeclaration(component) ||
      !component.name ||
      !call ||
      !ts.isCallExpression(call) ||
      !ts.isIdentifier(call.expression) ||
      call.expression.text !== 'bindArea' ||
      call.arguments[0]?.getText(source) !== component.name.text
    )
      report(
        source,
        'FEATURE_BINDING',
        'Discovered area must bind its named parent and typed direct children',
      );
  }
  if (feature && owner && !path.posix.basename(file).startsWith(owner.name))
    report(source, 'CHILD_NAME_PREFIX', `Feature filename must inherit ${owner.name}`);
  if (feature && owner && !isParent) {
    const parentSource = screen.program.getSourceFile(path.join(root, owner.file));
    const importedByParent = parentSource?.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        normalize(
          ts.resolveModuleName(
            statement.moduleSpecifier.text,
            parentSource.fileName,
            screen.parsed.options,
            ts.sys,
          ).resolvedModule?.resolvedFileName ?? '',
        ) === normalize(source.fileName),
    );
    if (exportedString(source, 'componentId') && !importedByParent)
      report(source, 'ORPHAN_CHILD', 'Declared child must be imported/bound by its owning parent');
  }
  return found;
}
for (const file of production) {
  const program = relative(file).startsWith('screen/') ? screen : native;
  const source = program.program.getSourceFile(file);
  if (source) violations.push(...inspect(source, program.parsed.options));
}
const wireFile = path.join(root, 'ShellHost.d.ts');
const wire = ts.createSourceFile(
  wireFile,
  fs.readFileSync(wireFile, 'utf8'),
  ts.ScriptTarget.Latest,
  true,
);
assert.ok(
  wire.statements.every(
    (statement) => ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement),
  ),
  'Wire contract must contain declarations only',
);
assert.ok(covered.has(normalize(wireFile)), 'Wire contract is outside compiler scope');

// LIFECYCLE — inspect emission in memory; do not depend on stale generated preload.
const preloadFile = path.join(root, 'electron', 'preload.cts');
const emitted = ts.transpileModule(fs.readFileSync(preloadFile, 'utf8'), {
  compilerOptions: native.parsed.options,
  fileName: preloadFile,
}).outputText;
const emittedSource = ts.createSourceFile(
  preloadFile,
  emitted,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
violations.push(...inspect(emittedSource, native.parsed.options, true));

// SELF-PROOF — real public/owner contracts; no live mutation or suppressed errors.
const imports = `import type {ShellHost, WindowOperation, PageMetadata, ReaderOpenResult} from './ShellHost.js';
 import type {ChildProps} from './screen/shared/logic/AreaDiscovery.ts';
 import type {ReaderConfig,BodyReaderInput} from './screen/body/reader/BodyReader.tsx';
 declare const host: ShellHost; declare const props: ChildProps<ReaderConfig,BodyReaderInput>;
declare const result: ReaderOpenResult;`;
const examples = [
  {
    name: 'valid',
    expected: [],
    code: `${imports}\nconst op: WindowOperation = 'restoreDefault'; host.windowAction(op); host.reader.prepare('id', 0, 800); host.reader.chapter('catalog','entry',{renderWidth:800,maxDecodeWidth:1600,maxDecodedMB:64}); const p: ChildProps<ReaderConfig,BodyReaderInput> = props; if (result.ok && 'chapter' in result) result.catalog.id;`,
  },
  {
    name: 'command',
    expected: [2322],
    code: `${imports}\nconst op: WindowOperation = 'unsupported';`,
  },
  {
    name: 'props',
    expected: [2741],
    code: `${imports}\nconst p: ChildProps<ReaderConfig,BodyReaderInput> = {config: props.config};`,
  },
  {
    name: 'page',
    expected: [2322],
    code: `${imports}\nconst p: PageMetadata = {id:'page',index:0,name:'p',width:'800',height:1000,targetWidth:800,targetHeight:1000};`,
  },
  { name: 'response', expected: [2339], code: `${imports}\nresult.chapter.id;` },
  {
    name: 'prepare',
    expected: [2345],
    code: `${imports}\nhost.reader.prepare('id', 'wrong', 800);`,
  },
  {
    name: 'decode-width-required',
    expected: [2554],
    code: `${imports}\nhost.reader.prepare('id', 0);`,
  },
  {
    name: 'decode-limit-required',
    expected: [2345],
    code: `${imports}\nhost.reader.open({renderWidth:800,maxDecodedMB:64});`,
  },
  {
    name: 'native-handler',
    expected: [2322],
    code: `import type {NativeHandlers} from './ShellHost.js'; const prepare: NativeHandlers['reader:prepare'] = async () => ({ok:true,url:123});`,
  },
  {
    name: 'chapter-options-required',
    expected: [2554],
    code: `${imports}\nhost.reader.chapter('catalog','entry');`,
  },
  {
    name: 'chapter-limit-required',
    expected: [2345],
    code: `${imports}\nhost.reader.chapter('catalog','entry',{renderWidth:800,maxDecodedMB:64});`,
  },
  {
    name: 'catalog-identity-required',
    expected: [2322],
    code: `import type {NativeHandlers} from './ShellHost.js'; const open: NativeHandlers['reader:chapter'] = async () => ({ok:true,chapter:{id:'id',name:'chapter',sourceRevision:'revision',pages:[],estimatedBytes:0}});`,
  },
  {
    name: 'prepare-priority',
    expected: [2345],
    code: `${imports}\nhost.reader.prepare('id',0,800,'gpu');`,
  },
  {
    name: 'chapter-priority',
    expected: [2345],
    code: `${imports}\nhost.reader.chapter('catalog','entry',{renderWidth:800,maxDecodeWidth:1600,maxDecodedMB:64},'unknown');`,
  },
  {
    name: 'budget-shape',
    expected: [2322],
    code: `import type {ReaderBudget} from './ShellHost.js';const budget:ReaderBudget={limitBytes:'64',residentBytes:0,inFlightBytes:0,activeJobs:0,queuedJobs:0};`,
  },
  {
    name: 'metric-kind',
    expected: [2322],
    code: `${imports}\nhost.reader.diagnostics([{kind:'gpu',clockMs:0,values:{}}]);`,
  },
  {
    name: 'metric-values',
    expected: [2322],
    code: `import type {ReaderMetricEvent} from './ShellHost.js';const metric:ReaderMetricEvent={kind:'image',clockMs:0,values:{payload:{invalid:true}}};`,
  },
  {
    name: 'metric-clock',
    expected: [2322],
    code: `import type {ReaderMetricEvent} from './ShellHost.js';const metric:ReaderMetricEvent={kind:'image',clockMs:'wrong',values:{}};`,
  },
  {
    name: 'feature-binding',
    expected: [2345],
    code: `${imports}\nimport BodyReader from './screen/body/reader/BodyReader.tsx'; import {bindChild,acceptCommonConfig} from './screen/shared/logic/AreaDiscovery.ts'; bindChild(BodyReader,acceptCommonConfig,{componentId:'test',fileName:'BodyReader.tsx'},()=>props.input);`,
  },
  {
    name: 'parent-callback',
    expected: [2345],
    code: `import {contract,createRequest} from './screen/shared/logic/ParentConnections.ts'; const port=createRequest(contract('n',(v:unknown):v is number=>typeof v==='number'),contract('s',(v:unknown):v is string=>typeof v==='string'),'missing');port.register((value:string)=>value);`,
  },
  {
    name: 'state-contract',
    expected: [2345],
    code: `import {contract,createState} from './screen/shared/logic/ParentConnections.ts';createState(contract('n',(v:unknown):v is number=>typeof v==='number'),'wrong');`,
  },
];
const virtualFiles = examples.map((example) => path.join(root, `.code-check-${example.name}.tsx`));
const virtual = new Map(
  examples.map((example) => [
    normalize(path.join(root, `.code-check-${example.name}.tsx`)),
    example.code,
  ]),
);
const host = ts.createCompilerHost(screen.parsed.options);
const realSource = host.getSourceFile.bind(host),
  realExists = host.fileExists.bind(host),
  realRead = host.readFile.bind(host);
/** @type {ts.CompilerHost['fileExists']} */
const proofExists = (file) => virtual.has(normalize(file)) || realExists(file);
/** @type {ts.CompilerHost['readFile']} */
const proofRead = (file) => virtual.get(normalize(file)) ?? realRead(file);
/** @type {ts.CompilerHost['getSourceFile']} */
const proofSource = (file, languageVersion, onError, shouldCreateNewSourceFile) => {
  const text = virtual.get(normalize(file));
  return text === undefined
    ? realSource(file, languageVersion, onError, shouldCreateNewSourceFile)
    : ts.createSourceFile(
        file,
        text,
        typeof languageVersion === 'number' ? languageVersion : languageVersion.languageVersion,
        true,
      );
};
host.fileExists = proofExists;
host.readFile = proofRead;
host.getSourceFile = proofSource;
const proof = ts.createProgram(
  [...screen.parsed.fileNames, ...virtualFiles],
  screen.parsed.options,
  host,
);
const diagnostics = ts.getPreEmitDiagnostics(proof);
for (const example of examples) {
  const name = normalize(path.join(root, `.code-check-${example.name}.tsx`));
  const actual = diagnostics
    .filter((diagnostic) => diagnostic.file && normalize(diagnostic.file.fileName) === name)
    .map((diagnostic) => diagnostic.code);
  assert.deepEqual(
    actual,
    example.expected,
    `Checker self-proof ${example.name} must fail for the expected contract, not a missing dependency`,
  );
}
const unrelated = diagnostics.filter(
  (diagnostic) => !diagnostic.file || !virtual.has(normalize(diagnostic.file.fileName)),
);
assert.deepEqual(
  unrelated.map(
    (diagnostic) =>
      `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').split('\n')[0]}`,
  ),
  [],
  'Production/dependency errors during checker proof',
);
const boundaryExamples = [
  {
    file: 'screen/body/reader/BodyReaderPixiWorker.ts',
    code: 'document.createElement("canvas");',
    rule: 'WORKER_DOM_GLOBAL',
  },
  {
    file: 'screen/body/reader/BodyReaderPixiWorker.ts',
    code: "import React from 'react';",
    rule: 'WORKER_UI_IMPORT',
  },
  {
    file: 'screen/body/reader/BodyReaderPixi.ts',
    code: 'new Worker(getUntrackedUrl());',
    rule: 'WORKER_ENTRY',
  },
  {
    file: 'screen/check-fixture.ts',
    code: "import fs from 'node:fs';",
    rule: 'SCREEN_NATIVE_IMPORT',
  },
  {
    file: 'screen/check-fixture.ts',
    code: "import type {WindowConfig} from '../electron/WindowConfig.cjs';",
    rule: 'SCREEN_NATIVE_IMPORT',
  },
  {
    file: 'electron/check-fixture.cts',
    code: "import React from 'react';",
    rule: 'NATIVE_SCREEN_IMPORT',
  },
  {
    file: 'screen/check-fixture.ts',
    code: "import {ShellHost} from '../ShellHost.js';",
    rule: 'RUNTIME_WIRE_IMPORT',
  },
  { file: 'electron/preload.cts', code: "const fs = require('node:fs');", rule: 'PRELOAD_MODULE' },
  { file: 'screen/check-fixture.ts', code: 'const unsafe: any = 1;', rule: 'EXPLICIT_ANY' },
  {
    file: 'screen/check-fixture.ts',
    code: '// @ts-ignore\nconst x: number = "bad";',
    rule: 'TYPE_SUPPRESSION',
  },
  { file: 'screen/check-fixture.ts', code: 'process.pid;', rule: 'SCREEN_NATIVE_GLOBAL' },
  {
    file: 'screen/windows-area/WindowsAreaBtnClose.tsx',
    code: "import WindowsAreaBtnLoad from './WindowsAreaBtnLoad.tsx';",
    rule: 'SIBLING_IMPORT',
  },
  {
    file: 'screen/windows-area/WindowsAreaBtnDefaultSize.tsx',
    code: "export type {WindowsAreaCloseInput} from './WindowsAreaBtnClose.tsx';",
    rule: 'SIBLING_IMPORT',
  },
  {
    file: 'screen/windows-area/WindowsArea.tsx',
    code: "import Body from '../body/Body.tsx';",
    rule: 'SIBLING_IMPORT',
  },
  {
    file: 'screen/shared/logic/fixture.ts',
    code: "import Body from '../../body/Body.tsx';",
    rule: 'SHARED_FEATURE_IMPORT',
  },
  {
    file: 'screen/Screen.tsx',
    code: "import Body from './body/Body.tsx';",
    rule: 'CENTRAL_AREA_REGISTRY',
  },
  {
    file: 'screen/windows-area/WindowsAreaBtnClose.tsx',
    code: "import {createRequest} from '@logic/ParentConnections.ts';",
    rule: 'LEAF_ROUTING_ENGINE',
  },
  {
    file: 'screen/windows-area/WindowsAreaBtnLoad.tsx',
    code: "window['shellHost'].reader.open({});",
    rule: 'FEATURE_GLOBAL_ACCESS',
  },
  {
    file: 'screen/windows-area/BadName.tsx',
    code: 'export const unrelated=1;',
    rule: 'CHILD_NAME_PREFIX',
  },
  { file: 'screen/unowned/Lost.tsx', code: 'export const orphan=1;', rule: 'ORPHAN_FEATURE' },
  {
    file: 'screen/windows-area/WindowsAreaBtnLoad.tsx',
    code: "import {validateScreenConfig} from '@logic/ConfigValidation.ts';",
    rule: 'LEAF_ROUTING_ENGINE',
  },
  {
    file: 'screen/windows-area/WindowsAreaBtnClose.tsx',
    code: "import type {ShellHost} from '../../ShellHost.js'; declare const props: ShellHost;",
    rule: 'BROAD_CHILD_SCOPE',
  },
];
for (const example of boundaryExamples) {
  const source = ts.createSourceFile(
    path.join(root, example.file),
    example.code,
    ts.ScriptTarget.Latest,
    true,
  );
  const result = inspect(
    source,
    example.file.startsWith('screen/') ? screen.parsed.options : native.parsed.options,
  );
  assert.ok(
    result.some((violation) => violation.rule === example.rule),
    `Boundary self-proof must reject ${example.rule}`,
  );
}
assert.deepEqual(violations, [], JSON.stringify(violations, null, 2));
console.log(
  JSON.stringify(
    {
      verdict: 'PASS',
      productionFiles: production.length,
      toolFiles: 2,
      typeProofs: examples.length,
      boundaryProofs: boundaryExamples.length,
      checks: [
        'strict compiler policy',
        'all production covered',
        'resolved import ownership',
        'typed area/child binding and parent-only imports',
        'no suppression/any/casts',
        'sandboxed preload emission',
        'positive/negative contract self-proof',
      ],
    },
    null,
    2,
  ),
);
