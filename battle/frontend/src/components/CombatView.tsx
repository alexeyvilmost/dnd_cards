import { useCallback, useEffect, useMemo, useState } from "react";
import { combatApi, spellsApi, Spell } from "../api/client";
import Hotbar, { HotbarGroup, HotbarItem } from "./Hotbar";
import { ACTION_DEFS, buildSpellTooltip, spellImageUrl, TooltipData } from "../battle/tooltip";

interface Props {
  roomId: string;
  onCombatOver?: (winner: string) => void;
  autoEnemies?: boolean; // if true, show "auto turn" for monster turns
}

type Char = any;

export default function CombatView({ roomId, onCombatOver, autoEnemies }: Props) {
  const [room, setRoom] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<string>("none");
  const [selectedSpell, setSelectedSpell] = useState<string>("");
  const [selectedEffectChoice, setSelectedEffectChoice] = useState<string>("");
  const [slotLevel, setSlotLevel] = useState<number | null>(null);
  const [spellCatalog, setSpellCatalog] = useState<Record<string, Spell>>({});
  const [msg, setMsg] = useState<string>("");
  const [overFired, setOverFired] = useState(false);

  const refresh = useCallback(async () => {
    const r = await combatApi.getRoom(roomId);
    setRoom(r);
    return r;
  }, [roomId]);

  useEffect(() => {
    refresh();
    spellsApi
      .list()
      .then((list) => {
        const map: Record<string, Spell> = {};
        list.forEach((s) => (map[s.name] = s));
        setSpellCatalog(map);
      })
      .catch(() => {});
  }, [refresh]);

  const chars: [string, Char][] = useMemo(
    () => (room ? Object.entries(room.characters) : []),
    [room]
  );
  const combat = room?.combat;
  const currentId: string | null =
    combat?.active && combat.initiative_order.length
      ? combat.initiative_order[combat.turn_index % combat.initiative_order.length]
      : null;
  const current: Char | null = currentId ? room.characters[currentId] : null;

  const isEnemy = (c: Char) => !!c.is_monster;

  useEffect(() => {
    if (room && combat && !combat.active && !overFired && chars.length > 0) {
      // combat ended
      const alive = chars.filter(([, c]) => c.is_conscious !== false && c.hp > 0);
      if (combat.round > 0) {
        setOverFired(true);
        const winner = alive.length ? (alive[0][1] as Char).name : "никто";
        onCombatOver?.(winner);
      }
    }
  }, [room, combat, chars, overFired, onCombatOver]);

  async function act(fn: () => Promise<any>) {
    setBusy(true);
    try {
      const res = await fn();
      if (res?.message) setMsg(res.message);
      await refresh();
      return res;
    } catch (e: any) {
      setMsg(e?.response?.data?.detail || "Ошибка действия");
    } finally {
      setBusy(false);
    }
  }

  async function startCombat() {
    await act(() => combatApi.startCombat(roomId));
  }

  async function onCellClick(x: number, y: number) {
    if (!current || busy) return;
    const occupant = chars.find(([, c]) => c.position.x === x && c.position.y === y);
    if (mode === "move" && !occupant) {
      await act(() => combatApi.action(roomId, "move", { character_id: currentId, x, y }));
    } else if (mode === "attack" && occupant && occupant[0] !== currentId) {
      await act(() =>
        combatApi.action(roomId, "attack", { character_id: currentId, target_id: occupant[0] })
      );
      setMode("none");
    } else if (mode === "cast" && occupant) {
      await castAt(occupant[0], { x, y });
    } else if (mode === "cast" && !occupant) {
      await castAt(null, { x, y });
    }
  }

  async function castAt(targetId: string | null, point: { x: number; y: number }) {
    const body: any = {
      character_id: currentId,
      spell: selectedSpell,
      target_ids: targetId ? [targetId] : [],
      slot_level: slotLevel,
      point,
      effect_choice: selectedEffectChoice || null,
    };
    await act(() => combatApi.action(roomId, "cast", body));
    setMode("none");
    setSelectedSpell("");
    setSelectedEffectChoice("");
  }

  async function endTurn() {
    const res = await act(() => combatApi.endTurn(roomId, currentId!));
    setMode("none");
    if (autoEnemies) await maybeAutoTurns();
    return res;
  }

  async function maybeAutoTurns() {
    // Let the backend resolve consecutive monster turns automatically.
    for (let i = 0; i < 20; i++) {
      const r = await combatApi.getRoom(roomId);
      const cid =
        r.combat?.active && r.combat.initiative_order.length
          ? r.combat.initiative_order[r.combat.turn_index % r.combat.initiative_order.length]
          : null;
      if (!cid) break;
      const c = r.characters[cid];
      if (!c?.is_monster) break;
      const res = await combatApi.autoTurn(roomId);
      if (res?.message) setMsg(res.message);
      if (!res?.acted) break;
    }
    await refresh();
  }

  function selectSpell(name: string) {
    const next = selectedSpell === name ? "" : name;
    setSelectedSpell(next);
    setMode(next ? "cast" : "none");
    const sp = spellCatalog[next];
    setSlotLevel(sp && sp.level > 0 ? sp.level : null);
    setSelectedEffectChoice(sp?.effect_options?.[0]?.key || "");
  }

  function spellTooltip(name: string): TooltipData {
    const sp = spellCatalog[name];
    if (sp) return buildSpellTooltip(sp);
    // Fallback when the spell isn't in the loaded catalog yet.
    return { name, subtype: "Заклинание", icon: spellImageUrl(), desc: "" };
  }

  function buildHotbarGroups(c: Char): HotbarGroup[] {
    const actionItem = (key: string, onClick: () => void, selected = false): HotbarItem => ({
      id: key,
      icon: ACTION_DEFS[key].tooltip.icon,
      tooltip: ACTION_DEFS[key].tooltip,
      state: selected ? "selected" : "ready",
      onClick,
    });

    const main: HotbarItem[] = [
      actionItem("move", () => setMode("move"), mode === "move"),
      actionItem("attack", () => setMode("attack"), mode === "attack"),
      actionItem("dash", () => act(() => combatApi.action(roomId, "dash", { character_id: currentId }))),
      actionItem("dodge", () => act(() => combatApi.action(roomId, "dodge", { character_id: currentId }))),
      actionItem("disengage", () =>
        act(() => combatApi.action(roomId, "disengage", { character_id: currentId }))
      ),
    ];

    const bonus: HotbarItem[] = [];
    if (c.class_name === "Fighter") {
      bonus.push({
        ...actionItem("second-wind", () =>
          act(() => combatApi.action(roomId, "second-wind", { character_id: currentId }))
        ),
        corner: "bonus",
      });
    }

    const spellNames: string[] = [...(c.cantrips || []), ...(c.spells_prepared || [])];
    const spells: HotbarItem[] = spellNames.map((name) => {
      const sp = spellCatalog[name];
      return {
        id: name,
        icon: spellImageUrl(sp),
        tooltip: spellTooltip(name),
        state: selectedSpell === name ? "selected" : "ready",
        onClick: () => selectSpell(name),
      };
    });

    return [
      { label: "Действия", kind: "main", items: main },
      { label: "Бонусные", kind: "bonus", items: bonus },
      { label: "Заклинания", kind: "spell", items: spells },
    ];
  }

  if (!room) return <div className="spinner">Загрузка боя…</div>;

  const gw = room.grid_width;
  const gh = room.grid_height;

  return (
    <div className="combat-layout">
      <div>
        <div className="btn-row" style={{ marginBottom: "0.6rem" }}>
          {!combat?.active && (
            <button className="primary" onClick={startCombat} disabled={busy || chars.length < 2}>
              ⚔️ Начать бой
            </button>
          )}
          {combat?.active && (
            <span className="pill">
              Раунд {combat.round} · ход: <b>{current?.name}</b>
            </span>
          )}
        </div>
        <div
          className="battle-grid"
          style={{ gridTemplateColumns: `repeat(${gw}, 1fr)` }}
        >
          {Array.from({ length: gh }).map((_, y) =>
            Array.from({ length: gw }).map((_, x) => {
              const occ = chars.find(([, c]) => c.position.x === x && c.position.y === y);
              const cls = ["cell"];
              if (mode === "move" && !occ) cls.push("moveable");
              if ((mode === "attack" || mode === "cast") && occ && occ[0] !== currentId)
                cls.push("targetable");
              return (
                <div
                  key={`${x}-${y}`}
                  className={cls.join(" ")}
                  onClick={() => onCellClick(x, y)}
                  title={`(${x},${y})`}
                >
                  {occ && (
                    <div
                      className={[
                        "token",
                        isEnemy(occ[1]) ? "enemy" : "ally",
                        occ[0] === currentId ? "current" : "",
                        occ[1].hp <= 0 ? "down" : "",
                      ].join(" ")}
                    >
                      {occ[1].portrait || occ[1].name[0]}
                      <div className="hpbar">
                        <div
                          style={{ width: `${Math.max(0, (occ[1].hp / occ[1].max_hp) * 100)}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
        {msg && <div className="notice" style={{ marginTop: "0.6rem" }}>{msg}</div>}
      </div>

      <div>
        {current && combat?.active && !current.is_monster && (
          <div className="panel">
            <h3>{current.name}</h3>
            <div className="muted">
              HP {current.hp}/{current.max_hp} · AC {current.ac} · ход{" "}
              {current.movement_remaining ?? current.speed}фт
            </div>
            <div style={{ marginTop: "0.8rem" }}>
              <Hotbar groups={buildHotbarGroups(current)} />
            </div>

            {selectedSpell && (
              <div style={{ marginTop: "0.8rem" }}>
                {(spellCatalog[selectedSpell]?.effect_options || []).length > 0 && (
                  <div>
                    <label>Вариант эффекта</label>
                    <select
                      value={selectedEffectChoice}
                      onChange={(e) => setSelectedEffectChoice(e.target.value)}
                    >
                      {spellCatalog[selectedSpell].effect_options!.map((o: any) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="muted" style={{ marginTop: 4 }}>
                  Выбрано: <b>{spellTooltip(selectedSpell).name}</b> — кликните по цели/клетке на сетке.
                </div>
              </div>
            )}

            <div className="btn-row" style={{ marginTop: "0.8rem" }}>
              <button className="primary" onClick={endTurn} disabled={busy}>
                Завершить ход ⏭
              </button>
            </div>
          </div>
        )}

        {current?.is_monster && combat?.active && (
          <div className="panel">
            <h3>Ход монстра: {current.name}</h3>
            <button className="primary" onClick={() => act(maybeAutoTurns)} disabled={busy}>
              ▶️ Авто-ход монстров
            </button>
          </div>
        )}

        <div className="panel">
          <h3>Участники</h3>
          {chars.map(([id, c]) => (
            <div key={id} style={{ marginBottom: 6 }}>
              <b style={{ color: isEnemy(c) ? "#e08a7a" : "#8ab0e0" }}>{c.name}</b>{" "}
              <span className="muted">
                {c.hp}/{c.max_hp} HP · AC {c.ac}
              </span>
              <div>
                {(c.conditions || []).map((cond: string) => (
                  <span key={cond} className="pill cond">
                    {cond}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>Журнал</h3>
          <div className="log">
            {(room.log || []).slice(-60).reverse().map((l: any, i: number) => (
              <div className="entry" key={i}>
                {l.message}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
