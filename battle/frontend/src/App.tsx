import { NavLink, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { healthApi } from "./api/client";
import CombatPage from "./pages/CombatPage";
import CharactersPage from "./pages/CharactersPage";
import CharacterBuilderPage from "./pages/CharacterBuilderPage";
import CharacterSheetPage from "./pages/CharacterSheetPage";
import LevelUpPage from "./pages/LevelUpPage";
import SpellbookPage from "./pages/SpellbookPage";
import SpellEditorPage from "./pages/SpellEditorPage";
import BestiaryPage from "./pages/BestiaryPage";
import MonsterEditorPage from "./pages/MonsterEditorPage";
import DungeonPage from "./pages/DungeonPage";
import AdminDefinitionsPage from "./pages/AdminDefinitionsPage";

function Nav() {
  const [storage, setStorage] = useState<string>("");
  useEffect(() => {
    healthApi
      .get()
      .then((h) => setStorage(h.storage))
      .catch(() => setStorage("offline"));
  }, []);
  const link = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <nav className="nav">
      <span className="brand">⚔️ D&D Battle</span>
      <NavLink to="/" className={link} end>
        Бой
      </NavLink>
      <NavLink to="/dungeon" className={link}>
        Подземелье
      </NavLink>
      <NavLink to="/characters" className={link}>
        Персонажи
      </NavLink>
      <NavLink to="/bestiary" className={link}>
        Бестиарий
      </NavLink>
      <NavLink to="/spellbook" className={link}>
        Заклинания
      </NavLink>
      <NavLink to="/admin" className={link}>
        Конструктор
      </NavLink>
      <span className="spacer" />
      <span className="badge">storage: {storage || "…"}</span>
    </nav>
  );
}

export default function App() {
  return (
    <div className="app">
      <Nav />
      <Routes>
        <Route path="/" element={<CombatPage />} />
        <Route path="/dungeon" element={<DungeonPage />} />
        <Route path="/dungeon/:runId" element={<DungeonPage />} />
        <Route path="/characters" element={<CharactersPage />} />
        <Route path="/characters/new" element={<CharacterBuilderPage />} />
        <Route path="/characters/:id" element={<CharacterSheetPage />} />
        <Route path="/characters/:id/level-up" element={<LevelUpPage />} />
        <Route path="/spellbook" element={<SpellbookPage />} />
        <Route path="/spellbook/new" element={<SpellEditorPage />} />
        <Route path="/spellbook/:id/edit" element={<SpellEditorPage />} />
        <Route path="/bestiary" element={<BestiaryPage />} />
        <Route path="/bestiary/new" element={<MonsterEditorPage />} />
        <Route path="/bestiary/:id/edit" element={<MonsterEditorPage />} />
        <Route path="/admin" element={<AdminDefinitionsPage />} />
        <Route path="*" element={<div className="panel">Страница не найдена.</div>} />
      </Routes>
    </div>
  );
}
