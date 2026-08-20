import { beforeAll, describe, expect, it } from 'vitest';
import {
  assertPinnedProdSnapshotL1Ready,
  loadPinnedProdSnapshotL1Provider,
  PINNED_PROD_SNAPSHOT_L1_CONTENT_HASH,
  PINNED_PROD_SNAPSHOT_L1_RELEASE_HASH,
  PINNED_PROD_SNAPSHOT_L1_RELEASE_ID,
  PINNED_PROD_SNAPSHOT_L1_RULES_HASH,
  PinnedSnapshotReadinessError,
  readMicroMvpSnapshotManifest,
} from './prodSnapshotL1Fixtures';
import type {
  PinnedProdSnapshotL1Provider,
  SnapshotFixtureIssueCode,
} from './prodSnapshotL1Fixtures';

const EXPECTED_CARD_NUMBERS = {
  classes: [
    'CLASS-warrior', 'CLASS-wizard', 'CLASS-rogue', 'CLASS-cleric',
    'CLASS-sorcerer', 'CLASS-warlock', 'CLASS-druid',
  ],
  species: ['RACE-0002', 'RACE-0004', 'RACE-0003', 'RACE-0008'],
  backgrounds: ['BG-0012', 'BG-0005', 'BG-0008', 'BG-0009'],
  originFeats: ['FEAT-0001', 'FEAT-0009', 'FEAT-0008', 'FEAT-0005'],
} as const;

function issuesOf(provider: PinnedProdSnapshotL1Provider, code: SnapshotFixtureIssueCode) {
  return provider.issues.filter((issue) => issue.code === code);
}

describe('pinned prod-snapshot micro-MVP L1 fixture provider', () => {
  let provider: PinnedProdSnapshotL1Provider;

  beforeAll(async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('network is forbidden for pinned snapshot fixtures');
    };
    try {
      provider = await loadPinnedProdSnapshotL1Provider();
    } finally {
      globalThis.fetch = originalFetch;
    }
  }, 30_000);

  it('resolves exactly the 7 × 4 × 4 × 4 stable manifest roots without network', () => {
    for (const [collection, expected] of Object.entries(EXPECTED_CARD_NUMBERS)) {
      const actual = provider.scope[collection as keyof typeof EXPECTED_CARD_NUMBERS]
        .map((item) => item.cardNumber);
      expect(actual).toEqual(expected);
    }
    expect(provider.roots).toHaveLength(448);
    expect(new Set(provider.roots.map((root) => root.fixtureId)).size).toBe(448);
    expect(new Set(provider.roots.map((root) => root.stableKey)).size).toBe(448);
    expect(provider.roots.every((root) => root.draft.level === 1)).toBe(true);

    for (const klass of provider.scope.classes) {
      expect(provider.roots.filter((root) => root.matrixCase.klass.id === klass.id)).toHaveLength(64);
    }
    for (const species of provider.scope.species) {
      expect(provider.roots.filter((root) => root.matrixCase.species.id === species.id)).toHaveLength(112);
    }
    for (const background of provider.scope.backgrounds) {
      expect(provider.roots.filter((root) => root.matrixCase.background.id === background.id)).toHaveLength(112);
    }
    for (const feat of provider.scope.originFeats) {
      expect(provider.roots.filter((root) => root.matrixCase.originFeat.id === feat.id)).toHaveLength(112);
    }
  });

  it('pins semantic rules/content/release hashes and source artifacts', () => {
    expect(provider.release).toMatchObject({
      id: PINNED_PROD_SNAPSHOT_L1_RELEASE_ID,
      systemId: 'dnd5e-2024',
      rulesetVersion: '2024',
      errataVersion: 'phb-2024-errata-v1',
      rulesHash: PINNED_PROD_SNAPSHOT_L1_RULES_HASH,
      contentHash: PINNED_PROD_SNAPSHOT_L1_CONTENT_HASH,
      releaseHash: PINNED_PROD_SNAPSHOT_L1_RELEASE_HASH,
    });
    expect(provider.release.rulesHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(provider.release.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(provider.release.releaseHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(provider.release.dependencyEntityCount).toBeGreaterThan(40);
    expect(Object.keys(provider.release.sourceArtifactHashes)).toEqual([
      "officials/Player's Handbook 2024.txt",
      'officials/Книга игрока 2024.txt',
    ]);
    expect(provider.ruleset).toEqual({
      systemId: 'dnd5e-2024',
      releaseId: PINNED_PROD_SNAPSHOT_L1_RELEASE_ID,
      contentHash: PINNED_PROD_SNAPSHOT_L1_CONTENT_HASH,
      errataVersion: 'phb-2024-errata-v1',
    });
  });

  it('projects the reviewed manifest 2.1 spell expansion into the dependency closure', async () => {
    const manifest = await readMicroMvpSnapshotManifest();
    expect(manifest.manifestVersion).toBe('2.1.0');
    expect(manifest.collections.cantrips.slice(7).map((entry) => entry.selector.cardNumber)).toEqual([
      'dancing_lights',
      'druidcraft',
      'mending',
      'poison_spray',
      'prestidigitation',
    ]);
    expect(manifest.collections.firstLevelSpells.slice(10)
      .map((entry) => entry.selector.cardNumber)).toEqual([
      'SPELL-0189',
      'SPELL-0236',
      'SPELL-0241',
      'SPELL-0252',
    ]);
    expect(provider.release.dependencyEntityCount).toBe(123);
  });

  it('replaces, rather than adds, every official background Origin feat', () => {
    for (const root of provider.roots) {
      expect(root.draft.swapFeat).toBe(true);
      expect(root.draft.featIds).toEqual([root.matrixCase.originFeat.id]);
      expect(root.originFeatAudit.grants).toEqual([{
        entityId: root.matrixCase.originFeat.id,
        sourceType: 'product_rule',
        sourceId: 'free_origin_feat_choice_v1',
      }]);
      expect(root.originFeatAudit.grants.some((grant) => grant.sourceType === 'official_background')).toBe(false);
      expect(root.assembled.feats.map((feat) => feat.id)).toEqual([root.matrixCase.originFeat.id]);
    }
    expect(issuesOf(provider, 'background_origin_feat_leak')).toEqual([]);
  });

  it('projects only L1 actions/resources into ActorState capabilities and runtime', () => {
    for (const root of provider.roots) {
      const assembledActionIds = [...new Set(root.assembled.actions.map(({ action }) => action.id))].sort();
      expect(root.actor.capabilities.actionIds).toEqual(assembledActionIds);
      expect(root.actor.capabilities.actionIds.some((id) => root.higherLevelActionIds.includes(id))).toBe(false);
      expect(root.assembled.effects.some(({ effect }) => root.higherLevelEffectIds.includes(effect.id))).toBe(false);
      for (const resourceId of root.rawExcludedL2Resources) {
        expect(root.actor.runtime.resources).not.toHaveProperty(resourceId);
        expect(root.actor.runtime.maxResources).not.toHaveProperty(resourceId);
      }
      expect(provider.getActor(root.fixtureId)).toBe(root.actor);
      expect(provider.getFixture(root.fixtureId)).toBe(root);
    }
    expect(issuesOf(provider, 'higher_level_ability_leak')).toEqual([]);

    const rawLeaks = issuesOf(provider, 'l2_resource_source_leak');
    expect(rawLeaks.map((issue) => [issue.subjectId, issue.affectedRootCount])).toEqual([
      ['CLASS-druid:wild_shape', 64],
      ['CLASS-sorcerer:sorcery_points', 64],
    ]);
  });

  it('does not turn narrative-only L1 records into mechanical evidence', () => {
    const narrativeSubjects = new Set(
      issuesOf(provider, 'narrative_only_mechanic').map((issue) => issue.subjectId),
    );
    expect(narrativeSubjects).toEqual(new Set([
      'EFF-alert',
      'EFF-divine-order',
      'EFF-innate-sorcery',
      'EFF-primal-order',
      'EFF-sneak-attack',
    ]));
  });

  it('reports current snapshot blockers and makes the full-build gate fail closed', () => {
    expect(issuesOf(provider, 'missing_support_certification')).toHaveLength(19);
    expect(issuesOf(provider, 'l1_choice_unresolved').length).toBeGreaterThan(0);
    expect(issuesOf(provider, 'l1_warlock_invocation_mismatch')).toEqual([
      expect.objectContaining({ affectedRootCount: 64 }),
    ]);
    expect(issuesOf(provider, 'broken_reference')).toEqual([]);
    expect(issuesOf(provider, 'release_hash_mismatch')).toEqual([]);
    expect(() => assertPinnedProdSnapshotL1Ready(provider)).toThrow(PinnedSnapshotReadinessError);

    try {
      assertPinnedProdSnapshotL1Ready(provider);
      throw new Error('expected PinnedSnapshotReadinessError');
    } catch (error) {
      expect(error).toBeInstanceOf(PinnedSnapshotReadinessError);
      const readiness = error as PinnedSnapshotReadinessError;
      expect(readiness.issues.some((issue) => issue.code === 'narrative_only_mechanic')).toBe(true);
      expect(readiness.issues.some((issue) => issue.code === 'l2_resource_source_leak')).toBe(true);
      expect(readiness.issues.some((issue) => issue.code === 'l1_choice_unresolved')).toBe(true);
    }
  });
});
