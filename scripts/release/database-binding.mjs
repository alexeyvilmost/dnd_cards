import {evidenceHash} from './validate-manifest.mjs';
import {isLegacyBaseline,validateLegacyBaseline,legacyRuntimeFingerprint} from './legacy-baseline.mjs';

export function bindCaptureDatabase(active,container,image,identity){
  if(isLegacyBaseline(active)){
    const dsn=bindDeploymentDatabase(active,container,image);
    if(container.State?.Running!==true||container.State.Health?.Status!=='healthy'||identity?.status!=='ok'||identity.source_commit!==active.claimedReleaseCommit)throw Error('Legacy capture health differs');
    return dsn;
  }
  const expected=active.manifest.components.backend,instance=active.instances.backend;
  if(container.State?.Running!==true||container.State?.Health?.Status!=='healthy'||container.Config?.Image!==expected.imageDigest
    ||container.Image!==image.Id||!image.RepoDigests?.includes(expected.imageDigest)
    ||identity?.component!=='backend'||identity.provenance!=='baked'||identity.sourceCommit!==expected.sourceCommit
    ||identity.inputFingerprint!==expected.inputFingerprint||identity.apiProtocolVersion!==active.manifest.apiProtocolVersion
    ||identity.releaseId!==instance.releaseId||identity.releaseCommit!==instance.releaseCommit)throw Error('Running capture source differs from active backend identity');
  return databaseURLFromEnvironment(container.Config.Env);
}
export function databaseURLFromEnvironment(environment){
  const settings=environment?.filter(value=>value.startsWith('DATABASE_URL='))??[];
  if(settings.length!==1)throw Error('Actual backend must declare exactly one DATABASE_URL');
  const dsn=settings[0].slice('DATABASE_URL='.length);let parsed;
  // WHATWG URL normalizes dot segments before exposing pathname; Go url.Parse
  // does not. Reject multi-segment/raw-normalized forms before parsing.
  const raw=dsn.match(/^postgres(?:ql)?:\/\/([^/?#]+)\/([^/?#]+)(?:\?[^#]*)?$/);
  if(!raw||/[\s\0]/.test(dsn)||raw[1].split('@').length!==2||raw[1].slice(raw[1].lastIndexOf('@')+1).includes('%'))throw Error('Database URL must use one explicit non-normalized path segment');
  try{parsed=new URL(dsn);}catch{throw Error('Actual backend database URL is invalid');}
  if(dsn.length>8192||!['postgres:','postgresql:'].includes(parsed.protocol)||!parsed.hostname||parsed.hash)throw Error('Actual backend database URL is invalid');
  // LoadConfig uses only URL fields + sslmode, then a keyword DSN. libpq also
  // honors URI host/dbname overrides, so accepting the raw URI could dump a
  // different database. Fail closed on forms the application cannot bind safely.
  for(const key of parsed.searchParams.keys())if(key!=='sslmode')throw Error('Unsupported backend database URL override');
  if(parsed.searchParams.getAll('sslmode').length>1)throw Error('Ambiguous backend SSL mode');
  const sslmode=parsed.searchParams.get('sslmode')||'require';
  if(!['disable','allow','prefer','require','verify-ca','verify-full'].includes(sslmode))throw Error('Invalid backend SSL mode');
  let user,password,database;
  try{user=decodeURIComponent(parsed.username);password=decodeURIComponent(parsed.password);database=decodeURIComponent(parsed.pathname.slice(1));}catch{throw Error('Invalid database URL encoding');}
  if(!user||!database||[user,password,database,parsed.hostname].some(value=>/[\s\\'\0]/.test(value))||database.includes('/'))throw Error('Explicit unambiguous backend database/user required');
  parsed.search='';parsed.searchParams.set('sslmode',sslmode);
  return parsed.toString(); // Private closure/child environment only; never artifact or argv.
}

// Deliberately excludes the password: private capture provenance is not a
// credential verifier. Full canonical DSN equality is held in memory per run.
export function databaseIdentityHash(dsn){
  const parsed=new URL(dsn);
  return evidenceHash({version:1,host:parsed.hostname,port:parsed.port||'5432',database:decodeURIComponent(parsed.pathname.slice(1)),user:decodeURIComponent(parsed.username),sslmode:parsed.searchParams.get('sslmode')});
}
export function bindDeploymentDatabase(state,container,image){
  if(isLegacyBaseline(state)){
    validateLegacyBaseline(state);
    if(container.Image!==state.components.backend.imageId||image.Id!==container.Image||legacyRuntimeFingerprint(container)!==state.components.backend.configurationHash)throw Error('Legacy backend image/configuration differs');
    const dsn=databaseURLFromEnvironment(container.Config.Env);if(databaseIdentityHash(dsn)!==state.databaseIdentityHash)throw Error('Legacy database identity differs');return dsn;
  }
  const expected=state.manifest.components.backend,instance=state.instances.backend;
  if(container.Config?.Image!==expected.imageDigest||container.Image!==image.Id||!image.RepoDigests?.includes(expected.imageDigest))throw Error('Running backend image differs from permitted deployment');
  for(const [key,value] of Object.entries({RELEASE_ID:instance.releaseId,RELEASE_COMMIT:instance.releaseCommit})){
    const matches=container.Config.Env?.filter(item=>item.startsWith(key+'='))??[];
    if(matches.length!==1||matches[0]!==key+'='+value)throw Error('Running backend launch differs from permitted deployment');
  }
  return databaseURLFromEnvironment(container.Config.Env);
}
