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
    .replace('spatialFacts(state, actor2.id, target2.id, false, illuminationSources)','spatialFacts(state, actor2.id, target2.id, false, illuminationSources, __projectionLifeMemo)')
    // This exact routine changes only character and passives on copied actors.
    // Comparing those values plus actor key order gives the same JSON equality
    // without serializing every unchanged inventory, resource and effect twice.
    .replace('JSON.stringify(state.world.actors) === JSON.stringify(actors)',
      "Object.keys(state.world.actors).length === Object.keys(actors).length && Object.keys(state.world.actors).every((id,index)=>Object.keys(actors)[index]===id && __sameAuraCharacterJSON(state.world.actors[id].character,actors[id].character) && __sameAuraPassivesJSON(state.world.actors[id].passives,actors[id].passives))");
  if(!aura.includes('illuminationSources, __projectionLifeMemo)'))return source;
  const spatial=routines.spatialFacts.replace('illuminationSources) {','illuminationSources, __memo) {\n const __previous=__spatialLifeMemo; if(__memo)__spatialLifeMemo=__memo; try {')
    .slice(0,-1)+'\n } finally {__spatialLifeMemo=__previous;}\n}';
  const footprintStart=source.indexOf('function actorFootprint('),footprintEnd=source.indexOf('\n}',footprintStart)+2;
  const footprint=footprintStart>=0&&footprintEnd>footprintStart?source.slice(footprintStart,footprintEnd):undefined;
  const cacheFootprint=footprint&&createHash('sha256').update(footprint).digest('hex')==='40e2b0c11b5b7c67d12f5002d82dc4066d87dfe5da1d8c318197247dc39464bf';
  if(cacheFootprint)source=source.replace(footprint,footprint.replace('function actorFootprint(', 'function __footprintUncached('));
  const footprintHelpers=cacheFootprint?`
const __footprintBySpatialScope=new WeakMap();
function actorFootprint(actor,rules) {
  if(!__spatialLifeMemo||!actor||!rules||rules.tacticalFootprints!=='sized')return __footprintUncached(actor,rules);
  let scopes=__footprintBySpatialScope.get(__spatialLifeMemo);if(!scopes){scopes=new WeakMap();__footprintBySpatialScope.set(__spatialLifeMemo,scopes);}
  let actors=scopes.get(rules);if(!actors){actors=new WeakMap();scopes.set(rules,actors);}
  if(!actors.has(actor))actors.set(actor,__footprintUncached(actor,rules));return actors.get(actor);
}
`:'';
  return source.replace(routines.projectCombatAuras,aura).replace(routines.spatialFacts,spatial)
    .replace(routines.collectLifePolicies,routines.collectLifePolicies.replace('function collectLifePolicies(','function __collectLifePoliciesUncached('))
    +footprintHelpers+`\nlet __spatialLifeMemo;

function __sameAuraCharacterJSON(left,right) {
  const a=Object.keys(left),b=Object.keys(right);
  if(a.length!==b.length||a.some((key,index)=>key!==b[index]))return JSON.stringify(left)===JSON.stringify(right);
  return a.every(key=>left[key]===right[key]||JSON.stringify(left[key])===JSON.stringify(right[key]));
}
function __sameAuraPassivesJSON(left,right) {
  if(!Array.isArray(left)||!Array.isArray(right))return JSON.stringify(left)===JSON.stringify(right);
  if(left.length!==right.length)return false;
  for(let index=0;index<left.length;index++)if(left[index]!==right[index]&&(JSON.stringify(left[index])??'null')!==(JSON.stringify(right[index])??'null'))return false;
  return true;
}
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
  const source=bytes.toString('utf8'),optimized=progressGuardSource(routeObservationMemoSource(spatialMemoSource(nativeHashSource(source))));
  if(optimized===source)return undefined;
  const compiled=new Module(file);
  compiled.filename=file;compiled.paths=Module._nodeModulePaths(path.dirname(file));
  compiled._compile(optimized,file);
  return compiled.exports;
}

// Reuse only inside one recognized, read-only route search. Coordinates still
// reach the original aura geometry on every edge. Nested scopes restore both
// caches and arbitrary later combat phases always recompute their observations.
export function routeObservationMemoSource(source) {
  if (!source.includes('let __spatialLifeMemo;')) return source;
  const routines = {};
  const expected = {
    reachableRoutes: '2ad83d7b1fcfef325339eaa9b78e38c3b6802fe418d1123b62c483deb2272c5a',
    auraDifficultStep: '87977f205a84b487e88b741b6e52ace408edc2e3af456f46a77c3443cc9541c3',
  };
  for (const [name, hash] of Object.entries(expected)) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    if (start < 0 || end <= start) return source;
    const routine = source.slice(start, end);
    if (createHash('sha256').update(routine).digest('hex') !== hash) return source;
    routines[name] = routine;
  }
  const route = routines.reachableRoutes;
  const opening = route.indexOf(') {') + 2;
  if (opening < 2 || route[opening] !== '{') return source;
  const wrapped = route.slice(0, opening + 1) + `
 const __previousLife=__spatialLifeMemo,__previousAura=__routeAuraPayloadMemo;
 __spatialLifeMemo=new WeakMap();__routeAuraPayloadMemo=new WeakMap();try {
` + route.slice(opening + 1, -1) + `
 }finally{__spatialLifeMemo=__previousLife;__routeAuraPayloadMemo=__previousAura;}
}`;
  const payloads = '[...source2.passives ?? [], ...source2.runtime.activeEffects.filter((e) => e.roundsLeft === void 0 || e.roundsLeft > 0).map((e) => e.mechanics)].flatMap(payloadsOf)';
  const aura = routines.auraDifficultStep.replace(payloads, '__routeAuraPayloads(source2)');
  return source.replace(route, wrapped).replace(routines.auraDifficultStep, aura) + `
let __routeAuraPayloadMemo;
function __routeAuraPayloads(source2) {
  if(!__routeAuraPayloadMemo)return ${payloads};
  if(!__routeAuraPayloadMemo.has(source2))__routeAuraPayloadMemo.set(source2,${payloads});
  return __routeAuraPayloadMemo.get(source2);
}
`;
}
