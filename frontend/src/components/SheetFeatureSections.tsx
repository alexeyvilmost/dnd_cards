import type {AssembledCharacter} from '../character/assemblyFactory';
import type {ChoiceOrigin} from '../mechanics/collectChoices';
import {effectAbilityPresentation} from '../character/abilityDisplay';
import {useSiteSettings} from '../settings';
import ForgeAbilityDisplay from './forge/ForgeAbilityDisplay';
import './SheetFeatureSections.css';

export const FEATURE_SECTIONS = [
  {id: 'race', label: 'Способности вида'}, {id: 'feat', label: 'Черты'},
  {id: 'class', label: 'Способности класса'}, {id: 'other', label: 'Прочие способности'},
] as const;
export function featureSection(origin: ChoiceOrigin, feats: AssembledCharacter['feats']): string {
  if (origin.kind === 'feat' && feats.some(f => f.id === origin.id && f.category === 'fighting_style')) return 'class';
  return ['race', 'feat', 'class'].includes(origin.kind) ? origin.kind : 'other';
}
const sourceLabel = (kind: string) => ({race:'Вид', feat:'Черта', class:'Класс', background:'Предыстория'}[kind] ?? 'Источник');

/** One projection shared by sheet layouts; no parallel feat-name summary. */
export default function SheetFeatureSections({assembled}: {assembled: Pick<AssembledCharacter, 'effects' | 'actions' | 'feats'>}) {
  const {entityDisplay} = useSiteSettings();
  const represented = new Set([...assembled.effects, ...assembled.actions].filter(row => row.origin.kind === 'feat').map(row => row.origin.id));
  return <div className="sheet-feature-sections">{FEATURE_SECTIONS.map(section => {
    const effects = assembled.effects.filter(row => featureSection(row.origin, assembled.feats) === section.id);
    const actions = assembled.actions.filter(row => featureSection(row.origin, assembled.feats) === section.id);
    const feats = assembled.feats.filter(feat => !represented.has(feat.id)
      && (feat.category === 'fighting_style' ? 'class' : 'feat') === section.id);
    if (!effects.length && !actions.length && !feats.length) return null;
    return <section className="sheet-feature-section" key={section.id} aria-label={section.label}>
      <h3>{section.label}</h3>
      <div className="sheet-feature-section__entities">
      <ForgeAbilityDisplay mode={entityDisplay.effects} linesClassName="sheet-item-cols" entries={[
        ...effects.map(({effect, origin}) => ({key:`effect:${effect.id}:${origin.id}`, imageUrl:effect.image_url,
          ...effectAbilityPresentation(effect, origin, assembled.feats, sourceLabel)})),
        ...feats.map(feat => ({key:`feat:${feat.id}`, name:feat.name, imageUrl:feat.image_url, feat})),
      ]}/>
      <ForgeAbilityDisplay mode={entityDisplay.actions} linesClassName="sheet-item-cols" entries={actions.map(({action, origin}) => ({
        key:`action:${action.id}:${origin.id}`, name:action.name, imageUrl:action.image_url,
        sourceLabel:`${sourceLabel(origin.kind)} · ${origin.name}`, action,
      }))}/>
      </div>
    </section>;
  })}{!assembled.feats.length && !assembled.effects.length && !assembled.actions.length && <p>Нет привязанных способностей.</p>}</div>;
}
