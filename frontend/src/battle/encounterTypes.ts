/**
 * Онлайн-бой (encounter) — типы общего состояния и ЧИСТЫЙ reducer применения событий.
 * Reducer зеркалит серверный applyOps (backend/encounter_controller.go), чтобы клиент
 * и сервер сходились. Клиент дедуплит по seq: применяет только события новее локального.
 */

/** Исход спасброска, предрассчитанный кастером ДВИЖКОМ (полноценно: урон с сопротивлениями/
 *  половиной, состояния, on_success-эффекты). Дельты, а не абсолюты — цель применяет их к своему
 *  ТЕКУЩЕМУ состоянию (иначе абсолют затёр бы параллельный урон от другого атакующего). */
export interface SaveOutcome {
  hpDelta: number;      // изменение hp (обычно отрицательное — урон)
  tempDelta: number;    // изменение временных хитов
  damageType?: string;  // тип основного урона (для журнала)
  addEffects?: { id: string; name: string; [k: string]: unknown }[]; // состояния/эффекты, добавляемые в этом исходе
}

/** Запрос на спасбросок, адресованный цели (онлайн-бой). Кастер предрассчитывает ОБА исхода
 *  (провал/успех) полноценным прогоном движка; цель кидает d20 сама на своём листе и применяет
 *  дельты выбранного исхода. Живёт на комбатанте-цели, синкается обычным патчем. */
export interface PendingSave {
  id: string;
  sourceName: string;   // кто наложил (для журнала/диалога)
  actionName: string;   // название заклинания/действия
  ability: string;      // спас-характеристика: dex/con/wis/...
  dc: number;           // СЛ
  onFail: SaveOutcome;
  onSuccess: SaveOutcome;
  avoidsConditions?: string[]; // состояния, налагаемые при провале — цель применит condition-scoped модификаторы спаса
}

export interface Combatant {
  actorId: string;
  name: string;
  isMonster?: boolean;
  characterId?: string;
  ownerUserId?: string;
  ac?: number;
  maxHp: number;
  hp: number;
  temp?: number;
  activeEffects?: { id: string; name: string; [k: string]: unknown }[];
  pendingSaves?: PendingSave[];
  avatarUrl?: string;
  initiative?: number;
}

export interface EncounterState {
  combatants: Combatant[];
  round: number;
  activeIndex: number;
}

export interface Encounter {
  id: string;
  name: string;
  owner_user_id: string;
  member_user_ids?: string[];
  state: EncounterState;
  seq: number;
}

/** Запись журнала боя: message — строка для общего журнала; targetCharacterId+payload —
 *  для журнала конкретного персонажа (пишет сервер). type/payload — EngineEvent. */
export interface BattleLogEntry {
  message: string;
  targetCharacterId?: string;
  type?: string;
  payload?: import('../mvp/contracts').EngineEvent;
}

/** Событие боя из SSE-потока (совпадает с payload op на сервере + seq). */
export interface EncounterEvent {
  seq: number;
  patches?: { actor_id: string; set?: Record<string, unknown> }[];
  add?: Combatant[];
  remove?: string[];
  round?: number;
  active_index?: number;
  events?: unknown[];
  log?: BattleLogEntry[];
}

export function emptyEncounterState(): EncounterState {
  return { combatants: [], round: 1, activeIndex: 0 };
}

/** Нормализация state из ответа сервера (jsonb может прийти с недостающими полями). */
export function normalizeState(raw: unknown): EncounterState {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const combatants = Array.isArray(s.combatants) ? (s.combatants as Combatant[]) : [];
  return {
    combatants,
    round: typeof s.round === 'number' ? s.round : 1,
    activeIndex: typeof s.activeIndex === 'number' ? s.activeIndex : 0,
  };
}

/**
 * Применить событие к состоянию боя (чисто). Порядок как на сервере: remove → patch → add,
 * затем round/activeIndex. Патч — shallow-merge set в комбатанта по actorId.
 */
export function applyEncounterEvent(state: EncounterState, ev: EncounterEvent): EncounterState {
  let combatants = state.combatants;
  if (ev.remove?.length) {
    const rm = new Set(ev.remove);
    combatants = combatants.filter((c) => !rm.has(c.actorId));
  }
  if (ev.patches?.length) {
    combatants = combatants.map((c) => {
      const p = ev.patches!.find((x) => x.actor_id === c.actorId);
      return p ? ({ ...c, ...(p.set ?? {}) } as Combatant) : c;
    });
  }
  if (ev.add?.length) {
    combatants = [...combatants, ...ev.add];
  }
  return {
    combatants,
    round: typeof ev.round === 'number' ? ev.round : state.round,
    activeIndex: typeof ev.active_index === 'number' ? ev.active_index : state.activeIndex,
  };
}
