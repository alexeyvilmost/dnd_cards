import type { AssembledCharacter } from './assemble';
import { initResources } from '../engine/resources';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import type { ForgeCharacter } from './types';
import type { PatchCharacterRuntimeRequest } from './api';
import { forgeToRuntimeState } from './runtime';

type Dict = Record<string, unknown>;

export function collectPassiveMechanics(assembled: AssembledCharacter): Dict[] {
  return assembled.effects
    .map(({ effect }) => effect.mechanics)
    .filter((m): m is Dict => !!m && typeof m === 'object');
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

export function buildResourceRuntimePatch(
  character: ForgeCharacter,
  ctx: CharacterContext,
  assembled: AssembledCharacter,
  force = false,
): PatchCharacterRuntimeRequest | null {
  const existing = forgeToRuntimeState(character);
  const synced = syncRuntimeResources(ctx, assembled, existing);
  const maxChanged = JSON.stringify(synced.maxResources) !== JSON.stringify(existing.maxResources);
  if (!force && !resourcesNeedSync(character) && !maxChanged) return null;

  return {
    max_hp: character.max_hp ?? existing.hp.max,
    current_hp: character.current_hp ?? existing.hp.current,
    resources: synced.resources,
    max_resources: synced.maxResources,
  };
}
