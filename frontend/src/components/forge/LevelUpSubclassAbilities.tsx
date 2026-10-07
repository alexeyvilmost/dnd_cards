import type {AssembledCharacter} from '../../character/assemble';
import {availableSubclassAbilities} from '../../character/levelUpPresentation';
import {useSiteSettings} from '../../settings';
import ForgeAbilityDisplay from './ForgeAbilityDisplay';

export default function LevelUpSubclassAbilities({assembled, subclassId, classLevel, loading = false}: {
  assembled: Pick<AssembledCharacter, 'effects' | 'actions'>;
  subclassId: string;
  classLevel: number;
  loading?: boolean;
}) {
  const {entityDisplay,hideTechnicalAbilities} = useSiteSettings();
  const abilities = availableSubclassAbilities(assembled, subclassId, classLevel);
  const detail = (level?: number) => level === classLevel ? 'Новая способность' : level ? `${level}-й уровень класса` : undefined;
  return <div className="levelup-subclass-abilities" aria-busy={loading || undefined}>
    <h4>Способности к {classLevel}-му уровню класса</h4>
    {loading ? <p className="forge-note">Загрузка способностей…</p> : <>
      <ForgeAbilityDisplay mode={entityDisplay.effects} entries={abilities.effects.filter(({effect})=>!hideTechnicalAbilities||!effect.is_technical).map(({effect, origin}, index)=>({
        key:`${effect.id}:${index}`,name:effect.name,imageUrl:effect.image_url,effect,sourceLabel:origin.name,detail:detail(origin.progressionLevel),
      }))}/>
      <ForgeAbilityDisplay mode={entityDisplay.actions} entries={abilities.actions.map(({action, origin})=>({
        key:action.id,name:action.name,imageUrl:action.image_url,action,sourceLabel:origin.name,detail:detail(origin.progressionLevel),
      }))}/>
      {!abilities.effects.length && !abilities.actions.length && <p className="forge-note">На этом уровне способности подкласса ещё не доступны.</p>}
    </>}
  </div>;
}
