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

  // Background (definition-driven): selection + ability bonus distribution.
  const [bgId, setBgId] = useState<string>("");
  const [bgMode, setBgMode] = useState<"2/1" | "1/1/1">("2/1");
  const [bgPlus2, setBgPlus2] = useState<string>("");
  const [bgPlus1, setBgPlus1] = useState<string>("");

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

  const selectedBg: any = (opts?.backgrounds || []).find((b: any) => b.id === bgId);

  function bgAbilityChoice(): Record<string, number> {
    if (!selectedBg) return {};
    const o: string[] = selectedBg.ability_options || [];
    if (bgMode === "1/1/1") return Object.fromEntries(o.map((a) => [a, 1]));
    const out: Record<string, number> = {};
    if (bgPlus2) out[bgPlus2] = 2;
    if (bgPlus1) out[bgPlus1] = 1;
    return out;
  }

  function bgValid(): boolean {
    if (!selectedBg) return false;
    if (bgMode === "1/1/1") return true;
    return !!bgPlus2 && !!bgPlus1 && bgPlus2 !== bgPlus1;
  }

  function effectInfo(bg: any): { skills: string[]; feat: string | null } {
    const skills: string[] = [];
    let feat: string | null = null;
    for (const e of bg?.effects || []) {
      if (e.type === "skill_proficiency") skills.push(...(e.fixed || []));
      if (e.type === "grant_origin_feat") {
        const f = (opts?.origin_feats || []).find((x: any) => x.id === e.feat);
        feat = f ? f.name_ru || f.name : e.feat;
      }
    }
    return { skills, feat };
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
    if (bgId && bgValid()) {
      payload.background = bgId;
      payload.background_ability_choice = bgAbilityChoice();
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

          {/* Background (definition-driven): grants ability bonuses, skills, an origin feat. */}
          <div className="field" style={{ marginTop: "1.2rem" }}>
            <label>Предыстория</label>
            <div className="chip-select">
              {(opts.backgrounds || []).map((b: any) => (
                <div
                  key={b.id}
                  className={`chip ${bgId === b.id ? "sel" : ""}`}
                  title={b.description}
                  onClick={() => {
                    setBgId(b.id);
                    setBgPlus2("");
                    setBgPlus1("");
                    setBgMode("2/1");
                  }}
                >
                  {b.name_ru || b.name}
                </div>
              ))}
            </div>
          </div>

          {selectedBg && (
            <div className="panel" style={{ marginTop: 8 }}>
              <p className="muted" style={{ marginTop: 0 }}>{selectedBg.description}</p>
              <div className="muted" style={{ marginBottom: 8 }}>
                Навыки: {effectInfo(selectedBg).skills.map((s) => s).join(", ") || "—"}
                {effectInfo(selectedBg).feat ? ` · Черта: ${effectInfo(selectedBg).feat}` : ""}
              </div>
              <label>Бонусы характеристик</label>
              <div className="chip-select" style={{ marginBottom: 8 }}>
                <div className={`chip ${bgMode === "2/1" ? "sel" : ""}`} onClick={() => setBgMode("2/1")}>+2 / +1</div>
                <div className={`chip ${bgMode === "1/1/1" ? "sel" : ""}`} onClick={() => setBgMode("1/1/1")}>+1 / +1 / +1</div>
              </div>
              {bgMode === "2/1" ? (
                <div className="row">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>+2 к</label>
                    <select value={bgPlus2} onChange={(e) => setBgPlus2(e.target.value)}>
                      <option value="">—</option>
                      {(selectedBg.ability_options || []).map((a: string) => (
                        <option key={a} value={a}>{ABILITY_LABELS[a]}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>+1 к</label>
                    <select value={bgPlus1} onChange={(e) => setBgPlus1(e.target.value)}>
                      <option value="">—</option>
                      {(selectedBg.ability_options || []).filter((a: string) => a !== bgPlus2).map((a: string) => (
                        <option key={a} value={a}>{ABILITY_LABELS[a]}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <div className="muted">
                  +1 к: {(selectedBg.ability_options || []).map((a: string) => ABILITY_LABELS[a]).join(", ")}
                </div>
              )}
              {bgId && !bgValid() && (
                <div className="muted" style={{ color: "#e08a7a", marginTop: 6 }}>
                  Выберите распределение (+2 и +1 к разным характеристикам).
                </div>
              )}
            </div>
          )}

          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <button onClick={() => setStep(0)}>← Назад</button>
            <button className="primary" disabled={!!bgId && !bgValid()} onClick={() => setStep(2)}>
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
