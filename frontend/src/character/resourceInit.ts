import type { AssembledCharacter } from './assemble';
import { collectActionUsesPools } from './actionSheet';
import { hitDiceResourceKey, initResources, resolveByLevel, resolveCount } from '../engine/resources';
import { freeuseKey, type FreeuseSpec } from '../engine/freeuse';
import type { ValueBreakdown } from '../mvp/contracts';
import type { CharacterContext, RollModifier, RuntimeState } from '../mvp/contracts';
import type { ForgeCharacter } from './types';
import type { PatchCharacterRuntimeRequest } from './api';
import { alignRuntimeHp, forgeToRuntimeState } from './runtime';
import { expandPassiveChoicePayloads, passiveSourceId } from '../mechanics/expandChoices';

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
 * системные/классовые пулы + гранты, затем виртуальные uses/freeuse-пулы.
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
  const turnLabels: Record<string, string> = {
    action: 'Действие', bonus_action: 'Бонусное действие', reaction: 'Реакция',
  };

  if (turnLabels[resourceKey]) {
    parts = [{ value: 1, source: 'Экономика хода', reason: turnLabels[resourceKey] }];
  } else if (resourceKey === hitDiceResourceKey(ctx.hitDie)) {
    parts = [{
      value: Math.max(0, ctx.level),
      source: assembled.klass?.name ?? 'Класс',
      reason: `${ctx.level} ур. · ${ctx.hitDie ?? 'кость хитов'}`,
    }];
  } else {
    const classDef = (assembled.klass?.resources as Dict | null | undefined)?.[resourceKey] as Dict | undefined;
    if (classDef) {
      const value = resolveByLevel(classDef.by_level, ctx.level)
        ?? resolveCount(classDef.count ?? classDef.max, ctx);
      if (value > 0) {
        const fromSubclass = Boolean((assembled.subclass?.resources as Dict | null | undefined)?.[resourceKey]);
        parts.push({
          value,
          source: (fromSubclass ? assembled.subclass?.name : assembled.klass?.name) ?? 'Класс',
          reason: classDef.by_level ? `значение на ${ctx.level}-м уровне` : 'максимум класса',
        });
      }
    }
    parts.push(...resourceGrantParts(collectPassiveMechanics(assembled), resourceKey, ctx));
  }

  const usesPool = collectActionUsesPools(assembled).find((pool) => pool.key === resourceKey);
  if (usesPool) {
    parts = [{ value: resolveCount(usesPool.count, ctx), source: usesPool.source, reason: 'лимит использований' }];
  }

  const freeuse = freeuseSpells.find((spec) => freeuseKey(spec.spell) === resourceKey);
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
): { resources: Record<string, number>; maxResources: Record<string, number>; sources: Record<string, RollModifier[]> } {
  const classRes = (assembled.klass?.resources ?? null) as Dict | null;
  const passiveMechanics = collectPassiveMechanics(assembled);
  const grantDetails = collectResourceGrantDetails(passiveMechanics);
  const grants = grantDetails.map(({ payload }) => payload);
  const fresh = initResources(ctx, classRes, grants);
  const sources: Record<string, RollModifier[]> = {};
  addResourceSource(sources, 'action', 1, 'Базовый ресурс хода', 'один ресурс на ход');
  addResourceSource(sources, 'bonus_action', 1, 'Базовый ресурс хода', 'один ресурс на ход');
  addResourceSource(sources, 'reaction', 1, 'Базовый ресурс хода', 'одна реакция на ход');

  if (classRes) {
    for (const [id, def] of Object.entries(classRes)) {
      const row = def as Dict;
      const count = resolveByLevel(row.by_level, ctx.level) ?? resolveCount(row.count ?? row.max, ctx);
      if (count > 0) addResourceSource(sources, id, count, assembled.klass?.name || 'Класс', 'классовый максимум');
    }
  }
  for (const { payload, source } of grantDetails) {
    const id = String(payload.id ?? '');
    const amount = resolveCount(payload.amount ?? 1, ctx);
    addResourceSource(sources, id, amount, source, 'грант ресурса');
  }

  // Виртуальные пулы использований действий (mechanics.uses → uses_<key>).
  for (const pool of collectActionUsesPools(assembled)) {
    const count = resolveCount(pool.count, ctx);
    if (count > 0) {
      fresh.maxResources[pool.key] = count;
      fresh.resources[pool.key] = count;
      addResourceSource(sources, pool.key, count, `Действие: ${pool.key.replace(/^uses_/, '')}`, 'число использований');
    }
  }

  // Пулы бесплатных использований заклинаний (grant_spell.freeuse → freeuse-<spell>).
  for (const spec of freeuseSpells) {
    const count = resolveCount(spec.count, ctx);
    if (count > 0) {
      const key = freeuseKey(spec.spell);
      fresh.maxResources[key] = count;
      fresh.resources[key] = count;
      addResourceSource(sources, key, count, `Заклинание: ${spec.spell}`, 'бесплатные использования');
    }
  }

  if (!existing) return { ...fresh, sources };

  const maxResources = { ...fresh.maxResources };
  const resources = { ...fresh.resources };

  // Heroic Inspiration is a universal runtime-owned resource: another
  // character can grant it even when the recipient's build does not declare
  // a matching class/species/feat pool. Keep that server snapshot across the
  // automatic sheet resource reconciliation, otherwise opening the recipient
  // sheet immediately deletes Musician's grant.
  if (existing.maxResources.heroic_inspiration > 0
    && maxResources.heroic_inspiration == null) {
    maxResources.heroic_inspiration = existing.maxResources.heroic_inspiration;
    resources.heroic_inspiration = Math.min(
      existing.resources.heroic_inspiration ?? 0,
      existing.maxResources.heroic_inspiration,
    );
    addResourceSource(
      sources,
      'heroic_inspiration',
      existing.maxResources.heroic_inspiration,
      'Героическое вдохновение',
      'универсальный ресурс персонажа',
    );
  }

  for (const key of Object.keys(maxResources)) {
    const cur = existing.resources[key];
    if (cur != null) {
      const oldMax = existing.maxResources[key] ?? maxResources[key];
      const gainedAtLevelUp = key === hitDiceResourceKey(ctx.hitDie)
        ? Math.max(0, maxResources[key] - oldMax)
        : 0;
      resources[key] = Math.min(cur + gainedAtLevelUp, maxResources[key]);
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
): PatchCharacterRuntimeRequest | null {
  const existing = forgeToRuntimeState(character);
  const hpBase = computedMaxHp && computedMaxHp > 0
    ? alignRuntimeHp(existing, computedMaxHp)
    : existing;
  const synced = syncRuntimeResources(ctx, assembled, hpBase, freeuseSpells);
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
