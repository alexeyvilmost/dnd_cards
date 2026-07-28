import { beforeAll, describe, expect, it } from 'vitest';

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
import { executeAction, type RuntimeState } from './contracts';
import { validateMechanics, type MechanicKind } from '../engine/validateMechanics';
import type { Background, CharacterClass, Feat, Race, Spell } from '../types';

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
  support: { status: string; limitations?: string[] };
  dependencies: Array<{ identity: string; type: string }>;
};

const PATHS: Record<string, [string, string]> = {
  class: ['/api/classes', 'classes'],
  race: ['/api/races', 'races'],
  background: ['/api/backgrounds', 'backgrounds'],
  feat: ['/api/feats', 'feats'],
  spell: ['/api/spells', 'spells'],
  card: ['/api/cards', 'cards'],
  action: ['/api/actions', 'actions'],
  effect: ['/api/effects', 'effects'],
};

async function fetchAll<T>(path: string, key: string): Promise<T[]> {
  const items: T[] = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(`${API_BASE_URL}${path}?page=${page}&limit=1000`, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const batch = (body[key] ?? []) as T[];
    items.push(...batch);
    if (batch.length < 1000) return items;
  }
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

describe('micro-micro certification audit: 37 entities', () => {
  let groups: Record<string, CatalogEntity[]>;
  let certifications: PreparedCertification[];

  beforeAll(async () => {
    groups = Object.fromEntries(await Promise.all(
      Object.entries(PATHS).map(async ([type, [path, key]]) => [
        type,
        await fetchAll<CatalogEntity>(path, key),
      ]),
    ));
    const moduleUrl = new URL('../../../scripts/content/micro-micro-certifications.mjs', import.meta.url);
    const module = await import(/* @vite-ignore */ moduleUrl.href) as {
      prepareMicroMicroCertifications: (
        entityGroups: Record<string, CatalogEntity[]>,
        options: { certifiedAt: string },
      ) => PreparedCertification[];
    };
    certifications = module.prepareMicroMicroCertifications(groups, {
      certifiedAt: '2026-07-28T00:00:00Z',
    });
  }, 180_000);

  it('формирует ровно 37 verified_partial сертификатов с явными ограничениями', () => {
    expect(certifications).toHaveLength(37);
    expect(new Set(certifications.map((item) => item.key)).size).toBe(37);
    for (const item of certifications) {
      expect(item.support.status, item.key).toBe('verified_partial');
      expect(item.support.limitations?.filter(Boolean).length, item.key).toBeGreaterThan(0);
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

  it('механики сущностей и зависимостей проходят schema; 17 заклинаний — execute smoke', () => {
    const byIdentity = new Map<string, { type: string; entity: CatalogEntity }>();
    for (const [type, entities] of Object.entries(groups)) {
      for (const entity of entities) byIdentity.set(`${type}:${entity.id}`, { type, entity });
    }
    const audited = new Set<string>();
    const schemaFailures: string[] = [];
    const executionFailures: string[] = [];
    const knownDependencyGaps = new Set<string>();
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
        const activation = mechanics.activation as Dict | undefined;
        if (activation?.mode === 'passive') continue;
        try {
          const result = executeAction(richState(), stripCost(mechanics), {
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
            ...(record.type === 'spell'
              ? { spell: { baseLevel: Number((record.entity as unknown as Spell).level ?? 1), castLevel: 1 } }
              : {}),
          });
          const serialized = JSON.stringify(result);
          if (serialized.includes('NOT_IMPLEMENTED')) {
            knownDependencyGaps.add(record.entity.card_number);
          }
          if (
            record.type === 'spell'
            && certifications.some((item) => item.entity_type === 'spell' && item.id === record.entity.id)
          ) {
            if (serialized.includes('NOT_IMPLEMENTED')) executionFailures.push(`${label}: NOT_IMPLEMENTED`);
            if (result.events.length === 0) executionFailures.push(`${label}: no execution events`);
          }
        } catch (error) {
          executionFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    expect(schemaFailures).toEqual([]);
    expect(executionFailures).toEqual([]);
    expect([...knownDependencyGaps].sort()).toEqual(['RE-dragonborn-4', 'RE-dwarf-4']);
    expect(audited.size).toBeGreaterThan(37);
  });

  it('каждый из четырёх боевых стилей реально выбирается Воином первого уровня', async () => {
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
