import { useEffect, useMemo, useState } from "react";
import { definitionsApi, Definition, Effect } from "../api/client";

const KINDS: { key: Definition["kind"]; label: string }[] = [
  { key: "background", label: "Предыстории" },
  { key: "origin_feat", label: "Черты происхождения" },
  { key: "general_feat", label: "Общие черты" },
  { key: "fighting_style", label: "Боевые стили" },
];

const ABILITY_LABELS: Record<string, string> = {
  strength: "СИЛ", dexterity: "ЛОВ", constitution: "ТЕЛ",
  intelligence: "ИНТ", wisdom: "МДР", charisma: "ХАР",
};

const EFFECT_LABELS: Record<string, string> = {
  ability_score: "Характеристики",
  skill_proficiency: "Навыки",
  tool_proficiency: "Инструменты",
  saving_throw_proficiency: "Спасброски",
  proficiency: "Доспехи/оружие",
  grant_origin_feat: "Выдать черту происхождения",
  grant_cantrip: "Выдать заговоры",
  grant_spell: "Выдать заклинания",
  grant_fighting_style: "Выдать боевой стиль",
  combat_mod: "Боевой модификатор",
  resource: "Ресурс",
  feature: "Особенность (текст)",
};

function blankDef(kind: Definition["kind"]): Definition {
  const d: Definition = {
    id: "", kind, name: "", name_ru: "", description: "", source: "custom", effects: [],
  };
  if (kind === "background") d.ability_options = ["strength", "dexterity", "constitution"];
  if (kind === "general_feat") d.prerequisites = { min_level: 4 };
  return d;
}

function defaultEffect(type: string): Effect {
  switch (type) {
    case "ability_score": return { type, mode: "fixed", ability: "strength", amount: 1 };
    case "skill_proficiency": return { type, fixed: [] };
    case "tool_proficiency": return { type, fixed: [] };
    case "saving_throw_proficiency": return { type, abilities: [] };
    case "proficiency": return { type, category: "armor", values: [] };
    case "grant_origin_feat": return { type, feat: "" };
    case "grant_cantrip": return { type, count: 1 };
    case "grant_spell": return { type, count: 1, max_level: 1 };
    case "grant_fighting_style": return { type, count: 1 };
    case "combat_mod": return { type, stat: "ac", amount: 1, condition: "always" };
    case "resource": return { type, key: "", amount: 1, recharge: "long" };
    case "feature": return { type, key: "", label: "" };
    default: return { type };
  }
}

export default function AdminDefinitionsPage() {
  const [schema, setSchema] = useState<any>(null);
  const [kind, setKind] = useState<Definition["kind"]>("background");
  const [list, setList] = useState<Definition[]>([]);
  const [originFeats, setOriginFeats] = useState<Definition[]>([]);
  const [form, setForm] = useState<Definition>(blankDef("background"));
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const abilities: string[] = schema?.abilities || Object.keys(ABILITY_LABELS);
  const skills: string[] = schema?.skills || [];
  const combatStats: string[] = schema?.effect_types?.combat_mod?.fields?.stat || [];
  const conditions: string[] = schema?.effect_types?.combat_mod?.fields?.condition || [];
  const effectTypes = Object.keys(EFFECT_LABELS);

  function loadList(k: Definition["kind"]) {
    definitionsApi.list(k).then(setList).catch(() => setList([]));
  }
  useEffect(() => {
    definitionsApi.schema().then(setSchema).catch(() => {});
    definitionsApi.list("origin_feat").then(setOriginFeats).catch(() => {});
  }, []);
  useEffect(() => loadList(kind), [kind]);

  function startNew() {
    setForm(blankDef(kind));
    setEditing(false);
    setMsg(null);
  }
  function startEdit(d: Definition) {
    setForm(JSON.parse(JSON.stringify(d)));
    setEditing(true);
    setMsg(null);
  }
  function setField(k: keyof Definition, v: any) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function updateEffect(i: number, patch: Partial<Effect>) {
    setForm((f) => {
      const effs = [...(f.effects || [])];
      effs[i] = { ...effs[i], ...patch };
      return { ...f, effects: effs };
    });
  }
  function addEffect() {
    setForm((f) => ({ ...f, effects: [...(f.effects || []), defaultEffect("combat_mod")] }));
  }
  function removeEffect(i: number) {
    setForm((f) => ({ ...f, effects: (f.effects || []).filter((_, idx) => idx !== i) }));
  }
  function toggleArr(arr: string[] | undefined, v: string): string[] {
    const a = arr || [];
    return a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
  }

  async function save() {
    setMsg(null);
    const payload: Partial<Definition> = { ...form };
    if (!editing) delete (payload as any).id;
    try {
      const saved = editing
        ? await definitionsApi.update(form.id, payload)
        : await definitionsApi.create(payload);
      setMsg({ kind: "ok", text: editing ? "Сохранено" : "Создано" });
      setForm(saved);
      setEditing(true);
      loadList(kind);
      if (saved.kind === "origin_feat") definitionsApi.list("origin_feat").then(setOriginFeats);
    } catch (e: any) {
      setMsg({ kind: "error", text: e?.response?.data?.detail || "Ошибка сохранения" });
    }
  }

  async function remove(d: Definition) {
    if (!confirm(`Удалить «${d.name_ru || d.name}»?`)) return;
    await definitionsApi.remove(d.id);
    if (form.id === d.id) startNew();
    loadList(kind);
  }

  const isReadonly = form.source === "PHB2024";
  const kindLabel = useMemo(() => KINDS.find((k) => k.key === kind)?.label, [kind]);

  return (
    <div>
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <h1>Конструктор сущностей</h1>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Создавайте и редактируйте предыстории, черты и боевые стили. Эффекты валидируются
        бэкендом по общей схеме. Базовые сущности помечены «PHB», свои — «custom».
      </p>

      <div className="chip-select" style={{ marginBottom: "1rem" }}>
        {KINDS.map((k) => (
          <div key={k.key} className={`chip ${kind === k.key ? "sel" : ""}`} onClick={() => setKind(k.key)}>
            {k.label}
          </div>
        ))}
      </div>

      <div className="combat-layout">
        {/* ── List ── */}
        <div className="panel">
          <div className="btn-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>{kindLabel}</h3>
            <button className="primary" onClick={startNew}>+ Новая</button>
          </div>
          {list.map((d) => (
            <div key={d.id} className="card-tile" style={{ marginBottom: 6 }} onClick={() => startEdit(d)}>
              <div className="btn-row" style={{ justifyContent: "space-between" }}>
                <b>{d.name_ru || d.name}</b>
                <span>
                  <span className="pill">{d.source === "PHB2024" ? "PHB" : "custom"}</span>
                  <button className="ghost" style={{ padding: "0 6px" }}
                    onClick={(e) => { e.stopPropagation(); remove(d); }} title="Удалить">🗑</button>
                </span>
              </div>
              <div className="muted">{(d.effects || []).length} эффект(ов)</div>
            </div>
          ))}
          {list.length === 0 && <div className="muted">Пусто</div>}
        </div>

        {/* ── Editor ── */}
        <div className="panel">
          <h3>{editing ? `Редактирование: ${form.name_ru || form.name}` : "Новая сущность"}</h3>
          {isReadonly && (
            <div className="notice" style={{ marginBottom: 8 }}>
              Это правило из книги (PHB2024). Сохранение создаст обновлённую версию того же id.
            </div>
          )}
          {msg && <div className={`notice ${msg.kind}`}>{msg.text}</div>}

          <div className="row">
            <div className="field">
              <label>Тип</label>
              <select value={form.kind} onChange={(e) => setField("kind", e.target.value)}>
                {KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Название (EN)</label>
              <input value={form.name} onChange={(e) => setField("name", e.target.value)} />
            </div>
            <div className="field">
              <label>Название (RU)</label>
              <input value={form.name_ru || ""} onChange={(e) => setField("name_ru", e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Описание</label>
            <textarea rows={3} value={form.description || ""} onChange={(e) => setField("description", e.target.value)} />
          </div>

          {form.kind === "general_feat" && (
            <div className="field" style={{ maxWidth: 220 }}>
              <label>Требуемый уровень</label>
              <input type="number" min={1} value={form.prerequisites?.min_level ?? 4}
                onChange={(e) => setField("prerequisites", { ...(form.prerequisites || {}), min_level: Number(e.target.value) })} />
            </div>
          )}

          {form.kind === "background" && (
            <div className="field">
              <label>Характеристики предыстории (выберите 3)</label>
              <div className="chip-select">
                {abilities.map((a) => (
                  <div key={a}
                    className={`chip ${(form.ability_options || []).includes(a) ? "sel" : ""}`}
                    onClick={() => setField("ability_options", toggleArr(form.ability_options, a))}>
                    {ABILITY_LABELS[a] || a}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Effects ── */}
          <div className="field">
            <div className="btn-row" style={{ justifyContent: "space-between" }}>
              <label style={{ margin: 0 }}>Эффекты</label>
              <button onClick={addEffect}>+ Эффект</button>
            </div>
            {(form.effects || []).map((eff, i) => (
              <div key={i} className="card-tile" style={{ cursor: "default", marginTop: 8 }}>
                <div className="row" style={{ alignItems: "flex-end" }}>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Тип эффекта</label>
                    <select value={eff.type} onChange={(e) => updateEffect(i, defaultEffect(e.target.value))}>
                      {effectTypes.map((t) => <option key={t} value={t}>{EFFECT_LABELS[t]}</option>)}
                    </select>
                  </div>
                  <button className="ghost danger" onClick={() => removeEffect(i)}>Удалить</button>
                </div>
                <div style={{ marginTop: 8 }}>{renderEffectFields(eff, i)}</div>
              </div>
            ))}
            {(form.effects || []).length === 0 && <div className="muted" style={{ marginTop: 6 }}>Эффектов нет</div>}
          </div>

          <div className="btn-row" style={{ marginTop: "1rem" }}>
            <button className="primary" onClick={save} disabled={!form.name.trim()}>
              {editing ? "Сохранить" : "Создать"}
            </button>
            {editing && <button onClick={startNew}>Новая</button>}
          </div>
        </div>
      </div>
    </div>
  );

  function renderEffectFields(eff: Effect, i: number) {
    const numField = (key: string, label: string, w = 120) => (
      <div className="field" style={{ marginBottom: 0, maxWidth: w }}>
        <label>{label}</label>
        <input type="number" value={eff[key] ?? 0} onChange={(e) => updateEffect(i, { [key]: Number(e.target.value) })} />
      </div>
    );
    const textField = (key: string, label: string) => (
      <div className="field" style={{ marginBottom: 0 }}>
        <label>{label}</label>
        <input value={eff[key] ?? ""} onChange={(e) => updateEffect(i, { [key]: e.target.value })} />
      </div>
    );
    const chips = (key: string, opts: string[], labels?: Record<string, string>) => (
      <div className="chip-select">
        {opts.map((o) => (
          <div key={o} className={`chip ${(eff[key] || []).includes(o) ? "sel" : ""}`}
            onClick={() => updateEffect(i, { [key]: toggleArr(eff[key], o) })}>
            {labels?.[o] || o}
          </div>
        ))}
      </div>
    );

    switch (eff.type) {
      case "ability_score":
        return (
          <div className="row">
            <div className="field" style={{ marginBottom: 0, maxWidth: 140 }}>
              <label>Режим</label>
              <select value={eff.mode} onChange={(e) => updateEffect(i, { mode: e.target.value })}>
                <option value="fixed">фикс.</option>
                <option value="choose">выбор</option>
              </select>
            </div>
            {eff.mode === "fixed" ? (
              <div className="field" style={{ marginBottom: 0, maxWidth: 140 }}>
                <label>Характеристика</label>
                <select value={eff.ability} onChange={(e) => updateEffect(i, { ability: e.target.value })}>
                  {abilities.map((a) => <option key={a} value={a}>{ABILITY_LABELS[a] || a}</option>)}
                </select>
              </div>
            ) : (
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Из набора</label>
                {chips("from", abilities, ABILITY_LABELS)}
              </div>
            )}
            {numField("amount", "Значение")}
          </div>
        );
      case "skill_proficiency":
        return (
          <>
            <label>Фиксированные навыки</label>
            {chips("fixed", skills)}
            <div style={{ marginTop: 6 }}>{numField("choose_count", "Выбрать (кол-во)")}</div>
          </>
        );
      case "tool_proficiency":
        return (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Инструменты (через запятую)</label>
            <input value={(eff.fixed || []).join(", ")}
              onChange={(e) => updateEffect(i, { fixed: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
          </div>
        );
      case "saving_throw_proficiency":
        return (<><label>Характеристики</label>{chips("abilities", abilities, ABILITY_LABELS)}</>);
      case "proficiency":
        return (
          <div className="row">
            <div className="field" style={{ marginBottom: 0, maxWidth: 160 }}>
              <label>Категория</label>
              <select value={eff.category} onChange={(e) => updateEffect(i, { category: e.target.value })}>
                <option value="armor">доспехи</option>
                <option value="weapon">оружие</option>
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Значения (через запятую)</label>
              <input value={(eff.values || []).join(", ")}
                onChange={(e) => updateEffect(i, { values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
            </div>
          </div>
        );
      case "grant_origin_feat":
        return (
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Черта происхождения</label>
            <select value={eff.feat} onChange={(e) => updateEffect(i, { feat: e.target.value })}>
              <option value="">—</option>
              {originFeats.map((f) => <option key={f.id} value={f.id}>{f.name_ru || f.name}</option>)}
            </select>
          </div>
        );
      case "grant_cantrip":
        return <div className="row">{numField("count", "Кол-во заговоров")}</div>;
      case "grant_spell":
        return <div className="row">{numField("count", "Кол-во")}{numField("max_level", "Макс. круг")}</div>;
      case "grant_fighting_style":
        return <div className="row">{numField("count", "Кол-во стилей")}</div>;
      case "combat_mod":
        return (
          <div className="row">
            <div className="field" style={{ marginBottom: 0, maxWidth: 180 }}>
              <label>Параметр</label>
              <select value={eff.stat} onChange={(e) => updateEffect(i, { stat: e.target.value })}>
                {combatStats.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {numField("amount", "Значение")}
            <div className="field" style={{ marginBottom: 0, maxWidth: 180 }}>
              <label>Условие</label>
              <select value={eff.condition || "always"} onChange={(e) => updateEffect(i, { condition: e.target.value })}>
                {conditions.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        );
      case "resource":
        return (
          <div className="row">
            {textField("key", "Ключ")}
            {numField("amount", "Кол-во")}
            <div className="field" style={{ marginBottom: 0, maxWidth: 160 }}>
              <label>Восстановление</label>
              <select value={eff.recharge} onChange={(e) => updateEffect(i, { recharge: e.target.value })}>
                <option value="short">короткий отдых</option>
                <option value="long">долгий отдых</option>
                <option value="day">день</option>
              </select>
            </div>
          </div>
        );
      case "feature":
        return <div className="row">{textField("key", "Ключ")}{textField("label", "Подпись")}</div>;
      default:
        return null;
    }
  }
}
