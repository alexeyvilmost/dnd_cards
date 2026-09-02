/**
 * Доска онлайн-боя (/encounter/:id) — общее состояние в реальном времени между всеми
 * подключёнными клиентами (разные устройства/аккаунты) через SSE. Действия (урон/лечение/
 * состояния/ход) отправляются как op на сервер (client-authoritative-relay), сервер бампит seq,
 * персистит и рассылает всем; изменения приходят обратно потоком и применяются локально.
 * Этот legacy relay не является семантическим authority нового rules-core: сырые
 * кнопки ниже — явно помеченный GM override, а не исполнение Action/Spell mechanics.
 */
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacter } from '../character/types';
import { useEncounterStream } from '../battle/useEncounterStream';
import {
  encounterInviteTokenFromHash,
  encounterInviteUrl,
  encountersApi,
  type ApplyOp,
} from '../battle/encountersApi';
import type { Combatant, BattleLogEntry } from '../battle/encounterTypes';
import {
  ENCOUNTER_GM_OVERRIDE_PROVENANCE,
  explicitEncounterArmorClass,
  manualGmOverrideCombatant,
} from '../battle/encounterOverrides';
import type { ActiveEffectEntry, EngineEvent } from '../mvp/contracts';
import { conditionOptions } from '../engine/conditions';
import { certifiedConditionEffectEntity } from '../api/conditionsApi';
import { groupActiveEffectsForDisplay } from '../engine/effects';
import ActiveEffectCard from '../components/ActiveEffectCard';
import { useAuth } from '../contexts/AuthContext';

// Состояния берём из реестра движка (канонические id + метки), чтобы наложенное с доски
// состояние было валидно и на листе персонажа (mechanics.value = id из реестра).
const CONDITIONS = conditionOptions();

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

export default function EncounterBoard() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const initialInviteToken = encounterInviteTokenFromHash(location.hash);
  const [inviteAccess, setInviteAccess] = useState<'joining' | 'ready' | 'error'>(initialInviteToken ? 'joining' : 'ready');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const { meta, state, connected, error, log, seq, apply: applyEncounter } = useEncounterStream(inviteAccess === 'ready' ? id : undefined);
  const [chars, setChars] = useState<ForgeCharacter[] | null>(null);
  const [addingChar, setAddingChar] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualHp, setManualHp] = useState('');
  const [manualAc, setManualAc] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [inviteBusy, setInviteBusy] = useState(false);
  const isEncounterOwner = Boolean(meta && user && meta.owner_user_id === user.id);

  useEffect(() => {
    const inviteToken = encounterInviteTokenFromHash(location.hash);
    if (!inviteToken) {
      setInviteAccess('ready');
      setInviteError(null);
      return;
    }
    // Fragment never reaches the server, and is removed from the visible URL
    // before the capability is submitted in the authenticated POST body.
    window.history.replaceState(window.history.state, '', `${location.pathname}${location.search}`);
    if (!id) {
      setInviteAccess('error');
      setInviteError('Некорректная ссылка-приглашение');
      return;
    }
    let cancelled = false;
    setInviteAccess('joining');
    setInviteError(null);
    encountersApi.join(id, inviteToken).then(() => {
      if (!cancelled) setInviteAccess('ready');
    }).catch((joinError) => {
      if (cancelled) return;
      setInviteAccess('error');
      setInviteError(joinError instanceof Error ? joinError.message : 'Приглашение недействительно или истекло');
    });
    return () => { cancelled = true; };
  }, [id, location.hash, location.pathname, location.search]);

  const apply = useCallback((op: ApplyOp) => {
    if (id) applyEncounter(op, seq).catch((e) => console.error('apply error', e));
  }, [id, applyEncounter, seq]);

  // Запись журнала боя: message → общий журнал; для персонажа (characterId) — ещё и в его лист.
  const logEntry = (c: Combatant, ev: EngineEvent, message: string): BattleLogEntry => ({
    message, type: ev.type, payload: ev, ...(c.characterId ? { targetCharacterId: c.characterId } : {}),
  });

  const damage = (c: Combatant, amt: number) => {
    const temp = c.temp ?? 0;
    const absorbed = Math.min(temp, amt);
    const hp = Math.max(0, c.hp - (amt - absorbed));
    apply({
      patches: [{ actor_id: c.actorId, set: { hp, temp: temp - absorbed } }],
      log: [logEntry(c, { type: 'damage', amount: amt, damageType: 'прямой' }, `[GM override] Урон ${amt} → ${c.name}`)],
    });
  };
  const heal = (c: Combatant, amt: number) => {
    const hp = Math.min(c.maxHp, c.hp + amt);
    apply({
      patches: [{ actor_id: c.actorId, set: { hp } }],
      log: [logEntry(c, { type: 'healing', amount: amt }, `[GM override] Лечение ${amt} → ${c.name}`)],
    });
  };
  const addCondition = (c: Combatant, opt: { id: string; label: string }) => {
    const eff = [...(c.activeEffects ?? [])];
    if (eff.some((e) => (e as { mechanics?: { kind?: string; value?: string } }).mechanics?.kind === 'condition'
      && (e as { mechanics?: { value?: string } }).mechanics?.value === opt.id)) return;
    // Богатая запись — валидна и как combatant.activeEffect, и как состояние листа (SheetConditionsPanel).
    const entity = certifiedConditionEffectEntity(opt.id);
    if (!entity) {
      setNotice(`Состояние «${opt.label}» не загружено из библиотеки.`);
      return;
    }
    const entry = {
      id: uid(),
      name: entity.name,
      mechanics: {
        ...entity.mechanics,
        provenance: ENCOUNTER_GM_OVERRIDE_PROVENANCE,
      },
      entityRef: { kind: 'effect' as const, id: entity.id, cardNumber: entity.card_number },
      expiry: 'manual',
      source: ENCOUNTER_GM_OVERRIDE_PROVENANCE,
    };
    apply({
      patches: [{ actor_id: c.actorId, set: { activeEffects: [...eff, entry] } }],
      log: [logEntry(c, { type: 'condition_applied', condition: opt.id }, `[GM override] Состояние «${opt.label}» → ${c.name}`)],
    });
  };
  const removeConditions = (c: Combatant, effectIds: readonly string[]) => {
    const ids = new Set(effectIds);
    const names = (c.activeEffects ?? [])
      .filter((effect) => ids.has(effect.id))
      .map((effect) => effect.name);
    apply({
      patches: [{ actor_id: c.actorId, set: { activeEffects: (c.activeEffects ?? []).filter((effect) => !ids.has(effect.id)) } }],
      log: names.map((name) => logEntry(
        c, { type: 'effect_expired', name }, `[GM override] Снято «${name}» с ${c.name}`,
      )),
    });
  };
  const removeCombatant = (combatant: Combatant) => apply({
    remove: [combatant.actorId],
    log: [{ message: `[GM override] Участник «${combatant.name}» удалён с доски` }],
  });

  const nextTurn = () => {
    const n = state.combatants.length;
    if (!n) return;
    const next = (state.activeIndex + 1) % n;
    const round = next === 0 ? state.round + 1 : state.round;
    const msg = next === 0
      ? `[GM override] — Раунд ${round} —`
      : `[GM override] Ход: ${state.combatants[next]?.name ?? ''}`;
    apply({ active_index: next, round, log: [{ message: msg }] });
  };

  const addManual = () => {
    try {
      const combatant = manualGmOverrideCombatant({
        actorId: uid(), name: manualName, hp: manualHp, ac: manualAc,
      });
      apply({
        add: [combatant],
        log: [{ message: `[GM override] Существо «${combatant.name}» добавлено вручную` }],
      });
      setManualName('');
      setManualHp('');
      setManualAc('');
      setNotice(null);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : 'Проверьте явные HP и КЗ существа');
    }
  };
  const addFromCharacter = async (ch: ForgeCharacter) => {
    if (!id) return;
    // Правило «один бой на персонажа»: сервер вернёт 409, если персонаж уже в другом бою.
    try {
      const c: Combatant = {
        actorId: uid(), name: ch.name, characterId: ch.id,
        hp: ch.current_hp ?? 0, maxHp: ch.max_hp ?? 0,
        ac: explicitEncounterArmorClass(ch),
        temp: (ch.turn_state?.temp_hp as number) ?? 0,
        activeEffects: (ch.active_effects as Combatant['activeEffects']) ?? [],
        avatarUrl: ch.avatar_url,
        provenance: `${ENCOUNTER_GM_OVERRIDE_PROVENANCE}:character_enrollment`,
      };
      await applyEncounter({
        add: [c],
        log: [{ message: `[GM override] Персонаж «${c.name}» добавлен на legacy-доску` }],
      }, seq);
      setNotice(null);
      setAddingChar(false);
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setNotice(msg || 'Не удалось добавить персонажа в бой');
    }
  };
  useEffect(() => {
    if (addingChar && !chars) charactersV3Api.list().then(setChars).catch(() => setChars([]));
  }, [addingChar, chars]);

  const copyInvite = async () => {
    if (!id || !isEncounterOwner || inviteBusy) return;
    setInviteBusy(true);
    try {
      const invite = await encountersApi.issueInvite(id);
      if (!navigator.clipboard) throw new Error('Буфер обмена недоступен в этом браузере');
      await navigator.clipboard.writeText(encounterInviteUrl(id, invite.token, window.location.origin));
      const expiresAt = new Date(invite.expires_at);
      const expiresLabel = Number.isNaN(expiresAt.getTime()) ? 'через 15 минут' : `до ${expiresAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      setNotice(`Приглашение скопировано и действует ${expiresLabel}`);
    } catch (inviteIssueError) {
      setNotice(inviteIssueError instanceof Error ? inviteIssueError.message : 'Не удалось создать приглашение');
    } finally {
      setInviteBusy(false);
    }
  };

  if (inviteAccess === 'joining') return <div role="status" style={{ padding: 24, color: '#d8b978' }}>Присоединяем к бою…</div>;
  if (inviteAccess === 'error') return <div role="alert" style={{ padding: 24, color: '#c0392b' }}>{inviteError ?? 'Приглашение недействительно или истекло'}</div>;
  if (error) return <div style={{ padding: 24, color: '#c0392b' }}>{error}</div>;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', color: '#e8e0d0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#d8b978', margin: 0 }}>{meta?.name ?? 'Бой'}</h1>
        <span title={connected ? 'подключено (realtime)' : 'переподключение…'} style={{
          width: 10, height: 10, borderRadius: '50%', background: connected ? '#3fb950' : '#c9a227',
        }} />
        <span style={{ fontSize: 13, color: '#a99f8b' }}>Раунд {state.round}</span>
        {isEncounterOwner && <button onClick={nextTurn} style={btn}>Следующий ход →</button>}
        {isEncounterOwner && <button
          onClick={() => { void copyInvite(); }}
          disabled={inviteBusy}
          title="Создать подписанное приглашение на 15 минут"
          style={{ ...btnGhost, marginLeft: 'auto' }}
        >{inviteBusy ? 'Создаём…' : 'Скопировать приглашение'}</button>}
      </div>

      {notice && (
        <div style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 8, border: '1px solid #7a4a2b', background: '#2b1f16', color: '#e8b98a', display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ flex: 1, fontSize: 13 }}>{notice}</span>
          <button onClick={() => setNotice(null)} style={btnGhost}>✕</button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.combatants.map((c, i) => {
          const pct = c.maxHp > 0 ? Math.round((c.hp / c.maxHp) * 100) : 0;
          const active = i === state.activeIndex;
          const canRemove = isEncounterOwner || Boolean(user && c.characterId && c.ownerUserId === user.id);
          const canPatch = isEncounterOwner || Boolean(user && c.characterId && c.ownerUserId === user.id);
          return (
            <div key={c.actorId} style={{
              border: `1px solid ${active ? '#8a7320' : '#3a332a'}`, borderRadius: 10, padding: 10,
              background: active ? '#241f16' : '#1c1813',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <b style={{ fontSize: 15 }}>{c.name}</b>
                {c.isMonster && <span style={tag}>монстр</span>}
                {typeof c.ac === 'number' && <span style={{ ...tag, background: '#2b3a2b' }}>КЗ {c.ac}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 14, color: c.hp <= 0 ? '#c0392b' : '#d8b978' }}>
                  {c.hp}/{c.maxHp}{c.temp ? ` (+${c.temp})` : ''}
                </span>
                {canRemove && <button onClick={() => removeCombatant(c)} title="Убрать из боя" style={btnGhost}>✕</button>}
              </div>
              <div style={{ height: 8, borderRadius: 5, background: '#3a332a', overflow: 'hidden', margin: '6px 0' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct > 50 ? '#3fb950' : pct > 20 ? '#c9a227' : '#c0392b', transition: 'width .2s' }} />
              </div>
              {!!c.activeEffects?.length && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  {groupActiveEffectsForDisplay(c.activeEffects as unknown as ActiveEffectEntry[]).map((group) => (
                    <ActiveEffectCard
                      key={group.key}
                      group={group}
                      actions={canPatch ? <button
                        type="button"
                        style={btnGhost}
                        onClick={() => removeConditions(c, group.effects.map((effect) => effect.id))}
                        title="Снять"
                      >✕</button> : undefined}
                    />
                  ))}
                </div>
              )}
              {canPatch && <RowActions
                onDamage={(n) => damage(c, n)}
                onHeal={(n) => heal(c, n)}
                onCondition={(opt) => addCondition(c, opt)}
              />}
            </div>
          );
        })}
        {!state.combatants.length && <p style={{ color: '#a99f8b' }}>В бою пока никого. Добавьте участников ниже.</p>}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setAddingChar((v) => !v)} style={btn}>+ Персонаж</button>
        {isEncounterOwner && <>
          <strong style={{ width: '100%', color: '#e8b98a', fontSize: 12 }}>
            GM override: ручные HP, КЗ и правки ниже обходят сценарный движок и записываются с provenance.
          </strong>
          <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Имя существа" style={input} />
          <input value={manualHp} onChange={(e) => setManualHp(e.target.value)} type="number" style={{ ...input, width: 70 }} title="HP" />
          <input value={manualAc} onChange={(e) => setManualAc(e.target.value)} type="number" style={{ ...input, width: 60 }} title="КЗ" />
          <button onClick={addManual} style={btn}>+ Существо</button>
        </>}
      </div>

      {addingChar && (
        <div style={{ marginTop: 8, border: '1px solid #3a332a', borderRadius: 8, padding: 8, background: '#1c1813', maxHeight: 220, overflowY: 'auto' }}>
          {chars === null && <p style={{ color: '#a99f8b' }}>Загрузка…</p>}
          {chars?.map((ch) => (
            <button key={ch.id} onClick={() => addFromCharacter(ch)} style={{ ...btnGhost, display: 'block', width: '100%', textAlign: 'left', margin: '2px 0' }}>
              {ch.name} · {ch.current_hp ?? 0}/{ch.max_hp ?? 0} HP
            </button>
          ))}
          {chars?.length === 0 && <p style={{ color: '#a99f8b' }}>Персонажей нет.</p>}
        </div>
      )}

      {/* Общий журнал боя — все события этого боя (урон/лечение/состояния/ход), live из SSE. */}
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setShowLog((v) => !v)} style={{ ...btnGhost, width: '100%', textAlign: 'left' }}>
          {showLog ? '▾' : '▸'} Журнал боя{log.length ? ` (${log.length})` : ''}
        </button>
        {showLog && (
          <div style={{ marginTop: 6, border: '1px solid #3a332a', borderRadius: 8, padding: 8, background: '#161210', maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
            {log.length ? log.map((l, i) => (
              <div key={`${l.seq}-${i}`} style={{ fontSize: 12.5, color: '#c9b98a', lineHeight: 1.5 }}>
                <span style={{ color: '#6b5f4a', marginRight: 6 }}>#{l.seq}</span>{l.text}
              </div>
            )) : <span style={{ color: '#a99f8b', fontSize: 13 }}>Событий пока нет.</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function RowActions({ onDamage, onHeal, onCondition }: { onDamage: (n: number) => void; onHeal: (n: number) => void; onCondition: (opt: { id: string; label: string }) => void }) {
  const [amt, setAmt] = useState('');
  const n = Math.max(0, parseInt(amt, 10) || 0);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={{ color: '#e8b98a', fontSize: 11 }}>GM override</span>
      <input value={amt} onChange={(e) => setAmt(e.target.value)} type="number" placeholder="кол-во" style={{ ...input, width: 70 }} />
      <button onClick={() => n && onDamage(n)} style={{ ...btn, background: '#5a2b2b' }}>Урон</button>
      <button onClick={() => n && onHeal(n)} style={{ ...btn, background: '#2b4a2b' }}>Лечение</button>
      <select onChange={(e) => { const opt = CONDITIONS.find((c) => c.id === e.target.value); if (opt) onCondition(opt); e.target.value = ''; }} defaultValue="" style={{ ...input, width: 150 }}>
        <option value="">+ состояние…</option>
        {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
      </select>
    </div>
  );
}

const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #6b5836', background: '#2b2520', color: '#e8e0d0', fontSize: 13, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '4px 8px', borderRadius: 6, border: '1px solid #4a4237', background: 'transparent', color: '#a99f8b', fontSize: 12, cursor: 'pointer' };
const input: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid #6b5836', background: '#1c1813', color: '#e8e0d0', fontSize: 13 };
const tag: React.CSSProperties = { fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#2b2520', color: '#c9b98a' };
