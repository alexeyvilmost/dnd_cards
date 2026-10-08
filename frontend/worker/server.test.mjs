import {workerTestBuild} from '../../scripts/testing/worker-test-build.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm, cp, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL, fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {createRulesWorker,createArtifactCache,snapshotHash} from './server.mjs';
import {nativeHashSource} from './native-hash.mjs';
import {createCombatFrameCache} from './combat-frames.mjs';
import {createSpeculativeTransitions} from './speculative-transitions.mjs';
import {buildIdentity} from '../../scripts/release/write-build-identity.mjs';
import {ignorePolicy, inventory, copyInputs} from '../../scripts/release/measure-local.mjs';

const token = 'local-test-worker-token-with-32-characters';
test('canonical subtree cache preserves the original hash after mutation, reordering and eviction',()=>{
  const original=value=>{const normalize=item=>Array.isArray(item)?item.map(normalize):item&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,normalize(item[key])])):item;return `sha256:${createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')}`;};
  const make=name=>({state:{catalog:{z:'<'+name+'> & 🐉'.repeat(1200),a:{'11':1,'2':2}},actors:{one:{character:{a:1}},two:{character:{z:3}}}},entropy:{seed:'private',cursor:1}});
  const first=make('one'),second=make('two');
  for(const value of [first,first,second,second])assert.equal(snapshotHash(value),original(value));
  first.state.catalog.a['2']=9;assert.equal(snapshotHash(first),original(first));
  first.state.catalog={a:first.state.catalog.a,z:first.state.catalog.z};assert.equal(snapshotHash(first),original(first));
  for(let i=0;i<40;i++){const value=make(String(i));assert.equal(snapshotHash(value),original(value));}
  assert.equal(snapshotHash(second),original(second));
});
test('speculation uses only the exact pinned frame and end-turn intent and cannot spend or advance input entropy',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'combat-speculation-'));
  const source="exports.stepRoguelikeCombat=(envelope,intent)=>({envelope:{...envelope,entropy:{...envelope.entropy,cursor:envelope.entropy.cursor+1},state:{...envelope.state,computedFor:intent.actorId}},randomValues:[0.5]});";
  const artifactHash=`sha256:${createHash('sha256').update(source).digest('hex')}`;
  await writeFile(path.join(directory,`${artifactHash.slice(7)}.cjs`),source);
  const speculation=createSpeculativeTransitions({artifactsDirectory:directory});
  try{
    const envelope={artifactHash,entropy:{cursor:5},state:{outcome:'active',characterId:'hero',world:{scene:{initiative:['hero'],activeIndex:0}}}};
    const before=structuredClone(envelope);speculation.schedule('before',envelope);
    const result=await speculation.take('before',{type:'end_turn',actorId:'hero'});assert.ok(result);
    assert.equal(result.result.envelope.entropy.cursor,6);assert.deepEqual(envelope,before);
    result.result.envelope.entropy.cursor=900;
    assert.equal((await speculation.take('before',{type:'end_turn',actorId:'hero'})).result.envelope.entropy.cursor,6);
    for(const [hash,intent] of [['changed',{type:'end_turn',actorId:'hero'}],['before',{type:'end_turn',actorId:'other'}],['before',{type:'end_turn',actorId:'hero',extra:true}],['before',{type:'action',actorId:'hero'}]])assert.equal(await speculation.take(hash,intent),undefined);
  }finally{await speculation.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('combat-speculation-'));await rm(directory,{recursive:true,force:true});}
});
test('native SHA preserves portable hashes including malformed UTF-16 and refuses unknown implementations', async()=>{
  const source=await readFile(new URL('artifact.cjs',workerTestBuild()),'utf8');
  const routine=/^function sha256String\d*\(value\) \{[\s\S]*?^\}/m.exec(source)?.[0];assert.ok(routine);
  const name=routine.slice('function '.length,routine.indexOf('('));
  const rotate=/^function rotateRight\d*\([^\n]*\) \{[\s\S]*?^\}/m.exec(source)?.[0];assert.ok(rotate);
  const constant=/^var SHA256_ROUND_CONSTANTS\s*=\s*new Uint32Array\(\[[\s\S]*?\]\);/m.exec(source)?.[0];assert.ok(constant);
  const original=Function(`${constant}\n${rotate}\n${routine};return ${name};`)();
  const optimized=nativeHashSource(routine);assert.notEqual(optimized,routine);
  const native=Function('require',`${optimized};return ${name};`)(createRequire(import.meta.url));
  for(const text of ['', 'abc', 'Русский текст 🐉', '\u0000', '\ud800', '\udc00', '\ud800\ud800', 'я'.repeat(1_000_000)])assert.equal(native(text),original(text));
  assert.equal(nativeHashSource(routine.replace('value)', 'other)')),routine.replace('value)', 'other)'));
});

test('pending continuations predict only exact phase and actor; influences remain explicit authoritative commands',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'combat-pending-speculation-'));
  const source="exports.stepRoguelikeCombat=(envelope,intent)=>({envelope:{...envelope,entropy:{...envelope.entropy,cursor:envelope.entropy.cursor+1},state:{...envelope.state,computedFor:[intent.actorId,intent.phase]}},randomValues:[0.5]});";
  const artifactHash=`sha256:${createHash('sha256').update(source).digest('hex')}`;
  await writeFile(path.join(directory,`${artifactHash.slice(7)}.cjs`),source);
  const speculation=createSpeculativeTransitions({artifactsDirectory:directory});
  try{
    for(const [actorId,phase] of [['hero','rolled'],['ally','resolved']]){
      const envelope={artifactHash,entropy:{cursor:5},state:{outcome:'active',controlledCharacterIds:['hero','ally'],pendingDeathSave:{actorId,phase},world:{scene:{initiative:['hero'],activeIndex:0}}}},before=structuredClone(envelope),hash=actorId+phase;
      speculation.schedule(hash,envelope);
      const intent={type:'death_save',actorId,phase},result=await speculation.take(hash,intent);
      assert.ok(result);assert.deepEqual(result.result.envelope.state.computedFor,[actorId,phase]);assert.deepEqual(envelope,before);
      for(const altered of [{...intent,phase:phase==='rolled'?'resolved':'rolled'},{...intent,actorId:'enemy'},{...intent,effectId:'influence'}, {type:'end_turn',actorId}])assert.equal(await speculation.take(hash,altered),undefined);
    }
  }finally{await speculation.close();assert.equal(path.dirname(directory),tmpdir());assert.ok(path.basename(directory).startsWith('combat-pending-speculation-'));await rm(directory,{recursive:true,force:true});}
});
test('combat frames bound memory, bind executable identity and preserve Go input ordering',()=>{
  const cache=createCombatFrameCache({maxFrames:2,maxBytes:1000});
  const make=artifactHash=>({artifactHash,state:{z:1,a:{z:2,a:3}}});
  const source=make('rules-one');cache.set('one',source);source.state.a.a=99;
  assert.equal(cache.get('one','rules-one').state.a.a,3);assert.deepEqual(Object.keys(cache.get('one','rules-one').state),['a','z']);
  assert.equal(cache.get('one','other-rules'),undefined);cache.set('two',make('rules-one'));cache.set('three',make('rules-one'));assert.equal(cache.get('one','rules-one'),undefined);
  cache.set('large',{artifactHash:'rules-one',padding:'x'.repeat(1001)});assert.equal(cache.get('large','rules-one'),undefined);cache.clear();assert.equal(cache.get('two','rules-one'),undefined);
});
test('concurrent immutable loads share one verified read and failures allow a clean retry', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'roguelike-worker-flight-'));
  const source='exports.version=7;',hash=`sha256:${createHash('sha256').update(source).digest('hex')}`,file=path.join(directory,`${hash.slice(7)}.cjs`);
  await writeFile(file,source);let reads=0,release;const held=new Promise(resolve=>{release=resolve;});
  const cache=createArtifactCache({artifactsDirectory:directory,read:async()=>{reads++;await held;return Buffer.from(source);}});
  try{
    const pending=Array.from({length:16},()=>cache.load(hash));assert.equal(reads,1);release();
    const values=await Promise.all(pending);assert.ok(values.every(value=>value===values[0]));assert.equal(values[0].version,7);
    cache.close();let corrupt=true;
    const retry=createArtifactCache({artifactsDirectory:directory,read:async()=>Buffer.from(corrupt?'wrong':source)});
    try{await assert.rejects(retry.load(hash),/hash mismatch/);corrupt=false;assert.equal((await retry.load(hash)).version,7);}finally{retry.close();}
  }finally{cache.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('roguelike-worker-flight-'));await rm(directory,{recursive:true,force:true});}
});
test('artifact cache cannot resurrect a module after close during its filesystem read', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'roguelike-worker-closing-')),require=createRequire(import.meta.url);
  const source='exports.version=1;',hash=`sha256:${createHash('sha256').update(source).digest('hex')}`,file=path.join(directory,`${hash.slice(7)}.cjs`);
  await writeFile(file,source);let releaseRead;const pendingRead=new Promise(resolve=>{releaseRead=resolve;});
  const cache=createArtifactCache({artifactsDirectory:directory,read:()=>pendingRead});
  try{
    const pending=cache.load(hash);cache.close();releaseRead(Buffer.from(source));
    await assert.rejects(pending,/cache is closed/);assert.equal(require.cache[file],undefined);assert.equal(cache.has(hash),false);
    await assert.rejects(cache.load(hash),/cache is closed/);assert.equal(await readFile(file,'utf8'),source);
  }finally{cache.close();assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('roguelike-worker-closing-'));await rm(directory,{recursive:true,force:true});}
});
test('artifact LRU releases Node references, reloads exact pins and verifies bytes after eviction', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'roguelike-worker-lru-')),artifactsDirectory=path.join(directory,'artifacts');
  await mkdir(artifactsDirectory);const require=createRequire(import.meta.url),files=[];
  for(const version of [1,2,3]){
    const source=`exports.executeRoguelikeCampAction=async input=>{if(input.wait)await new Promise(resolve=>setTimeout(resolve,100));return {status:'ready',version:${version},patch:input.patch,pending:input.pending,randomValues:input.randomValues};};`;
    const hash=`sha256:${createHash('sha256').update(source).digest('hex')}`,file=path.join(artifactsDirectory,`${hash.slice(7)}.cjs`);
    await writeFile(file,source);files.push({hash,file,source});
  }
  let server;
  try{
    for(const maxCachedArtifacts of [0,65,NaN,1.5])await assert.rejects(createRulesWorker({artifactFile:files[0].file,artifactsDirectory,token,maxCachedArtifacts}),/Invalid worker artifact cache limit/);
    server=await createRulesWorker({artifactFile:files[0].file,artifactsDirectory,token,maxCachedArtifacts:2,performanceEnabled:true});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
    const input={patch:{resources:{pool:1}},pending:{id:'same-choice'},randomValues:[.7]};
    async function call(index,wait=false){const response=await fetch(`${origin}/camp-action`,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json','x-performance-trace':'1'},body:JSON.stringify({artifactHash:files[index].hash,input:{...input,wait}})});return {status:response.status,body:await response.json(),hit:JSON.parse(response.headers.get('x-rules-performance')).worker_artifact_cache_hit};}
    const first=await call(0);assert.equal(first.hit,0);
    assert.equal((await call(1)).hit,0);assert.equal((await call(0)).hit,1);assert.equal((await call(2)).hit,0);
    assert.equal(require.cache[files[1].file],undefined,'least recently used CJS remains in Node cache');
    const parent=require.cache[files[0].file].parent;
    assert.ok(!parent.children.some(module=>module.filename===files[1].file),'parent retains evicted module');
    assert.equal((await call(1)).hit,0);const reloaded=await call(0);assert.equal(reloaded.hit,0);assert.deepEqual(reloaded.body,first.body);
    const pending=call(0,true);await new Promise(resolve=>setTimeout(resolve,30));await call(1);await call(2);
    assert.deepEqual((await pending).body,first.body,'eviction changed in-flight pending outcome');
    for(const file of files)assert.equal(await readFile(file.file,'utf8'),file.source,'LRU changed retained artifact bytes');
    await writeFile(files[0].file,'corrupt fixture only');const corrupt=await call(0);assert.equal(corrupt.status,422);assert.equal(require.cache[files[0].file],undefined);
    await writeFile(files[0].file,files[0].source);assert.deepEqual((await call(0)).body,first.body);
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    for(const file of files)assert.equal(require.cache[file.file],undefined,'closed wrapper retains modules');
  }finally{
    if(server?.listening){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(tmpdir()));assert.ok(path.basename(directory).startsWith('roguelike-worker-lru-'));await rm(directory,{recursive:true,force:true});
  }
});
test('clean Docker context includes every wrapper copy input and its relative import closure', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const build = parse('build.mjs', await readFile(new URL('./build.mjs', import.meta.url), 'utf8'));
  const copies = new Map();
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'copyFile') {
      assert.equal(node.arguments.length, 2, 'Review nonstandard runtime copy');
      const [source, destination] = node.arguments;
      assert.ok(ts.isStringLiteral(source), 'Runtime copy source must be statically auditable');
      assert.ok(ts.isCallExpression(destination) && destination.expression.getText(build) === 'path.join'
        && destination.arguments.length === 2 && destination.arguments[0].getText(build) === 'output'
        && ts.isStringLiteral(destination.arguments[1]), 'Runtime copy destination must be the selected distribution');
      const from = 'frontend/' + source.text, to = 'frontend/worker/dist/' + destination.arguments[1].text;
      assert.ok(to.startsWith('frontend/worker/dist/'), 'Review copy outside runtime distribution');
      assert.ok(!copies.has(from), 'Duplicate runtime input');
      copies.set(from, to);
    }
    ts.forEachChild(node, visit);
  }
  visit(build);
  assert.ok(copies.size > 0, 'Worker runtime copy inventory is empty');
  const policy = ignorePolicy(await readFile(new URL('../../infra/Dockerfile.rules-worker.dockerignore', import.meta.url), 'utf8'));
  const files = inventory(root, policy);
  copyInputs(await readFile(new URL('../../infra/Dockerfile.rules-worker', import.meta.url), 'utf8'), files);
  const modules = new Map(await Promise.all([...copies.keys()].map(async file =>
    [file, parse(file, await readFile(path.join(root, file), 'utf8'))])));
  function assertClosure(available) {
    for (const [file, target] of copies) {
      assert.ok(available.has(file), `Clean Docker context omits runtime copy input: ${file}`);
      function check(node) {
        let specifier;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
          || ts.isIdentifier(node.expression) && node.expression.text === 'require')) specifier = node.arguments[0];
        if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
          const source = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier.text));
          const destination = path.posix.normalize(path.posix.join(path.posix.dirname(target), specifier.text));
          assert.ok(available.has(source), `Clean Docker context omits runtime import: ${source}`);
          assert.equal(copies.get(source), destination, `Runtime import is not copied beside its importer: ${source}`);
        }
        ts.forEachChild(node, check);
      }
      check(modules.get(file));
    }
  }
  const available = new Set(files.map(file => file.path));
  assertClosure(available);
  for (const file of copies.keys()) {
    const missing = new Set(available); missing.delete(file);
    assert.throws(() => assertClosure(missing), /Clean Docker context omits/, `Omitting ${file} must fail`);
  }
});
test('clean distribution imports server and replay without source-tree runtime dependencies', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'roguelike-worker-package-'));
  let server;
  try {
    // This is the directory copied into the final OCI image. Importing the
    // source wrapper directly would conceal missing relative runtime modules.
    await cp(workerTestBuild(), directory, {recursive: true});
    for (const file of ['server.mjs', 'replay.mjs', 'mirrors.mjs']) {
      assert.deepEqual(await readFile(path.join(directory, file)), await readFile(new URL(file, import.meta.url)), `Stale packaged ${file}; build the worker first`);
    }
    const packaged = await import(pathToFileURL(path.join(directory, 'server.mjs')).href);
    assert.equal(typeof (await import(pathToFileURL(path.join(directory, 'replay.mjs')).href)).replayCombatRecords, 'function');
    server = await packaged.createRulesWorker({artifactFile: path.join(directory, 'artifact.cjs'), artifactsDirectory: path.join(directory, 'artifacts'), token});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/health`);
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.artifactHash, `sha256:${createHash('sha256').update(await readFile(path.join(directory, 'artifact.cjs'))).digest('hex')}`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(directory, {recursive: true, force: true});
  }
});

test('baked worker identity survives new release metadata and pinned pending decisions survive transport restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'roguelike-worker-identity-'));
  const artifactFile = path.join(directory, 'current.cjs'), artifactsDirectory = path.join(directory, 'artifacts');
  const artifact = `exports.stepRoguelikeCombat = (envelope) => ({envelope,events:[]});
exports.projectRoguelikeCombatPatch = (envelope) => ({envelope,patch:{runtime_revision:7}}); // version 1`;
  await writeFile(artifactFile, artifact);
  const oldBuild = buildIdentity({component: 'rulesWorker', sourceCommit: 'a'.repeat(40), inputFingerprint: `sha256:${'b'.repeat(64)}`, artifact: Buffer.from(artifact)});
  const oldHash = oldBuild.artifactHash;
  let server;
  async function start(identity) {
    server = await createRulesWorker({artifactFile, artifactsDirectory, token, buildIdentity: identity,
      releaseCommit: 'c'.repeat(40), releaseId: 'new-release'});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {await new Promise(resolve => server.close(resolve));}
  try {
    let url = await start(oldBuild);
    const identity = await (await fetch(`${url}/health`)).json();
    assert.equal(identity.sourceCommit, oldBuild.sourceCommit);
    assert.equal(identity.releaseCommit, 'c'.repeat(40));
    assert.equal(identity.provenance, 'baked');
    assert.equal(identity.workerRuntime.version, process.versions.node);
    await stop();
    const newArtifact = artifact.replace('version 1', 'version 2');
    await writeFile(artifactFile, newArtifact);
    const newBuild = buildIdentity({component: 'rulesWorker', sourceCommit: 'd'.repeat(40), inputFingerprint: `sha256:${'e'.repeat(64)}`, artifact: Buffer.from(newArtifact)});
    url = await start(newBuild);
    const pending = {schemaVersion: 1, world: {schemaVersion: 5, pendingDecision: {id: 'saved-decision', phase: 'after-roll-before-outcome', roll: 17}}, entropy: {cursor: 9}};
    const response = await fetch(`${url}/transition`, {method: 'POST', headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({artifactHash: oldHash, envelope: pending, intent: {type: 'fixture-read'}})});
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).envelope, pending);
    assert.equal(await readFile(path.join(artifactsDirectory, `${oldHash.slice(7)}.cjs`), 'utf8'), artifact);
    await assert.rejects(createRulesWorker({artifactFile, artifactsDirectory, token, buildIdentity: oldBuild}), /artifact identity mismatch/);
    await assert.rejects(createRulesWorker({artifactFile, artifactsDirectory, token, buildIdentity: {...newBuild, workerRuntime: {name: 'node', version: '0.0.0'}}}), /workerRuntime/);
  } finally {
    if (server?.listening) await stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('roguelike-worker-identity-'));
    await rm(directory, {recursive: true, force: true});
  }
});
test('internal worker authenticates requests and retains exact executable artifacts across restart', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'roguelike-worker-'));
  const artifactFile = path.join(directory, 'current.cjs');
  const artifactsDirectory = path.join(directory, 'artifacts');
  const artifact = `exports.initializeRoguelikeCombat = async () => ({status:'needs_content', needs:[], version:1}); exports.executeRoguelikeCampAction = async (input) => ({status:'ready', patch:{current_hp: input.character.current_hp + 1}, events:[{type:'healing',amount:1}]});`;
  await writeFile(artifactFile, artifact);
  const oldHash = `sha256:${createHash('sha256').update(artifact).digest('hex')}`;
  let server;
  async function start() {
    server = await createRulesWorker({artifactFile, artifactsDirectory, token});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() {await new Promise(resolve => server.close(resolve));}
  const post = (url, body, authorization = `Bearer ${token}`) => fetch(`${url}/initialize`, {
    method: 'POST', headers: {authorization, 'Content-Type': 'application/json'}, body: JSON.stringify(body)});
  try {
    let url = await start();
    assert.equal((await post(url, {}, 'Bearer wrong')).status, 401);
    assert.equal((await (await fetch(`${url}/health`)).json()).artifactHash, oldHash);
    assert.equal((await (await post(url, {})).json()).version, 1);
    const camp = await fetch(`${url}/camp-action`, {method:'POST', headers:{authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body:JSON.stringify({input:{character:{current_hp:4}}})});
    assert.equal(camp.status,200);
    assert.deepEqual(await camp.json(), {status:'ready',patch:{current_hp:5},events:[{type:'healing',amount:1}],artifactHash:oldHash});
    await stop();
    await writeFile(artifactFile, artifact.replace('version:1', 'version:2'));
    url = await start();
    assert.equal((await (await post(url, {})).json()).version, 2);
    assert.equal((await (await post(url, {artifactHash: oldHash})).json()).version, 1);
    assert.equal((await post(url, {artifactHash: '../current.cjs'})).status, 422);
    assert.equal((await post(url, {artifactHash: `sha256:${'0'.repeat(64)}`})).status, 409);
    assert.equal(await readFile(path.join(artifactsDirectory, `${oldHash.slice(7)}.cjs`), 'utf8'), artifact);
  } finally {
    if (server?.listening) await stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('roguelike-worker-'));
    await rm(directory, {recursive: true, force: true});
  }
});

test('transition diagnostics expose known rule codes without exception details', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'roguelike-worker-diagnostics-'));
  const artifactFile = path.join(directory, 'current.cjs');
  const artifact = `exports.stepRoguelikeCombat = (_envelope, intent) => {throw new Error(intent.message);};`;
  await writeFile(artifactFile, artifact);
  const server = await createRulesWorker({artifactFile, artifactsDirectory: path.join(directory, 'artifacts'), token});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const [message, expected] of [
      ['OutOfRange: target-private is outside 0 ft range; entropy-private', {rejectionCode: 'OutOfRange'}],
      ['InsufficientResources: Missing resources: slot_private; entropy-private', {rejectionCode: 'InsufficientResources'}],
      ['InvalidActionDefinition: private-snapshot-secret', {rejectionCode: 'InvalidActionDefinition'}],
      ['OutOfRangePrivate: entropy-private', {}],
      ['prefix OutOfRange: entropy-private', {}],
      ['private-snapshot-secret', {}],
      ['Прыжок превышает доступную дистанцию: entropy-private', {}],
      ['Каталог не содержит spell/test; entropy-private', {}],
      ['Карта столкновения отсутствует', {message: 'Карта столкновения отсутствует'}],
      ['Каталог не содержит spell/test_spell', {message: 'Каталог не содержит spell/test_spell'}],
    ]) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/transition`, {
        method: 'POST', headers: {authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({envelope: {entropy: {seed: 'request-private'}}, intent: {message}}),
      });
      assert.equal(response.status, 422);
      const diagnostic = await response.json();
      assert.deepEqual(diagnostic, {error: 'invalid_combat_command', ...expected});
      assert.ok(!JSON.stringify(diagnostic).includes('private'));
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('roguelike-worker-diagnostics-'));
    await rm(directory, {recursive: true, force: true});
  }
});
