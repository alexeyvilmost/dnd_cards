import {useEntityRef} from '../components/EntityRefRegistry';
import type {PassiveEffect} from '../types';
import { Fragment, useEffect, useState } from 'react';
import { useSiteSettings } from '../settings';
import SheetActionLine from '../components/SheetActionLine';
import SheetWeaponMasteryDialog from '../components/SheetWeaponMasteryDialog';
import type { PendingChoice } from '../mechanics/collectChoices';
import { type Action, type Feat, type Spell, getSpellLevelLabel } from '../types';
import { actionsApi, spellsApi } from '../api/client';
import ForgeAbilityLine from '../components/forge/ForgeAbilityLine';
import EntitySquareCard from '../components/forge/EntitySquareCard';
import FeatPreview from '../components/FeatPreview';
import { optionsForChoice, choiceOptionIdByReference, featForChoiceOption } from './choiceOptions';


function EffectChoiceOption({reference, name, selected, disabledReason, onSelect, mode}: {
  reference: string; name: string; selected: boolean; disabledReason?: string;
  onSelect: () => void; mode: 'icon' | 'row';
}) {
  const {entity, loading, error} = useEntityRef('effect', reference);
  const effect = entity as PassiveEffect | null;
  return <div className="choice-effect-option">
    <ForgeAbilityLine name={effect?.name ?? name} imageUrl={effect?.image_url} effect={effect ?? undefined}
      variant={mode} selected={selected} disabled={Boolean(disabledReason) || loading || error}
      disabledReason={disabledReason ?? (loading ? 'Загрузка способности…' : error ? 'Не удалось загрузить способность' : undefined)}
      onActivate={onSelect}/>
    {mode === 'icon' && <span className="choice-effect-option__name">{effect?.name ?? name}</span>}
  </div>;
}

export function ChoiceResolver({
  choice, value, onChange, unavailableOptions = {}, feats, groupSpellLevels = false,
}: {
  choice: PendingChoice;
  value: string[];
  onChange: (v: string[]) => void;
  unavailableOptions?: Record<string, string>;
  /** Справочник черт для choice(source:"feat") — варианты по категории. */
  feats?: Feat[];
  /** Presentation only; all levels retain one canonical selection/count. */
  groupSpellLevels?: boolean;
}) {
  const {entityDisplay} = useSiteSettings();
  const options = optionsForChoice(choice, feats);
  const actionReferences = JSON.stringify((choice.items ?? []).flatMap(item => {
    const grants = item.grants ?? [];
    const actionGrant = grants.find(grant => grant.kind === 'grant_action' && typeof grant.value === 'string');
    return actionGrant ? [[item.id, actionGrant.value]] : [];
  }));
  const [actionPreviews, setActionPreviews] = useState<Record<string, Action>>({});
  const spellReferences=JSON.stringify((choice.items??[]).flatMap(item=>{
    const grant=item.grants?.find(grant=>grant.kind==='grant_spell'&&typeof grant.value==='string');
    return grant?[[item.id,grant.value]]:[];
  }));
  const [spellPreviews,setSpellPreviews]=useState<Record<string,Spell>>({});
  useEffect(()=>{
    let stale=false;
    const references=JSON.parse(spellReferences) as [string,string][];
    if(!references.length)return;
    Promise.all(references.map(async([id,ref])=>{try{return [id,await spellsApi.getSpell(ref)] as const;}catch{return null;}}))
      .then(rows=>{if(!stale)setSpellPreviews(Object.fromEntries(rows.filter(row=>row!==null)));});
    return ()=>{stale=true;};
  },[spellReferences]);
  const [masteryOpen, setMasteryOpen] = useState(false);
  useEffect(() => {
    let stale = false;
    const references = JSON.parse(actionReferences) as [string, string][];
    if (!references.length) return;
    Promise.all(references.map(async ([id, reference]) => {
      try { return [id, await actionsApi.getAction(reference)] as const; }
      catch { return null; }
    })).then(loaded => {
      if (!stale) setActionPreviews(Object.fromEntries(loaded.filter(entry => entry !== null)));
    });
    return () => { stale = true; };
  }, [actionReferences]);
  const effectReference = (id: string) => {
    const item = choice.items?.find(item => item.id === id);
    const grant = item?.grants?.find(grant => grant.kind === 'grant_effect' && typeof grant.value === 'string');
    return item?.previewEffectId ?? (choice.source === 'effect' ? item?.value ?? id : grant?.value as string | undefined);
  };
  const hasEffectChoices = options.length > 0 && options.every(option => Boolean(effectReference(option.id)));
  const recommendedIds = new Set((choice.recommended ?? []).flatMap((reference) => {
    const optionId = choiceOptionIdByReference(options, reference);
    return optionId ? [optionId] : [];
  }));
  const toggle = (id: string) => {
    if (unavailableOptions[id] && !value.includes(id)) return;
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
    } else {
      if (value.length >= choice.count) {
        // заменяем самый старый выбор при переполнении
        onChange([...value.slice(1), id]);
      } else {
        onChange([...value, id]);
      }
    }
  };
  const done = value.length >= choice.count;
  const previewSpell = (optionId: string) => choice.items?.find(item => item.id === optionId)?.previewSpell ?? spellPreviews[optionId];
  const spellOptions = groupSpellLevels ? [...options].sort((left, right) => (
    (previewSpell(left.id)?.level ?? 0) - (previewSpell(right.id)?.level ?? 0)
  )) : options;

  // Выбор черты (боевой стиль, доп. черта Человека и т.п.) — как выбор
  // черты происхождения: сетка квадратов с иконкой и превью при наведении.
  const featTiles = choice.source === 'feat'
    ? options.flatMap(option => {
      const feat = featForChoiceOption(choice, option.id, feats ?? []);
      return feat ? [{option, feat}] : [];
    })
    : [];

  return (
    <div className="choice-box">
      <div className="choice-title">
        {choice.prompt} <span className="origin">· {choice.origin.name}</span>
      </div>
      {choice.grantKind === 'weapon_mastery' ? <>
        <button type="button" className="forge-btn" onClick={()=>setMasteryOpen(true)}>Выбрать</button>
        {value.length > 0 && <p>{options.filter(option=>value.includes(option.id)).map(option=>option.label).join(' · ')}</p>}
        {masteryOpen && <SheetWeaponMasteryDialog choices={[choice]} resolved={{[choice.id]:value}}
          unavailableOptions={unavailableOptions} initialShowAll onChange={(_id,next)=>onChange(next)} onClose={()=>setMasteryOpen(false)}/>}
      </> : hasEffectChoices ? (
        <div className={entityDisplay.effects === 'icon' ? 'choice-effect-options cs-action-tiles' : 'choice-effect-options'}>
          {options.map(option => <EffectChoiceOption key={option.id} reference={effectReference(option.id)!}
            name={option.label} mode={entityDisplay.effects} selected={value.includes(option.id)}
            disabledReason={!value.includes(option.id) ? unavailableOptions[option.id] : undefined} onSelect={() => toggle(option.id)}/>)}
        </div>
      ) : spellReferences!=='[]' ||choice.items?.some(item=>item.previewSpell) ? (
        <div className={entityDisplay.spells === 'icon' ? 'cs-action-tiles choice-spell-entities' : 'choice-spell-entities'}>
          {spellOptions.map((option, index) => {
            const spell = previewSpell(option.id);
            const startsLevel = groupSpellLevels && (index === 0 || spell?.level !== previewSpell(spellOptions[index - 1].id)?.level);
            return <Fragment key={option.id}>
              {startsLevel && <div className="choice-spell-level">{getSpellLevelLabel(spell?.level ?? 0)}</div>}
              <SheetActionLine name={option.label} imageUrl={spell?.image_url}
              variant={entityDisplay.spells} spellRef={spell} level={spell?.level}
              selected={value.includes(option.id)} sourceLabel={value.includes(option.id) ? 'Выбрано' : choice.prompt}
              detail={value.includes(option.id) ? 'Выбрано' : spell ? `${spell.level} ур.` : undefined}
              disabled={!!unavailableOptions[option.id] && !value.includes(option.id)} disabledTitle={unavailableOptions[option.id]}
              onActivate={() => toggle(option.id)}/></Fragment>;
          })}
        </div>
      ) : choice.items?.some(item=>item.previewAction) ? (
        <div className={entityDisplay.actions === 'icon' ? 'cs-action-tiles choice-entity-options' : 'choice-entity-options'}>
          {options.map(option=>{
            const action=choice.items?.find(item=>item.id===option.id)?.previewAction;
            return <SheetActionLine key={option.id} name={option.label} imageUrl={action?.image_url} variant={entityDisplay.actions}
              selected={value.includes(option.id)} disabled={!!unavailableOptions[option.id]&&!value.includes(option.id)}
              disabledTitle={unavailableOptions[option.id]} onActivate={()=>toggle(option.id)} actionRef={action}/>;
          })}
        </div>
      ) : choice.items?.some(item=>item.previewCard) ? (
        <div className={entityDisplay.items === 'icon' ? 'cs-action-tiles choice-entity-options' : 'choice-entity-options'}>
          {options.map(option=>{
            const card=choice.items?.find(item=>item.id===option.id)?.previewCard;
            return <SheetActionLine key={option.id} name={option.label} imageUrl={card?.image_url} variant={entityDisplay.items}
              selected={value.includes(option.id)} disabled={!!unavailableOptions[option.id]&&!value.includes(option.id)}
              disabledTitle={unavailableOptions[option.id]} onActivate={()=>toggle(option.id)} itemRef={card}/>;
          })}
        </div>
      ) : actionReferences !== '[]' ? (
        <div className={entityDisplay.actions === 'icon' ? 'cs-action-tiles choice-entity-options' : 'choice-entity-options'}>
          {options.map(option => {
            const action = actionPreviews[option.id];
            return <SheetActionLine key={option.id} name={option.label} variant={entityDisplay.actions}
              imageUrl={action?.image_url} selected={value.includes(option.id)}
              disabled={!!unavailableOptions[option.id] && !value.includes(option.id)}
              disabledTitle={unavailableOptions[option.id]}
              onActivate={() => toggle(option.id)} actionRef={action} />;
          })}
        </div>
      ) : featTiles.length > 0 ? (
        <div className={entityDisplay.effects === 'row' ? 'choice-feat-rows' : 'forge-square-grid'}>
          {featTiles.map(({option, feat: f}) => entityDisplay.effects === 'row' ? <ForgeAbilityLine
            key={option.id} name={f.name} imageUrl={f.image_url} feat={f} variant="row"
            selected={value.includes(option.id)}
            disabled={!!unavailableOptions[option.id] && !value.includes(option.id)}
            disabledReason={unavailableOptions[option.id]} onActivate={() => toggle(option.id)}/>
            : <EntitySquareCard
              key={option.id}
              name={f.name}
              imageUrl={f.image_url}
              selected={value.includes(option.id)}
              disabled={!!unavailableOptions[option.id] && !value.includes(option.id)}
              disabledReason={unavailableOptions[option.id]}
              onClick={() => toggle(option.id)}
              preview={<FeatPreview feat={f} disableHover />}
              supportEntity={f}
            />)}
          {options.filter(option => !featTiles.some(tile => tile.option.id === option.id)).map(option => <button
            key={option.id} type="button" className={`chip ${value.includes(option.id) ? 'on' : ''}`}
            aria-pressed={value.includes(option.id)} disabled={!!unavailableOptions[option.id] && !value.includes(option.id)}
            aria-description={unavailableOptions[option.id]} onClick={() => toggle(option.id)}>{option.label}</button>)}
        </div>
      ) : (
        <div className="chips">
          {options.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`chip ${value.includes(o.id) ? 'on' : ''} ${recommendedIds.has(o.id) ? 'rec' : ''}`}
              aria-pressed={value.includes(o.id)}
              disabled={!!unavailableOptions[o.id] && !value.includes(o.id)}
              aria-description={unavailableOptions[o.id]}
              onClick={() => toggle(o.id)}
            >
              {o.label}
            </button>
          ))}
          {options.length === 0 && <span className="ec-sub">Нет вариантов для источника «{choice.source}»</span>}
        </div>
      )}
      <div className={`choice-count ${done ? 'done' : ''}`}>
        Выбрано {value.length} из {choice.count}
      </div>
    </div>
  );
}


export default ChoiceResolver;
