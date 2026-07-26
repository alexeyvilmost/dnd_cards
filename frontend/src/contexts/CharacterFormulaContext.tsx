import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { CharacterContext } from '../mvp/contracts';
import type { FormulaContext } from '../engine/formula';

const CharacterFormulaCtx = createContext<FormulaContext | null>(null);

type PublishFn = (value: FormulaContext | null) => () => void;
const CharacterFormulaPublishCtx = createContext<PublishFn | null>(null);

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

/**
 * Корень на уровне App: диалог кубов и detail-модалки читают отсюда,
 * даже если они порталятся вне дерева листа/кузницы.
 */
export function CharacterFormulaRoot({ children }: { children: ReactNode }) {
  const [ctx, setCtx] = useState<FormulaContext | null>(null);
  const stackRef = useRef<Array<FormulaContext | null>>([]);

  const publish = useCallback<PublishFn>((value) => {
    stackRef.current.push(value);
    setCtx(value);
    return () => {
      const stack = stackRef.current;
      const idx = stack.lastIndexOf(value);
      if (idx >= 0) stack.splice(idx, 1);
      setCtx(stack[stack.length - 1] ?? null);
    };
  }, []);

  return (
    <CharacterFormulaPublishCtx.Provider value={publish}>
      <CharacterFormulaCtx.Provider value={ctx}>{children}</CharacterFormulaCtx.Provider>
    </CharacterFormulaPublishCtx.Provider>
  );
}

/**
 * Публикует formula context текущего персонажа (лист / кузня / мобильный).
 * Значение видно и потомкам, и глобальным оверлеям (диалог кубов, detail-модалки).
 */
export function CharacterFormulaProvider({
  value,
  children,
}: {
  value: FormulaContext | null | undefined;
  children: ReactNode;
}) {
  const publish = useContext(CharacterFormulaPublishCtx);
  const ctx = useMemo(() => value ?? null, [value]);

  useEffect(() => {
    if (!publish) return undefined;
    return publish(ctx);
  }, [publish, ctx]);

  // Локальный провайдер — чтобы потомки видели значение сразу (без ожидания эффекта).
  return <CharacterFormulaCtx.Provider value={ctx}>{children}</CharacterFormulaCtx.Provider>;
}

/** Контекст формул текущего персонажа. Вне листа/кузницы — null. */
export function useCharacterFormulaCtx(): FormulaContext | null {
  return useContext(CharacterFormulaCtx);
}
