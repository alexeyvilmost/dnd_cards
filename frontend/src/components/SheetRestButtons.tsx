import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Moon, Sun, Swords } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import { collectActionUsesRecharge } from '../character/actionSheet';
import type { AssembledCharacter } from '../character/assemble';
import { buildCharacterContext, alignRuntimeHp, forgeToRuntimeState } from '../character/runtime';
import {
  buildResourceRuntimePatch,
  collectPassiveMechanics,
} from '../character/resourceInit';
import type { ForgeCharacter } from '../character/types';
import type { CharacterRuleState } from '../character/rules/types';
import { buildResourceRecharge } from '../engine/resources';
import { longRest, shortRest, startTurn } from '../engine/turn';
import type { EngineEvent, RuntimeState } from '../mvp/contracts';

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents?: (events: EngineEvent[]) => void;
  compact?: boolean;
}

export default function SheetRestButtons({
  character,
  assembled,
  ruleState,
  onUpdated,
  onEvents,
  compact,
}: Props) {
  const [busy, setBusy] = useState(false);
  const syncAttempted = useRef(false);

  const passives = useMemo(() => collectPassiveMechanics(assembled), [assembled]);

  // Ресурсы класса + виртуальные пулы использований действий (uses_<key> → per).
  const resourceRecharge = useMemo(
    () => ({
      ...buildResourceRecharge((assembled.klass?.resources ?? null) as Record<string, unknown> | null),
      ...collectActionUsesRecharge(assembled),
    }),
    [assembled],
  );

  const ctx = useMemo(
    () => ({
      ...buildCharacterContext(
        ruleState,
        { level: character.level, abilities: character.abilities ?? {} },
        [],
        assembled.klass,
      ),
      resourceRecharge,
    }),
    [ruleState, character.level, character.abilities, assembled.klass, resourceRecharge],
  );

  const runtime = useMemo(
    () => alignRuntimeHp(forgeToRuntimeState(character), ruleState.maxHP),
    [character, ruleState.maxHP],
  );

  // Отдых открывает окно смены настройки на предметы; новый ход закрывает.
  function persistPayload(state: RuntimeState, attunementUnlocked?: boolean) {
    return {
      current_hp: state.hp.current,
      max_hp: state.hp.max,
      resources: state.resources,
      max_resources: state.maxResources,
      active_effects: state.activeEffects,
      turn_state: {
        ...(character.turn_state ?? {}),
        temp_hp: state.hp.temp,
        ...(attunementUnlocked !== undefined ? { attunement_unlocked: attunementUnlocked } : {}),
      },
    };
  }

  const apply = useCallback(async (next: RuntimeState, events: EngineEvent[], attunementUnlocked?: boolean) => {
    setBusy(true);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, persistPayload(next, attunementUnlocked));
      onUpdated(updated);
      onEvents?.(events);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [character.id, onUpdated, onEvents]);

  const syncResources = useCallback(async (force = false) => {
    const patch = buildResourceRuntimePatch(character, ctx, assembled, force, ruleState.maxHP);
    if (!patch) return;
    setBusy(true);
    try {
      const updated = await charactersV3Api.patchRuntime(character.id, patch);
      onUpdated(updated);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }, [character, ctx, assembled, onUpdated, ruleState.maxHP]);

  // Один прогон синка на маунт: buildResourceRuntimePatch сам вернёт null,
  // если пулы (включая uses_<key> действий) и HP уже актуальны.
  useEffect(() => {
    if (syncAttempted.current) return;
    syncAttempted.current = true;
    syncResources();
  }, [syncResources]);

  const restCtx = useMemo(() => ({ ...ctx, passives }), [ctx, passives]);

  const handleStartTurn = () => {
    const { state, events } = startTurn(runtime);
    apply(state, events, false);
  };

  const handleShortRest = () => {
    const { state, events } = shortRest(runtime, restCtx);
    apply(state, events, true);
  };

  const handleLongRest = () => {
    const { state, events } = longRest(runtime, restCtx);
    apply(state, events, true);
  };

  const cls = compact ? 'cs-top-rest' : 'sheet-runtime-actions';

  return (
    <div className={cls}>
      <button type="button" className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'} disabled={busy} onClick={handleStartTurn}>
        <Swords size={14} /> Новый ход
      </button>
      <button
        type="button"
        className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'}
        disabled={busy}
        onClick={handleShortRest}
        title="Короткий отдых: +50% max HP и заряды умений"
      >
        <Sun size={14} /> Короткий отдых
      </button>
      <button type="button" className={compact ? 'cs-top-rest-btn' : 'forge-btn ghost sheet-roll-btn'} disabled={busy} onClick={handleLongRest}>
        <Moon size={14} /> Долгий отдых
      </button>
    </div>
  );
}
