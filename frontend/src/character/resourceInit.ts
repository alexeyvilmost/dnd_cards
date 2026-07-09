import type { AssembledCharacter } from './assemble';
import { collectActionUsesPools } from './actionSheet';
import { initResources, resolveCount } from '../engine/resources';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
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
    out.push(m as Dict);
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

/** Синхронизация max-пулов с классом и пассивками; сохраняет потраченные заряды. */
export function syncRuntimeResources(
  ctx: CharacterContext,
  assembled: AssembledCharacter,
  existing?: RuntimeState,
): { resources: Record<string, number>; maxResources: Record<string, number> } {
  const classRes = (assembled.klass?.resources ?? null) as Dict | null;
  const grants = collectResourceGrantPayloads(collectPassiveMechanics(assembled));
  const fresh = initResources(ctx, classRes, grants);

  // Виртуальные пулы использований действий (mechanics.uses → uses_<key>).
  for (const pool of collectActionUsesPools(assembled)) {
    const count = resolveCount(pool.count, ctx);
    if (count > 0) {
      fresh.maxResources[pool.key] = count;
      fresh.resources[pool.key] = count;
    }
  }

  if (!existing) return fresh;

  const maxResources = { ...fresh.maxResources };
  const resources = { ...fresh.resources };

  for (const key of Object.keys(maxResources)) {
    const cur = existing.resources[key];
    if (cur != null) {
      resources[key] = Math.min(cur, maxResources[key]);
    }
  }

  return { resources, maxResources };
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

export function buildResourceRuntimePatch(
  character: ForgeCharacter,
  ctx: CharacterContext,
  assembled: AssembledCharacter,
  force = false,
  computedMaxHp?: number,
): PatchCharacterRuntimeRequest | null {
  const existing = forgeToRuntimeState(character);
  const hpBase = computedMaxHp && computedMaxHp > 0
    ? alignRuntimeHp(existing, computedMaxHp)
    : existing;
  const synced = syncRuntimeResources(ctx, assembled, hpBase);
  const maxChanged = JSON.stringify(synced.maxResources) !== JSON.stringify(existing.maxResources);
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
