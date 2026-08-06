import { describe, expect, it } from 'vitest';
import type { BuildResult } from './autoBuild';
import {
  FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
  auditMicroMvpOriginFeatChoice,
  createMicroMicroMatrix,
  createMicroMvpMatrix,
  microMicroBuildIssues,
  microMicroMatrixScopeIssues,
  microMvpBuildIssues,
  microMvpMatrixScopeIssues,
  type MatrixEntity,
  type MicroMvpMatrixCase,
} from './microMicroMatrix';

const entities = (prefix: string, count = 4): MatrixEntity[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-id-${index}`,
    name: `${prefix} ${index}`,
    card_number: `${prefix}-${index}`,
  }));

const matrixCase: MicroMvpMatrixCase = {
  key: 'CLASS-warrior × RACE-0002 × BG-0012 × FEAT-0001',
  klass: { id: 'class-1', name: 'Воин', card_number: 'CLASS-warrior' },
  species: { id: 'race-1', name: 'Человек', card_number: 'RACE-0002' },
  background: {
    id: 'background-1',
    name: 'Солдат',
    card_number: 'BG-0012',
    origin_feat: 'FEAT-SPECIES',
  },
  originFeat: { id: 'feat-selected', name: 'Бдительный', card_number: 'FEAT-0001' },
};

function buildResult({
  featIds = ['feat-selected'],
  swapFeat = true,
  speciesFeatIds = [],
  materializedFeats,
}: {
  featIds?: string[];
  swapFeat?: boolean;
  speciesFeatIds?: string[];
  materializedFeats?: Array<{
    id: string;
    card_number: string;
    repeatable: boolean;
  }>;
} = {}): BuildResult {
  const speciesChoiceId = 'race:race-1:effect:human-flexible:human-feat';
  return {
    draft: {
      featIds,
      swapFeat,
      resolvedChoices: speciesFeatIds.length ? { [speciesChoiceId]: speciesFeatIds } : {},
      level: 1,
      systemId: 'dnd5e-2024',
      rulesetVersion: '2024',
      characterType: 'free',
      characterSchemaVersion: 1,
    },
    assembled: {
      klass: { id: matrixCase.klass.id },
      race: { id: matrixCase.species.id },
      background: {
        id: matrixCase.background.id,
        origin_feat: matrixCase.background.origin_feat,
      },
      feats: materializedFeats ?? [{
        id: matrixCase.originFeat.id,
        card_number: matrixCase.originFeat.card_number,
        repeatable: false,
      }],
      pendingChoices: speciesFeatIds.length ? [{
        id: speciesChoiceId,
        prompt: 'Выберите черту Происхождения',
        count: 1,
        source: 'feat',
        filter: 'origin_feats',
        grantKind: 'grant_feat',
        origin: { kind: 'race', id: matrixCase.species.id, name: matrixCase.species.name },
      }] : [],
    },
    unresolvedNonSpell: [],
    unresolvedSpell: [],
    issues: [],
  } as unknown as BuildResult;
}

describe('micro-MVP acceptance matrix', () => {
  it('строит ровно 448 уникальных сочетаний 7 × 4 × 4 × 4', () => {
    const cases = createMicroMvpMatrix({
      classes: entities('class', 7),
      species: entities('species'),
      backgrounds: entities('background'),
      originFeats: entities('feat'),
    });

    expect(cases).toHaveLength(448);
    expect(new Set(cases.map((item) => item.key))).toHaveLength(448);
    expect(new Set(cases.map((item) => item.klass.id))).toHaveLength(7);
    expect(new Set(cases.map((item) => item.species.id))).toHaveLength(4);
    expect(new Set(cases.map((item) => item.background.id))).toHaveLength(4);
    expect(new Set(cases.map((item) => item.originFeat.id))).toHaveLength(4);
  });

  it('не допускает тихое уменьшение или дублирование осей', () => {
    const scope = {
      classes: entities('class', 6),
      species: entities('species'),
      backgrounds: entities('background'),
      originFeats: entities('feat'),
    };

    expect(microMvpMatrixScopeIssues(scope)).toEqual(['classes: expected 7, got 6']);
    expect(() => createMicroMvpMatrix(scope)).toThrow('Invalid micro-MVP matrix scope');

    const duplicateScope = {
      ...scope,
      classes: [...entities('class', 6), entities('class', 1)[0]],
    };
    expect(microMvpMatrixScopeIssues(duplicateScope)).toContain('classes: duplicate IDs');
    expect(microMvpMatrixScopeIssues(duplicateScope)).toContain('classes: duplicate card_numbers');
  });

  it('сохраняет legacy micro-micro exports как aliases canonical API', () => {
    expect(createMicroMicroMatrix).toBe(createMicroMvpMatrix);
    expect(microMicroMatrixScopeIssues).toBe(microMvpMatrixScopeIssues);
    expect(microMicroBuildIssues).toBe(microMvpBuildIssues);
  });
});

describe('free_origin_feat_choice_v1 matrix invariant', () => {
  it('даёт ровно один product/background-slot grant и подавляет официальный grant', () => {
    const result = buildResult();
    expect(auditMicroMvpOriginFeatChoice(matrixCase, result)).toEqual({
      productRuleId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
      selectedOriginFeatId: matrixCase.originFeat.id,
      suppressedOfficialBackgroundFeatId: 'FEAT-SPECIES',
      grants: [{
        entityId: matrixCase.originFeat.id,
        sourceType: 'product_rule',
        sourceId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
      }],
    });
    expect(microMvpBuildIssues(matrixCase, result)).toEqual([]);
  });

  it('считает species-granted feat отдельным источником, а не вторым background-slot grant', () => {
    const result = buildResult({
      speciesFeatIds: ['feat-species'],
      materializedFeats: [
        { id: 'feat-selected', card_number: 'FEAT-0001', repeatable: false },
        { id: 'feat-species', card_number: 'FEAT-SPECIES', repeatable: false },
      ],
    });
    const audit = auditMicroMvpOriginFeatChoice(matrixCase, result);
    expect(audit.grants.filter((grant) => grant.sourceType === 'product_rule')).toHaveLength(1);
    expect(audit.grants.filter((grant) => grant.sourceType === 'official_background')).toHaveLength(0);
    expect(audit.grants.filter((grant) => grant.sourceType === 'species')).toEqual([{
      entityId: 'feat-species',
      sourceType: 'species',
      sourceId: matrixCase.species.id,
    }]);
    expect(microMvpBuildIssues(matrixCase, result)).toEqual([]);
  });

  it('rejects zero/multiple product grants and a separate official background grant', () => {
    expect(microMvpBuildIssues(matrixCase, buildResult({ featIds: [] })))
      .toContain(`${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: expected exactly one product/background-slot grant, got 0`);
    expect(microMvpBuildIssues(matrixCase, buildResult({
      featIds: ['feat-selected', 'feat-extra'],
    }))).toContain(
      `${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: expected exactly one product/background-slot grant, got 2`,
    );

    const officialGrant = buildResult({
      swapFeat: false,
      materializedFeats: [
        { id: 'feat-selected', card_number: 'FEAT-0001', repeatable: false },
        { id: 'feat-official', card_number: 'FEAT-SPECIES', repeatable: false },
      ],
    });
    expect(microMvpBuildIssues(matrixCase, officialGrant)).toEqual(expect.arrayContaining([
      `${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: background replacement flag is disabled`,
      `${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: separate official background grant is present`,
    ]));
  });

  it('detects a materialized official background feat even when swapFeat claims suppression', () => {
    const leaked = buildResult({
      materializedFeats: [
        { id: 'feat-selected', card_number: 'FEAT-0001', repeatable: false },
        { id: 'feat-official', card_number: 'FEAT-SPECIES', repeatable: false },
      ],
    });
    expect(microMvpBuildIssues(matrixCase, leaked)).toContain(
      `${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: 1 unexpected official background feat instance(s)`,
    );
  });
});
