import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {appendFile,mkdir,readFile,readdir,rmdir,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {_electron} from 'playwright-core';

// CONFIG AND FIXTURES — preparation/cache/identity only; no FPS or chapter suite.
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const evidence=path.join(root,'.runtime',`reader-phase2-proof-${Date.now()}`),pages=path.join(evidence,'pages');
await mkdir(pages,{recursive:true});
for(const [name,width,height]of [['01-large.png',1600,2000],['02-small.png',800,1000]]){
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#243c62"/><circle cx="${width/2}" cy="${height/2}" r="${width/4}" fill="#8dbfff"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(pages,name));
}
const run=promisify(execFile);
await run('python',['-c','import pathlib,zipfile,sys; p=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(p/"phase2.cbz","w",zipfile.ZIP_DEFLATED); [z.write(f,"pages/"+f.name) for f in sorted((p/"pages").glob("*.png"))]; z.close()',evidence]);
const archive=path.join(evidence,'phase2.cbz'),original=await readFile(archive);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const app=await _electron.launch({args:[root,'--qa'],cwd:root,env,timeout:15000});
const checks=[],observations={};
try{
  const page=await app.firstWindow();await page.waitForSelector('[data-reader]');
  const userData=await app.evaluate(({app,dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});return app.getPath('userData');},archive);
  const open=(options={renderWidth:400,maxDecodeWidth:1600,maxDecodedMB:64})=>page.evaluate(options=>window.shellHost.reader.open(options),options);
  const prepare=(chapter,index,width)=>page.evaluate(({id,index,width})=>window.shellHost.reader.prepare(id,index,width),{id:chapter.id,index,width});
  const release=chapter=>page.evaluate(id=>window.shellHost.reader.release(id),chapter.id);
  const fetchPage=url=>app.evaluate(async({net},url)=>{const response=await net.fetch(url);return{status:response.status,contentType:response.headers.get('content-type'),bytes:response.status===200?Array.from(new Uint8Array(await response.arrayBuffer())):[]};},url);
  assert.equal((await open({renderWidth:400,maxDecodeWidth:0,maxDecodedMB:64})).ok,false);
  assert.equal((await open({renderWidth:1601,maxDecodeWidth:1600,maxDecodedMB:64})).ok,false);
  const opened=await open();assert.equal(opened.ok,true);assert.ok('chapter' in opened);const chapter=opened.chapter;
  assert.match(chapter.sourceRevision,/^[a-f0-9]{64}$/);assert.equal(chapter.pages.length,2);assert.match(chapter.pages[0].id,/^[a-f0-9]{64}$/);
  for(const width of [undefined,0,-1,1.25,NaN,Infinity,1601,8193,'800'])assert.equal((await prepare(chapter,0,width)).ok,false,`invalid decode width ${width}`);
  assert.equal((await prepare(chapter,-1,400)).ok,false);
  checks.push('explicit max width and per-request validation reject omitted/invalid/unauthorized inputs');
  const base=await prepare(chapter,0,400);assert.equal(base.ok,true,JSON.stringify(base));assert.equal(base.width,400);assert.equal(base.height,500);assert.equal(base.sourceRevision,chapter.sourceRevision);assert.equal(base.pageId,chapter.pages[0].id);
  const directory=path.join(userData,'reader-cache',`reader-${chapter.id}`);
  const filename=(index,width)=>path.join(directory,`${hash(Buffer.from(JSON.stringify([chapter.sourceRevision,chapter.pages[index].id,width])))}-${width}.png`);
  const concurrent=await Promise.all(Array.from({length:12},()=>prepare(chapter,0,800)));
  assert.ok(concurrent.every(result=>result.ok&&result.width===800&&result.url===concurrent[0].url));
  const first=concurrent[0],file=filename(0,800),firstStat=await stat(file,{bigint:true}),firstHash=hash(await readFile(file));
  const hit=await prepare(chapter,0,800);assert.equal(hit.ok,true);assert.equal((await stat(file,{bigint:true})).mtimeNs,firstStat.mtimeNs);assert.equal(hash(await readFile(file)),firstHash);
  assert.equal((await readdir(directory)).filter(file=>file.endsWith('.png')).length,2);
  checks.push('concurrent equal variants coalesce; cache reuse preserves completed file identity');
  const natural=await Promise.all([prepare(chapter,1,1000),prepare(chapter,1,1400)]);assert.ok(natural.every(result=>result.ok&&result.width===800&&result.height===1000));assert.equal(natural[0].url,natural[1].url);assert.equal(natural[0].requestedWidth,1000);assert.equal(natural[1].requestedWidth,1400);
  checks.push('actual prepared dimensions are natural-width capped with truthful requested-width responses');
  const block=filename(0,1100);await mkdir(block);
  const failed=await prepare(chapter,0,1100);assert.equal(failed.ok,false);
  assert.equal((await fetchPage(first.url)).status,200);
  assert.equal((await fetchPage(`yuzread-page://page/${chapter.id}/0-1100.png`)).status,404);
  assert.equal((await readdir(directory)).some(file=>file.endsWith('.tmp')),false);await rmdir(block);
  checks.push('failed publication exposes no token/temporary PNG and preserves accepted content');
  await writeFile(file,Buffer.from([137,80,78,71,13,10,26,10]));assert.equal((await fetchPage(first.url)).status,404);
  const repaired=await prepare(chapter,0,800);assert.equal(repaired.ok,true);assert.equal(hash(await readFile(file)),firstHash);
  const delivered=await fetchPage(repaired.url);assert.equal(delivered.status,200);assert.equal(delivered.contentType,'image/png');assert.equal(hash(Buffer.from(delivered.bytes)),firstHash);
  const metadata=await sharp(Buffer.from(delivered.bytes)).metadata();assert.equal(metadata.width,800);assert.equal(metadata.height,1000);
  checks.push('corrupt cache is refused, re-created atomically and streamed as verified PNG bytes');
  let budgetFailure;
  for(const width of [1000,1200,1400,1600,1500,1300,1100,900,700]){const result=await prepare(chapter,0,width);if(!result.ok){budgetFailure=result;break;}}
  assert.ok(budgetFailure);assert.match(budgetFailure.error,/budget/);assert.equal((await fetchPage(repaired.url)).status,200);assert.equal((await readdir(directory)).some(file=>file.endsWith('.tmp')),false);
  observations.budgetFailure=budgetFailure.error;checks.push('retained variants plus decode workspace are admitted against the per-session budget');
  await appendFile(archive,Buffer.from([0]));const stale=await prepare(chapter,0,400);assert.equal(stale.ok,false);assert.match(stale.error,/source changed/);assert.equal((await fetchPage(base.url)).status,200);await release(chapter);assert.equal((await fetchPage(base.url)).status,404);
  await writeFile(archive,original);
  const next=await open({renderWidth:400,maxDecodeWidth:1600,maxDecodedMB:512});assert.equal(next.ok,true);assert.notEqual(next.chapter.id,chapter.id);assert.notEqual(next.chapter.sourceRevision,chapter.sourceRevision);
  const race=await page.evaluate(async id=>{const pending=window.shellHost.reader.prepare(id,0,1600);await window.shellHost.reader.release(id);return await pending;},next.chapter.id);
  assert.equal(race.ok,false);assert.equal((await fetchPage(`yuzread-page://page/${next.chapter.id}/0-1600.png`)).status,404);
  checks.push('source revision change rejects even cache hits; released in-flight work cannot publish a late token');
  assert.equal((await readdir(path.join(userData,'reader-cache'))).filter(file=>file.startsWith('reader-')).length,0);
  const result={verdict:'PASS',checks,observations,sourceRevision:chapter.sourceRevision,evidence};await writeFile(path.join(evidence,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}catch(error){await writeFile(path.join(evidence,'result.json'),JSON.stringify({verdict:'FAIL',error:String(error),checks,evidence},null,2));throw error;}finally{await app.close();}
