import { useEffect, useState } from "react";
import CombatView from "../components/CombatView";
import { charactersApi, runsApi } from "../api/client";

export default function DungeonPage() {
  const [sheets, setSheets] = useState<any[]>([]);
  const [sheetId, setSheetId] = useState("");
  const [run, setRun] = useState<any>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    charactersApi.list().then(setSheets);
  }, []);

  async function startRun() {
    if (!sheetId) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await runsApi.start(sheetId);
      setRun(r);
      setRoomId(null);
    } finally {
      setBusy(false);
    }
  }

  async function nextRoom() {
    if (!run?.id) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await runsApi.nextRoom(run.id);
      setRun(res.run);
      setRoomId(res.room_id);
    } finally {
      setBusy(false);
    }
  }

  async function resolveRoom() {
    if (!run?.id) return;
    setBusy(true);
    try {
      const res = await runsApi.resolve(run.id);
      setRun(res.run);
      const rr = res.result || {};
      if (rr.outcome === "victory") {
        setMsg(`Победа! +${rr.gold_gained || 0} золота, +${rr.xp_gained || 0} XP`);
      } else if (rr.outcome === "defeat") {
        setMsg("Поражение.");
      } else {
        setMsg("Комната ещё не завершена.");
      }
      setRoomId(null);
    } finally {
      setBusy(false);
    }
  }

  async function buy(offerId: string) {
    if (!run?.id) return;
    const res = await runsApi.buy(run.id, offerId);
    setRun(res.run);
  }

  return (
    <div>
      <h1>Dungeon Crawl (MVP)</h1>

      {!run && (
        <div className="panel" style={{ maxWidth: 700 }}>
          <h3>Новый забег</h3>
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
          </div>
          <button className="primary" disabled={!sheetId || busy} onClick={startRun}>
            ▶ Начать забег
          </button>
        </div>
      )}

      {run && (
        <div className="panel">
          <div className="btn-row" style={{ justifyContent: "space-between" }}>
            <h3>
              Забег: {run.sheet_name} · этаж {Math.min(run.depth, run.max_depth)}/{run.max_depth}
            </h3>
            <div className="muted">Статус: {run.status}</div>
          </div>
          <div className="muted">
            Золото: {run.gold} · Суммарный XP за забег: {run.xp_total}
          </div>
          {msg && <div className="notice ok">{msg}</div>}

          {run.status === "between_rooms" && (
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="primary" disabled={busy} onClick={nextRoom}>
                ⚔ Войти в следующую комнату
              </button>
              <button onClick={() => setRun(null)}>Завершить просмотр</button>
            </div>
          )}

          {run.status === "completed" && <div className="notice ok">Забег завершён успешно!</div>}
          {run.status === "failed" && <div className="notice error">Забег провален.</div>}

          {run.status === "between_rooms" && (
            <div className="panel" style={{ marginTop: 10 }}>
              <h4>Магазин между комнатами</h4>
              {(run.shop_offers || []).length === 0 && (
                <div className="muted">Предметов нет (или не подключён API предметов).</div>
              )}
              {(run.shop_offers || []).map((o: any) => (
                <div key={o.offer_id} className="card-tile" style={{ cursor: "default", marginBottom: 8 }}>
                  <div className="btn-row" style={{ justifyContent: "space-between" }}>
                    <span>
                      {o.name} — {o.cost}g
                    </span>
                    <button disabled={run.gold < o.cost} onClick={() => buy(o.offer_id)}>
                      Купить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {roomId && (
        <div className="panel">
          <div className="btn-row" style={{ justifyContent: "space-between" }}>
            <h3>Бой в комнате</h3>
            <button onClick={resolveRoom}>Проверить исход комнаты</button>
          </div>
          <CombatView roomId={roomId} autoEnemies onCombatOver={() => resolveRoom()} />
        </div>
      )}
    </div>
  );
}
