import type { AssembledCharacter } from '../../character/assemble';
import ForgeAbilityLine from './ForgeAbilityLine';

type Props = {
  assembled: AssembledCharacter;
  kind: 'race' | 'class';
  fallbackImageUrl?: string | null;
};

const ForgeOriginAbilities = ({ assembled, kind, fallbackImageUrl }: Props) => {
  const effects = (assembled.effects || []).filter((e) => e.origin.kind === kind);
  const actions = (assembled.actions || []).filter((a) => a.origin.kind === kind);
  if (!effects.length && !actions.length) return null;

  const effectTitle = kind === 'race' ? 'Видовые особенности' : 'Классовые особенности';
  const actionTitle = kind === 'race' ? 'Действия вида' : 'Действия класса';
  const effectSource = kind === 'race' ? 'Способность вида' : 'Способность класса';
  const actionSource = kind === 'race' ? 'Действие вида' : 'Действие класса';

  return (
    <div className="forge-origin-abilities">
      {effects.length > 0 && (
        <div className="forge-block">
          <div className="forge-section-h">{effectTitle}</div>
          <div className="forge-ability-lines">
            {effects.map(({ effect, origin }) => (
              <ForgeAbilityLine
                key={effect.id}
                name={effect.name}
                imageUrl={effect.image_url}
                fallbackImageUrl={fallbackImageUrl}
                sourceLabel={`${effectSource} · ${origin.name}`}
                effect={effect}
              />
            ))}
          </div>
        </div>
      )}
      {actions.length > 0 && (
        <div className="forge-block">
          <div className="forge-section-h">{actionTitle}</div>
          <div className="forge-ability-lines">
            {actions.map(({ action, origin }) => (
              <ForgeAbilityLine
                key={action.id}
                name={action.name}
                imageUrl={action.image_url}
                fallbackImageUrl={fallbackImageUrl}
                sourceLabel={`${actionSource} · ${origin.name}`}
                action={action}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ForgeOriginAbilities;
