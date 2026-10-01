import type {PendingChoice} from '../../mechanics/collectChoices';
import type {Feat, Spell} from '../../types';
import {Sparkles, Star, Swords, Plus, Pencil, Check} from 'lucide-react';
import {useSiteSettings} from '../../settings';
import EntitySquareCard from './EntitySquareCard';
import FeatPreview from '../FeatPreview';
import ForgeAbilityDisplay from './ForgeAbilityDisplay';
import ForgeSpellIconGrid from './ForgeSpellIconGrid';
import './LevelUpChoiceButton.css';

export default function LevelUpChoiceButton({choice, selectedLabels, selectedFeats = [], selectedSpells = [], replacementLimit, loading = false, onActivate}: {
  choice: PendingChoice;
  selectedLabels: string[];
  selectedFeats?: Feat[];
  selectedSpells?: Spell[];
  replacementLimit?: number;
  loading?: boolean;
  onActivate: () => void;
}) {
  const {entityDisplay} = useSiteSettings();
  const complete = selectedLabels.length >= choice.count;
  const Icon = choice.source === 'feat' ? choice.filter === 'fighting_style' ? Swords : Star : Sparkles;
  const knownLabels = new Set([...selectedFeats, ...selectedSpells].map(entity => entity.name));
  const fallbackLabels = selectedLabels.filter(label => !knownLabels.has(label));
  return <section className={`levelup-choice${complete ? ' is-complete' : ''}${selectedLabels.length ? ' has-selection' : ' is-empty'}`} aria-busy={loading || undefined}>
    <div className="levelup-choice-heading">
      <div><span className="levelup-choice-source">{choice.origin.name}</span><h3>{choice.prompt}</h3></div>
      <span className={`choice-count ${complete ? 'done' : ''}`} aria-live="polite">
        {complete && <Check size={13} aria-hidden="true"/>} Выбрано {selectedLabels.length} из {choice.count}
      </span>
    </div>
    {replacementLimit != null && <p className="levelup-choice-hint">Можно заменить до {replacementLimit} из ранее выбранных вариантов.</p>}
    {selectedLabels.length ? <>
      {selectedFeats.length > 0 && <div className={`levelup-choice-feats levelup-choice-feats--${entityDisplay.effects}`}>
        {selectedFeats.map(feat => <div className="levelup-selected-feat" key={feat.id}>
          {entityDisplay.effects === 'row' ? <ForgeAbilityDisplay mode="row" entries={[{key:feat.id,name:feat.name,imageUrl:feat.image_url,feat}]}/> : <EntitySquareCard name={feat.name} imageUrl={feat.image_url}
            onClick={loading ? undefined : onActivate} preview={<FeatPreview feat={feat} disableHover/>}/>}
          <button type="button" className="levelup-choice-edit" disabled={loading} aria-label={`Изменить: ${feat.name}`} onClick={onActivate}><Pencil size={12} aria-hidden="true"/>Изменить</button>
        </div>)}
      </div>}
      {selectedSpells.length > 0 && <div className="levelup-choice-selected-spells"><ForgeSpellIconGrid spells={selectedSpells}/></div>}
      {fallbackLabels.length > 0 && <div className="levelup-choice-labels">{fallbackLabels.map((label,index) => <span key={`${label}:${index}`}>{label}</span>)}</div>}
      {(selectedFeats.length === 0 || selectedLabels.length < choice.count) && <button type="button" className="levelup-choice-edit levelup-choice-edit--group"
        disabled={loading} aria-label={`Изменить: ${choice.prompt}`} onClick={onActivate}><Pencil size={13} aria-hidden="true"/>{loading ? 'Загрузка вариантов…' : complete ? 'Изменить' : 'Продолжить выбор'}</button>}
    </> : <button type="button" className="levelup-choice-empty" aria-label={choice.prompt} disabled={loading} onClick={onActivate}>
      <span className="levelup-choice-emblem"><Icon size={30} strokeWidth={1.35} aria-hidden="true"/></span>
      <span className="levelup-choice-empty-copy"><b>Откройте новые возможности</b><span>Выберите подходящие варианты для следующего уровня</span></span>
      <span className="levelup-choice-select"><Plus size={15} aria-hidden="true"/>{loading ? 'Загрузка…' : 'Выбрать'}</span>
    </button>}
  </section>;
}
