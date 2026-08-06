import type { BuildResult } from './autoBuild';

export const FREE_ORIGIN_FEAT_CHOICE_RULE_ID = 'free_origin_feat_choice_v1';

export const MICRO_MVP_MATRIX_DIMENSION_SIZES = Object.freeze({
  classes: 7,
  species: 4,
  backgrounds: 4,
  originFeats: 4,
});

export interface MicroMvpMatrixEntity {
  id: string;
  name: string;
  card_number: string;
  /** Present on background records; harmless on the shared structural type. */
  origin_feat?: string | null;
}

export interface MicroMvpMatrixScope {
  classes: MicroMvpMatrixEntity[];
  species: MicroMvpMatrixEntity[];
  backgrounds: MicroMvpMatrixEntity[];
  originFeats: MicroMvpMatrixEntity[];
}

export interface MicroMvpMatrixCase {
  key: string;
  klass: MicroMvpMatrixEntity;
  species: MicroMvpMatrixEntity;
  background: MicroMvpMatrixEntity;
  originFeat: MicroMvpMatrixEntity;
}

export type MicroMvpOriginFeatGrant = {
  entityId: string;
  sourceType: 'product_rule' | 'official_background' | 'species';
  sourceId: string;
};

export interface MicroMvpOriginFeatChoiceAudit {
  productRuleId: typeof FREE_ORIGIN_FEAT_CHOICE_RULE_ID;
  selectedOriginFeatId: string;
  suppressedOfficialBackgroundFeatId?: string;
  grants: MicroMvpOriginFeatGrant[];
}

export function microMvpMatrixScopeIssues(scope: MicroMvpMatrixScope): string[] {
  return (Object.entries(MICRO_MVP_MATRIX_DIMENSION_SIZES) as Array<
    [keyof typeof MICRO_MVP_MATRIX_DIMENSION_SIZES, number]
  >).flatMap(([dimension, expectedSize]) => {
    const entities = scope[dimension];
    const issues: string[] = [];
    if (entities.length !== expectedSize) {
      issues.push(`${dimension}: expected ${expectedSize}, got ${entities.length}`);
    }
    if (new Set(entities.map((entity) => entity.id)).size !== entities.length) {
      issues.push(`${dimension}: duplicate IDs`);
    }
    if (new Set(entities.map((entity) => entity.card_number)).size !== entities.length) {
      issues.push(`${dimension}: duplicate card_numbers`);
    }
    return issues;
  });
}

/** Полное декартово произведение 7 классов × 4 вида × 4 предыстории × 4 черты. */
export function createMicroMvpMatrix(scope: MicroMvpMatrixScope): MicroMvpMatrixCase[] {
  const scopeIssues = microMvpMatrixScopeIssues(scope);
  if (scopeIssues.length) {
    throw new Error(`Invalid micro-MVP matrix scope: ${scopeIssues.join('; ')}`);
  }

  const cases: MicroMvpMatrixCase[] = [];
  for (const klass of scope.classes) {
    for (const species of scope.species) {
      for (const background of scope.backgrounds) {
        for (const originFeat of scope.originFeats) {
          cases.push({
            key: [
              klass.card_number,
              species.card_number,
              background.card_number,
              originFeat.card_number,
            ].join(' × '),
            klass,
            species,
            background,
            originFeat,
          });
        }
      }
    }
  }
  return cases;
}

function resolvedSpeciesFeatGrants(result: BuildResult): MicroMvpOriginFeatGrant[] {
  return result.assembled.pendingChoices.flatMap((choice) => {
    if (
      choice.origin.kind !== 'race'
      || choice.source !== 'feat'
      || (choice.grantKind && choice.grantKind !== 'grant_feat')
    ) {
      return [];
    }
    return (result.draft.resolvedChoices[choice.id] ?? []).map((entityId) => ({
      entityId,
      sourceType: 'species' as const,
      sourceId: choice.origin.id,
    }));
  });
}

/**
 * Source-aware audit for free_origin_feat_choice_v1.
 *
 * The selected product/background slot is represented by `draft.featIds` with
 * `swapFeat=true`. Species choices are independent grants and therefore do not
 * increase the product/background-slot count.
 */
export function auditMicroMvpOriginFeatChoice(
  matrixCase: MicroMvpMatrixCase,
  result: BuildResult,
): MicroMvpOriginFeatChoiceAudit {
  const officialBackgroundFeatId = result.assembled.background?.origin_feat
    ?? matrixCase.background.origin_feat
    ?? undefined;
  const productGrants = result.draft.featIds.map((entityId) => ({
    entityId,
    sourceType: 'product_rule' as const,
    sourceId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
  }));
  const officialBackgroundGrants = !result.draft.swapFeat && officialBackgroundFeatId
    ? [{
      entityId: officialBackgroundFeatId,
      sourceType: 'official_background' as const,
      sourceId: matrixCase.background.id,
    }]
    : [];

  return {
    productRuleId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
    selectedOriginFeatId: matrixCase.originFeat.id,
    ...(result.draft.swapFeat && officialBackgroundFeatId
      ? { suppressedOfficialBackgroundFeatId: officialBackgroundFeatId }
      : {}),
    grants: [
      ...productGrants,
      ...officialBackgroundGrants,
      ...resolvedSpeciesFeatGrants(result),
    ],
  };
}

function featMatchesReference(
  feat: { id: string; card_number: string },
  reference: string,
): boolean {
  return feat.id === reference || feat.card_number === reference;
}

function unexpectedOfficialBackgroundInstances(
  audit: MicroMvpOriginFeatChoiceAudit,
  result: BuildResult,
): number {
  const officialReference = result.assembled.background?.origin_feat;
  if (!officialReference || !result.draft.swapFeat) return 0;

  const materialized = result.assembled.feats
    .filter((feat) => featMatchesReference(feat, officialReference));
  if (materialized.length === 0) return 0;

  const legitimateGrants = audit.grants
    .filter((grant) => grant.sourceType !== 'official_background')
    .filter((grant) => {
      if (grant.entityId === officialReference) return true;
      const entity = result.assembled.feats.find((feat) => feat.id === grant.entityId);
      return entity ? featMatchesReference(entity, officialReference) : false;
    });
  const allowedInstances = materialized[0].repeatable
    ? legitimateGrants.length
    : Math.min(legitimateGrants.length, 1);
  return Math.max(0, materialized.length - allowedInstances);
}

/** Инварианты готового персонажа, общие для каждой строки micro-MVP matrix-gate. */
export function microMvpBuildIssues(
  matrixCase: MicroMvpMatrixCase,
  result: BuildResult,
): string[] {
  const issues: string[] = [];
  if (result.assembled.klass?.id !== matrixCase.klass.id) issues.push('wrong class assembled');
  if (result.assembled.race?.id !== matrixCase.species.id) issues.push('wrong species assembled');
  if (result.assembled.background?.id !== matrixCase.background.id) issues.push('wrong background assembled');

  const originFeatAudit = auditMicroMvpOriginFeatChoice(matrixCase, result);
  const productGrants = originFeatAudit.grants
    .filter((grant) => grant.sourceType === 'product_rule');
  const officialBackgroundGrants = originFeatAudit.grants
    .filter((grant) => grant.sourceType === 'official_background');
  if (productGrants.length !== 1) {
    issues.push(
      `${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: expected exactly one product/background-slot grant, got ${productGrants.length}`,
    );
  } else if (productGrants[0].entityId !== matrixCase.originFeat.id) {
    issues.push(`${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: wrong product/background-slot feat`);
  }
  if (!result.draft.swapFeat) {
    issues.push(`${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: background replacement flag is disabled`);
  }
  if (officialBackgroundGrants.length > 0) {
    issues.push(`${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: separate official background grant is present`);
  }
  const leakedOfficialInstances = unexpectedOfficialBackgroundInstances(originFeatAudit, result);
  if (leakedOfficialInstances > 0) {
    issues.push(
      `${FREE_ORIGIN_FEAT_CHOICE_RULE_ID}: ${leakedOfficialInstances} unexpected official background feat instance(s)`,
    );
  }

  if (!result.assembled.feats.some((feat) => feat.id === matrixCase.originFeat.id)) {
    issues.push('selected origin feat is absent');
  }
  if (result.draft.level !== 1) issues.push(`expected level 1, got ${result.draft.level}`);
  if (result.draft.systemId !== 'dnd5e-2024') {
    issues.push(`wrong system: ${result.draft.systemId}`);
  }
  if (result.draft.rulesetVersion !== '2024') {
    issues.push(`wrong ruleset: ${result.draft.rulesetVersion}`);
  }
  if (result.draft.characterType !== 'free') {
    issues.push(`wrong character type: ${result.draft.characterType}`);
  }
  if (result.draft.characterSchemaVersion < 1) {
    issues.push(`invalid character schema: ${result.draft.characterSchemaVersion}`);
  }
  issues.push(...result.unresolvedNonSpell.map((issue) => `unresolved: ${issue}`));
  issues.push(...result.unresolvedSpell.map((issue) => `unresolved spell: ${issue}`));
  issues.push(...result.issues.map((issue) => `completion: ${issue}`));
  return [...new Set(issues)];
}

// Legacy public API retained for existing micro-micro consumers.
export type MatrixEntity = MicroMvpMatrixEntity;
export type MicroMicroMatrixScope = MicroMvpMatrixScope;
export type MicroMicroMatrixCase = MicroMvpMatrixCase;
export const microMicroMatrixScopeIssues = microMvpMatrixScopeIssues;
export const createMicroMicroMatrix = createMicroMvpMatrix;
export const microMicroBuildIssues = microMvpBuildIssues;
