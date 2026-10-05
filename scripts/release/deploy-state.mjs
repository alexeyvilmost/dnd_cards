import {mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, unlinkSync, rmdirSync, lstatSync, realpathSync, readdirSync, openSync, closeSync, fsyncSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertReleaseReady, validateManifest, evidenceHash, retentionReferences} from './validate-manifest.mjs';
import {databaseMigrationSet,validateDatabaseState,migrationTransition,databaseStateFromResult,stateWithDatabase,requiresOldReaders} from './migration-transition.mjs';
import {isLegacyBaseline,validateLegacyBaseline,baselineDocument,baselineArtifact} from './legacy-baseline.mjs';

export const serviceOrder = ['rulesWorker', 'backend', 'frontend'];
const same = (a, b) => evidenceHash(a) === evidenceHash(b);
const read = file => JSON.parse(readFileSync(file, 'utf8'));
export function validateActive(state) {
  if(isLegacyBaseline(state)){validateLegacyBaseline(state);validateDatabaseState(state);return state;}
  if (state?.schemaVersion !== 1 || state.status !== 'active') throw Error('Verified active deployment state required; inspect legacy deployment explicitly');
  validateManifest(state.manifest);
  for (const key of serviceOrder) {
    const instance = state.instances?.[key];
    if (!instance || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(instance.releaseId) || !/^[a-f0-9]{40}$/.test(instance.releaseCommit)) throw Error('Per-component launch identity missing');
  }
  validateDatabaseState(state);
  return state;
}
export function planDeployment(candidate, bundle, active) {
  validateActive(active); assertReleaseReady(candidate, bundle);
  const legacy=isLegacyBaseline(active);
  if(legacy){
    if(candidate.previousReleaseId!==null||bundle.previousManifest!=null||!same(bundle.legacyBaseline,active)||bundle.rehearsalReceipt?.activeHash!==evidenceHash(active))throw Error('First manifest release requires exact observed legacy rehearsal');
  }else{
    if (!same(bundle.previousManifest, active.manifest) || candidate.previousReleaseId !== active.manifest.releaseId) throw Error('Candidate does not follow the actually active manifest');
    if (candidate.releaseId === active.manifest.releaseId) throw Error('Release ID already active');
  }
  const migration = migrationTransition(candidate, bundle, active);
  const changed = legacy?[...serviceOrder]:serviceOrder.filter(key => !same(candidate.components[key], active.manifest.components[key]));
  const instances = Object.fromEntries(serviceOrder.map(key => [key, changed.includes(key)
    ? {releaseId: candidate.releaseId, releaseCommit: candidate.releaseCommit} : {...active.instances[key]}]));
  const desired = {schemaVersion: 1, status: 'active', manifest: candidate, instances,
    ...(migration.mode === 'no-schema-change' && active.database ? {database: active.database} : {})};
  return {schemaVersion: 1,...(legacy?{adoption:'observed-legacy-baseline'}:{}), candidateHash: evidenceHash(candidate), baselineHash: evidenceHash(baselineDocument(active)), changed, previous: active, desired,
    preservesArtifacts: [...new Set([candidate.rulesArtifactHash, baselineArtifact(active), ...bundle.historicalArtifactHashes])].sort(),
    trafficSwitch: 'sequential-compose-services', migrationMode: migration.mode, migration};
}
export function deploymentEnvironment(active) {
  validateActive(active);
  if(isLegacyBaseline(active))throw Error('Legacy rollback uses its observed private Compose document, not generated manifest environment');
  // Compose 2.40 evaluates required expressions inside nested defaults even
  // when the component variable is present. Supply the composition fallback;
  // each component's explicit launch identity below still takes precedence.
  const env = {RELEASE_ID: active.manifest.releaseId, RELEASE_COMMIT: active.manifest.releaseCommit};
  for (const [key, prefix] of [['backend', 'BACKEND'], ['frontend', 'FRONTEND'], ['rulesWorker', 'RULES_WORKER']]) {
    env[`${prefix}_IMAGE`] = active.manifest.components[key].imageDigest;
    env[`${prefix}_RELEASE_ID`] = active.instances[key].releaseId;
    env[`${prefix}_RELEASE_COMMIT`] = active.instances[key].releaseCommit;
  }
  return env;
}
export function assertObserved(active, observed) {
  validateActive(active);
  if (observed?.database?.schemaStatus !== 'verified' || !same(observed.database.migrationSet, databaseMigrationSet(active))) throw Error('Live database migration identity differs or is unverified');
  if (active.database && (observed.database.schemaProofHash !== active.database.schemaProofHash || requiresOldReaders(active) && observed.database.oldReadersSafe !== true)) throw Error('Expanded database proof or old-reader compatibility is unverified');
  assertServiceIdentities(active, observed.services);
  return observed;
}
export function assertServiceIdentities(active, services) {
  validateActive(active);
  if(isLegacyBaseline(active)){
    for(const key of serviceOrder){const expected=active.components[key],actual=services?.[key];
      if(actual?.healthy!==true||actual.imageId!==expected.imageId||actual.configurationHash!==expected.configurationHash||actual.runtimeClaim!==expected.runtimeClaim)throw Error(`Observed legacy ${key} image/configuration/health differs`);
    }
    if(services.rulesWorker.artifactHash!==active.rulesArtifactHash)throw Error('Legacy worker artifact differs');
    return services;
  }
  for (const key of serviceOrder) {
    const actual = services?.[key], expected = active.manifest.components[key];
    if (!actual || actual.healthy !== true || actual.imageDigest !== expected.imageDigest || actual.identity?.provenance !== 'baked'
      || actual.identity.component !== key || actual.identity.sourceCommit !== expected.sourceCommit
      || actual.identity.inputFingerprint !== expected.inputFingerprint || actual.identity.apiProtocolVersion !== active.manifest.apiProtocolVersion
      || actual.identity.releaseId !== active.instances[key].releaseId || actual.identity.releaseCommit !== active.instances[key].releaseCommit) throw Error(`Live ${key} identity/health differs`);
  }
  const worker = services.rulesWorker.identity;
  for (const [key, value] of Object.entries({artifactHash: active.manifest.rulesArtifactHash, workerRuntime: active.manifest.workerRuntime,
    workerProtocolVersion: active.manifest.workerProtocolVersion, supportedWorldSchemaVersions: active.manifest.supportedWorldSchemaVersions, capabilities: active.manifest.capabilities})) {
    if (!same(worker[key], value)) throw Error(`Live worker ${key} differs`);
  }
  return services;
}
async function assertCurrentHistory(adapter,plan){
  const result=await adapter.assertHistoricalInventory(plan);
  if(result?.status!=='verified'||!Array.isArray(result.artifactHashes)||result.artifactHashes.some(hash=>!plan.preservesArtifacts.includes(hash)))throw Error('Fresh live artifact inventory is not covered by rehearsal');
}
async function verifiedBackup(adapter,active){
  const result=await adapter.backup(active);
  if(result?.status!=='verified'||result.manifestHash!==evidenceHash(baselineDocument(active))||result.restoreDrillPassed!==true)throw Error('Verified backup and restore drill required');
  return result;
}
export function createDeploymentStore(root,{legacyBaselineFile}={}) {
  root = path.resolve(root);
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || realpathSync(root) !== root) throw Error('Existing real deployment directory required');
  const operations = path.join(root, 'operations'); mkdirSync(operations, {recursive: true});
  if (lstatSync(operations).isSymbolicLink()) throw Error('Operation directory cannot be a symlink');
  const activeFile = path.join(root, 'active.json'),legacyStateFile=path.join(root,'legacy-state.json'), lock = path.join(root, 'deploy.lock');
  if(legacyBaselineFile&&(!path.resolve(legacyBaselineFile).startsWith(root+path.sep)||lstatSync(legacyBaselineFile).isSymbolicLink()||realpathSync(legacyBaselineFile)!==path.resolve(legacyBaselineFile)))throw Error('Protected observed legacy baseline required');
  const opFile = id => {if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(id)) throw Error('Invalid release ID'); return path.join(operations, `${id}.json`);};
  const atomic = (file, data) => {
    const temporary = `${file}.${randomUUID()}.tmp`;
    const descriptor = openSync(temporary, 'wx', 0o600);
    try {writeFileSync(descriptor, JSON.stringify(data, null, 2) + '\n'); fsyncSync(descriptor);} finally {closeSync(descriptor);}
    try {renameSync(temporary, file);} catch (error) {unlinkSync(temporary); throw error;}
    if (process.platform !== 'win32') {const directory = openSync(path.dirname(file), 'r'); try {fsyncSync(directory);} finally {closeSync(directory);}}
  };
  return {
    active: () => validateActive(read(existsSync(activeFile)?activeFile:existsSync(legacyStateFile)?legacyStateFile:legacyBaselineFile??activeFile)), operation: id => existsSync(opFile(id)) ? read(opFile(id)) : null,
    pending: () => readdirSync(operations).filter(name => name.endsWith('.json')).map(name => read(path.join(operations, name)))
      .filter(item => !['succeeded', 'rolled_back', 'failed_before_cutover'].includes(item.status)),
    writeActive: state => {validateActive(state);if(isLegacyBaseline(state)){atomic(legacyStateFile,state);if(existsSync(activeFile))unlinkSync(activeFile);}else atomic(activeFile,state);}, writeOperation: operation => atomic(opFile(operation.releaseId), operation),
    lock() {
      try {mkdirSync(lock);} catch (error) {if (error.code === 'EEXIST') throw Error('Deployment lock exists; inspect owner/outcome before explicit recovery'); throw error;}
      writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({pid: process.pid, startedAt: new Date().toISOString()}), {flag: 'wx', mode: 0o600});
      return () => {unlinkSync(path.join(lock, 'owner.json')); rmdirSync(lock);};
    },
  };
}

export async function deploy({store, adapter, candidate, bundle, beforePrepare}) {
  const unlock = store.lock();
  let operation;
  try {
    const active = store.active();
    if(beforePrepare)await beforePrepare(active); // lock held; before the first journal or application mutation
    const existing = store.operation(candidate.releaseId);
    if (existing) {
      if (existing.plan.candidateHash !== evidenceHash(candidate)) throw Error('Release ID collision');
      if (existing.status === 'succeeded' && same(active.manifest, candidate)) {
        assertObserved(active, await adapter.observe(active)); return {...existing, repeated: true};
      }
      throw Error('Previous deployment outcome requires inspection/recovery; no blind retry');
    }
    if (store.pending().length) throw Error('Another release outcome requires inspection/recovery before a new candidate');
    const plan = planDeployment(candidate, bundle, active);
    assertObserved(active, await adapter.observe(active));
    operation = {schemaVersion: 1, releaseId: candidate.releaseId, status: 'preparing', plan, touched: [], createdAt: new Date().toISOString()};
    const record = status => {operation.status = status; operation.updatedAt = new Date().toISOString(); store.writeOperation(operation);};
    record('preparing');
    try {
      // A verified backup remains mandatory even for frontend-only releases.
      operation.backup = await verifiedBackup(adapter,active);
      await adapter.prepare(plan, bundle); // pull/identity/embedded migrations, retained assets and CJS, immutable release directory
      assertObserved(active, await adapter.observe(active)); // baseline/schema may have changed during preparation
      if (plan.migrationMode === 'additive-298-300') {
        operation.migrationStarted=true;
        record('migrating');
        const receipt = await adapter.migrate(plan);
        const database = databaseStateFromResult(plan, receipt);
        plan.rollbackState = stateWithDatabase(active, database);
        plan.desired = stateWithDatabase(plan.desired, database);
        operation.migrationReceipt = receipt;
        record('migrated');
        // The application is still old; persist the truthful expanded DB state.
        assertObserved(plan.rollbackState, await adapter.observe(plan.rollbackState));
        store.writeActive(plan.rollbackState);
      }
      await assertCurrentHistory(adapter,plan);
      // Reference scanning can take minutes. Re-verify the same captured bytes
      // and original capture age immediately before forward replacements. This
      // performs no dump and deliberately does not gate compatible rollback.
      operation.cutoverBackup = await verifiedBackup(adapter,plan.previous);
      record('prepared');
      for (const component of plan.changed) {
        operation.touched.push(component); record(`replacing:${component}`);
        await adapter.replace(component, plan.desired);
      }
      record('verifying'); assertObserved(plan.desired, await adapter.observe(plan.desired));
      store.writeActive(plan.desired); record('succeeded'); return operation;
    } catch (error) {
      operation.failure = error.code ?? 'deployment-failed'; // Do not persist raw process output/env/DB errors.
      if (error.uncertainOutcome || operation.status === 'migrating') {record('recovery_required'); throw Error('Deployment outcome unknown; inspect before explicit recovery');}
      if (!operation.touched.length) {
        if (plan.rollbackState) {
          try {assertObserved(plan.rollbackState, await adapter.observe(plan.rollbackState)); store.writeActive(plan.rollbackState);}
          catch {record('recovery_required'); throw Error('Expanded database compatibility requires inspection');}
        }
        record('failed_before_cutover'); throw error;
      }
      record('rolling_back');
      try {
        const rollbackState = plan.rollbackState ?? active;
        const database = await adapter.assertDatabase(databaseMigrationSet(rollbackState), rollbackState.database);
        if (requiresOldReaders(rollbackState) && database?.oldReadersSafe !== true) throw Error('Old readers are no longer compatible');
        await assertCurrentHistory(adapter,plan);
        for (const component of [...operation.touched].reverse()) await adapter.replace(component, rollbackState);
        assertObserved(rollbackState, await adapter.observe(rollbackState)); store.writeActive(rollbackState); record('rolled_back');
      } catch {record('recovery_required'); throw Error('Rollback not verified; preserve all artifacts and inspect live state');}
      throw Error('Candidate failed; previous compatible application composition restored; database was not restored');
    }
  } finally {unlock();}
}

// Recovery reconciles observations first. Only an explicitly approved additive
// request may be replayed: its DDL+ledger transaction is atomic and idempotent.
export async function recover({store, adapter, releaseId, rollback = false}) {
  const unlock = store.lock();
  try {
    const operation = store.operation(releaseId);
    if (!operation) throw Error('No operation to inspect');
    const plan = operation.plan;
    const active=store.active();
    if (['succeeded','rolled_back','failed_before_cutover'].includes(operation.status)) {
      const completed=operation.status==='succeeded'?plan.desired:(plan.rollbackState??plan.previous);
      if(!same(active,completed))throw Error('Completed operation is no longer active; stale recovery is forbidden');
      assertObserved(active,await adapter.observe(active));return {...operation,repeated:true};
    }
    if(!same(baselineDocument(active),baselineDocument(plan.previous))&&!same(baselineDocument(active),baselineDocument(plan.desired)))throw Error('Recovery does not own the current active release');
    adapter.allowRecovery?.(operation);
    if (plan.migrationMode === 'additive-298-300' && !plan.rollbackState && operation.migrationStarted===true) {
      // Same immutable request, source and target. This handles lost commit
      // acknowledgement and a crash before the first ledger write alike.
      const receipt = await adapter.migrate(plan);
      const database = databaseStateFromResult(plan, receipt);
      plan.rollbackState = stateWithDatabase(plan.previous, database);
      plan.desired = stateWithDatabase(plan.desired, database);
      operation.migrationReceipt = receipt; operation.status = 'migrated'; store.writeOperation(operation);
    }
    const previous = plan.rollbackState ?? plan.previous, desired = plan.desired;
    for (const [state, status] of [[desired, 'succeeded'], [previous, 'rolled_back']]) {
      try {assertObserved(state, await adapter.observe(state));}
      catch {continue;}
      store.writeActive(state); operation.status = status; store.writeOperation(operation); return operation;
    }
    if (!rollback) throw Error('Mixed/unknown live state; explicit compatible rollback required');
    const database = await adapter.assertDatabase(databaseMigrationSet(previous), previous.database);
    if (requiresOldReaders(previous) && database?.oldReadersSafe !== true) throw Error('Old readers are no longer compatible');
    await assertCurrentHistory(adapter,plan);
    // Inspect first, then restore only touched services. Unknown state of an
    // unrelated service fails final verification rather than restarting it.
    for (const component of [...operation.touched].reverse()) await adapter.replace(component, previous);
    assertObserved(previous, await adapter.observe(previous)); store.writeActive(previous);
    operation.status = 'rolled_back'; store.writeOperation(operation); return operation;
  } finally {unlock();}
}

export function deploymentRetention(states, historicalHashes) {
  states.forEach(validateActive);
  const references = retentionReferences(states.filter(state=>!isLegacyBaseline(state)).map(state => state.manifest), [...historicalHashes,...states.filter(isLegacyBaseline).flatMap(state=>state.artifactHashes)]);
  const legacyImageIds=[...new Set(states.filter(isLegacyBaseline).flatMap(state=>Object.values(state.components).map(row=>row.imageId)))].sort();
  if(legacyImageIds.length)references.legacyImageIds=legacyImageIds;
  references.images = [...new Set([...references.images, ...states.flatMap(state => state.database ? [state.database.executorImageDigest] : [])])].sort();
  return references;
}
