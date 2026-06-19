import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { monstersApi } from "../api/client";

const ABILS = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

export default function MonsterEditorPage() {
  const { id } = useParams();
  const edit = !!id;
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [m, setM] = useState<any>({
    name: "",
    cr: 0.25,
    ability_scores: {
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    },
    max_hp: 10,
    ac: 12,
    speed: 30,
    attacks: [{ name: "Claws", attack_bonus: 4, reach: 5, damage_dice: "1d6+2", damage_type: "slashing" }],
    multiattack: 1,
    save_proficiencies: [],
    features: [],
    battle_ready: true,
    portrait: "👾",
    description: "",
  });

  useEffect(() => {
    if (edit) monstersApi.get(id!).then(setM);
    else monstersApi.get("default").then(setM).catch(() => {});
  }, [edit, id]);

  function setField(k: string, v: any) {
    setM((x: any) => ({ ...x, [k]: v }));
  }

  function setAbility(ab: string, v: number) {
    setM((x: any) => ({ ...x, ability_scores: { ...x.ability_scores, [ab]: v } }));
  }

  function setAttack(idx: number, patch: any) {
    const attacks = [...m.attacks];
    attacks[idx] = { ...attacks[idx], ...patch };
    setField("attacks", attacks);
  }

  async function submit() {
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...m,
        cr: Number(m.cr),
        max_hp: Number(m.max_hp),
        ac: Number(m.ac),
        speed: Number(m.speed),
        multiattack: Number(m.multiattack || 1),
        attacks: m.attacks.map((a: any) => ({
          ...a,
          attack_bonus: Number(a.attack_bonus || 0),
          reach: Number(a.reach || 5),
        })),
      };
      if (edit) await monstersApi.update(id!, payload);
      else await monstersApi.create(payload);
      nav("/bestiary");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка сохранения");
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1>{edit ? "Редактирование монстра" : "Новый монстр"}</h1>
      {error && <div className="notice error">{error}</div>}

      <div className="row">
        <div className="field">
          <label>Имя</label>
          <input value={m.name} onChange={(e) => setField("name", e.target.value)} />
        </div>
        <div className="field">
          <label>CR</label>
          <input type="number" step="0.125" value={m.cr} onChange={(e) => setField("cr", e.target.value)} />
        </div>
        <div className="field">
          <label>Портрет</label>
          <input value={m.portrait || ""} onChange={(e) => setField("portrait", e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>HP</label>
          <input type="number" value={m.max_hp} onChange={(e) => setField("max_hp", e.target.value)} />
        </div>
        <div className="field">
          <label>AC</label>
          <input type="number" value={m.ac} onChange={(e) => setField("ac", e.target.value)} />
        </div>
        <div className="field">
          <label>Скорость</label>
          <input type="number" value={m.speed} onChange={(e) => setField("speed", e.target.value)} />
        </div>
        <div className="field">
          <label>Multiattack</label>
          <input type="number" value={m.multiattack} onChange={(e) => setField("multiattack", e.target.value)} />
        </div>
      </div>

      <h3>Характеристики</h3>
      <div className="row">
        {ABILS.map((ab) => (
          <div className="field" key={ab}>
            <label>{ab}</label>
            <input
              type="number"
              value={m.ability_scores[ab]}
              onChange={(e) => setAbility(ab, Number(e.target.value))}
            />
          </div>
        ))}
      </div>

      <h3>Атаки</h3>
      {m.attacks.map((a: any, idx: number) => (
        <div key={idx} className="panel" style={{ marginBottom: 10 }}>
          <div className="row">
            <div className="field">
              <label>name</label>
              <input value={a.name} onChange={(e) => setAttack(idx, { name: e.target.value })} />
            </div>
            <div className="field">
              <label>attack_bonus</label>
              <input type="number" value={a.attack_bonus} onChange={(e) => setAttack(idx, { attack_bonus: e.target.value })} />
            </div>
            <div className="field">
              <label>reach</label>
              <input type="number" value={a.reach} onChange={(e) => setAttack(idx, { reach: e.target.value })} />
            </div>
            <div className="field">
              <label>damage_dice</label>
              <input value={a.damage_dice} onChange={(e) => setAttack(idx, { damage_dice: e.target.value })} />
            </div>
            <div className="field">
              <label>damage_type</label>
              <input value={a.damage_type} onChange={(e) => setAttack(idx, { damage_type: e.target.value })} />
            </div>
          </div>
          <button
            className="danger"
            onClick={() => setField("attacks", m.attacks.filter((_: any, i: number) => i !== idx))}
            disabled={m.attacks.length <= 1}
          >
            Удалить атаку
          </button>
        </div>
      ))}
      <button onClick={() => setField("attacks", [...m.attacks, { name: "", attack_bonus: 0, reach: 5, damage_dice: "1d6", damage_type: "slashing" }])}>
        + Добавить атаку
      </button>

      <div className="field" style={{ marginTop: 10 }}>
        <label>Описание</label>
        <textarea rows={4} value={m.description || ""} onChange={(e) => setField("description", e.target.value)} />
      </div>
      <label>
        <input type="checkbox" checked={!!m.battle_ready} onChange={(e) => setField("battle_ready", e.target.checked)} />
        {" "}battle_ready
      </label>

      <div className="btn-row" style={{ marginTop: "1rem" }}>
        <button onClick={() => nav("/bestiary")}>Отмена</button>
        <button className="primary" disabled={busy} onClick={submit}>
          {edit ? "Сохранить" : "Создать"}
        </button>
      </div>
    </div>
  );
}
