import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { charactersApi, spellsApi, Spell } from "../api/client";
import SpellPickGrid from "../components/SpellPickGrid";

const ABILITY_LABELS: Record<string, string> = {
  strength: "СИЛ",
  dexterity: "ЛОВ",
  constitution: "ТЕЛ",
  intelligence: "ИНТ",
  wisdom: "МДР",
  charisma: "ХАР",
};
const PORTRAITS = ["🧙", "🧝", "⚔️", "🛡️", "🏹", "🗡️", "🔮", "🧔", "👩‍🦰", "🐉"];

export default function CharacterBuilderPage() {
  const nav = useNavigate();
  const [opts, setOpts] = useState<any>(null);
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [className, setClassName] = useState("Fighter");
  const [portrait, setPortrait] = useState("⚔️");
  const [scores, setScores] = useState<Record<string, number>>({
    strength: 8,
    dexterity: 8,
    constitution: 8,
    intelligence: 8,
    wisdom: 8,
    charisma: 8,
  });
  const [fightingStyle, setFightingStyle] = useState("dueling");
  const [masteries, setMasteries] = useState<string[]>([]);
  const [loadout, setLoadout] = useState("longsword_shield");
  const [cantrips, setCantrips] = useState<string[]>([]);
  const [prepared, setPrepared] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<Record<string, Spell>>({});

  useEffect(() => {
    charactersApi.createOptions().then(setOpts);
    spellsApi
      .list()
      .then((list) => {
        const map: Record<string, Spell> = {};
        list.forEach((s) => (map[s.name] = s));
        setCatalog(map);
      })
      .catch(() => {});
  }, []);

  const costTable: Record<number, number> = opts?.point_buy.cost || {};
  const pointsUsed = useMemo(
    () => Object.values(scores).reduce((sum, v) => sum + (costTable[v] ?? 0), 0),
    [scores, costTable]
  );
  const pointsLeft = (opts?.point_buy.total || 27) - pointsUsed;

  function mod(v: number) {
    return Math.floor((v - 10) / 2);
  }
  function changeScore(ab: string, delta: number) {
    const v = scores[ab] + delta;
    if (v < 8 || v > 15) return;
    const newCost = (costTable[v] ?? 0) - (costTable[scores[ab]] ?? 0);
    if (delta > 0 && newCost > pointsLeft) return;
    setScores({ ...scores, [ab]: v });
  }

  function toggle(list: string[], setList: (l: string[]) => void, key: string, max: number) {
    if (list.includes(key)) setList(list.filter((k) => k !== key));
    else if (list.length < max) setList([...list, key]);
  }

  const steps = ["Класс", "Характеристики", "Способности"];

  async function submit() {
    setError("");
    setBusy(true);
    const payload: any = {
      name,
      class_name: className,
      portrait,
      ability_scores: scores,
    };
    if (className === "Fighter") {
      payload.fighting_style = fightingStyle;
      payload.weapon_masteries = masteries;
      payload.weapon_choice = loadout;
    } else {
      payload.cantrips = cantrips;
      payload.spells_prepared = prepared;
    }
    try {
      const c = await charactersApi.create(payload);
      nav(`/characters/${c.id}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка создания");
      setBusy(false);
    }
  }

  if (!opts) return <div className="spinner">Загрузка…</div>;

  const wiz = opts.wizard;
  const fig = opts.fighter;

  return (
    <div className="panel" style={{ maxWidth: 760, margin: "0 auto" }}>
      <h1>Создание персонажа</h1>
      <div className="stepper">
        {steps.map((s, i) => (
          <span key={s} className={`step ${i === step ? "active" : i < step ? "done" : ""}`}>
            {i + 1}. {s}
          </span>
        ))}
      </div>
      {error && <div className="notice error">{error}</div>}

      {step === 0 && (
        <div>
          <div className="field">
            <label>Имя</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя героя" />
          </div>
          <div className="field">
            <label>Класс</label>
            <div className="chip-select">
              {opts.classes.map((c: string) => (
                <div
                  key={c}
                  className={`chip ${className === c ? "sel" : ""}`}
                  onClick={() => setClassName(c)}
                >
                  {c === "Fighter" ? "⚔️ Воин" : "🔮 Волшебник"}
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Раса</label>
            <div className="muted">Человек (без черт происхождения)</div>
          </div>
          <div className="field">
            <label>Портрет</label>
            <div className="chip-select">
              {PORTRAITS.map((p) => (
                <div
                  key={p}
                  className={`chip ${portrait === p ? "sel" : ""}`}
                  style={{ fontSize: "1.3rem" }}
                  onClick={() => setPortrait(p)}
                >
                  {p}
                </div>
              ))}
            </div>
          </div>
          <button className="primary" disabled={!name} onClick={() => setStep(1)}>
            Далее →
          </button>
        </div>
      )}

      {step === 1 && (
        <div>
          <p className="muted">
            Point-buy: осталось очков <b style={{ color: pointsLeft < 0 ? "#e08a7a" : "#c9a227" }}>{pointsLeft}</b> из {opts.point_buy.total}
          </p>
          <div className="statbox">
            {opts.abilities.map((ab: string) => (
              <div key={ab} className="stat">
                <div className="l">{ABILITY_LABELS[ab]}</div>
                <div className="v">{scores[ab]}</div>
                <div className="muted">{mod(scores[ab]) >= 0 ? "+" : ""}{mod(scores[ab])}</div>
                <div className="btn-row" style={{ justifyContent: "center", marginTop: 4 }}>
                  <button onClick={() => changeScore(ab, -1)}>−</button>
                  <button onClick={() => changeScore(ab, 1)}>+</button>
                </div>
              </div>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <button onClick={() => setStep(0)}>← Назад</button>
            <button className="primary" onClick={() => setStep(2)}>
              Далее →
            </button>
          </div>
        </div>
      )}

      {step === 2 && className === "Fighter" && (
        <div>
          <div className="field">
            <label>Боевой стиль</label>
            <div className="chip-select">
              {fig.fighting_styles.map((s: any) => (
                <div
                  key={s.key}
                  className={`chip ${fightingStyle === s.key ? "sel" : ""}`}
                  onClick={() => setFightingStyle(s.key)}
                >
                  {s.label}
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Снаряжение</label>
            <div className="chip-select">
              {fig.weapon_loadouts.map((s: any) => (
                <div
                  key={s.key}
                  className={`chip ${loadout === s.key ? "sel" : ""}`}
                  onClick={() => setLoadout(s.key)}
                >
                  {s.label}
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label>Мастерства оружия (выберите {fig.masteries_to_pick})</label>
            <div className="chip-select">
              {fig.weapon_masteries.map((m: any) => (
                <div
                  key={m.key}
                  className={`chip ${masteries.includes(m.key) ? "sel" : ""}`}
                  onClick={() => toggle(masteries, setMasteries, m.key, fig.masteries_to_pick)}
                >
                  {m.label}
                </div>
              ))}
            </div>
          </div>
          <div className="btn-row">
            <button onClick={() => setStep(1)}>← Назад</button>
            <button
              className="primary"
              disabled={busy || masteries.length !== fig.masteries_to_pick}
              onClick={submit}
            >
              ✓ Создать
            </button>
          </div>
        </div>
      )}

      {step === 2 && className === "Wizard" && (
        <div>
          <div className="field">
            <label>
              Заговоры — выбрано {cantrips.length}/{wiz.cantrips_to_pick}
            </label>
            <SpellPickGrid
              names={wiz.cantrips}
              catalog={catalog}
              selected={cantrips}
              max={wiz.cantrips_to_pick}
              onToggle={(c) => toggle(cantrips, setCantrips, c, wiz.cantrips_to_pick)}
            />
          </div>
          <div className="field">
            <label>
              Подготовленные заклинания 1 круга — выбрано {prepared.length}/{wiz.spells_to_pick}
            </label>
            <SpellPickGrid
              names={wiz.spells}
              catalog={catalog}
              selected={prepared}
              max={wiz.spells_to_pick}
              onToggle={(c) => toggle(prepared, setPrepared, c, wiz.spells_to_pick)}
            />
          </div>
          <div className="btn-row">
            <button onClick={() => setStep(1)}>← Назад</button>
            <button
              className="primary"
              disabled={
                busy ||
                cantrips.length !== wiz.cantrips_to_pick ||
                prepared.length !== wiz.spells_to_pick
              }
              onClick={submit}
            >
              ✓ Создать
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
