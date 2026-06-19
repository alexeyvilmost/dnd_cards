import { useState } from "react";
import { useEffect } from "react";
import { charactersApi, combatApi, monstersApi } from "../api/client";
import CombatView from "../components/CombatView";

export default function CombatPage() {
  const [roomId, setRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [winner, setWinner] = useState<string | null>(null);
  const [sheets, setSheets] = useState<any[]>([]);
  const [monsters, setMonsters] = useState<any[]>([]);
  const [sheetId, setSheetId] = useState("");
  const [monsterId, setMonsterId] = useState("");
  const [autoEnemies, setAutoEnemies] = useState(false);

  useEffect(() => {
    charactersApi.list().then(setSheets).catch(() => {});
    monstersApi.list().then(setMonsters).catch(() => {});
  }, []);

  async function quickstart() {
    setBusy(true);
    setWinner(null);
    setAutoEnemies(false);
    try {
      const res = await combatApi.quickstart();
      setRoomId(res.room_id);
    } finally {
      setBusy(false);
    }
  }

  async function startPve() {
    if (!sheetId || !monsterId) return;
    setBusy(true);
    setWinner(null);
    setAutoEnemies(true);
    try {
      const room = await combatApi.createRoom("PvE Arena");
      const rid = room.room_id;
      await combatApi.addFromSheet(rid, sheetId, 2, 10, "party");
      await combatApi.addMonster(rid, { monster_id: monsterId, x: 17, y: 10 });
      setRoomId(rid);
    } finally {
      setBusy(false);
    }
  }

  if (!roomId) {
    return (
      <div className="panel">
        <h1>Боевая арена</h1>
        <p className="muted">
          Пошаговый боевой движок D&D 2024. Быстрый старт создаёт арену с двумя
          воинами 1 уровня на сетке 20×20.
        </p>
        <button className="primary" onClick={quickstart} disabled={busy} style={{ marginRight: 8 }}>
          ⚡ Быстрый старт (2 воина)
        </button>
        <button onClick={() => setRoomId(null)}>Сброс</button>

        <div className="panel" style={{ marginTop: "1rem" }}>
          <h3>PvE: лист персонажа против монстра</h3>
          <div className="row">
            <div className="field">
              <label>Персонаж</label>
              <select value={sheetId} onChange={(e) => setSheetId(e.target.value)}>
                <option value="">— выбрать —</option>
                {sheets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (ур. {s.level})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Монстр</label>
              <select value={monsterId} onChange={(e) => setMonsterId(e.target.value)}>
                <option value="">— выбрать —</option>
                {monsters.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (CR {m.cr})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button className="primary" onClick={startPve} disabled={busy || !sheetId || !monsterId}>
            ▶ Старт PvE
          </button>
        </div>

        <p className="muted" style={{ marginTop: "1rem" }}>
          Для боя своими персонажами против монстров используйте режим{" "}
          <a href="/dungeon">Подземелье</a>.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="btn-row" style={{ marginBottom: "1rem" }}>
        <button onClick={() => setRoomId(null)}>← Новая арена</button>
      </div>
      {winner && (
        <div className="notice ok">
          ⚔️ Бой окончен! Победитель: <b>{winner}</b>.
        </div>
      )}
      <CombatView roomId={roomId} autoEnemies={autoEnemies} onCombatOver={(w) => setWinner(w)} />
    </div>
  );
}
