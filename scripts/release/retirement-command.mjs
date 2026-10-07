// CLI transport boundary. External backup/reader approval and durable intent
// belong to the controller; this module does not authorize a retirement.
import {evidenceHash, validateManifest} from './validate-manifest.mjs';
import {assertExecutableMigrationRegistry} from './migration-transition.mjs';
import {retirementMigrationId, retirementSQLHash, validateRetirementInspectionRequest, assertRetirementInspectionResult} from './retirement-state.mjs';
import {validateRetirementExecutionRequest, retirementInspectionFromExecution} from './retirement-execution-result.mjs';

const commands = Object.freeze({execute: '--execute-character-retirement', reconcile: '--reconcile-character-retirement', inspect: '--inspect-character-retirement'});
const same = (a, b) => evidenceHash(a) === evidenceHash(b);
function parse(value) {
  const bytes = typeof value === 'string' || Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(JSON.stringify(value));
  if (bytes.length > 1024 * 1024) throw Error('Bounded retirement command response required');
  return JSON.parse(bytes);
}

export async function prepareRetirementCommand({mode, executorManifest, request, command}) {
  if (!Object.hasOwn(commands, mode) || typeof command !== 'function') throw Error('Explicit retirement command transport required');
  // Snapshot before awaiting transport, so concurrent caller edits cannot
  // change the request whose executor capability was checked.
  const accepted = structuredClone(request), manifest = structuredClone(executorManifest);
  validateManifest(manifest);
  if (mode === 'inspect') validateRetirementInspectionRequest(accepted);
  else validateRetirementExecutionRequest(accepted);
  const backend = manifest.components.backend;
  if (backend.sourceCommit !== accepted.candidateSourceCommit || backend.inputFingerprint !== accepted.candidateInputFingerprint) throw Error('Retirement request differs from exact executor manifest');
  const input = JSON.stringify(accepted);
  if (Buffer.byteLength(input) > 512 * 1024) throw Error('Bounded retirement command request required');

  // --migration-info is supported by old deployed readers and exits before
  // database/application initialization. Never send an unknown destructive
  // flag to an older binary: its CLI may otherwise start the web service.
  const metadata = parse(await command({imageDigest: backend.imageDigest, args: ['--migration-info'], input: null}));
  if (metadata.build?.provenance !== 'baked' || metadata.build.sourceCommit !== backend.sourceCommit || metadata.build.inputFingerprint !== backend.inputFingerprint
      || metadata.retirementExecutionProtocolVersion !== 1
      || mode !== 'inspect' && metadata.retirementReconciliationProtocolVersion !== 1
      || !same(metadata.supportedRetirementMigrations, [{id: retirementMigrationId, checksum: retirementSQLHash}])) throw Error('Exact baked retirement command capability required');
  assertExecutableMigrationRegistry(metadata, accepted.expectedCurrent, accepted.expectedCurrent);
  // The controller may now persist uncertainty immediately before dispatch.
  // This closure retains the checked image/request; serialization cannot
  // manufacture an executable capability.
  return async () => {
    const receipt = parse(await command({imageDigest: backend.imageDigest, args: [commands[mode]], input}));
    if (mode === 'inspect') assertRetirementInspectionResult({request: accepted}, receipt);
    else {
      retirementInspectionFromExecution(accepted, receipt);
      if (mode === 'reconcile' && !same(receipt.result.applied, [])) throw Error('Read-only reconciliation reported a mutation');
    }
    return receipt;
  };
}

export async function runRetirementCommand(options) {
  return (await prepareRetirementCommand(options))();
}
