import { beforeAll, describe, expect, it } from 'vitest';
import { readLiveJson } from './liveJsonRead';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as Storage;
}

import { API_BASE_URL } from '../api/client';
import { autoBuildAt, type BuildContent } from '../canon/autoBuild';
import {
  compileLiveMicroMvpCertification,
  type LiveMicroMvpCompiledCertification,
} from '../canon/liveMicroMvpCompiledCertification';
import type { SnapshotCatalogs } from '../canon/prodSnapshotL1Fixtures';
import {
  MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY,
  MICRO_MVP_SEMANTIC_ASPECT,
} from '../rules-core/coverage/microMvpDenominator';
import { MICRO_MVP_EVIDENCE_MANIFEST_SCHEMA_VERSION } from '../rules-core/coverage/microMvpEvidenceExecution';
import { executeAction, type RuntimeState } from './contracts';
import { validateMechanics, type MechanicKind } from '../engine/validateMechanics';
import { collectInPlayActionChoices } from '../mechanics/collectChoices';
import type {
  Action,
  Background,
  Card,
  CharacterClass,
  Feat,
  PassiveEffect,
  Race,
  ResourceDefinition,
  Spell,
  Variable,
} from '../types';

type Dict = Record<string, unknown>;
type CatalogEntity = {
  id: string;
  card_number: string;
  name: string;
  mechanics?: Dict | null;
  related_effects?: string[] | null;
  related_actions?: string[] | null;
  origin_feat?: string | null;
  level_progression?: Record<string, { effects?: string[]; actions?: string[] }> | null;
};
type PreparedCertification = {
  key: string;
  collection: string;
  entity_type: string;
  id: string;
  card_number: string;
  name: string;
  support: {
    status: string;
    limitations?: string[];
    certification_version?: string;
    note?: string;
  };
  dependencies: Array<{ identity: string; type: string }>;
};

async function runCertificationSetupStage<T>(
  stage: string,
  task: () => T | Promise<T>,
): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.name}: ${error.message}${error.stack ? `\n${error.stack}` : ''}`
      : String(error);
    throw new Error(`live certification setup failed at ${stage}: ${detail}`);
  }
}

const PATHS: Record<string, [string, string]> = {
  class: ['/api/classes', 'classes'],
  race: ['/api/races', 'races'],
  background: ['/api/backgrounds', 'backgrounds'],
  feat: ['/api/feats', 'feats'],
  spell: ['/api/spells', 'spells'],
  card: ['/api/cards', 'cards'],
  action: ['/api/actions', 'actions'],
  effect: ['/api/effects', 'effects'],
  resource: ['/api/resources', 'resources'],
  variable: ['/api/variables', 'variables'],
};
const CERTIFICATION_ENTITY_TYPES = [
  'class', 'race', 'background', 'feat', 'spell', 'card', 'action', 'effect',
] as const;

// The production Dragonborn record still references its level-5 flight
// feature at the species level.  The L1 compiler removes it explicitly, so it
// belongs to part-MVP rather than this executable denominator.
const OUT_OF_SCOPE_DEPENDENCY_CARD_NUMBERS = new Set(['RE-dragonborn-4']);

async function fetchAll<T extends { id: string }>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  const seenIds = new Set<string>();
  let expectedTotal: number | null = null;
  for (let page = 1; page <= 100; page += 1) {
    const body = await readLiveJson<Record<string, unknown>>(
      `${API_BASE_URL}${path}?page=${page}&limit=1000`,
      { label: path },
    );
    if (!Array.isArray(body[key])) throw new Error(`${path}: required collection ${key} is missing`);
    const batch = body[key] as T[];
    const responseTotal = Number(body.total);
    if (Number.isSafeInteger(responseTotal) && responseTotal >= 0) {
      if (expectedTotal !== null && responseTotal !== expectedTotal) {
        throw new Error(`${path}: total changed from ${expectedTotal} to ${responseTotal}`);
      }
      expectedTotal = responseTotal;
    }
    const repeatedId = batch.find((item) => !item?.id || seenIds.has(item.id))?.id;
    if (repeatedId !== undefined) {
      throw new Error(`${path}: pagination repeated or omitted entity id ${repeatedId || '<blank>'}`);
    }
    batch.forEach((item) => seenIds.add(item.id));
    items.push(...batch);
    if (expectedTotal !== null) {
      if (items.length === expectedTotal) return items;
      if (items.length > expectedTotal || batch.length === 0) {
        throw new Error(`${path}: received ${items.length}/${expectedTotal} records`);
      }
    } else if (batch.length < 1000) {
      return items;
    }
  }
  throw new Error(`${path}: pagination exceeded 100 pages`);
}

function richState(): RuntimeState {
  const resources: Record<string, number> = {
    action: 9,
    bonus_action: 9,
    reaction: 9,
    free_action: 9,
  };
  for (let level = 1; level <= 9; level += 1) resources[`spell_slot_${level}`] = 9;
  return {
    hp: { current: 20, max: 60, temp: 0 },
    resources: { ...resources },
    maxResources: { ...resources },
    equipment: {},
    inventory: [],
    activeEffects: [],
  };
}

function stripCost(mechanics: Dict): Dict {
  const activation = (mechanics.activation as Dict | undefined) ?? {};
  return {
    ...mechanics,
    activation: { ...activation, mode: 'active', cost: [] },
  };
}

function kindOf(entityType: string): MechanicKind {
  if (entityType === 'spell') return 'spell';
  if (entityType === 'action') return 'action';
  if (entityType === 'effect') return 'passive_effect';
  return 'trait';
}

function firstInPlayChoiceSelections(mechanics: Dict, label: string): Record<string, string[]> {
  const choices = collectInPlayActionChoices(mechanics, {
    kind: 'other',
    id: 'certification-smoke',
    name: label,
  });
  return Object.fromEntries(choices.flatMap((choice) => {
    const selected = choice.items?.slice(0, choice.count).map((item) => item.id) ?? [];
    return selected.length > 0 ? [[choice.id, selected]] : [];
  }));
}

function directReferences(entity: CatalogEntity): string[] {
  const refs = [
    ...(entity.related_effects ?? []),
    ...(entity.related_actions ?? []),
    ...(entity.origin_feat ? [entity.origin_feat] : []),
  ];
  for (const progression of Object.values(entity.level_progression ?? {})) {
    refs.push(...(progression.effects ?? []), ...(progression.actions ?? []));
  }
  return refs;
}

describe.skipIf(process.env.MVP_CONTENT !== '1')('micro-MVP certification audit: 49 core entities + 15 conditions', () => {
  let groups: Record<string, CatalogEntity[]>;
  let certifications: PreparedCertification[];
  let compiledCertification: LiveMicroMvpCompiledCertification;

  beforeAll(async () => {
    groups = await runCertificationSetupStage('catalog reads', async () => {
      const entries: Array<[string, CatalogEntity[]]> = [];
      for (const [type, [path, key]] of Object.entries(PATHS)) {
        entries.push([type, await fetchAll<CatalogEntity>(path, key)]);
      }
      return Object.fromEntries(entries);
    });
    const moduleUrl = new URL('../../../scripts/content/micro-mvp-certifications.mjs', import.meta.url);
    const module = await runCertificationSetupStage('certification module import', async () => (
      await import(/* @vite-ignore */ moduleUrl.href) as {
      MICRO_MVP_CERTIFICATION_VERSION: string;
      prepareMicroMvpCertifications: (
        entityGroups: Record<string, CatalogEntity[]>,
        options: { certifiedAt: string },
      ) => PreparedCertification[];
      }
    ));
    const certificationGroups = Object.fromEntries(CERTIFICATION_ENTITY_TYPES.map((type) => (
      [type, groups[type]]
    )));
    certifications = await runCertificationSetupStage('certification preparation', () => (
      module.prepareMicroMvpCertifications(certificationGroups, {
        certifiedAt: '2026-07-28T00:00:00Z',
      })
    ));
    const catalogs: SnapshotCatalogs = {
      cards: groups.card as unknown as Card[],
      classes: groups.class as unknown as CharacterClass[],
      races: groups.race as unknown as Race[],
      backgrounds: groups.background as unknown as Background[],
      feats: groups.feat as unknown as Feat[],
      effects: groups.effect as unknown as PassiveEffect[],
      actions: groups.action as unknown as Action[],
      spells: groups.spell as unknown as Spell[],
      resources: groups.resource as unknown as ResourceDefinition[],
      variables: groups.variable as unknown as Variable[],
    };
    compiledCertification = await runCertificationSetupStage('compiled semantic audit', () => (
      compileLiveMicroMvpCertification({
        catalogs,
        certificationVersion: module.MICRO_MVP_CERTIFICATION_VERSION,
      })
    ));
  }, 180_000);

  it('компилирует фактически полученный GET-каталог тем же release и связывает semantic evidence profile', () => {
    expect(compiledCertification.catalogInput.liveSemanticProjectionHash)
      .toBe(compiledCertification.catalogInput.reviewedSemanticProjectionHash);
    expect(compiledCertification.catalogInput.fullCatalog.liveRawHash)
      .toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(compiledCertification.catalogInput.fullCatalog.liveCollectionCardinalities.classes)
      .toBeGreaterThanOrEqual(7);
    expect(compiledCertification.catalogInput.fullCatalog.liveCollectionCardinalities.races)
      .toBeGreaterThanOrEqual(4);
    expect(compiledCertification.provider.roots).toHaveLength(448);
    expect(compiledCertification.provider.capabilityGaps).toEqual([]);
    const profile = compiledCertification.semanticEvidenceProfile;
    expect(profile).toMatchObject({
      certificationVersion: 'micro-mvp-l1-rules-core-v4',
      release: {
        releaseId: compiledCertification.provider.release.id,
        rulesHash: compiledCertification.provider.release.overlayHash,
        contentHash: compiledCertification.catalogInput.compilerRaw.reviewedContentHash,
        releaseHash: compiledCertification.catalogInput.compilerRaw.reviewedReleaseHash,
      },
      denominator: {
        entityCount: MICRO_MVP_ENTITY_DENOMINATOR_CARDINALITY,
      },
      evidence: {
        manifestSchemaVersion: MICRO_MVP_EVIDENCE_MANIFEST_SCHEMA_VERSION,
        aspectId: MICRO_MVP_SEMANTIC_ASPECT,
        requiredTypes: ['compiled_release_scenario', 'scenario', 'unit'],
      },
    });
    // Exact denominator cardinalities have one authority in
    // microMvpDenominator.test.ts. This live gate consumes the derived profile
    // and checks only invariants, so adding an obligation cannot leave a second
    // stale set of copied numbers that fails after a successful production GET.
    expect(profile.denominator.obligationCount)
      .toBeGreaterThanOrEqual(profile.denominator.entityCount);
    expect(profile.denominator.coverageCellCount)
      .toBeGreaterThanOrEqual(profile.denominator.obligationCount);
    expect(profile.evidence.requiredSlotCount)
      .toBeGreaterThanOrEqual(profile.denominator.coverageCellCount);
  });

  it('формирует 49 partial, 15 mechanical и полное транзитивное покрытие одной rules-core версии', () => {
    const base = certifications.filter((item) => item.collection !== 'dependencies');
    const dependencies = certifications.filter((item) => item.collection === 'dependencies');
    expect(base).toHaveLength(64);
    expect(dependencies.length).toBeGreaterThan(0);
    expect(new Set(certifications.map((item) => item.key)).size).toBe(certifications.length);
    for (const item of base) {
      if (item.collection === 'conditions') {
        expect(item.support.status, item.key).toBe('verified_mechanical');
        expect(item.support.limitations ?? [], item.key).toEqual([]);
        expect(item.support.note, item.key).toContain('two-PC');
      } else {
        expect(item.support.status, item.key).toBe('verified_partial');
        expect(item.support.limitations?.filter(Boolean).length, item.key).toBeGreaterThan(0);
        expect(item.support.note, item.key).toContain('rules-core acceptance');
      }
      expect(item.support.certification_version, item.key).toBe('micro-mvp-l1-rules-core-v4');
    }
    for (const item of dependencies) {
      const expectedStatus = ['action', 'effect', 'spell'].includes(item.entity_type)
        ? 'verified_mechanical'
        : 'verified_partial';
      expect(item.support.status, item.key).toBe(expectedStatus);
      if (expectedStatus === 'verified_mechanical') {
        expect(item.support.limitations ?? [], item.key).toEqual([]);
      } else {
        expect(item.support.limitations?.filter(Boolean).length, item.key).toBeGreaterThan(0);
      }
      expect(item.support.note, item.key).toContain('транзитивно');
      expect(item.support.certification_version, item.key).toBe('micro-mvp-l1-rules-core-v4');
    }
  });

  it('все прямые ссылки и транзитивные зависимости разрешаются однозначно', () => {
    const allByReference = new Map<string, CatalogEntity[]>();
    for (const entities of Object.values(groups)) {
      for (const entity of entities) {
        for (const ref of [entity.id, entity.card_number]) {
          allByReference.set(ref, [...(allByReference.get(ref) ?? []), entity]);
        }
      }
    }
    for (const certification of certifications) {
      const root = groups[certification.entity_type]
        .find((entity) => entity.id === certification.id);
      expect(root, certification.key).toBeTruthy();
      for (const reference of directReferences(root!)) {
        expect(allByReference.get(reference)?.length, `${certification.key} → ${reference}`).toBe(1);
      }
      expect(new Set(certification.dependencies.map((item) => item.identity)).size)
        .toBe(certification.dependencies.length);
    }
  });

  it('legacy validateMechanics/executeAction проходит только non-certifying compatibility smoke', () => {
    const byIdentity = new Map<string, { type: string; entity: CatalogEntity }>();
    for (const [type, entities] of Object.entries(groups)) {
      for (const entity of entities) byIdentity.set(`${type}:${entity.id}`, { type, entity });
    }
    const audited = new Set<string>();
    const schemaFailures: string[] = [];
    const executionFailures: string[] = [];
    const excludedHigherLevelDependencies = new Set<string>();
    let executedActiveMechanics = 0;
    const grantedEffects = Object.fromEntries(
      groups.effect.map((effect) => [
        effect.card_number,
        { name: effect.name, mechanics: effect.mechanics },
      ]),
    );
    for (const certification of certifications) {
      const identities = [
        `${certification.entity_type}:${certification.id}`,
        ...certification.dependencies.map((dependency) => dependency.identity),
      ];
      for (const identity of identities) {
        if (audited.has(identity)) continue;
        audited.add(identity);
        const record = byIdentity.get(identity);
        if (!record?.entity.mechanics || Object.keys(record.entity.mechanics).length === 0) continue;
        const mechanics = record.entity.mechanics;
        const validation = validateMechanics(mechanics, {
          id: record.entity.card_number || record.entity.id,
          name: record.entity.name,
          kind: kindOf(record.type),
        });
        const label = `${identity} (${record.entity.card_number}: ${record.entity.name})`;
        if (!validation.valid) schemaFailures.push(`${label}: ${validation.errors.join(' | ')}`);
        if (OUT_OF_SCOPE_DEPENDENCY_CARD_NUMBERS.has(record.entity.card_number)) {
          excludedHigherLevelDependencies.add(record.entity.card_number);
          continue;
        }
        const activation = mechanics.activation as Dict | undefined;
        // executeAction is the legacy direct-action adapter. Passive,
        // triggered, reaction and build-time choice effects are queried or
        // dispatched by their owning subsystem and must not be rewritten into
        // an active action merely for this compatibility smoke.
        if (activation?.mode !== 'active') continue;
        try {
          // This adapter smoke is intentionally non-certifying: canonical
          // world/condition primitives are accepted even when the deprecated
          // interpreter reports NOT_IMPLEMENTED or emits no legacy event.
          // Their behavior is certified by the rules-core scenario/unit gates.
          executedActiveMechanics += 1;
          executeAction(richState(), stripCost(mechanics), {
            character: {
              abilityMods: { str: 3, dex: 3, con: 3, int: 5, wis: 5, cha: 5 },
              profBonus: 2,
              level: 1,
              classLevels: { fighter: 1, wizard: 1, rogue: 1, cleric: 1 },
              spellcastingMod: 5,
              characterSpeed: 30,
            },
            target: {
              ac: 1,
              saveMods: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
              runtimeState: richState(),
            },
            rng: () => 0.75,
            forceSaveOutcome: 'fail',
            grantedEffects,
            choices: firstInPlayChoiceSelections(mechanics, label),
            // Canonical rules-core has already validated/owned primitive
            // behavior in this live gate. This flag exercises only the
            // deprecated projection after the explicit one-way hand-off.
            externalPrimitiveHandled: true,
            ...(record.type === 'spell'
              ? { spell: { baseLevel: Number((record.entity as unknown as Spell).level ?? 1), castLevel: 1 } }
              : {}),
          });
        } catch (error) {
          executionFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    expect(schemaFailures).toEqual([]);
    expect(executionFailures).toEqual([]);
    expect(executedActiveMechanics).toBeGreaterThan(20);
    expect([...excludedHigherLevelDependencies].sort()).toEqual(['RE-dragonborn-4']);
    expect(audited.size).toBeGreaterThan(49);
  });

  it('legacy autoBuild выбирает четыре боевых стиля как non-certifying UI smoke', async () => {
    const classes = groups.class as unknown as CharacterClass[];
    const races = groups.race as unknown as Race[];
    const backgrounds = groups.background as unknown as Background[];
    const feats = groups.feat as unknown as Feat[];
    const spells = groups.spell as unknown as Spell[];
    const fighter = classes.find((entity) => entity.card_number === 'CLASS-warrior')!;
    const human = races.find((entity) => entity.card_number === 'RACE-0002')!;
    const soldier = backgrounds.find((entity) => entity.card_number === 'BG-0012')!;
    const styles = certifications
      .filter((item) => item.collection === 'fightingStyles')
      .map((item) => feats.find((feat) => feat.id === item.id)!);
    const content: BuildContent = { classes, races, backgrounds, feats, spells };

    for (const style of styles) {
      const result = await autoBuildAt({
        classId: fighter.id,
        raceId: human.id,
        backgroundId: soldier.id,
        level: 1,
        preferredChoiceOptionIds: [style.id],
      }, content);
      const choices = Object.values(result.draft.resolvedChoices).flat();
      expect(choices, style.name).toContain(style.id);
      expect(result.assembled.feats.map((feat) => feat.id), style.name).toContain(style.id);
      expect(result.unresolvedNonSpell, style.name).toEqual([]);
      expect(result.issues, style.name).toEqual([]);
    }
  }, 180_000);
});
