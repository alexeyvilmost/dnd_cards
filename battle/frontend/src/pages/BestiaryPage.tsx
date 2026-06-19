import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { monstersApi } from "../api/client";

export default function BestiaryPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const nav = useNavigate();

  function load() {
    setLoading(true);
    monstersApi
      .list()
      .then(setItems)
      .catch(() => setError("Не удалось загрузить бестиарий"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(id: string) {
    if (!confirm("Удалить монстра?")) return;
    await monstersApi.remove(id);
    load();
  }

  return (
    <div>
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <h1>Бестиарий</h1>
        <Link to="/bestiary/new" className="btn primary">
          + Создать монстра
        </Link>
      </div>

      {error && <div className="notice error">{error}</div>}
      {loading && <div className="spinner">Загрузка…</div>}
      {!loading && items.length === 0 && (
        <div className="panel muted">Пока монстров нет. Создайте первого.</div>
      )}
      <div className="grid cols-3">
        {items.map((m) => (
          <div key={m.id} className="card-tile" onClick={() => nav(`/bestiary/${m.id}/edit`)}>
            <div style={{ fontSize: "2rem" }}>{m.portrait || "👾"}</div>
            <h3>{m.name}</h3>
            <div className="muted">
              CR {m.cr} · XP {m.xp}
            </div>
            <div className="muted">
              HP {m.max_hp} · AC {m.ac} · speed {m.speed}
            </div>
            <div className="muted">{m.battle_ready ? "ready" : "draft"}</div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(m.id);
                }}
              >
                Удалить
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
