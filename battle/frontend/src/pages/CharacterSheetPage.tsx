import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { charactersApi, definitionsApi, featsApi, Definition } from "../api/client";

const ABILITY_LABELS: Record<string, string> = {
  strength: "СИЛ",
  dexterity: "ЛОВ",
  constitution: "ТЕЛ",
  intelligence: "ИНТ",
  wisdom: "МДР",
  charisma: "ХАР",
};

export default function CharacterSheetPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<any>(null);
  const [error, setError] = useState("");
  const [xpAmount, setXpAmount] = useState(300);
  const [cardId, setCardId] = useState("");
  const [defs, setDefs] = useState<Record<string, Definition>>({});
  const [newFeat, setNewFeat] = useState("");

  function load() {
    charactersApi
      .get(id!)
      .then(setC)
      .catch(() => setError("Персонаж не найден"));
  }
  useEffect(load, [id]);

  useEffect(() => {
    definitionsApi
      .list()
      .then((list) => setDefs(Object.fromEntries(list.map((d) => [d.id, d]))))
      .catch(() => {});
  }, []);

  const defName = (defId: string) => defs[defId]?.name_ru || defs[defId]?.name || defId;

  async function addFeat() {
    if (!newFeat) return;
    try {
      await featsApi.add(id!, newFeat);
      setNewFeat("");
      load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Не удалось добавить черту");
    }
  }

  async function dropFeat(featId: string) {
    await featsApi.remove(id!, featId);
    load();
  }

  async function award() {
    await charactersApi.awardXp(id!, xpAmount);
    load();
  }

  async function importCard() {
    if (!cardId.trim()) return;
    await charactersApi.importEquipmentCard(id!, cardId.trim());
    setCardId("");
    load();
  }

  async function removeCard(cid: string) {
    await charactersApi.removeEquipmentCard(id!, cid);
    load();
  }

  function mod(v: number) {
    const m = Math.floor((v - 10) / 2);
    return (m >= 0 ? "+" : "") + m;
  }

  if (error) return <div className="notice error">{error}</div>;
  if (!c) return <div className="spinner">Загрузка…</div>;

  const lp = c.level_progress || {};

  return (
    <div>
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <h1>
          {c.portrait} {c.name}
        </h1>
        <Link to="/characters">← К списку</Link>
      </div>

      <div className="panel">
        <div className="muted">
          {c.class_name === "Fighter" ? "Воин" : "Волшебник"} · Человек · уровень {c.level}
          {c.subclass ? ` · ${c.subclass}` : ""}
        </div>
        <div style={{ marginTop: 8 }}>
          <b>Опыт:</b> {lp.xp} {lp.xp_to_next != null ? `(до след. уровня: ${lp.xp_to_next})` : "(макс. уровень)"}
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          {lp.can_level_up && (
            <button className="primary" onClick={() => nav(`/characters/${id}/level-up`)}>
              ⬆ Повысить уровень
            </button>
          )}
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Начислить XP (тест)</label>
              <input
                type="number"
                style={{ width: 100 }}
                value={xpAmount}
                onChange={(e) => setXpAmount(Number(e.target.value))}
              />
            </div>
            <button onClick={award}>+ XP</button>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Характеристики</h3>
        <div className="statbox">
          {Object.keys(ABILITY_LABELS).map((ab) => (
            <div key={ab} className="stat">
              <div className="l">{ABILITY_LABELS[ab]}</div>
              <div className="v">{c.ability_scores[ab]}</div>
              <div className="muted">{mod(c.ability_scores[ab])}</div>
            </div>
          ))}
        </div>
      </div>

      {c.class_name === "Fighter" && (
        <div className="panel">
          <h3>Боевые опции</h3>
          <p>
            <b>Стиль:</b> {c.fighting_style} · <b>Снаряжение:</b> {c.weapon_choice}
          </p>
          <p>
            <b>Мастерства:</b>{" "}
            {(c.weapon_masteries || []).map((m: string) => (
              <span key={m} className="pill">
                {m}
              </span>
            ))}
          </p>
        </div>
      )}

      {c.class_name === "Wizard" && (
        <div className="panel">
          <h3>Магия</h3>
          <p>
            <b>Заговоры:</b>{" "}
            {(c.cantrips || []).map((s: string) => (
              <span key={s} className="pill">
                {s}
              </span>
            ))}
          </p>
          <p>
            <b>Подготовлено:</b>{" "}
            {(c.spells_prepared || []).map((s: string) => (
              <span key={s} className="pill">
                {s}
              </span>
            ))}
          </p>
        </div>
      )}

      <div className="panel">
        <h3>Способности</h3>
        {(c.features || []).map((f: string) => (
          <span key={f} className="pill">
            {f}
          </span>
        ))}
      </div>

      <div className="panel">
        <h3>Предыстория и черты</h3>
        <div className="muted" style={{ marginBottom: 8 }}>
          Предыстория: <b style={{ color: "var(--gold)" }}>{c.background ? defName(c.background) : "—"}</b>
        </div>
        <div style={{ marginBottom: 8 }}>
          {(c.feats || []).length === 0 && <span className="muted">Черт нет</span>}
          {(c.feats || []).map((f: string) => (
            <span key={f} className="pill" title={defs[f]?.description || ""}>
              {defName(f)}
              <button
                className="ghost"
                style={{ padding: "0 6px" }}
                onClick={() => dropFeat(f)}
                title="Убрать"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        {c.level >= 4 && (
          <div className="row" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ marginBottom: 0, minWidth: 220 }}>
              <label>Добавить общую черту</label>
              <select value={newFeat} onChange={(e) => setNewFeat(e.target.value)}>
                <option value="">— выбрать —</option>
                {Object.values(defs)
                  .filter((d) => d.kind === "general_feat" && !(c.feats || []).includes(d.id))
                  .sort((a, b) => (a.name_ru || a.name).localeCompare(b.name_ru || b.name))
                  .map((d) => (
                    <option key={d.id} value={d.id}>{d.name_ru || d.name}</option>
                  ))}
              </select>
            </div>
            <button onClick={addFeat} disabled={!newFeat}>+ Черта</button>
          </div>
        )}
      </div>

      <div className="panel">
        <h3>Экипировка из dnd_cards (боевой импорт)</h3>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Card ID</label>
            <input value={cardId} onChange={(e) => setCardId(e.target.value)} placeholder="uuid карточки" />
          </div>
          <button onClick={importCard}>Импортировать предмет</button>
        </div>
        {(c.equipment || []).length === 0 && <div className="muted">Нет импортированных предметов</div>}
        {(c.equipment || []).map((it: any) => (
          <div key={it.card_id} className="card-tile" style={{ cursor: "default", marginTop: 8 }}>
            <div className="btn-row" style={{ justifyContent: "space-between" }}>
              <b>{it.name}</b>
              <button className="danger" onClick={() => removeCard(it.card_id)}>
                Убрать
              </button>
            </div>
            <div className="muted">
              kind: {it.kind} · ready: {String(it.ready)}
            </div>
            <div className="muted">
              {it.damage_dice ? `dmg ${it.damage_dice} ${it.damage_type || ""}` : ""}
              {it.ac_bonus != null ? ` · AC +${it.ac_bonus}` : ""}
              {it.to_hit_bonus != null ? ` · hit +${it.to_hit_bonus}` : ""}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
