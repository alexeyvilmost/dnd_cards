import {writerPolicy} from './validate-manifest.mjs';
import {isLegacyBaseline} from './legacy-baseline.mjs';

export const writerFlagNames = ['DB_COMPACT_RECEIPTS','DB_FROZEN_CATALOGS','IMAGE_JOBS_ENABLED'];
export function writerEnvironment(manifest) {
  const p=writerPolicy(manifest);
  return {DB_COMPACT_RECEIPTS:p.compactReceipts?'1':'0',DB_FROZEN_CATALOGS:'0',IMAGE_JOBS_ENABLED:p.imageJobs?'1':'0'};
}
function flags(environment) {
  if(!Array.isArray(environment))throw Error('Actual environment array required');
  const result={};
  for(const row of environment){
    if(typeof row!=='string'||!row.includes('='))throw Error('Malformed runtime environment');
    const i=row.indexOf('='),key=row.slice(0,i);
    if(!writerFlagNames.includes(key))continue;
    if(Object.hasOwn(result,key))throw Error('Duplicate writer flag in actual environment');
    result[key]=row.slice(i+1);
  }
  return result;
}
export function assertExpansionWritersOff(environment) {
  const actual=flags(environment);
  for(const key of writerFlagNames)if(actual[key]!==undefined&&actual[key]!=='0')throw Error('Expansion writers must be disabled');
}
export function assertRuntimeWriterPolicy(environment,state) {
  if(isLegacyBaseline(state))return assertExpansionWritersOff(environment);
  if(!state?.manifest)throw Error('Actual permitted manifest state required');
  const expected=writerEnvironment(state.manifest),actual=flags(environment);
  // Previously accepted absent-policy images may omit OFF variables. Explicit
  // policy manifests require exact values; missing is not a runtime claim.
  const explicit=Object.hasOwn(state.manifest,'writerPolicy');
  for(const key of writerFlagNames)if(actual[key]!==expected[key]&&(explicit||actual[key]!==undefined))throw Error('Runtime writer policy differs from permitted release');
}
