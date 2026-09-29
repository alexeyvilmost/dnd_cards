import type { Action, Background, Card, CharacterClass, Concept, Feat, PassiveEffect, Race, ResourceDefinition, Spell, Variable } from '../types';
import type { Monster } from '../monsters/types';
import { passivePresentationEffect, type PassivePresentation } from '../character/passiveCatalog';
import { useSiteSettings } from '../settings';
import CardPreview from './CardPreview';
import ItemPreview from './ItemPreview';
import SpellPreview from './SpellPreview';
import ActionPreview from './ActionPreview';
import EffectPreview from './EffectPreview';
import FeatPreview from './FeatPreview';
import BackgroundPreview from './BackgroundPreview';
import RacePreview from './RacePreview';
import ClassPreview from './ClassPreview';
import ResourcePreview from './ResourcePreview';
import VariablePreview from './VariablePreview';
import ConceptPreview from './ConceptPreview';
import MonsterPreview from './MonsterPreview';

export default function CanonicalEntityPreview({ kind, entity }: { kind: string; entity: Record<string, unknown> }) {
  const asInterface = useSiteSettings().itemPreview === 'interface';
  switch (kind) {
    case 'cards': return asInterface ? <ItemPreview card={entity as unknown as Card} disableHover /> : <CardPreview card={entity as unknown as Card} disableHover />;
    case 'spells': return <SpellPreview spell={entity as unknown as Spell} disableHover />;
    case 'actions': return <ActionPreview action={entity as unknown as Action} disableHover />;
    case 'effects': return <EffectPreview effect={entity as unknown as PassiveEffect} disableHover />;
    case 'feats': return <FeatPreview feat={entity as unknown as Feat} disableHover />;
    case 'backgrounds': return <BackgroundPreview background={entity as unknown as Background} disableHover />;
    case 'races': return <RacePreview race={entity as unknown as Race} disableHover />;
    case 'classes': return <ClassPreview characterClass={entity as unknown as CharacterClass} disableHover />;
    case 'resources': return <ResourcePreview resource={entity as unknown as ResourceDefinition} disableHover />;
    case 'variables': return <VariablePreview variable={entity as unknown as Variable} disableHover />;
    case 'concepts': return <ConceptPreview concept={entity as unknown as Concept} disableHover />;
    case 'monsters': return <MonsterPreview monster={entity as unknown as Monster} />;
    case 'passives': return <EffectPreview reviewEntityType="passive" effect={passivePresentationEffect(entity as unknown as PassivePresentation)} disableHover />;
  }
}
