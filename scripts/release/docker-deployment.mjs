// Prepared host adapter. Unit tests inject its Docker boundary; policy starts disabled.
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync, lstatSync} from 'node:fs';
import path from 'node:path';
import {evidenceHash} from './validate-manifest.mjs';
import {assertRuntimeWriterPolicy,assertExpansionWritersOff} from './writer-environment.mjs';
export {assertExpansionWritersOff} from './writer-environment.mjs';
import {deploymentEnvironment, assertServiceIdentities} from './deploy-state.mjs';
import {readRetainedRuntime} from './retained-runtime.mjs';
import {databaseMigrationSet,databaseStateFromResult,assertExecutableMigrationRegistry} from './migration-transition.mjs';
import {inspectIdentity} from './ci-images.mjs';
import {backupFile,checksum, verifyDeploymentBackup} from './backup-manifest.mjs';
import {retainImmutableAssets} from './retained-assets.mjs';
import {readDockerInventory,readDockerSchemaLedgerProof} from './read-snapshot.mjs';
import {verifyBackupSourceReleases} from './source-release-references.mjs';
import {bindDeploymentDatabase,databaseURLFromEnvironment,databaseIdentityHash} from './database-binding.mjs';
import {isLegacyBaseline,validateLegacyBaseline,baselineDocument,componentImage,legacyRuntimeFingerprint,deploymentStateFile} from './legacy-baseline.mjs';
const service = {backend: 'backend', frontend: 'frontend', rulesWorker: 'rules-worker'};
const read = file => JSON.parse(readFileSync(file, 'utf8'));
export async function assertLiveReferenceCoverage({inventory,plan,backup,backupDirectory,artifactDirectory}){
  await verifyBackupSourceReleases(backupDirectory,inventory.sourceReleaseReferences,backup.sourceReleases??[],backup.files);
  for(const hash of inventory.artifactHashes){
    if(!plan.preservesArtifacts.includes(hash))throw Error('Live history introduced an artifact not covered by candidate rehearsal');
    if(await checksum(path.join(artifactDirectory,`${hash.slice(7)}.cjs`))!==hash)throw Error('Live referenced artifact is absent or corrupt');
  }
  return {status:'verified',artifactHashes:inventory.artifactHashes,sourceReleaseReferenceHash:evidenceHash(inventory.sourceReleaseReferences)};
}
// Database observations belong to active.json/operation journals. An immutable
// application directory must remain reusable after the database has expanded.
export function releaseApplicationState(state) {
  const {database, ...application} = state;
  return application;
}

function command(args, {input,env={}} = {}) {
  try {return execFileSync('docker', args, {input, env:{...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.toUpperCase().startsWith('PG'))),...env}, encoding: 'utf8', stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024, timeout: 310_000}).trim();}
  catch(error) {const code=error.code==='ENOBUFS'?'ENOBUFS':/canceling statement due to statement timeout/.test(String(error.stderr??''))?'PG_STATEMENT_TIMEOUT':'docker-step-failed';throw Object.assign(Error('Docker deployment step failed; private host logs require separate inspection'), {code});}
}
export function assertHostConfiguration(config, policy, {production = false, enabled = process.env.DEPLOY_PRODUCTION_ENABLED} = {}) {
  if (!production || enabled !== 'true' || policy?.schemaVersion !== 1 || policy.productionEnabled !== true
    || !['no-schema-change', 'additive-298-300'].includes(policy.migrationMode) || policy.deleteBackupsImagesAssets !== false) throw Error('Production deployment remains disabled until separate explicit authorization');
  if (config.schemaVersion !== 1 || !/^[a-z][a-z0-9_-]{0,62}$/.test(config.project)
    || !/^[a-z0-9][a-z0-9._:/-]*@sha256:[a-f0-9]{64}$/.test(config.postgresImage)) throw Error('Incomplete host configuration');
  for (const key of ['root', 'composeFile', 'caddyFile', 'deployEnvFile', 'appEnvFile', 'workerEnvFile', 'artifactDirectory', 'assetDirectory', 'backupDirectory', 'migrationBaselineFile']) {
    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key]) || /[\r\n\0]/.test(config[key])) throw Error('Explicit absolute host paths required');
  }
  for (const key of ['composeHash', 'caddyHash']) if (!/^sha256:[a-f0-9]{64}$/.test(config[key])) throw Error('Reviewed infrastructure checksums required');
  return {...config, migrationMode: policy.migrationMode};
}
export async function createDockerDeploymentAdapter(config,{command:run=command,identityProbe=inspectIdentity}={}) {
  const command=run;
  const endpoint = JSON.parse(command(['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}']));
  if (!/^(unix:\/\/|npipe:\/\/)/.test(endpoint) || process.env.DOCKER_HOST || process.env.DOCKER_CONTEXT) throw Error('A default local Docker socket without endpoint overrides is required');
  if (await checksum(config.composeFile) !== config.composeHash || await checksum(config.caddyFile) !== config.caddyHash) throw Error('Infrastructure differs from reviewed host configuration');
  const baseline = read(config.migrationBaselineFile);
  if(isLegacyBaseline(baseline))validateLegacyBaseline(baseline);
  else if (baseline.schemaVersion !== 1 || baseline.inspected !== true || !Array.isArray(baseline.migrationSet)
    || !/^sha256:[a-f0-9]{64}$/.test(baseline.inspectionReportHash)) throw Error('Explicit inspected migration baseline required; historical checksums cannot be inferred');
  const capture=read(backupFile(config.backupDirectory,'capture.json')),backup=read(backupFile(config.backupDirectory,'backup.json'));
  const sourceFile=backup.files?.filter(row=>row.category==='source-binding');
  if(capture.schemaVersion!==1||capture.kind!=='candidate-capture'||capture.status!=='captured'||sourceFile?.length!==1
    ||!capture.files?.some(row=>evidenceHash(row)===evidenceHash(sourceFile[0])))throw Error('Fresh capture with database source binding required');
  const sourcePath=backupFile(config.backupDirectory,sourceFile[0].path);
  if(await checksum(sourcePath)!==sourceFile[0].sha256)throw Error('Captured database binding changed');
  const source=read(sourcePath);
  if(source.schemaVersion!==1||!/^[a-f0-9]{64}$/.test(source.backendContainerId)||!/^sha256:[a-f0-9]{64}$/.test(source.databaseIdentityHash))throw Error('Invalid captured database source binding');
  let binding,backendReplacementStarted=false;
  const permitted=new Map();
  const permit=state=>permitted.set(evidenceHash(releaseApplicationState(state)),state);
  permit(read(deploymentStateFile(config)));
  function assertLiveDatabase(state){
    if(state)permit(state);
    // A failed candidate can be stopped during rollback. Its immutable image
    // and actual launch environment still bind the DB; final service health is
    // separately mandatory in observe(). Never infer a missing container's DSN.
    const id=command(['ps','-a','--filter',`label=com.docker.compose.project=${config.project}`,'--filter','label=com.docker.compose.service=backend','--no-trunc','--format','{{.ID}}']);
    if(id===''&&backendReplacementStarted&&binding)return binding;
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exactly one backend container required for database binding');
    const container=JSON.parse(command(['inspect',id]))[0];let dsn;
    const candidates=[...permitted.values()].filter(value=>isLegacyBaseline(value)?value.components.backend.imageId===container.Image:componentImage(value,'backend')===container.Config?.Image);
    for(const candidate of candidates){
      const image=JSON.parse(command(['image','inspect',componentImage(candidate,'backend')]))[0];
      try{const value=bindDeploymentDatabase(candidate,container,image);assertRuntimeWriterPolicy(container.Config.Env,candidate);dsn=value;break;}catch{ /* Try another permitted launch of the same immutable image. */ }
    }
    if(!dsn||databaseIdentityHash(dsn)!==source.databaseIdentityHash||(binding&&binding!==dsn))throw Error('Running backend database differs from captured source');
    binding=dsn;return dsn;
  }
  const releaseDir = state => isLegacyBaseline(state)?config.legacyBaselineDirectory:path.join(config.root, 'releases', state.manifest.releaseId);
  const retained=new Map(),created=new Set();
  function retainedLaunch(state){
    if(isLegacyBaseline(state))return null;
    const directory=Object.hasOwn(state,'uiProofAnchor')?path.join(config.root,'frontend-releases',state.manifest.releaseId):releaseDir(state),key=evidenceHash(releaseApplicationState(state));
    if(created.has(directory))return null;
    if(retained.has(key)){retained.get(key).assertUnchanged();return retained.get(key);}
    if(!existsSync(path.join(directory,'compose.runtime.json'))){if(Object.hasOwn(state,'uiProofAnchor'))throw Error('Retained frontend predecessor launch is missing');return null;}
    const value=readRetainedRuntime(config,state,{command,expectedEnvironment:deploymentEnvironment(state)});
    retained.set(key,value);return value;
  }
  function ensureRelease(state) {
    if(isLegacyBaseline(state)){
      validateLegacyBaseline(state);deploymentStateFile({...config,root:config.root});
      if(!config.legacyBaselineDirectory||path.dirname(path.resolve(config.legacyBaselineDirectory))!==path.resolve(config.root))throw Error('Protected legacy rollback directory required');
      const file=backupFile(config.legacyBaselineDirectory,'rollback.compose.json');
      if(evidenceHash(read(file))!==state.rollbackConfigurationHash)throw Error('Observed rollback configuration changed');
      return config.legacyBaselineDirectory;
    }
    const previous=retainedLaunch(state);if(previous)return previous.directory;
    const directory = releaseDir(state); mkdirSync(directory, {recursive: true});created.add(directory);
    if (lstatSync(directory).isSymbolicLink()) throw Error('Release directory cannot be a symlink');
    const environment = {...deploymentEnvironment(state), APP_ENV_FILE: config.appEnvFile, WORKER_ENV_FILE: config.workerEnvFile,
      RULES_ARTIFACTS_DIRECTORY: config.artifactDirectory, FRONTEND_ASSETS_DIRECTORY: config.assetDirectory};
    const files = {'state.json': JSON.stringify(releaseApplicationState(state), null, 2) + '\n', 'compose.env': Object.entries(environment).map(([key, value]) => `${key}=${value}`).join('\n') + '\n',
      'compose.prod.yml': readFileSync(config.composeFile), Caddyfile: readFileSync(config.caddyFile)};
    for (const [name, content] of Object.entries(files)) {
      const file = path.join(directory, name);
      if (existsSync(file)) {if (!readFileSync(file).equals(Buffer.from(content))) throw Error('Immutable release directory differs from composition');}
      else writeFileSync(file, content, {flag: 'wx', mode: 0o600});
    }
    return directory;
  }
  function compose(state, args) {
    const directory = ensureRelease(state);
    if(isLegacyBaseline(state))return command(['compose','--project-name',config.project,'-f',path.join(directory,'rollback.compose.json'),...args]);
    const previous=retainedLaunch(state);
    if(previous)return command(['compose','--project-name',config.project,'-f',previous.runtimeFile,...args]);
    return command(['compose', '--project-name', config.project, '--env-file', config.deployEnvFile, '--env-file', path.join(directory, 'compose.env'), '-f', path.join(directory, 'compose.prod.yml'), ...args]);
  }
  function effectiveComposition(state){
    const previous=retainedLaunch(state);
    const document=previous?previous.document():JSON.parse(compose(state,['config','--format','json']));
    const environment=document.services?.backend?.environment;
    if(!environment||typeof environment!=='object'||Array.isArray(environment))throw Error('Resolved backend environment required');
    // Compose config's JSON presentation already escapes literal dollars for
    // another Compose parse. Decode once for comparison, retain the document
    // itself unchanged for `up` (a second escape would change credentials).
    const values=Object.entries(environment).map(([key,value])=>key+'='+String(value).replaceAll('$$','$'));
    if(databaseURLFromEnvironment(values)!==assertLiveDatabase())throw Error('Effective Compose backend database differs from captured source');
    assertRuntimeWriterPolicy(values,state);
    if(document.services.backend.image!==componentImage(state,'backend'))throw Error('Resolved backend image differs from release');
    return document;
  }
  const databaseNetwork = `${config.project}_edge`;
  function validateDatabaseNetwork() {
    const network = JSON.parse(command(['network', 'inspect', databaseNetwork]));
    if (network.length !== 1 || network[0].Labels?.['com.docker.compose.project'] !== config.project || network[0].Labels?.['com.docker.compose.network'] !== 'edge') throw Error('Reviewed database network differs from active Compose project');
  }
  function migrationCommand(database, inspectOnly) {
    validateDatabaseNetwork();assertLiveDatabase();
    return JSON.parse(command(['run', '--rm', '-i', '--read-only', '--network', databaseNetwork, '-e', 'DATABASE_URL',
      '-e', `RELEASE_ID=${database.request.releaseId}`, '-e', `RELEASE_COMMIT=${database.request.candidateSourceCommit}`,
      database.executorImageDigest, inspectOnly ? '--inspect-release-migrations' : '--migrate-release'], {input: JSON.stringify(database.request),env:{DATABASE_URL:binding}}));
  }
  async function assertDatabase(expected, database) {
    assertLiveDatabase();
    const historical=isLegacyBaseline(baseline)?baseline.migrationIds.map(id=>({id})):baseline.migrationSet;
    for (const row of historical) if (!expected.some(item => isLegacyBaseline(baseline)?item.id===row.id:evidenceHash(item) === evidenceHash(row))) throw Error('Migration identity differs from inspected historical baseline');
    if ((isLegacyBaseline(baseline)?evidenceHash(historical.map(row=>row.id))!==evidenceHash(expected.map(row=>row.id)):evidenceHash(historical)!==evidenceHash(expected)) && !database) throw Error('Observed additive database state required');
    if (database) {
      const receipt = migrationCommand(database, true);
      if (receipt.status !== 'verified' || receipt.build?.provenance !== 'baked'
        || receipt.build.sourceCommit !== database.request.candidateSourceCommit || receipt.build.inputFingerprint !== database.request.candidateInputFingerprint
        || receipt.result?.schemaProofHash !== database.schemaProofHash || evidenceHash(receipt.result.observedVersions) !== evidenceHash(expected.map(row => row.id).sort())) throw Error('Expanded database proof differs from recorded schema');
      if(database.request.schemaVersion===2&&receipt.result.baselineObservationHash!==database.request.baselineObservationHash)throw Error('Migration inspection differs from legacy observation');
      return {schemaStatus: 'verified', migrationSet: expected, schemaProofHash: receipt.result.schemaProofHash, oldReadersSafe: receipt.result.rollbackReadersSafe};
    }
    validateDatabaseNetwork();
    // DSN remains inside the container environment, never in argv/logs.
    const result = command(['run', '--rm', '--read-only', '--network', databaseNetwork, '-e', 'DATABASE_URL', '--entrypoint', 'sh', config.postgresImage, '-ec',
      'exec psql "$DATABASE_URL" -X -qAt -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; SELECT coalesce(json_agg(version ORDER BY version),\'[]\'::json) FROM schema_migrations; ROLLBACK;"'],{env:{DATABASE_URL:binding}});
    if (evidenceHash(JSON.parse(result)) !== evidenceHash(expected.map(item => item.id).sort())) throw Error('Live database has missing/unexpected migrations');
    if(isLegacyBaseline(baseline)){
      const proof=await readDockerSchemaLedgerProof({command,postgresImage:config.postgresImage,databaseNetwork,dsn:binding});
      if(proof.schemaFingerprint!==baseline.schemaFingerprint||evidenceHash(proof.migrations)!==evidenceHash(expected.map(item=>item.id).sort()))throw Error('Observed historical database schema or ledger changed');
    }
    return {schemaStatus: 'verified', migrationSet: expected};
  }
  function assertLiveWriterPolicy(state) {
    assertLiveDatabase(state);
    const id=compose(state,['ps','-q','backend']);
    if(!/^[a-f0-9]{64}$/.test(id))throw Error('Exactly one backend required for expansion writer policy');
    assertRuntimeWriterPolicy(JSON.parse(command(['inspect',id]))[0].Config.Env,state);
  }
  async function retainAssets(state, extraction) {
    const id = command(['create', '--network', 'none', '--entrypoint', '/bin/true', componentImage(state,'frontend')]);
    if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid extraction container');
    mkdirSync(extraction);
    try {command(['cp', `${id}:/usr/share/nginx/html/.`, extraction]);} finally {command(['rm', id]);}
    await retainImmutableAssets(extraction, config.assetDirectory);
  }
  return {
    allowRecovery(operation){
      if(!operation.touched?.includes('backend')||['succeeded','rolled_back','failed_before_cutover'].includes(operation.status))return;
      const {previous,desired}=operation.plan;permit(previous);permit(desired);
      // Only a journaled backend replacement can use the already validated
      // private candidate document if the failed container itself is absent.
      const file=path.join(releaseDir(desired),'compose.runtime.json');
      if(!existsSync(file)||lstatSync(file).isSymbolicLink())throw Error('Recovery lacks checked runtime configuration');
      const backend=read(file).services?.backend,environment=backend?.environment;
      if(backend?.image!==desired.manifest.components.backend.imageDigest||!environment||typeof environment!=='object'||Array.isArray(environment))throw Error('Recovery runtime differs from candidate');
      const values=Object.entries(environment).map(([key,value])=>key+'='+String(value).replaceAll('$$','$'));
      const dsn=databaseURLFromEnvironment(values);
      if(databaseIdentityHash(dsn)!==source.databaseIdentityHash)throw Error('Recovery database differs from captured source');
      for(const [key,value] of Object.entries({RELEASE_ID:desired.instances.backend.releaseId,RELEASE_COMMIT:desired.instances.backend.releaseCommit})){
        if(!values.includes(key+'='+value))throw Error('Recovery runtime launch differs from candidate');
      }
      assertRuntimeWriterPolicy(values,desired);binding=dsn;backendReplacementStarted=true;
    },
    assertDatabase,
    async assertHistoricalInventory(plan) {
      permit(plan.previous);permit(plan.desired);assertLiveDatabase();effectiveComposition(plan.previous);effectiveComposition(plan.desired);validateDatabaseNetwork();
      const inventory=await readDockerInventory({command,postgresImage:config.postgresImage,databaseNetwork,dsn:binding,options:config.inventory});
      return assertLiveReferenceCoverage({inventory,plan,backup,backupDirectory:config.backupDirectory,artifactDirectory:config.artifactDirectory});
    },
    backup: active => verifyDeploymentBackup(config.backupDirectory, baselineDocument(active)),
    async observe(state) {
      retainedLaunch(state)?.assertLive();assertLiveWriterPolicy(state);effectiveComposition(state);
      const database = await assertDatabase(databaseMigrationSet(state), state.database), services = {};
      for (const [key, name] of Object.entries(service)) {
        const id = compose(state, ['ps', '-q', name]);
        if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Expected exactly one live component container');
        const info = JSON.parse(command(['inspect', id]))[0], expected = componentImage(state,key);
        if (key === 'backend') assertRuntimeWriterPolicy(info.Config.Env,state);
        const image = JSON.parse(command(['image', 'inspect', expected]))[0];
        if(isLegacyBaseline(state)){if(info.Image!==expected||image.Id!==expected)throw Error('Legacy running image ID differs');}
        else if (info.Config.Image !== expected || info.Image !== image.Id || !image.RepoDigests.includes(expected)) throw Error('Running container differs from manifest digest');
        const args = key === 'rulesWorker' ? ['node', '-e', "fetch('http://127.0.0.1:8090/health').then(async r=>{if(!r.ok)process.exit(1);console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"]
          : ['wget', '-qO-', key === 'backend' ? 'http://127.0.0.1:8080/api/health' : 'http://127.0.0.1:3000/build-info.json'];
        const identity=JSON.parse(command(['exec',id,...args]));
        services[key] = isLegacyBaseline(state)?{healthy:info.State?.Health?.Status==='healthy',imageId:expected,configurationHash:legacyRuntimeFingerprint(info),runtimeClaim:identity.source_commit??identity.sourceCommit,artifactHash:identity.artifactHash}
          :{healthy: info.State?.Health?.Status === 'healthy', imageDigest: expected, containerId: id, identity};
      }
      return {database, services};
    },
    async prepare(plan) {
      permit(plan.previous);permit(plan.desired);retainedLaunch(plan.previous)?.assertLive();assertLiveDatabase();effectiveComposition(plan.previous);effectiveComposition(plan.desired);
      const {desired, previous} = plan, directory = ensureRelease(desired), services = {};
      const isolated = {...desired, instances: Object.fromEntries(Object.keys(service).map(key => [key, {releaseId: desired.manifest.releaseId, releaseCommit: desired.manifest.releaseCommit}]))};
      for (const key of Object.keys(service)) {
        const digest = desired.manifest.components[key].imageDigest; command(['pull', digest]);
        const identity = identityProbe(digest, {candidate: desired.manifest.releaseCommit, releaseId: desired.manifest.releaseId}, {name: key === 'rulesWorker' ? 'worker' : key});
        services[key] = {healthy: true, imageDigest: digest, identity};
      }
      assertServiceIdentities(isolated, services);
      await assertDatabase(databaseMigrationSet(previous), previous.database);
      const migrations = JSON.parse(command(['run', '--rm', '--network', 'none', '--read-only', desired.manifest.components.backend.imageDigest, '--migration-info']));
      assertExecutableMigrationRegistry(migrations,desired.manifest.migrationSet,databaseMigrationSet(previous));
      if (plan.migrationMode === 'additive-298-300') {
        if (config.migrationMode !== 'additive-298-300') throw Error('Reviewed additive migration policy required');
        for (const row of plan.migration.added) if (!migrations.additiveMigrations?.some(item => evidenceHash(item) === evidenceHash(row))) throw Error('Candidate additive source checksum differs from approval');
      }
      const artifactFile = path.join(config.artifactDirectory, `${desired.manifest.rulesArtifactHash.slice(7)}.cjs`);
      if (!existsSync(artifactFile)) {
        const id = command(['create', '--network', 'none', '--entrypoint', '/bin/true', desired.manifest.components.rulesWorker.imageDigest]);
        if (!/^[a-f0-9]{64}$/.test(id)) throw Error('Invalid artifact extraction container');
        const staged = path.join(directory, 'artifact.cjs');
        try {command(['cp', `${id}:/app/artifact.cjs`, staged]);} finally {command(['rm', id]);}
        if (await checksum(staged) !== desired.manifest.rulesArtifactHash) throw Error('Extracted CJS hash differs');
        copyFileSync(staged, artifactFile);
      }
      for (const hash of plan.preservesArtifacts) if (await checksum(path.join(config.artifactDirectory, `${hash.slice(7)}.cjs`)) !== hash) throw Error('Referenced artifact absent/corrupt');
      await retainAssets(previous, path.join(directory, 'assets-previous'));
      await retainAssets(desired, path.join(directory, 'assets-candidate'));
    },
    async migrate(plan) {
      if (config.migrationMode !== 'additive-298-300' || plan.migrationMode !== 'additive-298-300') throw Error('Additive migration policy required');
      permit(plan.previous);permit(plan.desired);assertLiveWriterPolicy(plan.previous);assertExpansionWritersOff(JSON.parse(command(['inspect',compose(plan.previous,['ps','-q','backend'])]))[0].Config.Env);effectiveComposition(plan.previous);effectiveComposition(plan.desired);
      const database = {request: plan.migration.request, executorImageDigest: plan.desired.manifest.components.backend.imageDigest};
      // Reconcile a previously committed transaction before considering a retry.
      try {const observed = migrationCommand(database, true); databaseStateFromResult(plan, observed); return observed;}
      catch {
        // Unknown target/schema is not repaired blindly. Only the exact known
        // baseline permits the same bounded expansion transaction to run.
        await assertDatabase(plan.migration.baseline, plan.previous.database);
        await verifyDeploymentBackup(config.backupDirectory, baselineDocument(plan.previous));
      }
      try {const result = migrationCommand(database, false); databaseStateFromResult(plan, result); return result;}
      catch {throw Object.assign(Error('Additive migration outcome requires reconciliation'), {uncertainOutcome: true});}
    },
    async replace(key, state) {
      if (!service[key]) throw Error('Unknown component');
      permit(state);assertLiveDatabase();
      // Resolve once, validate the effective merged environment, and launch that
      // exact private document. Later edits of either env file cannot redirect
      // the already checked cutover. No credentials enter active/op journals.
      const document=effectiveComposition(state),directory=ensureRelease(state),file=path.join(directory,'compose.runtime.json');
      const content=JSON.stringify(document,null,2)+'\n';
      if(existsSync(file)){if(readFileSync(file,'utf8')!==content)throw Error('Immutable runtime configuration changed');}
      else writeFileSync(file,content,{flag:'wx',mode:0o600});
      if(key==='backend')backendReplacementStarted=true;
      command(['compose','--project-name',config.project,'-f',file,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120',service[key]]);
      assertLiveDatabase();
    },
  };
}
