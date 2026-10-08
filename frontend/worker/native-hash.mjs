import {createHash} from 'node:crypto';
import {Module} from 'node:module';
import path from 'node:path';

// A compiler optimization for one exact, tested portable SHA implementation.
// Retained source files and their artifact identities are never overwritten.
// Unknown/minified implementations retain their original executable behavior.
const portableRoutineHash='6f82df33cdeebacc5216462e0a8cfe108a7c15a6cbbfaa21158d66a11d1963df';
const spatialRoutines={
  projectCombatAuras:'205c391d5ee56cb9656b4a0afb3bd687f08a37b8c26671b5ed424f9b2e9cf018',
  spatialFacts:'924f91ab0c88961dc16c2122bf1a284316cfac5b3f57a68fcf53b14238ca65f9',
  collectLifePolicies:'9904272a6ded04bc417ef6e0a627f32435013d88f19c8613ab981ac7b5a9a765',
};

// The recognized aura projector queries one unchanged input board. Life-policy
// evaluation is pure in these spatial queries, so share it only during that
// projection, keyed by all three input identities. Derived aura actors and
// later phases never consult this cache. Node executes these functions
// synchronously; finally restores the scope even on a rule rejection.
export function spatialMemoSource(source) {
  const routines={};
  for(const [name,expected] of Object.entries(spatialRoutines)){
    const start=source.indexOf(`function ${name}(`),end=source.indexOf('\n}',start)+2;
    if(start<0||end<2)return source;
    const routine=source.slice(start,end);
    if(createHash('sha256').update(routine).digest('hex')!==expected)return source;
    routines[name]=routine;
  }
  const aura=routines.projectCombatAuras.replace('{','{\n const __projectionLifeMemo=new WeakMap();')
    .replace('spatialFacts(state, actor.id, target.id, false, illuminationSources)','spatialFacts(state, actor.id, target.id, false, illuminationSources, __projectionLifeMemo)')
    // This exact routine changes only character and passives on copied actors.
    // Comparing those values plus actor key order gives the same JSON equality
    // without serializing every unchanged inventory, resource and effect twice.
    .replace('JSON.stringify(state.world.actors) === JSON.stringify(actors)',
      "Object.keys(state.world.actors).length === Object.keys(actors).length && Object.keys(state.world.actors).every((id,index)=>Object.keys(actors)[index]===id && JSON.stringify(state.world.actors[id].character)===JSON.stringify(actors[id].character) && JSON.stringify(state.world.actors[id].passives)===JSON.stringify(actors[id].passives))");
  if(!aura.includes('illuminationSources, __projectionLifeMemo)'))return source;
  const spatial=routines.spatialFacts.replace('illuminationSources) {','illuminationSources, __memo) {\n const __previous=__spatialLifeMemo; if(__memo)__spatialLifeMemo=__memo; try {')
    .slice(0,-1)+'\n } finally {__spatialLifeMemo=__previous;}\n}';
  return source.replace(routines.projectCombatAuras,aura).replace(routines.spatialFacts,spatial)
    .replace(routines.collectLifePolicies,routines.collectLifePolicies.replace('function collectLifePolicies(','function __collectLifePoliciesUncached('))
    +`\nlet __spatialLifeMemo;
function collectLifePolicies(state,passives,character) {
  if(!__spatialLifeMemo)return __collectLifePoliciesUncached(state,passives,character);
  let byPassive=__spatialLifeMemo.get(state);if(!byPassive){byPassive=new Map();__spatialLifeMemo.set(state,byPassive);}
  let byCharacter=byPassive.get(passives);if(!byCharacter){byCharacter=new Map();byPassive.set(passives,byCharacter);}
  if(!byCharacter.has(character))byCharacter.set(character,__collectLifePoliciesUncached(state,passives,character));
  return byCharacter.get(character);
}\n`;
}

export function progressGuardSource(source) {
  const start=source.indexOf('function stepRoguelikeCombat('),end=source.indexOf('\n}',start)+2;
  if(start<0||end<2)return source;
  const routine=source.slice(start,end);
  if(createHash('sha256').update(routine).digest('hex')!=='ee0bcc372244e6e270181b3e2389d1619936e25e3e91e92a3af7f54bc03d1814')return source;
  // A different primitive field proves that the canonical states differ.
  // When these fields do not change, retain the complete original hash guard.
  return source.replace(routine,routine.replace('if (canonicalSha256Sync(state) === canonicalSha256Sync(before))',
    'if (state.world.scene.round === before.world.scene.round && state.world.scene.activeIndex === before.world.scene.activeIndex && state.world.scene.turnStarted === before.world.scene.turnStarted && canonicalSha256Sync(state) === canonicalSha256Sync(before))'));
}
export function nativeHashSource(source) {
  const match=/^function sha256String\d*\(value\) \{[\s\S]*?^\}/m.exec(source);
  if(!match||createHash('sha256').update(match[0]).digest('hex')!==portableRoutineHash)return source;
  const replacement=match[0].slice(0,match[0].indexOf('{')+1)+"\n  return require('node:crypto').createHash('sha256').update(value, 'utf8').digest('hex');\n}";
  return source.replace(match[0],replacement);
}
export function compileNativeHashArtifact(file,bytes) {
  const source=bytes.toString('utf8'),optimized=progressGuardSource(spatialMemoSource(nativeHashSource(source)));
  if(optimized===source)return undefined;
  const compiled=new Module(file);
  compiled.filename=file;compiled.paths=Module._nodeModulePaths(path.dirname(file));
  compiled._compile(optimized,file);
  return compiled.exports;
}
