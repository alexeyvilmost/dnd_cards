// Shared orchestration, not production authorization. The host entry point
// must supply its canonical file/backup/reader verifier and exact transport.
import {prepareRetirementCommand, runRetirementCommand} from './retirement-command.mjs';
import {validateRetirementExecutionRequest} from './retirement-execution-result.mjs';
import {assertRetirementExecutionIntentBinding, prepareRetirementExecutionIntent, markRetirementExecutionOutcomeUnknown} from './retirement-intent.mjs';
import {validateRetirementOutcomeJournal, recordRetirementExecutionOutcome, reconcileRetirementObservation} from './retirement-outcome-journal.mjs';

export async function executeRetirement({store, executorManifest, approvalHash, request, verifyArtifacts, command, observe}) {
  if (typeof verifyArtifacts !== 'function' || typeof command !== 'function' || typeof observe !== 'function') throw Error('Retirement verification, command and observation adapters required');
  const accepted = {executorManifest: structuredClone(executorManifest), approvalHash, request: structuredClone(request)};
  validateRetirementExecutionRequest(accepted.request);
  const existing = store.operation(accepted.request.releaseId);
  if (existing?.kind === 'character-retirement-observation-302') {
    validateRetirementOutcomeJournal(existing);
    if (existing.schemaVersion !== 2) throw Error('Original durable execution intent required for controller recovery');
    assertRetirementExecutionIntentBinding(existing.executionIntent, {active: existing.previous, ...accepted});
    return reconcileRetirementObservation({store, releaseId: accepted.request.releaseId, observe});
  }
  if (existing) {
    assertRetirementExecutionIntentBinding(existing, {active: store.active(), ...accepted});
    if (existing.status === 'retirement_outcome_unknown') return recoverUnknown();
  }

  // Capability rejection precedes journal creation. The external verifier is
  // then re-run against the current baseline immediately before preparing
  // the intent. Production artifact acceptance belongs to that verifier;
  // passing orchestration tests does not supply that acceptance.
  const dispatch = await prepareRetirementCommand({mode: 'execute', ...accepted, command});
  const baseline = structuredClone(store.active());
  await verifyArtifacts({active: structuredClone(baseline), ...structuredClone(accepted)});
  const intent = await prepareRetirementExecutionIntent({store, ...accepted, expectedActive: baseline});
  const unknown = await markRetirementExecutionOutcomeUnknown({store, releaseId: intent.releaseId, intentHash: intent.intentHash});
  // A concurrent caller already claimed dispatch. Only inspect its actual
  // ledger result; never send the destructive command again.
  if (unknown.repeated) return recoverUnknown();
  const receipt = await dispatch();
  return recordRetirementExecutionOutcome({store, ...accepted, receipt, observe});

  async function recoverUnknown() {
    const receipt = await runRetirementCommand({mode: 'reconcile', ...accepted, command});
    return recordRetirementExecutionOutcome({store, ...accepted, receipt, observe});
  }
}
