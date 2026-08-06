import { canonicalStringify } from '../rules-core/determinism';

export const FREE_ORIGIN_FEAT_CHOICE_RULE_ID = 'free_origin_feat_choice_v1';

export interface StableBuildEntity {
  id: string;
}

export interface MicroMvpRootScope {
  classes: StableBuildEntity[];
  species: StableBuildEntity[];
  backgrounds: Array<StableBuildEntity & { officialOriginFeatId?: string }>;
  originFeats: StableBuildEntity[];
}

export interface OriginFeatGrant {
  entityId: string;
  kind: 'origin_feat';
  sourceType: 'product_rule' | 'species';
  sourceId: string;
}

export interface FreeOriginFeatChoiceResult {
  productRuleId: typeof FREE_ORIGIN_FEAT_CHOICE_RULE_ID;
  backgroundId: string;
  suppressedOfficialBackgroundFeatId?: string;
  grants: OriginFeatGrant[];
}

export class BuildRuleError extends Error {
  constructor(readonly code: 'OriginFeatChoiceCount' | 'OriginFeatNotAllowed', message: string) {
    super(message);
    this.name = 'BuildRuleError';
  }
}

/**
 * Applies the project ruling without creating a second background feat.
 * Species-granted feats are a distinct source and may coexist with this slot.
 */
export function resolveFreeOriginFeatChoice(input: {
  backgroundId: string;
  officialBackgroundFeatId?: string;
  selectedOriginFeatIds: string[];
  allowedOriginFeatIds: string[];
  speciesId?: string;
  speciesGrantedOriginFeatIds?: string[];
}): FreeOriginFeatChoiceResult {
  if (input.selectedOriginFeatIds.length !== 1) {
    throw new BuildRuleError(
      'OriginFeatChoiceCount',
      `${FREE_ORIGIN_FEAT_CHOICE_RULE_ID} requires exactly one selected feat`,
    );
  }
  const [selected] = input.selectedOriginFeatIds;
  if (!input.allowedOriginFeatIds.includes(selected)) {
    throw new BuildRuleError('OriginFeatNotAllowed', `${selected} is outside the active milestone pool`);
  }
  const grants: OriginFeatGrant[] = [{
    entityId: selected,
    kind: 'origin_feat',
    sourceType: 'product_rule',
    sourceId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
  }];
  for (const entityId of input.speciesGrantedOriginFeatIds ?? []) {
    grants.push({
      entityId,
      kind: 'origin_feat',
      sourceType: 'species',
      sourceId: input.speciesId ?? 'species:unknown',
    });
  }
  return {
    productRuleId: FREE_ORIGIN_FEAT_CHOICE_RULE_ID,
    backgroundId: input.backgroundId,
    suppressedOfficialBackgroundFeatId: input.officialBackgroundFeatId,
    grants,
  };
}

export interface MicroMvpBuildRoot {
  key: string;
  classId: string;
  speciesId: string;
  backgroundId: string;
  originFeatId: string;
  originFeatChoice: FreeOriginFeatChoiceResult;
}

const EXPECTED_SIZES = { classes: 7, species: 4, backgrounds: 4, originFeats: 4 } as const;

export function microMvpScopeIssues(scope: MicroMvpRootScope): string[] {
  return (Object.entries(EXPECTED_SIZES) as Array<[keyof typeof EXPECTED_SIZES, number]>).flatMap(
    ([dimension, expected]) => {
      const entities = scope[dimension];
      const issues: string[] = [];
      if (entities.length !== expected) issues.push(`${dimension}: expected ${expected}, got ${entities.length}`);
      if (new Set(entities.map((entity) => entity.id)).size !== entities.length) issues.push(`${dimension}: duplicate IDs`);
      return issues;
    },
  );
}

export function createMicroMvpBuildRoots(scope: MicroMvpRootScope): MicroMvpBuildRoot[] {
  const issues = microMvpScopeIssues(scope);
  if (issues.length) throw new Error(`Invalid micro-MVP root scope: ${issues.join('; ')}`);
  const allowedOriginFeatIds = scope.originFeats.map((feat) => feat.id);
  const roots: MicroMvpBuildRoot[] = [];
  for (const klass of scope.classes) {
    for (const species of scope.species) {
      for (const background of scope.backgrounds) {
        for (const feat of scope.originFeats) {
          roots.push({
            key: `${klass.id} × ${species.id} × ${background.id} × ${feat.id}`,
            classId: klass.id,
            speciesId: species.id,
            backgroundId: background.id,
            originFeatId: feat.id,
            originFeatChoice: resolveFreeOriginFeatChoice({
              backgroundId: background.id,
              officialBackgroundFeatId: background.officialOriginFeatId,
              selectedOriginFeatIds: [feat.id],
              allowedOriginFeatIds,
              speciesId: species.id,
            }),
          });
        }
      }
    }
  }
  return roots;
}

export function microMvpRootsCanonicalHashInput(roots: readonly MicroMvpBuildRoot[]): string {
  return canonicalStringify([...roots].sort((a, b) => a.key.localeCompare(b.key)));
}
