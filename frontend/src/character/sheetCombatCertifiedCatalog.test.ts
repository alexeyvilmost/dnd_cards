import { beforeAll, describe, expect, it } from 'vitest';
import {
  compileMicroMvpL1Overlay,
  type CompiledMicroMvpL1Provider,
} from '../canon/microMvpL1Overlay';
import { canonicalStringify } from '../rules-core/determinism';
import type { ActorState, RuleActionDefinition } from '../rules-core/domain';
import generatedArtifact from './sheetCombatCertification.generated.json';
import {
  actionBelongsToSheetCombatSlice,
  assertCertifiedSheetCombatAction,
  assertCertifiedSheetCombatActorAccess,
  certifySheetCombatArtifact,
  MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID,
  type CertifiedSheetCombatCatalog,
  type SheetCombatCertificationArtifact,
} from './sheetCombatCertifiedCatalog';
import {
  buildSheetCombatCertificationArtifact,
  serializeSheetCombatCertificationArtifact,
} from './sheetCombatCertificationGenerator';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Test fixture misses ${label}`);
  return value;
}

function combatActions(root: CompiledMicroMvpL1Provider['roots'][number]): RuleActionDefinition[] {
  return root.rulesActions.filter(actionBelongsToSheetCombatSlice);
}

describe('448-root sheet combat certification', () => {
  let provider: CompiledMicroMvpL1Provider;
  let artifact: SheetCombatCertificationArtifact;
  let certified: CertifiedSheetCombatCatalog;

  beforeAll(async () => {
    [provider, artifact] = await Promise.all([
      compileMicroMvpL1Overlay(),
      buildSheetCombatCertificationArtifact(),
    ]);
    certified = await certifySheetCombatArtifact(generatedArtifact);
  }, 30_000);

  it('is byte-for-byte generated from the complete current compiler output', () => {
    expect(serializeSheetCombatCertificationArtifact(
      generatedArtifact as unknown as SheetCombatCertificationArtifact,
    ))
      .toBe(serializeSheetCombatCertificationArtifact(artifact));
    expect(artifact.summary).toEqual({
      rootCount: 448,
      combatRootCount: 448,
      actionOccurrenceCount: 1443,
      uniqueActionCount: 13,
    });
  });

  it('has one exact coverage row for every root and no uncovered combat action/access signature', () => {
    const expectedRows = provider.roots
      .map((root) => ({
        stableKey: root.stableKey,
        actionIds: [
          ...combatActions(root),
          ...provider.globalActions.filter(actionBelongsToSheetCombatSlice),
        ].map((action) => action.id).sort(),
      }))
      .sort((left, right) => left.stableKey.localeCompare(right.stableKey));
    for (const expected of expectedRows) {
      const actual = required(
        artifact.coverage.find((row) => row.stableKey === expected.stableKey),
        expected.stableKey,
      );
      expect(actual.actionIds).toEqual(expect.arrayContaining(expected.actionIds));
    }

    const coveredActionIds = [...new Set(artifact.coverage.flatMap((row) => row.actionIds))].sort();
    expect(coveredActionIds).toEqual(artifact.actions.map((action) => action.id));
    expect(Object.keys(artifact.accessSignaturesByAction).sort()).toEqual(coveredActionIds);
    expect(Object.values(artifact.accessSignaturesByAction).every((values) => values.length > 0))
      .toBe(true);
  });

  it('certifies every compiled and ruleset-global root/action occurrence', () => {
    let occurrences = 0;
    for (const root of provider.roots) {
      const actions = [
        ...combatActions(root),
        ...provider.globalActions.filter(actionBelongsToSheetCombatSlice),
      ];
      for (const action of actions) {
        expect(assertCertifiedSheetCombatAction(action, certified)).toEqual(action);
        occurrences += 1;
      }
      const actor = clone(root.actor);
      actor.capabilities.actionIds = [...new Set([
        ...actor.capabilities.actionIds,
        ...provider.globalActions.map((action) => action.id),
      ])].sort();
      expect(() => assertCertifiedSheetCombatActorAccess(
        actor,
        actions.map((action) => action.id),
        certified,
      )).not.toThrow();
    }
    expect(occurrences).toBe(1440);
  });

  it('records every Magic Initiate combat spell choice and mental casting ability', () => {
    expect(artifact.magicInitiate.grantSourceId).toBe(MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID);
    expect(artifact.magicInitiate.originFeatEntityId)
      .toBe('51832580-68f5-4e96-8afe-93e4af045283');
    expect(artifact.magicInitiate.actions.map((row) => (
      artifact.actions.find((candidate) => candidate.id === row.actionId)?.name
    )).sort()).toEqual([
      'Волна грома',
      'Волшебная стрела',
      'Огненные ладони',
      'Щит',
    ].sort());
    for (const row of artifact.magicInitiate.actions) {
      const action = required(
        artifact.actions.find((candidate) => candidate.id === row.actionId),
        row.actionId,
      );
      expect(row.sourceEntityIds).toEqual(action.sourceEntityIds);
      expect(row.sourceEntityIds).toContain(artifact.magicInitiate.originFeatEntityId);
      expect(row.grantSignatures.map((grant) => grant.spellcastingAbility).sort())
        .toEqual(['cha', 'int', 'wis']);
      for (const grant of row.grantSignatures) {
        expect(grant).toMatchObject({
          actionId: row.actionId,
          sourceId: MAGIC_INITIATE_WIZARD_GRANT_SOURCE_ID,
          access: 'always_prepared',
          ritual: false,
          slotResource: 'spell_slot_1',
        });
        expect(grant.freeUseResource).toMatch(/^freeuse-/);
      }
    }
  });

  it('retains the exact alternate Rules Lab familiar-Wizard preparation profile', () => {
    expect(artifact.preparedSourceProfiles).toHaveLength(2);
    for (const profile of artifact.preparedSourceProfiles) {
      expect(profile).toMatchObject({ sourceId: 'CLASS-wizard', capacity: 4 });
      expect(profile.availableActionIds).toHaveLength(6);
      expect(profile.preparedActionIds).toHaveLength(4);
    }
    const wizardSignatureCounts = artifact.actions
      .filter((action) => action.id.endsWith('@CLASS-wizard'))
      .map((action) => artifact.accessSignaturesByAction[action.id].length)
      .sort();
    expect(wizardSignatureCounts).toEqual([1, 2, 2, 2]);
  });

  it.each([
    {
      label: 'capacity',
      mutate: (actor: ActorState) => {
        actor.spellcastingAccess!.preparedSources['CLASS-wizard']!.capacity += 1;
      },
    },
    {
      label: 'prepared exact set',
      mutate: (actor: ActorState) => {
        const source = actor.spellcastingAccess!.preparedSources['CLASS-wizard']!;
        const replacement = required(
          source.availableActionIds.find((id) => !source.preparedActionIds.includes(id)),
          'unprepared Wizard spell',
        );
        source.preparedActionIds = [...source.preparedActionIds.slice(1), replacement];
      },
    },
    {
      label: 'available exact set',
      mutate: (actor: ActorState) => {
        actor.spellcastingAccess!.preparedSources['CLASS-wizard']!.availableActionIds.pop();
      },
    },
    {
      label: 'ritual authority',
      mutate: (actor: ActorState, actionId: string) => {
        required(
          actor.spellcastingAccess?.grants.find((grant) => grant.actionId === actionId),
          'Wizard combat grant',
        ).ritual = true;
      },
    },
  ])('rejects actor-side $label tampering', ({ mutate }) => {
    const root = required(
      provider.roots.find((candidate) => candidate.matrixCase.klass.card_number === 'CLASS-wizard'),
      'Wizard root',
    );
    const actionIds = combatActions(root).map((action) => action.id);
    const actor = clone(root.actor);
    mutate(actor, actionIds[0]);
    expect(() => assertCertifiedSheetCombatActorAccess(actor, actionIds, certified))
      .toThrow(/differs|invalid|available/);
  });

  it('rejects action bytes and generated artifact bytes after either is changed', async () => {
    const action = clone(artifact.actions[0]);
    action.name = `${action.name} (tampered)`;
    expect(() => assertCertifiedSheetCombatAction(action, certified)).toThrow('differs');

    const tampered = clone(generatedArtifact) as unknown as SheetCombatCertificationArtifact;
    tampered.coverage[0].actionIds = [artifact.actions[0].id];
    await expect(certifySheetCombatArtifact(tampered)).rejects.toThrow('content hash mismatch');
  });

  it('keeps every access signature and prepared profile canonically deduplicated', () => {
    for (const signatures of Object.values(artifact.accessSignaturesByAction)) {
      const values = signatures.map(canonicalStringify);
      expect(new Set(values).size).toBe(values.length);
      expect(values).toEqual([...values].sort());
    }
    const profiles = artifact.preparedSourceProfiles.map(canonicalStringify);
    expect(new Set(profiles).size).toBe(profiles.length);
    expect(profiles).toEqual([...profiles].sort());
  });
});
