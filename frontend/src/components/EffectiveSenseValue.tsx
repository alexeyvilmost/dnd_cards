import {
  effectiveSenseRoundsLeft,
  type EffectiveSense,
} from '../rules-core/dwarfTraits';

export default function EffectiveSenseValue({ sense }: { sense: EffectiveSense }) {
  const roundsLeft = effectiveSenseRoundsLeft(sense);
  const temporary = roundsLeft == null ? '' : ` · временно: ${roundsLeft} раунд.`;
  return (
    <span
      data-testid={`effective-sense-${sense.sense}`}
      title={roundsLeft == null ? 'Постоянное чувство' : `Осталось раундов: ${roundsLeft}`}
    >
      {sense.range} фт{temporary}
    </span>
  );
}
