import { actionsApi, cardsApi, effectsApi, featsApi, spellsApi } from '../api/client';
import type { Action, Card, Feat, FeatCategory, PassiveEffect, Spell } from '../types';
import { charactersV3Api } from './api';
import { loadAssembly } from './assemble';
import { buildSavePayload, characterToDraft } from './forgeHelpers';
import { buildResourceRuntimePatch } from './resourceInit';
import { resolveCharacterRules } from './rules/resolveCharacterRules';
import { buildCharacterContext } from './runtime';
import type { CharacterDraft, ForgeCharacter } from './types';

export type ManualEntityType = 'items' | 'actions' | 'effects' | 'spells' | 'feats';
export type ManualEntitySource = Card | Action | PassiveEffect | Spell | Feat;

export interface ManualEntity {
  id: string;
  name: string;
  description: string;
  imageUrl?: string;
  meta?: string;
  repeatable: boolean;
  source: ManualEntitySource;
}

export interface ManualEntitySelection {
  entity: ManualEntity;
  amount: number;
}

export const FEAT_CATEGORY_LABELS: Record<FeatCategory, string> = {
  origin: 'Черта происхождения',
  general: 'Общая черта',
  fighting_style: 'Боевой стиль',
  epic_boon: 'Эпическая милость',
};

function normalize(source: ManualEntitySource, type: ManualEntityType): ManualEntity {
  let meta = '';
  if (type === 'spells' && 'level' in source) {
    meta = source.level === 0 ? 'Заговор' : `${source.level} уровень`;
  } else if (type === 'feats' && 'category' in source) {
    meta = FEAT_CATEGORY_LABELS[source.category];
  } else if (type === 'actions' && 'resource' in source) {
    meta = source.resource || '';
  } else if (type === 'effects' && 'effect_type' in source) {
    meta = source.effect_type || '';
  } else if (type === 'items' && 'type' in source) {
    meta = source.type || '';
  }
  return {
    id: source.id,
    name: source.name,
    description: source.description || '',
    imageUrl: source.image_url,
    meta,
    repeatable: 'repeatable' in source ? Boolean(source.repeatable) : false,
    source,
  };
}

export async function loadManualEntities(
  type: ManualEntityType,
  search = '',
  limit = 100,
): Promise<ManualEntity[]> {
  const query = search.trim() || undefined;
  if (type === 'items') {
    const response = await cardsApi.getCards({ limit, search: query, exclude_template_only: true });
    return (response.cards ?? []).map((entity) => normalize(entity, type));
  }
  if (type === 'actions') {
    const response = await actionsApi.getActions({ limit, search: query });
    return (response.actions ?? []).map((entity) => normalize(entity, type));
  }
  if (type === 'spells') {
    const response = await spellsApi.getSpells({ limit, search: query });
    return (response.spells ?? []).map((entity) => normalize(entity, type));
  }
  if (type === 'feats') {
    const response = await featsApi.getFeats({ limit, search: query });
    return (response.feats ?? []).map((entity) => normalize(entity, type));
  }
  const response = await effectsApi.getEffects({ limit, search: query });
  return (response.effects ?? [])
    .filter((entity) => entity.effect_type !== 'condition')
    .map((entity) => normalize(entity, type));
}

export function manualEntityAlreadyAdded(
  character: ForgeCharacter,
  type: ManualEntityType,
  entity: Pick<ManualEntity, 'id' | 'repeatable'>,
): boolean {
  if (type === 'items' || ((type === 'effects' || type === 'feats') && entity.repeatable)) return false;
  if (type === 'actions') return (character.action_ids ?? []).includes(entity.id);
  if (type === 'effects') return (character.effect_ids ?? []).includes(entity.id);
  if (type === 'feats') return (character.feat_ids ?? []).includes(entity.id);
  return (character.spell_ids ?? []).includes(entity.id);
}

export function appendManualEntityIds(
  current: string[] | null | undefined,
  selections: ManualEntitySelection[],
  allowRepeatable: boolean,
): string[] {
  const result = [...(current ?? [])];
  for (const { entity, amount } of selections) {
    if (amount <= 0) continue;
    if (!entity.repeatable && result.includes(entity.id)) continue;
    const copies = allowRepeatable && entity.repeatable ? amount : 1;
    for (let index = 0; index < copies; index += 1) result.push(entity.id);
  }
  return result;
}

function addSelectionsToDraft(
  draft: CharacterDraft,
  type: Exclude<ManualEntityType, 'items'>,
  selections: ManualEntitySelection[],
): void {
  if (type === 'actions') {
    draft.actionIds = appendManualEntityIds(draft.actionIds, selections, false);
  } else if (type === 'effects') {
    draft.effectIds = appendManualEntityIds(draft.effectIds, selections, true);
  } else if (type === 'feats') {
    draft.featIds = appendManualEntityIds(draft.featIds, selections, true);
  } else {
    draft.spellIds = appendManualEntityIds(draft.spellIds, selections, false);
  }
}

/**
 * Добавляет сущности тем же полным конвейером, что использует кузница:
 * draft → assembly → rule_state/save payload → синхронизация runtime-ресурсов.
 */
export async function addManualEntities(
  character: ForgeCharacter,
  type: ManualEntityType,
  selections: ManualEntitySelection[],
): Promise<ForgeCharacter> {
  const selected = selections.filter(({ amount }) => amount > 0);
  if (!selected.length) return character;

  if (type === 'items') {
    const inventory = (character.inventory_items ?? []).map((row) => ({ ...row }));
    for (const { entity, amount } of selected) {
      const existing = inventory.find((row) => row.card_id === entity.id && !row.container_id);
      if (existing) existing.qty += amount;
      else inventory.push({ card_id: entity.id, qty: amount });
    }
    return charactersV3Api.patchRuntime(character.id, { inventory_items: inventory });
  }

  const draft = characterToDraft(character);
  addSelectionsToDraft(draft, type, selected);
  const assembled = await loadAssembly(draft);
  const ruleState = resolveCharacterRules({ draft, assembled });
  let updated = await charactersV3Api.update(
    character.id,
    buildSavePayload(draft, assembled, ruleState, character.current_hp),
  );

  const ctx = buildCharacterContext(ruleState, draft, [], assembled.klass);
  const runtimePatch = buildResourceRuntimePatch(
    updated,
    ctx,
    assembled,
    true,
    undefined,
    ruleState.freeuseSpells,
  );
  if (runtimePatch) updated = await charactersV3Api.patchRuntime(character.id, runtimePatch);
  return updated;
}
