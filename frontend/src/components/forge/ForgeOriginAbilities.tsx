import type { AssembledCharacter } from '../../character/assemble';
import { useSiteSettings } from '../../settings';
import ForgeAbilityDisplay from './ForgeAbilityDisplay';

type Props = {
  assembled: AssembledCharacter;
  kind: 'race' | 'class';
  fallbackImageUrl?: string | null;
};

const ForgeOriginAbilities = ({ assembled, kind, fallbackImageUrl }: Props) => {
  const { entityDisplay } = useSiteSettings();
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
          <ForgeAbilityDisplay
            mode={entityDisplay.effects}
            linesClassName="forge-ability-lines"
            entries={effects.map(({ effect, origin }) => ({
              key: effect.id,
              name: effect.name,
              imageUrl: effect.image_url,
              fallbackImageUrl,
              sourceLabel: `${effectSource} · ${origin.name}`,
              effect,
            }))}
          />
        </div>
      )}
      {actions.length > 0 && (
        <div className="forge-block">
          <div className="forge-section-h">{actionTitle}</div>
          <ForgeAbilityDisplay
            mode={entityDisplay.actions}
            linesClassName="forge-ability-lines"
            entries={actions.map(({ action, origin }) => ({
              key: action.id,
              name: action.name,
              imageUrl: action.image_url,
              fallbackImageUrl,
              sourceLabel: `${actionSource} · ${origin.name}`,
              action,
            }))}
          />
        </div>
      )}
    </div>
  );
};

export default ForgeOriginAbilities;
