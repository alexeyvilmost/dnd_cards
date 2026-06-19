import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { spellsApi, Spell } from "../api/client";
import SpellGrid, { SpellGroup } from "../components/SpellGrid";

const LEVEL_NAMES: Record<number, string> = {
  0: "Заговоры",
  1: "1 круг",
  2: "2 круг",
  3: "3 круг",
};

export default function SpellbookPage() {
  const [spells, setSpells] = useState<Spell[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  function load() {
    setLoading(true);
    spellsApi
      .list()
      .then(setSpells)
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(s: Spell) {
    if (!s.id) return;
    if (!confirm(`Удалить заклинание «${s.name}»?`)) return;
    await spellsApi.remove(s.id);
    load();
  }

  const filtered = spells.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));

  const byLevel: Record<number, Spell[]> = {};
  filtered.forEach((s) => {
    (byLevel[s.level] ||= []).push(s);
  });

  const groups: SpellGroup[] = Object.keys(byLevel)
    .map(Number)
    .sort((a, b) => a - b)
    .map((lvl) => ({
      label: LEVEL_NAMES[lvl] || `${lvl} круг`,
      spells: byLevel[lvl].sort((a, b) => a.name.localeCompare(b.name)),
    }));

  return (
    <div>
      <div className="btn-row" style={{ justifyContent: "space-between" }}>
        <h1>Книга заклинаний</h1>
        <Link to="/spellbook/new" className="btn primary">
          + Создать заклинание
        </Link>
      </div>
      <div className="field" style={{ maxWidth: 360 }}>
        <input placeholder="Поиск…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <p className="muted" style={{ margin: "0 0 1rem" }}>
        Наведите на иконку для подробностей · клик — редактировать · ✎ — черновик.
      </p>

      {loading && <div className="spinner">Загрузка…</div>}
      {!loading && groups.length === 0 && <div className="panel muted">Ничего не найдено.</div>}

      <SpellGrid groups={groups} onDelete={remove} />
    </div>
  );
}
