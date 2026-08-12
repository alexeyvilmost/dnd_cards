import { describe, expect, it } from 'vitest';
import { loadCertifiedSheetCombatCatalog } from '../character/sheetCombatCertifiedCatalog';
import { canonicalSha256, canonicalStringify } from '../rules-core/determinism';
import {
  compileMicroMvpAcceptanceCorpus,
  runCompiledMicroMvpAcceptanceCase,
} from '../rules-core/testing/compiledMicroMvpAcceptanceCorpus';
import { migrateWorldState } from '../rules-core/worldMigration';
import { executeRulesWorkerRequest } from './execute';

function dieEntryToUint32(entry: { sides: number; value: number }): number {
  const unit = (entry.value - 0.5) / entry.sides;
  return Math.max(0, Math.min(0xffffffff, Math.floor(unit * 0x1_0000_0000)));
}

function firstDifferences(left: unknown, right: unknown, path = '$', out: string[] = []): string[] {
  if (out.length >= 12 || Object.is(left, right)) return out;
  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) out.push(`${path}.length ${left.length} != ${right.length}`);
    for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
      firstDifferences(left[index], right[index], `${path}[${index}]`, out);
    }
    return out;
  }
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of [...keys].sort()) {
      firstDifferences(
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
        `${path}.${key}`,
        out,
      );
    }
    return out;
  }
  out.push(`${path}: ${JSON.stringify(left)} != ${JSON.stringify(right)}`);
  return out;
}

function withoutEnvironmentClock<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutEnvironmentClock) as T;
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== 'logicalClock' && key !== 'deadlineLogicalClock')
    .map(([key, entry]) => [key, withoutEnvironmentClock(entry)])) as T;
}

describe('micro-MVP browser/worker differential', () => {
  it('replays a complete two-PC acceptance scenario through the server worker', async () => {
    const [corpus, certified] = await Promise.all([
      compileMicroMvpAcceptanceCorpus(),
      loadCertifiedSheetCombatCatalog(),
    ]);
    const scenario = corpus.cases[0];
    const browser = runCompiledMicroMvpAcceptanceCase(scenario);
    const rngTape = (scenario.spec.rollTape ?? []).map(dieEntryToUint32);
    let rngOffset = 0;
    let world = migrateWorldState(structuredClone(browser.initialState));
    const workerEvents = [];

    for (const command of browser.commands) {
      const result = await executeRulesWorkerRequest({
        protocolVersion: 1,
        rulesArtifactHash: certified.artifact.source.release.releaseHash,
        baseStateHash: await canonicalSha256(world),
        world,
        command,
        rngTape: rngTape.slice(rngOffset).length ? rngTape.slice(rngOffset) : [0],
      });
      if (result.status === 'rejected') {
        const expected = browser.rejections.find((rejection) => rejection.code === result.code);
        expect(expected, `${command.commandId} unexpectedly rejected: ${result.code}`).toBeDefined();
        continue;
      }
      rngOffset += result.rngConsumed.length;
      world = result.nextState;
      workerEvents.push(...result.events);
    }

    const expectedState = migrateWorldState(structuredClone(browser.finalState));
    // The acceptance helper intentionally starts its logical clock at 90_000;
    // the server derives it from the persisted world head. This is environment
    // provenance, not a rules-semantic difference.
    expectedState.logicalClock = world.logicalClock;
    const stateDiff = firstDifferences(world, expectedState);
    expect(stateDiff).toEqual([]);
    expect(canonicalStringify(withoutEnvironmentClock(workerEvents)))
      .toBe(canonicalStringify(withoutEnvironmentClock(browser.events)));
    expect(rngOffset).toBe(browser.rngConsumed);
    expect(browser.observedTrace).toEqual([
      'abilityCheck', 'applyCondition', 'castSpell', 'nonSpellAction', 'savingThrow',
    ]);
  }, 120_000);
});
