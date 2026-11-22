import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {_electron} from 'playwright-core';

// CONFIG AND FIXTURE — an isolated copy only; never inject a dummy into live source.
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const evidence=path.join(root,'.runtime',`modular-area-proof-${Date.now()}`),fixture=path.join(evidence,'app');
await mkdir(fixture,{recursive:true});
for(const directory of ['screen','electron-built','electron'])await cp(path.join(root,directory),path.join(fixture,directory),{recursive:true});
for(const file of ['package.json','ShellHost.d.ts'])await cp(path.join(root,file),path.join(fixture,file));
const digest=text=>createHash('sha256').update(text).digest('hex');
const assemblerFiles=['main.tsx','Screen.tsx','shared/logic/AreaDiscovery.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(assemblerFiles.map(async file=>[file,digest(await readFile(path.join(root,'screen',file)))])));
const folder=path.join(fixture,'screen','proof-area');await mkdir(folder,{recursive:true});
await writeFile(path.join(folder,'ProofAreaCounter.tsx'),`
import {useState} from 'react';
import ActionButton from '@ui/ActionButton.tsx';
import type {ChildProps} from '@logic/AreaDiscovery.ts';
import type {ResolvedConfig} from '@logic/ConfigValidation.ts';
export const componentId='proof.counter';
export default function ProofAreaCounter({config}:ChildProps<ResolvedConfig,Record<string,never>>){
  const [count,setCount]=useState(0);
  return <ActionButton config={config} icon="folderOpen" label={config.label+' '+count} onClick={()=>setCount(value=>value+1)}/>;
}
`);
await writeFile(path.join(folder,'ProofArea.tsx'),`
import {AreaChildren} from '@ui/AreaLayout.tsx';
import {acceptCommonConfig,bindArea,bindChild} from '@logic/AreaDiscovery.ts';
import type {AreaProps} from '@logic/AreaDiscovery.ts';
import ProofAreaCounter,{componentId} from './ProofAreaCounter.tsx';
export const areaId='proofArea';export const parentName='ProofArea';
const children=[bindChild(ProofAreaCounter,acceptCommonConfig,{componentId,fileName:'ProofAreaCounter.tsx'},()=>({}))];
export default function ProofArea({config,ports,report}:AreaProps<Record<string,never>>){return <AreaChildren nodes={config.nodes} ports={ports} report={report}/>;}
export const bind=bindArea(ProofArea,children,()=>({}));
`);
const config=JSON.parse(await readFile(path.join(fixture,'screen','config.json'),'utf8'));
config.areas.push({id:'proofArea',parentId:'window',folder:'proof-area',label:'Isolated extension proof',enabled:true,draggable:false,overlay:true,zIndex:20,bounds:{x:10,y:10,width:20,height:10},preset:'titleBar',children:[{id:'counter',componentId:'proof.counter',parentId:'proofArea',label:'Increment fixture',enabled:true,bounds:{x:0,y:0,width:100,height:100},preset:'captionButton'}]});
await writeFile(path.join(fixture,'screen','config.json'),JSON.stringify(config,null,2));
for(const file of assemblerFiles)assert.equal(digest(await readFile(path.join(fixture,'screen',file))),sourceHashes[file],`Assembler was edited: ${file}`);
const aliases={'@ui/*':[path.join(fixture,'screen','shared','components','*')],'@logic/*':[path.join(fixture,'screen','shared','logic','*')]};
const typeConfig={extends:path.join(root,'tsconfig.screen.json'),compilerOptions:{paths:aliases},include:['screen/**/*.ts','screen/**/*.tsx','ShellHost.d.ts']};
const configFile=path.join(fixture,'tsconfig.screen.json');await writeFile(configFile,JSON.stringify(typeConfig,null,2));
const parsed=ts.parseJsonConfigFileContent(typeConfig,ts.sys,fixture,undefined,configFile);
assert.deepEqual(parsed.errors,[]);
const program=ts.createProgram(parsed.fileNames,parsed.options);
const typeErrors=ts.getPreEmitDiagnostics(program);
assert.deepEqual(typeErrors.map(error=>ts.flattenDiagnosticMessageText(error.messageText,'\n')),[],'Isolated area and copied screen must satisfy the same strict contracts');
await build({configFile:false,root:path.join(fixture,'screen'),base:'./',plugins:[react()],resolve:{alias:{'@ui':path.join(fixture,'screen','shared','components'),'@logic':path.join(fixture,'screen','shared','logic')},dedupe:['react','react-dom']},build:{outDir:path.join(fixture,'screen-built'),emptyOutDir:true}});
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({executablePath:path.join(root,'node_modules','electron','dist','electron.exe'),args:[fixture,'--qa'],cwd:fixture,env,timeout:15000});
try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.waitForSelector('#proofArea');
  await page.getByRole('button',{name:'Increment fixture 0',exact:true}).click();
  await page.getByRole('button',{name:'Increment fixture 1',exact:true}).waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>window.shellDev.catalog.filter(area=>area.areaId==='proofArea').length),1);
  assert.deepEqual(await page.evaluate(()=>window.shellDev.records()),[]);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(evidence,'new-area.png')});
  const result={verdict:'PASS',fixtureTypechecked:true,area:'proofArea',childStateAfterClick:1,unchangedAssemblers:sourceHashes,checks:['new folder plus config discovered and rendered','no main/Screen/discovery edit','typed parent and child contracts','child owns its UI state','no real-source dummy feature or dependencies copied'],evidence};
  await writeFile(path.join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await writeFile(path.join(evidence,'result.json'),JSON.stringify({verdict:'FAIL',error:String(error),evidence},null,2));throw error;}finally{await app.close();}
