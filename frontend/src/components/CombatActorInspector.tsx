import { Heart, Shield, X } from 'lucide-react';
import { effectiveCombatActorSpeedFt } from '../solo-combat/tacticalGrid';
import type { SoloCombatState } from '../solo-combat/types';
import { groupActiveEffectsForDisplay } from '../engine/effects';
import { combatGrappleStatusRows } from '../solo-combat/grapplePresentation';

const ABILITIES = [
  ['str', 'СИЛ'], ['dex', 'ЛОВ'], ['con', 'ТЕЛ'],
  ['int', 'ИНТ'], ['wis', 'МДР'], ['cha', 'ХАР'],
] as const;

const DEFENSE_LABELS = {
  resistance: 'Сопротивление урону',
  immunity: 'Иммунитет к урону',
  vulnerability: 'Уязвимость к урону',
  condition_immunity: 'Иммунитет к состоянию',
} as const;

export interface CombatDefenseRow {
  kind: keyof typeof DEFENSE_LABELS;
  value: string;
}

/** Extract defenses only from mechanics primitives, never localized prose. */
export function collectCombatDefenses(values: readonly unknown[]): CombatDefenseRow[] {
  const rows: CombatDefenseRow[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const row = value as Record<string, unknown>;
    if (row.kind === 'resistance'
      && typeof row.damage_type === 'string'
      && (row.value === 'resistance' || row.value === 'immunity' || row.value === 'vulnerability')) {
      rows.push({ kind: row.value, value: row.damage_type });
    }
    if (row.kind === 'condition_immunity' && typeof row.condition === 'string') {
      rows.push({ kind: 'condition_immunity', value: row.condition });
    }
    Object.values(row).forEach(visit);
  };
  values.forEach(visit);
  return [...new Map(rows.map((row) => [`${row.kind}:${row.value}`, row])).values()];
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

export default function CombatActorInspector({
  state,
  actorId,
  onClose,
}: {
  state: SoloCombatState;
  actorId: string;
  onClose: () => void;
}) {
  const actor = state.world.actors[actorId];
  if (!actor) return null;
  const presentation = state.actorPresentation[actorId];
  const token = state.tokens[actorId];
  const defenses = collectCombatDefenses([
    ...(actor.passives ?? []),
    ...(presentation?.traits.map((trait) => trait.mechanics) ?? []),
    ...actor.runtime.activeEffects.map((effect) => effect.mechanics),
  ]);
  for (const immunity of actor.traits?.conditionImmunities ?? []) {
    if (!defenses.some((row) => row.kind === 'condition_immunity' && row.value === immunity.condition)) {
      defenses.push({ kind: 'condition_immunity', value: immunity.condition });
    }
  }
  const effectGroups = groupActiveEffectsForDisplay(actor.runtime.activeEffects);
  const grappleStatuses = combatGrappleStatusRows(state.world, actorId);
  const baseSpeed = Number(actor.character.characterSpeed ?? actor.character.baseSpeed ?? 0);
  const effectiveSpeed = effectiveCombatActorSpeedFt(state, actorId);
  const actions = (presentation?.actionIds ?? actor.capabilities.actionIds).flatMap((actionId) => {
    const action = state.catalogActions.find((candidate) => candidate.id === actionId);
    if (!action) return [];
    return [{ action, presentation: state.actionPresentation?.[actionId] }];
  });

  return (
    <aside className="combat-actor-inspector site-scrollbar" aria-label={`Информация: ${actor.name}`}>
      <button type="button" className="combat-actor-inspector__close" onClick={onClose} aria-label="Закрыть информацию">
        <X size={18} />
      </button>
      <header className="combat-actor-inspector__header">
        <span className="combat-actor-inspector__portrait">
          {token?.tokenUrl ? <img src={token.tokenUrl} alt="" /> : actor.name.slice(0, 1)}
        </span>
        <div>
          <h2>{actor.name}</h2>
          <p>{[
            presentation?.size,
            presentation?.creatureType ?? actor.character.creatureType,
            presentation?.alignment,
          ].filter(Boolean).join(' · ')}</p>
          {presentation?.challengeRating && <small>ПО {presentation.challengeRating}</small>}
        </div>
      </header>

      <div className="combat-actor-inspector__vitals">
        <span><Heart size={16} /><b>{actor.runtime.hp.current}/{actor.runtime.hp.max}</b><small>HP{actor.runtime.hp.temp > 0 ? ` · ${actor.runtime.hp.temp} врем.` : ''}</small></span>
        <span><Shield size={16} /><b>{actor.ac ?? '—'}</b><small>Класс доспеха</small></span>
        <span><b>{effectiveSpeed}</b><small>Скорость, фт.{effectiveSpeed !== baseSpeed ? ` · базовая ${baseSpeed}` : ''}</small></span>
      </div>

      <section>
        <h3>Характеристики</h3>
        <div className="combat-actor-inspector__abilities">
          {ABILITIES.map(([ability, label]) => {
            const score = Number(actor.character.abilityScores?.[ability] ?? 10);
            const modifier = Number(actor.character.abilityMods[ability] ?? Math.floor((score - 10) / 2));
            return <span key={ability}><small>{label}</small><b>{score}</b><em>{signed(modifier)}</em></span>;
          })}
        </div>
      </section>

      <section>
        <h3>Состояния</h3>
        {effectGroups.length || grappleStatuses.length
          ? <div className="combat-actor-inspector__effects">{effectGroups.map((group) => (
            <div key={group.key}>
              <strong>{group.name}</strong>
              {group.instructions.map((instruction) => <small key={instruction}>{instruction}</small>)}
            </div>
          ))}{grappleStatuses.map((status) => (
            <div key={status.key}>
              <strong>{status.name}</strong>
              {status.instructions.map((instruction) => <small key={instruction}>{instruction}</small>)}
            </div>
          ))}</div>
          : <p className="combat-actor-inspector__empty">Активных состояний нет</p>}
      </section>

      <section>
        <h3>Защита</h3>
        {defenses.length
          ? <dl className="combat-actor-inspector__defenses">{defenses.map((defense) => <div key={`${defense.kind}:${defense.value}`}><dt>{DEFENSE_LABELS[defense.kind]}</dt><dd>{defense.value}</dd></div>)}</dl>
          : <p className="combat-actor-inspector__empty">Особых защит нет</p>}
      </section>

      {presentation?.traits.length ? (
        <section>
          <h3>Особенности</h3>
          <div className="combat-actor-inspector__entries">
            {presentation.traits.map((trait) => <details key={trait.id}><summary>{trait.name}</summary>{trait.description && <p>{trait.description}</p>}</details>)}
          </div>
        </section>
      ) : null}

      {actions.length ? (
        <section>
          <h3>Действия</h3>
          <div className="combat-actor-inspector__entries">
            {actions.map(({ action, presentation: actionView }) => <details key={action.id}><summary>{action.name}</summary>{actionView?.description && <p>{actionView.description}</p>}</details>)}
          </div>
        </section>
      ) : null}

      {presentation?.description && <p className="combat-actor-inspector__description">{presentation.description}</p>}
      {presentation?.source && <footer>Источник: {presentation.source}</footer>}
    </aside>
  );
}
