import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { spellsApi, imagesApi, imageUrl } from "../api/client";
import { DEFAULT_ICON } from "../battle/tooltip";

type Option = { key: string; label: string; damage_type?: string | null; condition?: string | null };

const EFFECTS = ["attack", "save", "heal", "buff", "utility"];
const TARGETING = ["single", "multi", "area", "self"];
const CAST_TIME = ["action", "bonus", "reaction"];
const SAVES = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];

export default function SpellEditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const edit = !!id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState<any>({
    name: "",
    level: 0,
    school: "Evocation",
    casting_time: "action",
    range_ft: 30,
    components: "V, S",
    duration: "Instantaneous",
    concentration: false,
    effect: "attack",
    targeting: "single",
    damage_dice: "",
    damage_type: "",
    save_ability: "",
    save_for_half: false,
    half_on_save: false,
    condition: "",
    heal_dice: "",
    auto_hit: false,
    num_targets: 1,
    area_radius: 0,
    area_shape: "",
    upcast_damage_dice: "",
    upcast_targets: 0,
    cantrip_scale: false,
    battle_ready: true,
    description: "",
  });
  const [options, setOptions] = useState<Option[]>([]);
  const [newOpt, setNewOpt] = useState<Option>({ key: "", label: "", damage_type: "", condition: "" });

  useEffect(() => {
    if (!edit) return;
    spellsApi.get(id!).then((s) => {
      setForm({
        ...form,
        ...s,
        damage_dice: s.damage_dice || "",
        damage_type: s.damage_type || "",
        save_ability: s.save_ability || "",
        condition: s.condition || "",
        heal_dice: s.heal_dice || "",
        area_shape: s.area_shape || "",
        upcast_damage_dice: s.upcast_damage_dice || "",
        description: s.description || "",
      });
      setOptions(s.effect_options || []);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, id]);

  function set(k: string, v: any) {
    setForm((f: any) => ({ ...f, [k]: v }));
  }

  const [uploading, setUploading] = useState(false);

  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    try {
      // Reuse the existing key when replacing so we don't orphan images.
      const res = await imagesApi.upload(file, form.image || undefined);
      set("image", res.id);
    } catch (err: any) {
      setError(err?.response?.data?.detail || "Ошибка загрузки изображения");
    } finally {
      setUploading(false);
    }
  }

  function clearImage() {
    set("image", "");
  }

  function addOption() {
    if (!newOpt.key || !newOpt.label) return;
    if (options.some((o) => o.key === newOpt.key)) return;
    setOptions([...options, newOpt]);
    setNewOpt({ key: "", label: "", damage_type: "", condition: "" });
  }

  async function submit() {
    setBusy(true);
    setError("");
    const payload = {
      ...form,
      level: Number(form.level),
      range_ft: Number(form.range_ft || 0),
      num_targets: Number(form.num_targets || 1),
      area_radius: Number(form.area_radius || 0),
      upcast_targets: Number(form.upcast_targets || 0),
      damage_dice: form.damage_dice || null,
      damage_type: form.damage_type || null,
      save_ability: form.save_ability || null,
      condition: form.condition || null,
      heal_dice: form.heal_dice || null,
      area_shape: form.area_shape || null,
      upcast_damage_dice: form.upcast_damage_dice || null,
      effect_options: options,
    };
    try {
      if (edit) await spellsApi.update(id!, payload);
      else await spellsApi.create(payload);
      nav("/spellbook");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка сохранения");
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ maxWidth: 860, margin: "0 auto" }}>
      <h1>{edit ? "Редактирование заклинания" : "Новое заклинание"}</h1>
      {error && <div className="notice error">{error}</div>}

      <div className="field">
        <label>Иконка</label>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <img
            src={form.image ? imageUrl(form.image) : DEFAULT_ICON}
            alt="Иконка заклинания"
            style={{
              width: 64,
              height: 64,
              objectFit: "contain",
              borderRadius: 10,
              border: "1px solid var(--gold-dim)",
              background: "radial-gradient(circle at 50% 38%, #3a3027, #221a14)",
              padding: 6,
            }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = DEFAULT_ICON;
            }}
          />
          <div className="btn-row">
            <label className="btn" style={{ margin: 0 }}>
              {uploading ? "Загрузка…" : form.image ? "Заменить" : "Загрузить"}
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                disabled={uploading}
                onChange={onPickImage}
              />
            </label>
            {form.image && (
              <button type="button" className="ghost" onClick={clearImage} disabled={uploading}>
                Убрать
              </button>
            )}
          </div>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>
          Нет иконки — используется default. PNG/JPG/WebP, до 4 МБ.
        </p>
      </div>

      <div className="row">
        <div className="field">
          <label>Название</label>
          <input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div className="field">
          <label>Уровень</label>
          <input type="number" min={0} max={9} value={form.level} onChange={(e) => set("level", e.target.value)} />
        </div>
        <div className="field">
          <label>Школа</label>
          <input value={form.school} onChange={(e) => set("school", e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>Эффект</label>
          <select value={form.effect} onChange={(e) => set("effect", e.target.value)}>
            {EFFECTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Таргетинг</label>
          <select value={form.targeting} onChange={(e) => set("targeting", e.target.value)}>
            {TARGETING.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Время каста</label>
          <select value={form.casting_time} onChange={(e) => set("casting_time", e.target.value)}>
            {CAST_TIME.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Range (ft)</label>
          <input type="number" value={form.range_ft} onChange={(e) => set("range_ft", e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>damage_dice</label>
          <input value={form.damage_dice} onChange={(e) => set("damage_dice", e.target.value)} placeholder="1d8" />
        </div>
        <div className="field">
          <label>damage_type</label>
          <input value={form.damage_type} onChange={(e) => set("damage_type", e.target.value)} placeholder="fire" />
        </div>
        <div className="field">
          <label>save_ability</label>
          <select value={form.save_ability} onChange={(e) => set("save_ability", e.target.value)}>
            <option value="">—</option>
            {SAVES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>condition</label>
          <input value={form.condition} onChange={(e) => set("condition", e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>heal_dice</label>
          <input value={form.heal_dice} onChange={(e) => set("heal_dice", e.target.value)} placeholder="1d8" />
        </div>
        <div className="field">
          <label>num_targets</label>
          <input type="number" value={form.num_targets} onChange={(e) => set("num_targets", e.target.value)} />
        </div>
        <div className="field">
          <label>area_radius</label>
          <input type="number" value={form.area_radius} onChange={(e) => set("area_radius", e.target.value)} />
        </div>
        <div className="field">
          <label>area_shape</label>
          <input value={form.area_shape} onChange={(e) => set("area_shape", e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>upcast_damage_dice</label>
          <input value={form.upcast_damage_dice} onChange={(e) => set("upcast_damage_dice", e.target.value)} />
        </div>
        <div className="field">
          <label>upcast_targets</label>
          <input type="number" value={form.upcast_targets} onChange={(e) => set("upcast_targets", e.target.value)} />
        </div>
        <div className="field">
          <label>components</label>
          <input value={form.components} onChange={(e) => set("components", e.target.value)} />
        </div>
        <div className="field">
          <label>duration</label>
          <input value={form.duration} onChange={(e) => set("duration", e.target.value)} />
        </div>
      </div>

      <div className="row">
        <div className="field">
          <label>
            <input type="checkbox" checked={form.concentration} onChange={(e) => set("concentration", e.target.checked)} />
            {" "}concentration
          </label>
          <label>
            <input type="checkbox" checked={form.auto_hit} onChange={(e) => set("auto_hit", e.target.checked)} />
            {" "}auto_hit
          </label>
          <label>
            <input type="checkbox" checked={form.save_for_half} onChange={(e) => set("save_for_half", e.target.checked)} />
            {" "}save_for_half
          </label>
          <label>
            <input type="checkbox" checked={form.half_on_save} onChange={(e) => set("half_on_save", e.target.checked)} />
            {" "}half_on_save
          </label>
          <label>
            <input type="checkbox" checked={form.cantrip_scale} onChange={(e) => set("cantrip_scale", e.target.checked)} />
            {" "}cantrip_scale
          </label>
          <label>
            <input type="checkbox" checked={form.battle_ready} onChange={(e) => set("battle_ready", e.target.checked)} />
            {" "}battle_ready
          </label>
        </div>
      </div>

      <div className="field">
        <label>Описание</label>
        <textarea rows={4} value={form.description} onChange={(e) => set("description", e.target.value)} />
      </div>

      <div className="panel" style={{ marginTop: 10 }}>
        <h3>Варианты эффекта (опционально)</h3>
        <p className="muted">Если указаны варианты, при касте можно выбрать один из них.</p>
        <div className="row">
          <div className="field">
            <label>key</label>
            <input value={newOpt.key} onChange={(e) => setNewOpt({ ...newOpt, key: e.target.value })} />
          </div>
          <div className="field">
            <label>label</label>
            <input value={newOpt.label} onChange={(e) => setNewOpt({ ...newOpt, label: e.target.value })} />
          </div>
          <div className="field">
            <label>damage_type</label>
            <input value={newOpt.damage_type || ""} onChange={(e) => setNewOpt({ ...newOpt, damage_type: e.target.value })} />
          </div>
          <div className="field">
            <label>condition</label>
            <input value={newOpt.condition || ""} onChange={(e) => setNewOpt({ ...newOpt, condition: e.target.value })} />
          </div>
        </div>
        <button onClick={addOption}>+ Добавить вариант</button>
        <div style={{ marginTop: 8 }}>
          {options.map((o, i) => (
            <div key={o.key} className="pill">
              {o.label} ({o.key})
              {o.damage_type ? ` dmg:${o.damage_type}` : ""}
              {o.condition ? ` cond:${o.condition}` : ""}
              {" "}
              <button
                className="ghost"
                style={{ padding: "0 6px" }}
                onClick={() => setOptions(options.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="btn-row" style={{ marginTop: "1rem" }}>
        <button onClick={() => nav("/spellbook")}>Отмена</button>
        <button className="primary" disabled={busy} onClick={submit}>
          {edit ? "Сохранить" : "Создать"}
        </button>
      </div>
    </div>
  );
}
