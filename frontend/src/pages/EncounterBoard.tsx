/**
 * Доска онлайн-боя (/encounter/:id) — общее состояние в реальном времени между всеми
 * подключёнными клиентами (разные устройства/аккаунты) через SSE. Действия (урон/лечение/
 * состояния/ход) отправляются как op на сервер (client-authoritative-relay), сервер бампит seq,
 * персистит и рассылает всем; изменения приходят обратно потоком и применяются локально.
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { charactersV3Api } from '../character/api';
import type { ForgeCharacter } from '../character/types';
import { useEncounterStream } from '../battle/useEncounterStream';
import { encountersApi, type ApplyOp } from '../battle/encountersApi';
import type { Combatant } from '../battle/encounterTypes';

const CONDITIONS = ['Отравлен', 'Испуган', 'Схвачен', 'Опрокинут', 'Ошеломлён', 'Ослеплён', 'Очарован', 'Оглох', 'Парализован', 'Опутан', 'Без сознания', 'Невидим'];

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}`);

export default function EncounterBoard() {
  const { id } = useParams<{ id: string }>();
  const { meta, state, connected, error } = useEncounterStream(id);
  const [chars, setChars] = useState<ForgeCharacter[] | null>(null);
  const [addingChar, setAddingChar] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualHp, setManualHp] = useState('10');
  const [manualAc, setManualAc] = useState('12');

  const apply = useCallback((op: ApplyOp) => {
    if (id) encountersApi.apply(id, op).catch((e) => console.error('apply error', e));
  }, [id]);

  const patch = useCallback((actorId: string, set: Record<string, unknown>, events?: unknown[]) =>
    apply({ patches: [{ actor_id: actorId, set }], events }), [apply]);

  const damage = (c: Combatant, amt: number) => {
    const temp = c.temp ?? 0;
    const absorbed = Math.min(temp, amt);
    const hp = Math.max(0, c.hp - (amt - absorbed));
    patch(c.actorId, { hp, temp: temp - absorbed }, [`урон ${amt} по ${c.name}`]);
  };
  const heal = (c: Combatant, amt: number) => patch(c.actorId, { hp: Math.min(c.maxHp, c.hp + amt) }, [`лечение ${amt} на ${c.name}`]);
  const addCondition = (c: Combatant, name: string) => {
    const eff = [...(c.activeEffects ?? [])];
    if (eff.some((e) => e.name === name)) return;
    patch(c.actorId, { activeEffects: [...eff, { id: uid(), name }] });
  };
  const removeCondition = (c: Combatant, effId: string) =>
    patch(c.actorId, { activeEffects: (c.activeEffects ?? []).filter((e) => e.id !== effId) });
  const removeCombatant = (actorId: string) => apply({ remove: [actorId] });

  const nextTurn = () => {
    const n = state.combatants.length;
    if (!n) return;
    const next = (state.activeIndex + 1) % n;
    apply({ active_index: next, round: next === 0 ? state.round + 1 : state.round });
  };

  const addCombatant = (c: Combatant) => apply({ add: [c] });
  const addManual = () => {
    const hp = Math.max(1, parseInt(manualHp, 10) || 1);
    addCombatant({ actorId: uid(), name: manualName.trim() || 'Существо', isMonster: true, hp, maxHp: hp, ac: parseInt(manualAc, 10) || 10 });
    setManualName('');
  };
  const addFromCharacter = (ch: ForgeCharacter) => {
    const rs = (ch.rule_state ?? {}) as { armorClass?: number };
    addCombatant({
      actorId: uid(), name: ch.name, characterId: ch.id,
      hp: ch.current_hp ?? 0, maxHp: ch.max_hp ?? 0, ac: rs.armorClass ?? ch.armor_class ?? 10,
      temp: (ch.turn_state?.temp_hp as number) ?? 0,
      activeEffects: (ch.active_effects as Combatant['activeEffects']) ?? [],
      avatarUrl: ch.avatar_url,
    });
    setAddingChar(false);
  };
  useEffect(() => {
    if (addingChar && !chars) charactersV3Api.list().then(setChars).catch(() => setChars([]));
  }, [addingChar, chars]);

  const copyLink = () => navigator.clipboard?.writeText(window.location.href);

  if (error) return <div style={{ padding: 24, color: '#c0392b' }}>{error}</div>;

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', color: '#e8e0d0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#d8b978', margin: 0 }}>{meta?.name ?? 'Бой'}</h1>
        <span title={connected ? 'подключено (realtime)' : 'переподключение…'} style={{
          width: 10, height: 10, borderRadius: '50%', background: connected ? '#3fb950' : '#c9a227',
        }} />
        <span style={{ fontSize: 13, color: '#a99f8b' }}>Раунд {state.round}</span>
        <button onClick={nextTurn} style={btn}>Следующий ход →</button>
        <button onClick={copyLink} style={{ ...btnGhost, marginLeft: 'auto' }}>Скопировать ссылку</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {state.combatants.map((c, i) => {
          const pct = c.maxHp > 0 ? Math.round((c.hp / c.maxHp) * 100) : 0;
          const active = i === state.activeIndex;
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
                <button onClick={() => removeCombatant(c.actorId)} title="Убрать из боя" style={btnGhost}>✕</button>
              </div>
              <div style={{ height: 8, borderRadius: 5, background: '#3a332a', overflow: 'hidden', margin: '6px 0' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: pct > 50 ? '#3fb950' : pct > 20 ? '#c9a227' : '#c0392b', transition: 'width .2s' }} />
              </div>
              {!!c.activeEffects?.length && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                  {c.activeEffects.map((e) => (
                    <span key={e.id} style={{ ...tag, background: '#3a2b2b', cursor: 'pointer' }} onClick={() => removeCondition(c, e.id)} title="Снять">
                      {e.name} ✕
                    </span>
                  ))}
                </div>
              )}
              <RowActions
                onDamage={(n) => damage(c, n)}
                onHeal={(n) => heal(c, n)}
                onCondition={(name) => addCondition(c, name)}
              />
            </div>
          );
        })}
        {!state.combatants.length && <p style={{ color: '#a99f8b' }}>В бою пока никого. Добавьте участников ниже.</p>}
      </div>

      <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setAddingChar((v) => !v)} style={btn}>+ Персонаж</button>
        <input value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Имя существа" style={input} />
        <input value={manualHp} onChange={(e) => setManualHp(e.target.value)} type="number" style={{ ...input, width: 70 }} title="HP" />
        <input value={manualAc} onChange={(e) => setManualAc(e.target.value)} type="number" style={{ ...input, width: 60 }} title="КЗ" />
        <button onClick={addManual} style={btn}>+ Существо</button>
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
    </div>
  );
}

function RowActions({ onDamage, onHeal, onCondition }: { onDamage: (n: number) => void; onHeal: (n: number) => void; onCondition: (name: string) => void }) {
  const [amt, setAmt] = useState('');
  const n = Math.max(0, parseInt(amt, 10) || 0);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <input value={amt} onChange={(e) => setAmt(e.target.value)} type="number" placeholder="кол-во" style={{ ...input, width: 70 }} />
      <button onClick={() => n && onDamage(n)} style={{ ...btn, background: '#5a2b2b' }}>Урон</button>
      <button onClick={() => n && onHeal(n)} style={{ ...btn, background: '#2b4a2b' }}>Лечение</button>
      <select onChange={(e) => { if (e.target.value) { onCondition(e.target.value); e.target.value = ''; } }} defaultValue="" style={{ ...input, width: 150 }}>
        <option value="">+ состояние…</option>
        {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  );
}

const btn: React.CSSProperties = { padding: '5px 10px', borderRadius: 6, border: '1px solid #6b5836', background: '#2b2520', color: '#e8e0d0', fontSize: 13, cursor: 'pointer' };
const btnGhost: React.CSSProperties = { padding: '4px 8px', borderRadius: 6, border: '1px solid #4a4237', background: 'transparent', color: '#a99f8b', fontSize: 12, cursor: 'pointer' };
const input: React.CSSProperties = { padding: '5px 8px', borderRadius: 6, border: '1px solid #6b5836', background: '#1c1813', color: '#e8e0d0', fontSize: 13 };
const tag: React.CSSProperties = { fontSize: 11, padding: '1px 6px', borderRadius: 4, background: '#2b2520', color: '#c9b98a' };
