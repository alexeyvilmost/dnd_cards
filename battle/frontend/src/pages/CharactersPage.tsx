import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { charactersApi, BattleCharacter } from "../api/client";

export default function CharactersPage() {
  const [chars, setChars] = useState<BattleCharacter[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const nav = useNavigate();

  function load() {
    setLoading(true);
    charactersApi
      .list()
      .then(setChars)
      .catch(() => setError("Не удалось загрузить персонажей"))
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(id: string) {
    if (!confirm("Удалить персонажа?")) return;
    await charactersApi.remove(id);
    load();
  }

  return (
    <div>
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <h1>Персонажи</h1>
        <Link to="/characters/new" className="btn primary">
          + Создать персонажа
        </Link>
      </div>
      {error && <div className="notice error">{error}</div>}
      {loading && <div className="spinner">Загрузка…</div>}
      {!loading && chars.length === 0 && (
        <div className="panel muted">Пока нет персонажей. Создайте первого!</div>
      )}
      <div className="grid cols-3">
        {chars.map((c) => (
          <div key={c.id} className="card-tile" onClick={() => nav(`/characters/${c.id}`)}>
            <div style={{ fontSize: "2rem" }}>{c.portrait || "🧝"}</div>
            <h3>{c.name}</h3>
            <div className="muted">
              {c.class_name === "Fighter" ? "Воин" : "Волшебник"} · ур. {c.level}
            </div>
            <div className="muted">XP: {c.xp}</div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                className="danger"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(c.id!);
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
