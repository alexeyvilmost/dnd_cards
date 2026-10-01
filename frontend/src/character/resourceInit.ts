import type { AssembledCharacter } from './assemble';
import { collectActionUsesPools, type GrantedAction } from './actionSheet';
import { hitDiceResourceKey, initResources, resolveCount, resolveLeveledCount, resourceLevel } from '../engine/resources';
import { resolveFreeusePoolKey, isFreeusePoolKey, type FreeuseSpec } from '../engine/freeuse';
import type { ValueBreakdown } from '../mvp/contracts';
import type { CharacterContext, RollModifier, RuntimeState } from '../mvp/contracts';
import type { ForgeCharacter } from './types';
import type { PatchCharacterRuntimeRequest } from './api';
import { alignRuntimeHp, forgeToRuntimeState } from './runtime';
import { expandPassiveChoicePayloads, passiveSourceId } from '../mechanics/expandChoices';
import type { Card } from '../types';
import {collectItemMechanics} from './attunement';
import {currentResourceForMaximum} from './vitalityReconciliation';
import resourceDeclarations from '../engine/data/resources.json';

type Dict = Record<string, unknown>;

/**
 * Пассивные механики персонажа для листа/боя. Помимо самих механик эффектов (как есть),
 * Ярус 1.1: разворачивает выбранные через choice РАНТАЙМ-пейлоады (сопротивление/модификатор/
 * set_value/…) в синтетическую auto-механику — чтобы payloadsOf / collectModifiers /
 * resistanceLevelFor их увидели. Ключ выбора совпадает с резолвером (общий expandChoices).
 * resolvedChoices по умолчанию пуст → поведение как раньше (обратная совместимость).
 */
export function collectPassiveMechanics(
  assembled: AssembledCharacter,
  resolvedChoices: Record<string, string[]> = {},
): Dict[] {
  const out: Dict[] = [];
  for (const { effect, origin } of assembled.effects) {
    const m = effect.mechanics;
    if (!m || typeof m !== 'object') continue;
    const activation = (m as Dict).activation as Dict | undefined;
    const activationMode = String(activation?.mode ?? 'passive');
    // Build-time derivation and runtime passives share this boundary. Active
    // and reaction mechanics are capabilities, never permanent modifiers on
    // the character merely because their source entity is selected.
    if (activationMode === 'active' || activationMode === 'reaction') continue;
    // Имя эффекта — в механику: диспетчер триггеров/реакций показывает его в окне решения
    // (иначе «пассивка N»). id — для гейта «раз за ход» (uses.per) по стабильному ключу.
    out.push({ id: effect.card_number ?? effect.id, ...(m as Dict), name: (m as Dict).name ?? effect.name });
    const chosen = expandPassiveChoicePayloads(m as Dict, passiveSourceId(origin, effect), resolvedChoices);
    if (chosen.length) out.push({ name: (m as Dict).name, effects: [{ resolution: 'auto', result: chosen }] });
  }
  return out;
}

/** Гранты ресурсов из пассивных/триггерных механик (max-пул при инициализации). */
export function collectResourceGrantPayloads(passives: Dict[]): Dict[] {
  const out: Dict[] = [];
  for (const mech of passives) {
    const effects = mech.effects as Dict[] | undefined;
    if (!Array.isArray(effects)) continue;
    for (const eff of effects) {
      const results = (eff.result ?? eff.results) as Dict[] | undefined;
      if (!Array.isArray(results)) continue;
      for (const r of results) {
        if (r.kind === 'resource' && r.op === 'grant') out.push(r);
      }
    }
  }
  return out;
}

function resourceGrantParts(passives: Dict[], resourceKey: string, ctx: CharacterContext) {
  const parts: ValueBreakdown['parts'] = [];
  for (const mech of passives) {
    const source = String(mech.name ?? 'Эффект персонажа');
    const effects = mech.effects as Dict[] | undefined;
    if (!Array.isArray(effects)) continue;
    for (const effect of effects) {
      const results = (effect.result ?? effect.results) as Dict[] | undefined;
      if (!Array.isArray(results)) continue;
      for (const result of results) {
        if (result.kind !== 'resource' || result.op !== 'grant' || String(result.id ?? '') !== resourceKey) continue;
        const value = resolveCount(result.amount ?? 1, ctx);
        if (value > 0) parts.push({ value, source, reason: 'выданный ресурс' });
      }
    }
  }
  return parts;
}

/**
 * Объяснение максимума ресурса для UI. Порядок зеркалит syncRuntimeResources:
 * системные/классовые пулы + гранты, объявленные uses и generic freeuse-пулы.
 * actualMax добавляет явную строку согласования для старого или вручную
 * изменённого snapshot, поэтому показанные части всегда сходятся с UI-числом.
 */
export function resourceMaximumBreakdown(
  resourceKey: string,
  ctx: CharacterContext,
  assembled: AssembledCharacter,
  freeuseSpells: FreeuseSpec[] = [],
  actualMax?: number,
): ValueBreakdown {
  let parts: ValueBreakdown['parts'] = [];
  const systemPool = resourceDeclarations.system_pools.find(pool => pool.resource_id === resourceKey);
  const declaration = resourceDeclarations.resources.find(resource => resource.resource_id === resourceKey);

  if (systemPool) {
    parts = [{ value: systemPool.count, source: 'Экономика хода', reason: declaration?.name ?? resourceKey }];
  } else if (Object.values(resourceDeclarations.hit_dice).includes(resourceKey)) {
    for (const klass of assembled.classes ?? (assembled.klass ? [assembled.klass] : [])) {
      if (hitDiceResourceKey(klass.hit_die) !== resourceKey) continue;
      const slug = (klass.card_number || klass.name).replace(/^CLASS[-_]/i, '').toLowerCase().replace(/-/g, '_');
      const count = Math.max(0, Math.floor(ctx.classLevels?.[slug] ?? 0));
      if (count) parts.push({ value: count, source: klass.name, reason: `${count} ур. · ${klass.hit_die ?? 'кость хитов'}` });
    }
  } else {
    const classDef = (assembled.klass?.resources as Dict | null | undefined)?.[resourceKey] as Dict | undefined;
    if (classDef) {
      const value = resolveLeveledCount(classDef, ctx);
      if (value > 0) {
        const fromSubclass = Boolean((assembled.subclass?.resources as Dict | null | undefined)?.[resourceKey]);
        parts.push({
          value,
          source: (fromSubclass ? assembled.subclass?.name : assembled.klass?.name) ?? 'Класс',
          reason: classDef.by_level ? `значение на ${resourceLevel(classDef, ctx)}-м уровне класса` : 'максимум класса',
        });
      }
    }
    parts.push(...resourceGrantParts(collectPassiveMechanics(assembled), resourceKey, ctx));
  }

  const usesPool = collectActionUsesPools(assembled).find((pool) => pool.key === resourceKey);
  if (usesPool) {
    parts = [{ value: resolveLeveledCount(usesPool, ctx), source: usesPool.source, reason: 'лимит использований' }];
  }

  const freeuse = freeuseSpells.find((spec) => resolveFreeusePoolKey(spec, {
    spells: assembled.spells, resources: { [resourceKey]: actualMax ?? 0 },
  }) === resourceKey);
  if (freeuse) {
    const spell = assembled.spells.find((candidate) => candidate.id === freeuse.spell || candidate.card_number === freeuse.spell);
    parts = [{
      value: resolveCount(freeuse.count, ctx),
      source: spell?.name ?? freeuse.spell,
      reason: 'бесплатные использования заклинания',
    }];
  }

  const computed = parts.reduce((sum, part) => sum + part.value, 0);
  const value = actualMax ?? computed;
  if (computed !== value) {
    parts.push({ value: value - computed, source: 'Сохранённое состояние', reason: 'согласование runtime' });
  }
  if (!parts.length) {
    parts.push({ value, source: 'Сохранённое состояние', reason: 'максимум ресурса' });
  }
  return { value, parts };
}

function collectResourceGrantDetails(passives: Dict[]): { payload: Dict; source: string }[] {
  const out: { payload: Dict; source: string }[] = [];
  for (const mech of passives) {
    const effects = mech.effects as Dict[] | undefined;
    if (!Array.isArray(effects)) continue;
    for (const eff of effects) {
      const results = (eff.result ?? eff.results) as Dict[] | undefined;
      if (!Array.isArray(results)) continue;
      for (const r of results) {
        if (r.kind === 'resource' && r.op === 'grant') {
          out.push({ payload: r, source: String(mech.name ?? 'Пассивная способность') });
        }
      }
    }
  }
  return out;
}

function addResourceSource(
  sources: Record<string, RollModifier[]>,
  id: string,
  value: number,
  source: string,
  reason: string,
) {
  if (!id || !Number.isFinite(value) || value <= 0) return;
  (sources[id] ??= []).push({ value, source, reason });
}

/** Синхронизация max-пулов с классом и пассивками; сохраняет потраченные заряды. */
export function syncRuntimeResources(
  ctx: CharacterContext,
  assembled: AssembledCharacter,
  existing?: RuntimeState,
  freeuseSpells: FreeuseSpec[] = [],
  itemCards: readonly Card[] = [],
  grantedActions: readonly GrantedAction[] = [],
): { resources: Record<string, number>; maxResources: Record<string, number>; sources: Record<string, RollModifier[]> } {
  const classRes = (assembled.klass?.resources ?? null) as Dict | null;
  const itemMechanics = collectItemMechanics(
    existing?.equipment ?? Object.fromEntries((ctx.equippedCards ?? []).map((card,index)=>[`equipped_${index}`,card.id])),
    new Map(itemCards.map(card=>[card.id,card])),
    {attuned_ids:ctx.attunedIds ?? []},
    existing?.inventory ?? [],
  ).map(item=>item.mechanics).filter(mechanics=>{
    const activation=mechanics.activation as Dict|undefined;
    return !activation?.mode || activation.mode==='passive';
  });
  const runtimeGrants=(existing?.activeEffects ?? []).filter(effect=>effect.roundsLeft===undefined || effect.roundsLeft>0)
    .map(effect=>({...effect.mechanics as Dict,name:effect.name}))
    .filter(mechanics=>{
      const activation=(mechanics as Dict).activation as Dict|undefined;
      return !activation?.mode || activation.mode==='passive';
    });
  const passiveMechanics = [...collectPassiveMechanics(assembled),...itemMechanics,...runtimeGrants];
  const grantDetails = collectResourceGrantDetails(passiveMechanics);
  const grants = grantDetails.map(({ payload }) => payload);
  const fresh = initResources(ctx, classRes, grants);
  // Each class contributes its own Hit Dice. Replace the legacy single-class
  // total seeded by initResources with one pool per die size.
  for (const key of Object.keys(fresh.maxResources)) {
    if (Object.values(resourceDeclarations.hit_dice).includes(key)) {
      delete fresh.maxResources[key];
      delete fresh.resources[key];
    }
  }
  for (const klass of assembled.classes ?? (assembled.klass ? [assembled.klass] : [])) {
    const key = hitDiceResourceKey(klass.hit_die);
    const slug = (klass.card_number || klass.name).replace(/^CLASS[-_]/i, '').toLowerCase().replace(/-/g, '_');
    const count = Math.max(0, Math.floor(ctx.classLevels?.[slug] ?? 0));
    if (!key || !count) continue;
    fresh.maxResources[key] = (fresh.maxResources[key] ?? 0) + count;
    fresh.resources[key] = (fresh.resources[key] ?? 0) + count;
  }
  const sources: Record<string, RollModifier[]> = {};
  for (const pool of resourceDeclarations.system_pools) {
    addResourceSource(sources, pool.resource_id, pool.count, 'Базовый ресурс хода', 'базовый максимум на ход');
  }

  if (classRes) {
    for (const [id, def] of Object.entries(classRes)) {
      const row = def as Dict;
      const count = resolveLeveledCount(row, ctx);
      if (count > 0) addResourceSource(sources, id, count, assembled.klass?.name || 'Класс', 'классовый максимум');
    }
  }
  for (const { payload, source } of grantDetails) {
    const id = String(payload.id ?? '');
    const amount = resolveCount(payload.amount ?? 1, ctx);
    addResourceSource(sources, id, amount, source, 'грант ресурса');
  }

  // Пулы использований из объявлений mechanics.uses.
  const ownedItemIds=new Set(existing
    ? [...Object.values(existing.equipment),...existing.inventory.map(row=>row.cardId)].filter((id):id is string=>Boolean(id))
    : (ctx.equippedCards??[]).map(card=>card.id));
  for (const pool of collectActionUsesPools(assembled, existing?itemCards.filter(card=>ownedItemIds.has(card.id)):itemCards, grantedActions)) {
    const count = resolveLeveledCount(pool, ctx);
    if (count > 0) {
      fresh.maxResources[pool.key] = count;
      fresh.resources[pool.key] = count;
      addResourceSource(sources, pool.key, count, pool.source, 'число использований');
    }
  }

  // Generic-пулы бесплатных использований: сохранённые ключи переживают исправление ссылок выдачи.
  for (const spec of freeuseSpells) {
    if (spec.atWill) continue;
    const count = resolveCount(spec.count, ctx);
    if (count > 0) {
      const key = resolveFreeusePoolKey(spec, { spells: assembled.spells, resources: existing?.maxResources });
      fresh.maxResources[key] = count;
      fresh.resources[key] = count;
      addResourceSource(sources, key, count, `Заклинание: ${spec.spell}`, 'бесплатные использования');
    }
  }

  if (!existing) return { ...fresh, sources };

  const maxResources = { ...fresh.maxResources };
  const resources = { ...fresh.resources };
  // A missing spell grant does not mean a fresh resource the next time that
  // item is equipped/attuned. Keep its saved virtual pool dormant; live grant
  // authority, rather than the presence of a pool, controls spell access.
  // Keeping the old maximum also preserves any unspent charges within bounds.
  for(const [key,maximum] of Object.entries(existing.maxResources)) {
    if(isFreeusePoolKey(key)&&maxResources[key]===undefined) {
      maxResources[key]=maximum;
      resources[key]=Math.min(existing.resources[key]??0,maximum);
    }
  }
  // Keep an empty slot for previously initialized item-granted pools when the
  // item is unequipped. Equipping it again must not refill an expended resource.
  const knownItemResourceKeys = new Set(collectResourceGrantPayloads(
    itemCards.flatMap(card=>card.mechanics ? [card.mechanics as Dict] : []),
  ).map(payload=>String(payload.id ?? '')));
  for (const key of knownItemResourceKeys) {
    if (existing.maxResources[key] !== undefined && maxResources[key] === undefined) {
      maxResources[key]=0;
      resources[key]=0;
    }
  }

  // Runtime-owned resources may be granted by another actor. Their declared
  // ownership policy preserves the server snapshot across build reconciliation.
  for (const key of resourceDeclarations.runtime_owned) {
    if (existing.maxResources[key] > 0 && maxResources[key] == null) {
      maxResources[key] = existing.maxResources[key];
      resources[key] = Math.min(existing.resources[key] ?? 0, existing.maxResources[key]);
      const declaration = resourceDeclarations.resources.find(resource => resource.resource_id === key);
      addResourceSource(sources, key, existing.maxResources[key], declaration?.name ?? key, 'ресурс персонажа');
    }
  }

  for (const key of Object.keys(maxResources)) {
    const cur = existing.resources[key];
    if (cur != null) {
      const oldMax = existing.maxResources[key] ?? maxResources[key];
      // Re-equipping a previously exhausted item must not replenish its
      // dormant pool. Permanent class/feat capacity increases are available
      // immediately, including slots and limited-use action pools.
      const dormantItemPool = knownItemResourceKeys.has(key) && oldMax === 0;
      resources[key] = dormantItemPool ? Math.min(cur, maxResources[key])
        : currentResourceForMaximum(cur, oldMax, maxResources[key]);
    }
  }

  return { resources, maxResources, sources };
}

export function resourcesNeedSync(character: ForgeCharacter): boolean {
  const max = character.max_resources;
  if (!max || Object.keys(max).length === 0) return true;
  const turnKeys = ['action', 'bonus_action', 'reaction'];
  return turnKeys.some((k) => max[k] == null);
}

export function hpNeedsSync(character: ForgeCharacter, computedMaxHp: number): boolean {
  if (computedMaxHp <= 0) return false;
  const max = character.max_hp ?? 0;
  const cur = character.current_hp ?? 0;
  return max !== computedMaxHp || cur > computedMaxHp;
}

function numericRecordsEqual(
  left: Readonly<Record<string, number>>,
  right: Readonly<Record<string, number>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && left[key] === right[key]);
}

export function buildResourceRuntimePatch(
  character: ForgeCharacter,
  ctx: CharacterContext,
  assembled: AssembledCharacter,
  force = false,
  computedMaxHp?: number,
  freeuseSpells: FreeuseSpec[] = [],
  itemCards: readonly Card[] = [],
  grantedActions: readonly GrantedAction[] = [],
): PatchCharacterRuntimeRequest | null {
  const existing = forgeToRuntimeState(character);
  const hpBase = computedMaxHp && computedMaxHp > 0
    ? alignRuntimeHp(existing, computedMaxHp)
    : existing;
  const synced = syncRuntimeResources(ctx, assembled, hpBase, freeuseSpells, itemCards, grantedActions);
  // PostgreSQL/jsonb returns object keys in its own order. Resource identity is
  // key/value based, so ordering must never manufacture a runtime write (and a
  // new runtime_revision) every time a character sheet mounts.
  const maxChanged = !numericRecordsEqual(synced.maxResources, existing.maxResources);
  const hpChanged = hpBase.hp.max !== existing.hp.max
    || hpBase.hp.current !== (character.current_hp ?? existing.hp.current);
  if (!force && !resourcesNeedSync(character) && !maxChanged && !hpChanged) return null;

  return {
    max_hp: hpBase.hp.max,
    current_hp: hpBase.hp.current,
    resources: synced.resources,
    max_resources: synced.maxResources,
  };
}
