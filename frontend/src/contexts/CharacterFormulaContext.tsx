import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { CharacterContext } from '../mvp/contracts';
import type { FormulaContext } from '../engine/formula';

const CharacterFormulaCtx = createContext<FormulaContext | null>(null);

/** FormulaContext из CharacterContext листа/кузницы (для превью механики). */
export function formulaCtxFromCharacter(character: CharacterContext | null | undefined): FormulaContext | null {
  if (!character) return null;
  return {
    abilityMods: character.abilityMods,
    profBonus: character.profBonus,
    selfLevel: character.level,
    classLevels: character.classLevels,
    spellcastingMod: character.spellcastingMod,
    characterSpeed: character.characterSpeed,
    variables: character.variables,
  };
}

export function CharacterFormulaProvider({
  value,
  children,
}: {
  value: FormulaContext | null | undefined;
  children: ReactNode;
}) {
  const ctx = useMemo(() => value ?? null, [value]);
  return <CharacterFormulaCtx.Provider value={ctx}>{children}</CharacterFormulaCtx.Provider>;
}

/** Контекст формул текущего персонажа (лист / кузня / мобильный лист). Вне — null. */
export function useCharacterFormulaCtx(): FormulaContext | null {
  return useContext(CharacterFormulaCtx);
}
