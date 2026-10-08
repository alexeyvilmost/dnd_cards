// Public safe runtime settings relevant to browser/API compatibility. Credentials,
// endpoints and arbitrary environment variables never leave host observation.
import {evidenceHash} from './validate-manifest.mjs';
const backendBooleans=['RULES_CATALOG_BATCH_ENABLED','RULES_WORKER_MIRRORS_ENABLED','RULES_PREPARATION_CACHE_ENABLED','RULES_EQUIPMENT_INTENT_ENABLED','RULES_INITIATIVE_OPTIONS_ENABLED','RULES_CATALOG_PREFETCH_ENABLED','RULES_PERFORMANCE_ENABLED','DB_COMPACT_RECEIPTS','DB_FROZEN_CATALOGS','IMAGE_JOBS_ENABLED'];
export function safeExecutionEnvironment(component,environment){
  const entries=new Map();for(const row of environment??[]){const split=row.indexOf('=');if(split<1||entries.has(row.slice(0,split)))throw Error('Duplicate/invalid observed environment');entries.set(row.slice(0,split),row.slice(split+1));}
  const result={};for(const key of component==='backend'?backendBooleans:[]){const value=entries.get(key)??'0';if(!['0','1'].includes(value))throw Error('Unsupported explicit runtime boolean');result[key]=value;}
  // Keep historical v1 profiles byte-compatible when these settings were
  // absent. Explicit new settings must bind UI proofs and survive rehearsal.
  const optional=component==='backend'?['RULES_COMBAT_ASYNC_PERSIST_ENABLED']:['RULES_PERFORMANCE_ENABLED'];
  for(const key of optional){if(!entries.has(key))continue;const value=entries.get(key);if(!['0','1'].includes(value))throw Error('Unsupported explicit runtime boolean');result[key]=value;}
  const key=component==='backend'?'RULES_WORKER_MAX_INFLIGHT':'RULES_WORKER_MAX_CACHED_ARTIFACTS',value=entries.get(key)??'4';
  if(!/^[1-9]\d{0,3}$/.test(value))throw Error('Invalid bounded runtime setting');result[key]=value;return result;
}
export function validateExecutionProfile(profile){
  if(profile?.schemaVersion!==1||Object.keys(profile).sort().join(',')!=='backend,rulesWorker,schemaVersion')throw Error('Exact public execution profile required');
  for(const component of ['backend','rulesWorker']){
    const row=profile[component];if(!row||Object.keys(row).sort().join(',')!=='environment,instance')throw Error('Invalid execution profile component');
    if(!/^[a-zA-Z0-9._-]{1,160}$/.test(row.instance?.releaseId??'')||!/^[a-f0-9]{40}$/.test(row.instance.releaseCommit??'')||Object.keys(row.instance).length!==2)throw Error('Invalid protected launch identity');
    if(evidenceHash(safeExecutionEnvironment(component,Object.entries(row.environment??{}).map(([key,value])=>key+'='+value)))!==evidenceHash(row.environment))throw Error('Unknown execution profile environment');
  }return profile;
}
