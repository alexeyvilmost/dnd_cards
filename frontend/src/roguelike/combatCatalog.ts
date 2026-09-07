import type {Action, Background, Card, CharacterClass, Feat, PassiveEffect, Race, ResourceDefinition, Spell, Variable} from '../types';
import type {ForgeCharacter} from '../character/types';
import type {SheetCombatParticipantSeed} from '../character/sheetCombatSession';
import {createAssemblyRuntime} from '../character/assemblyFactory';
import {createSheetCombatRuntime} from '../character/sheetCombatRuntimeFactory';
import {createRegistry} from '../engine/registry';
import {weaponMasteryPrimitive} from '../engine/weaponMastery2024';
import {canonicalSha256Sync} from '../rules-core/determinism';

export interface CombatCatalogEntities {
  race: Race; class: CharacterClass; background: Background; feat: Feat;
  effect: PassiveEffect; action: Action; spell: Spell; card: Card; resource: ResourceDefinition;
}
export type CombatCatalogKind = keyof CombatCatalogEntities;
export interface FrozenCombatCatalog {
  schemaVersion: 1;
  entities: {[K in CombatCatalogKind]: CombatCatalogEntities[K][]};
  variables: Variable[];
  variablesComplete: boolean;
  completeEffectTypes: string[];
}
export type CombatCatalogNeed =
  | {kind: 'entity'; entityType: CombatCatalogKind; reference: string}
  | {kind: 'effect_type'; effectType: string}
  | {kind: 'variables'};
export type PreparedCombatParticipant =
  | {status: 'needs_content'; needs: CombatCatalogNeed[]}
  | {status: 'ready'; participant: SheetCombatParticipantSeed; contentManifestHash: string};

/** A read-only, per-build resolver. Missing declarations survive the ordinary
 * assembler's optional-load catches and must be fulfilled before a worker can
 * accept the build. No request can fall through to a live HTTP catalog. */
export async function prepareRoguelikeCombatParticipant(
  character: ForgeCharacter,
  catalog: FrozenCombatCatalog,
  basicActionIds: readonly string[],
): Promise<PreparedCombatParticipant> {
  if (catalog.schemaVersion !== 1) throw new Error('Несовместимая версия каталога боя');
  const needs = new Map<string, CombatCatalogNeed>();
  const need = (entry: CombatCatalogNeed) => {needs.set(canonicalSha256Sync(entry), entry);};
  const indexes = new Map<CombatCatalogKind, Map<string, unknown>>();
  for (const kind of Object.keys(catalog.entities) as CombatCatalogKind[]) {
    const index = new Map<string, unknown>();
    for (const entity of catalog.entities[kind]) {
      const row = entity as unknown as Record<string, unknown>;
      for (const reference of [row.id, row.card_number, row.resource_id]) {
        if (typeof reference !== 'string' || !reference) continue;
        if (index.has(reference) && index.get(reference) !== entity) throw new Error(`Неоднозначная ссылка каталога: ${kind}/${reference}`);
        index.set(reference, entity);
      }
    }
    indexes.set(kind, index);
  }
  const get = async <K extends CombatCatalogKind>(kind: K, reference: string): Promise<CombatCatalogEntities[K]> => {
    const entity = indexes.get(kind)?.get(reference);
    if (!entity) {
      need({kind: 'entity', entityType: kind, reference});
      throw new Error(`Каталог не содержит ${kind}/${reference}`);
    }
    return structuredClone(entity) as CombatCatalogEntities[K];
  };
  const listEffects = async (effectType: string) => {
    if (!catalog.completeEffectTypes.includes(effectType)) need({kind: 'effect_type', effectType});
    return structuredClone(catalog.entities.effect.filter((entry) => entry.type === effectType));
  };
  const effectsApi = {getEffect: (id: string) => get('effect', id),
    getEffects: async (params?: {type?: string}) => {
      if (!params?.type) throw new Error('Каталог требует явный тип эффекта');
      const effects = await listEffects(params.type);
      return {effects, total: effects.length, page: 1, limit: effects.length};
    }};
  const actionsApi = {getAction: (id: string) => get('action', id)};
  const assembly = createAssemblyRuntime({
    racesApi: {getRace: id => get('race', id)}, classesApi: {getClass: id => get('class', id)},
    backgroundsApi: {getBackground: id => get('background', id)}, featsApi: {getFeat: id => get('feat', id)},
    effectsApi, actionsApi, spellsApi: {getSpell: id => get('spell', id)},
    resourcesApi: {getResource: id => get('resource', id)},
    variablesApi: {getVariables: async () => {
      if (!catalog.variablesComplete) need({kind: 'variables'});
      return {variables: structuredClone(catalog.variables), total: catalog.variables.length, page: 1, limit: catalog.variables.length};
    }},
    entityRegistry: createRegistry({resolveEffect: id => get('effect', id), resolveAction: id => get('action', id),
      resolveFeat: id => get('feat', id), resolveSpell: id => get('spell', id)}),
  });
  const sheet = createSheetCombatRuntime({actionsApi, effectsApi,
    cardsApi: {getCard: id => get('card', id)}, loadAssembly: assembly.loadAssembly,
    loadMasteryEffectsStrict: async () => {
      const effects = await listEffects('Эффект мастерства');
      if (!effects.length || effects.some((effect) => !weaponMasteryPrimitive(effect.mechanics))) {
        throw new Error('Неполный каталог искусностей оружия');
      }
      return effects;
    },
  });
  try {
    const basicActions = await Promise.all(basicActionIds.map(id => get('action', id)));
    const participant = await sheet.loadSheetCombatParticipant({character: structuredClone(character), basicActions,
      cards: new Map(catalog.entities.card.map(card => [card.id, card]))});
    if (needs.size) return {status: 'needs_content', needs: [...needs.values()]};
    return {status: 'ready', participant, contentManifestHash: canonicalSha256Sync(catalog)};
  } catch (error) {
    if (needs.size) return {status: 'needs_content', needs: [...needs.values()]};
    throw error;
  }
}
