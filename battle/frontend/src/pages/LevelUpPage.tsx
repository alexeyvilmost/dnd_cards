import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { charactersApi } from "../api/client";

export default function LevelUpPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [opts, setOpts] = useState<any>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    charactersApi.levelUpOptions(id!).then(setOpts);
  }, [id]);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await charactersApi.levelUp(id!, choices);
      nav(`/characters/${id}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Ошибка");
      setBusy(false);
    }
  }

  if (!opts) return <div className="spinner">Загрузка…</div>;
  if (!opts.can_level_up)
    return (
      <div className="panel">
        <div className="notice">{opts.reason}</div>
        <button onClick={() => nav(`/characters/${id}`)}>← Назад</button>
      </div>
    );

  return (
    <div className="panel" style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1>Повышение до уровня {opts.target_level}</h1>
      {opts.grants && (
        <div className="notice ok">
          Автоматически: {opts.grants.join(", ")}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}

      {(opts.choices || []).map((ch: any) => (
        <div key={ch.id} className="field">
          <label>{ch.label}</label>
          <div className="chip-select">
            {ch.options.map((o: any) => (
              <div
                key={o.key}
                className={`chip ${choices[ch.id] === o.key ? "sel" : ""}`}
                onClick={() => setChoices({ ...choices, [ch.id]: o.key })}
              >
                {o.label}
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="btn-row">
        <button onClick={() => nav(`/characters/${id}`)}>Отмена</button>
        <button className="primary" disabled={busy} onClick={submit}>
          ✓ Повысить уровень
        </button>
      </div>
    </div>
  );
}
