import type { ActiveEffectEntry, ExecuteContext, RuntimeState } from '../mvp/contracts';
import { collectGrantActionSlugs } from '../mechanics/actionGrants';

type Dict = Record<string, unknown>;

/** Catalog gates only; the UI cannot invent a live grant by naming an action. */
export function matchingRuntimeActionGrants(state: RuntimeState, mechanics: Dict, level?: number): ActiveEffectEntry[] {
  const references = mechanics.requires_runtime_action_grant;
  if (!Array.isArray(references) || !references.length || references.some(ref => typeof ref !== 'string' || !ref.trim())) return [];
  return state.activeEffects.filter(effect => (effect.roundsLeft === undefined || effect.roundsLeft > 0)
    && collectGrantActionSlugs(effect.mechanics, level).some(ref => references.includes(ref)));
}

/** This snapshot was created by grant_effect in the authoritative executor and
 * travels with the recipient, including when the original caster is absent. */
export function runtimeActionContext(state: RuntimeState, mechanics: Dict, ctx: ExecuteContext): ExecuteContext {
  const sources = matchingRuntimeActionGrants(state, mechanics, ctx.character.level)
    .flatMap(effect => effect.actionContext ? [effect.actionContext] : []);
  if (!sources.length) return ctx;
  if (sources.some(source => JSON.stringify(source) !== JSON.stringify(sources[0]))) {
    throw new Error('Для временного действия существует несколько разных источников каста');
  }
  const source = sources[0];
  if (source.targetId && ctx.target?.id !== source.targetId) throw new Error('Это действие связано с первоначальной целью заклинания');
  return { ...ctx, character: { ...ctx.character, ...source.character },
    spell: source.spell, effectSourceId: source.sourceId, suppressSpellCastEvent: true };
}

export function captureActionContext(ctx: ExecuteContext, bindTarget: boolean): NonNullable<ActiveEffectEntry['actionContext']> {
  return { character: { level: ctx.character.level, profBonus: ctx.character.profBonus,
    abilityMods: { ...ctx.character.abilityMods }, spellcastingMod: ctx.character.spellcastingMod,
    ...(ctx.character.classLevels ? { classLevels: { ...ctx.character.classLevels } } : {}) },
    ...(ctx.spell ? { spell: structuredClone(ctx.spell) } : {}),
    ...(ctx.selfId ? { sourceId: ctx.selfId } : {}),
    ...(bindTarget && ctx.target?.id ? { targetId: ctx.target.id } : {}) };
}
