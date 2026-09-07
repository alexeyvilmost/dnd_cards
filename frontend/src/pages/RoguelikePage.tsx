import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BedDouble, Lock, RotateCcw, ShoppingBag, Swords, Trophy, Unlock } from 'lucide-react';
import { charactersV3Api } from '../character/api';
import { fetchBasicActions } from '../character/basicActions';
import { loadSheetCombatParticipant } from '../character/sheetCombatTargetRuntime';
import {
  writeRulesEngineRuntimeTurnState,
} from '../character/runtime';
import type { ForgeCharacter } from '../character/types';
import { longRest, shortRest, spendHitDie } from '../engine/turn';
import { hitDiceResourceKey, hitDieSides } from '../engine/resources';
import type { CharacterContext, RuntimeState } from '../mvp/contracts';
import { getCardsIndex } from '../utils/cardsIndex';
import { roguelikeApi, type RoguelikeCommandType, type RoguelikeRun } from '../roguelike/api';
import './RoguelikePage.css';

const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000] as const;
const DIFFICULTY_LABELS = { low: 'Низкая', moderate: 'Средняя', high: 'Высокая' } as const;

type RestContext = CharacterContext & { passives?: Record<string, unknown>[] };

function earnedLevel(xp: number): number {
  for (let level = 5; level >= 1; level -= 1) {
    if (xp >= XP_THRESHOLDS[level - 1]) return level;
  }
  return 1;
}

function nextTarget(level: number): number {
  return level >= 5 ? 14000 : XP_THRESHOLDS[level];
}

function combatURL(run: RoguelikeRun, setup: boolean): string {
  const params = new URLSearchParams({ roguelike: run.id });
  if (setup && run.encounter.monster_id && run.encounter.quantity) {
    params.set(run.encounter.monster_id, String(run.encounter.quantity));
  }
  return `/characters-v3/${run.character_id}/combat?${params.toString()}`;
}

function hasCombatSnapshot(character?: ForgeCharacter): boolean {
  const value = character?.turn_state?.solo_combat_v1;
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return 'Операция не выполнена';
}

function RunList() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RoguelikeRun[]>([]);
  const [characters, setCharacters] = useState<ForgeCharacter[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([roguelikeApi.list(), charactersV3Api.list()])
      .then(([loadedRuns, loadedCharacters]) => {
        if (!active) return;
        setRuns(loadedRuns);
        const candidates = loadedCharacters.filter((character) => (
          character.level === 1 && character.character_type !== 'dungeon_crawl'
        ));
        setCharacters(candidates);
        setSelected(candidates[0]?.id ?? '');
      })
      .catch((reason) => active && setError(errorMessage(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  const create = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const run = await roguelikeApi.create(selected);
      navigate(`/roguelike/${run.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
      setBusy(false);
    }
  };

  return (
    <main className="roguelike-shell">
      <section className="roguelike-hero">
        <p className="roguelike-kicker">РЕЖИМ ЗАБЕГА</p>
        <h1>Дорога до шестого уровня</h1>
        <p>Проведите воина через случайные столкновения, развивайте сборку и наберите 14 000 опыта.</p>
      </section>

      {error && <div className="roguelike-error" role="alert">{error}</div>}
      {loading ? <p>Загружаем забеги…</p> : (
        <div className="roguelike-grid">
          <section className="roguelike-card">
            <h2>Новый забег</h2>
            <p>Нужен готовый воин 1 уровня. Будет создан отдельный игровой лист.</p>
            {characters.length ? (
              <>
                <label className="roguelike-field">
                  <span>Персонаж</span>
                  <select value={selected} onChange={(event) => setSelected(event.target.value)}>
                    {characters.map((character) => (
                      <option key={character.id} value={character.id}>{character.name} · КЗ {character.armor_class ?? 10}</option>
                    ))}
                  </select>
                </label>
                <button type="button" className="roguelike-primary" disabled={busy} onClick={create}>
                  {busy ? 'Создаём…' : 'Начать забег'}
                </button>
              </>
            ) : (
              <p>Нет подходящего персонажа. <Link to="/m/characters/new">Создать воина</Link></p>
            )}
          </section>

          <section className="roguelike-card roguelike-runs">
            <h2>Ваши забеги</h2>
            {runs.length === 0 ? <p>Здесь появится история прохождений.</p> : runs.map((run) => (
              <Link className="roguelike-run-row" to={`/roguelike/${run.id}`} key={run.id}>
                <strong>{run.character?.name ?? 'Воин'}</strong>
                <span>{run.experience} XP · {run.encounters_won} побед · попытка {run.attempt}</span>
                <em>{run.status === 'victory' ? 'Победа' : run.status === 'defeat' ? 'Поражение' : 'В пути'}</em>
              </Link>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}

function RunCamp({ id }: { id: string }) {
  const navigate = useNavigate();
  const [run, setRun] = useState<RoguelikeRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restDraft, setRestDraft] = useState<{
    runtime: RuntimeState;
    context: RestContext;
    rolls: number[];
  } | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      setRun(await roguelikeApi.get(id));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }, [id]);

  useEffect(() => { void reload(); }, [reload]);

  const command = async (type: RoguelikeCommandType, payload: Record<string, unknown> = {}) => {
    if (!run) return null;
    setBusy(true);
    setError(null);
    try {
      const updated = await roguelikeApi.command(run.id, run.revision, type, payload);
      setRun(updated);
      return updated;
    } catch (reason) {
      setError(errorMessage(reason));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const startEncounter = async () => {
    const updated = await command('start_encounter');
    if (updated) navigate(combatURL(updated, true));
  };

  const restAuthority = async () => {
    if (!run?.character) throw new Error('Лист забега не загружен');
    const [cards, basicActions] = await Promise.all([getCardsIndex(), fetchBasicActions()]);
    const participant = await loadSheetCombatParticipant({
      character: run.character,
      basicActions,
      cards,
    });
    const actor = participant.canonical.world.actors[run.character.id];
    if (!actor || !participant.restContext) throw new Error('Не удалось собрать правила отдыха');
    return { runtime: actor.runtime, context: participant.restContext };
  };

  const beginShortRest = async () => {
    setBusy(true);
    setError(null);
    try {
      const authority = await restAuthority();
      const rested = shortRest(authority.runtime, authority.context);
      if (rested.pendingReactions?.length) throw new Error('Отдых требует решения реакции на листе персонажа');
      setRestDraft({ runtime: rested.state, context: authority.context, rolls: [] });
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const spendOneHitDie = () => {
    if (!restDraft) return;
    const sides = hitDieSides(restDraft.context.hitDie);
    if (!sides) return;
    const sample = new Uint32Array(1);
    crypto.getRandomValues(sample);
    const rolled = 1 + (sample[0] % sides);
    const result = spendHitDie(restDraft.runtime, restDraft.context, rolled);
    setRestDraft({ ...restDraft, runtime: result.state, rolls: [...restDraft.rolls, rolled] });
  };

  const restPayload = (runtime: RuntimeState, hitDieRolls: number[] = []) => ({
    runtime: {
      current_hp: runtime.hp.current,
      resources: runtime.resources,
      active_effects: runtime.activeEffects,
      turn_state: writeRulesEngineRuntimeTurnState(run?.character?.turn_state, runtime),
    },
    hit_die_rolls: hitDieRolls,
  });

  const finishShortRest = async () => {
    if (!restDraft) return;
    const updated = await command('short_rest', restPayload(restDraft.runtime, restDraft.rolls));
    if (updated) setRestDraft(null);
  };

  const takeLongRest = async () => {
    setBusy(true);
    setError(null);
    try {
      const authority = await restAuthority();
      const rested = longRest(authority.runtime, authority.context);
      if (rested.pendingReactions?.length) throw new Error('Отдых требует решения реакции на листе персонажа');
      const updated = await roguelikeApi.command(run!.id, run!.revision, 'long_rest', restPayload(rested.state));
      setRun(updated);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  const currentLevel = run?.character?.level ?? 1;
  const targetXP = nextTarget(currentLevel);
  const progress = run ? Math.min(100, Math.round((run.experience / targetXP) * 100)) : 0;
  const levelAvailable = run ? earnedLevel(run.experience) > currentLevel || Boolean(run.pending_level) : false;
  const victoryAvailable = Boolean(run && run.experience >= 14000 && currentLevel === 5);
  const hitDieKey = restDraft ? hitDiceResourceKey(restDraft.context.hitDie) : null;
  const hitDiceLeft = hitDieKey && restDraft ? restDraft.runtime.resources[hitDieKey] ?? 0 : 0;
  const potionOffers = [...(run?.shop?.staples ?? []), ...(run?.shop?.offers ?? [])]
    .filter((offer) => offer.card_number === 'CARD-0839' || offer.card_number === 'CARD-0840');
  const potionCardIds = new Set(potionOffers.map((offer) => offer.card_id).filter(Boolean));
  const healingItems = (run?.character?.inventory_items ?? [])
    .filter((row) => row.qty > 0 && potionCardIds.has(row.card_id));

  if (!run) {
    return <main className="roguelike-shell">{error ? <div className="roguelike-error">{error}</div> : <p>Загружаем лагерь…</p>}</main>;
  }

  if (run.status === 'victory') {
    return (
      <main className="roguelike-shell roguelike-ending">
        <Trophy size={64} />
        <p className="roguelike-kicker">ЗАБЕГ ЗАВЕРШЁН</p>
        <h1>Победа!</h1>
        <p>{run.character?.name} набрал {run.experience} опыта за {run.encounters_won} столкновений.</p>
        <Link className="roguelike-primary" to="/roguelike">К списку забегов</Link>
      </main>
    );
  }

  if (run.status === 'defeat') {
    return (
      <main className="roguelike-shell roguelike-ending">
        <RotateCcw size={64} />
        <p className="roguelike-kicker">ПОПЫТКА {run.attempt}</p>
        <h1>Поражение</h1>
        <p>Можно вернуться к состоянию после последней выигранной встречи. Награда за проигранный бой не начислена.</p>
        {error && <div className="roguelike-error">{error}</div>}
        <button type="button" className="roguelike-primary" disabled={busy} onClick={() => void command('retry')}>
          Повторить с контрольной точки
        </button>
      </main>
    );
  }

  if (run.phase === 'combat') {
    return (
      <main className="roguelike-shell roguelike-ending">
        <Swords size={64} />
        <p className="roguelike-kicker">СТОЛКНОВЕНИЕ {run.encounter.number}</p>
        <h1>{run.encounter.monster_name} × {run.encounter.quantity}</h1>
        <p>{DIFFICULTY_LABELS[run.encounter.difficulty ?? 'moderate']} сложность · {run.encounter.xp_total} XP</p>
        <Link className="roguelike-primary" to={combatURL(run, !hasCombatSnapshot(run.character))}>Вернуться в бой</Link>
      </main>
    );
  }

  return (
    <main className="roguelike-shell">
      <Link to="/roguelike" className="roguelike-back"><ArrowLeft size={16} /> Все забеги</Link>
      <section className="roguelike-camp-header">
        <div>
          <p className="roguelike-kicker">ЛАГЕРЬ · ПОПЫТКА {run.attempt}</p>
          <h1>{run.character?.name}</h1>
          <p>Уровень {currentLevel} · {run.encounters_won} выигранных столкновений · {run.game_clock_hours} ч. в пути</p>
        </div>
        <div className="roguelike-wallet"><strong>{run.gold}</strong><span>зм</span><strong>{run.supplies}</strong><span>припасов</span></div>
      </section>

      <section className="roguelike-progress" aria-label="Прогресс опыта">
        <div><strong>{run.experience} XP</strong><span>{victoryAvailable ? 'Цель достигнута' : `до цели ${targetXP - run.experience}`}</span></div>
        <div className="roguelike-progress-track"><span style={{ width: `${progress}%` }} /></div>
      </section>

      {run.last_reward?.experience ? (
        <section className="roguelike-reward">
          <strong>Награда:</strong> +{run.last_reward.experience} XP, +{run.last_reward.gold} зм
          {(run.last_reward.items?.length ?? 0) > 0
            ? <> · найдено: <b>{run.last_reward.items!.map((item) => item.name).join(', ')}</b></>
            : run.last_reward.item && <> · найдено: <b>{run.last_reward.item.name}</b></>}
        </section>
      ) : null}
      {error && <div className="roguelike-error" role="alert">{error}</div>}

      <div className="roguelike-grid">
        <section className="roguelike-card roguelike-actions">
          <h2>Следующий шаг</h2>
          {victoryAvailable ? (
            <button type="button" className="roguelike-victory" disabled={busy} onClick={() => void command('victory')}>
              <Trophy size={20} /> Победа!
            </button>
          ) : levelAvailable ? (
            <Link className="roguelike-primary" to={`/m/characters/${run.character_id}/level-up?returnTo=${encodeURIComponent(`/roguelike/${run.id}`)}`}>
              {run.pending_level ? `Продолжить повышение до ${run.pending_level} уровня` : `Повысить до ${earnedLevel(run.experience)} уровня`}
            </Link>
          ) : (
            <button type="button" className="roguelike-primary" disabled={busy} onClick={startEncounter}>
              <Swords size={18} /> Начать столкновение
            </button>
          )}
          <Link className="roguelike-secondary" to={`/characters-v3/${run.character_id}?roguelike=${encodeURIComponent(run.id)}`}>
            Экипировка и лист героя
          </Link>

          <div className="roguelike-consumables">
            <strong>Лечебные зелья</strong>
            {healingItems.length === 0 ? <small>Нет в инвентаре</small> : healingItems.map((row) => {
              const offer = potionOffers.find((candidate) => candidate.card_id === row.card_id);
              return (
                <button
                  type="button"
                  key={row.card_id}
                  disabled={busy || (run.character?.current_hp ?? 0) >= (run.character?.max_hp ?? 0)}
                  onClick={() => void command('use_item', { card_id: row.card_id })}
                >
                  Применить {offer?.name ?? 'зелье'} · {row.qty} шт.
                </button>
              );
            })}
          </div>

          <div className="roguelike-rests">
            <button type="button" disabled={busy || Boolean(restDraft)} onClick={beginShortRest}>Короткий отдых</button>
            <button type="button" disabled={busy || run.supplies < 1 || Boolean(restDraft)} onClick={takeLongRest}>
              <BedDouble size={16} /> Долгий отдых · 1 припас
            </button>
          </div>

          {restDraft && (
            <div className="roguelike-rest-draft">
              <strong>Короткий отдых</strong>
              <p>Хиты: {restDraft.runtime.hp.current}/{restDraft.runtime.hp.max}. Костей хитов: {hitDiceLeft}.</p>
              {restDraft.rolls.length > 0 && <p>Броски: {restDraft.rolls.join(', ')}</p>}
              <div>
                <button type="button" disabled={hitDiceLeft < 1 || restDraft.runtime.hp.current >= restDraft.runtime.hp.max} onClick={spendOneHitDie}>
                  Потратить одну кость
                </button>
                <button type="button" className="roguelike-primary" disabled={busy} onClick={finishShortRest}>Завершить отдых</button>
                <button type="button" onClick={() => setRestDraft(null)}>Отмена</button>
              </div>
            </div>
          )}
        </section>

        <section className="roguelike-card">
          <div className="roguelike-shop-title"><h2><ShoppingBag size={20} /> Магазин</h2><span>Обновление #{run.shop.generation}</span></div>
          <h3>Постоянная полка</h3>
          <div className="roguelike-offers">
            {(run.shop.staples ?? []).map((offer) => (
              <div className="roguelike-offer" key={offer.id}>
                <span><b>{offer.name}</b><small>{offer.quantity > 1 ? `${offer.quantity} шт.` : 'без ограничения'}</small></span>
                <button type="button" disabled={busy || run.gold < offer.price} onClick={() => void command('buy', { offer_id: offer.id })}>{offer.price} зм</button>
              </div>
            ))}
          </div>
          <h3>Случайные товары</h3>
          <div className="roguelike-offers">
            {(run.shop.offers ?? []).map((offer) => (
              <div className={`roguelike-offer ${offer.pinned ? 'is-pinned' : ''} ${offer.sold ? 'is-sold' : ''}`} key={offer.id}>
                <span><b>{offer.name}</b><small>{offer.sold ? 'Продано' : `${offer.price} зм`}</small></span>
                <div>
                  <button type="button" title={offer.pinned ? 'Снять фиксацию' : 'Зафиксировать за 5 зм'} disabled={busy || offer.sold} onClick={() => void command('pin', { offer_id: offer.pinned ? '' : offer.id })}>
                    {offer.pinned ? <Lock size={15} /> : <Unlock size={15} />}
                  </button>
                  <button type="button" disabled={busy || offer.sold || run.gold < offer.price} onClick={() => void command('buy', { offer_id: offer.id })}>Купить</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" className="roguelike-refresh" disabled={busy || run.gold < 5 * (run.paid_refresh_count + 1)} onClick={() => void command('refresh_shop')}>
            Обновить незакреплённое · {5 * (run.paid_refresh_count + 1)} зм
          </button>
        </section>
      </div>
    </main>
  );
}

export default function RoguelikePage() {
  const { id } = useParams<{ id: string }>();
  return id ? <RunCamp id={id} /> : <RunList />;
}
