import React from 'react';
import type { CombatLogEntry, RollChip } from '../../utils/combatLog';

function Die({ value }: { value: number }) {
  return (
    <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded bg-gray-800 px-1 text-xs font-bold tabular-nums text-white">
      {value}
    </span>
  );
}

function ChipView({ chip }: { chip: RollChip }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span className="font-semibold tabular-nums">{chip.total}</span>
      <span className="text-gray-400">(</span>
      {chip.dice.map((d, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-gray-400">+</span>}
          <Die value={d} />
        </React.Fragment>
      ))}
      {chip.bonus !== undefined && (
        <span className="text-gray-500">
          {chip.bonus >= 0 ? '+' : '−'} {Math.abs(chip.bonus)}
        </span>
      )}
      <span className="text-gray-400">)</span>
      {chip.suffix && <span className="text-gray-600">{chip.suffix}</span>}
    </span>
  );
}

interface CombatLogEntryViewProps {
  entry: CombatLogEntry;
}

const CombatLogEntryView: React.FC<CombatLogEntryViewProps> = ({ entry }) => {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 shadow-sm"
      style={{ borderLeftWidth: '4px', borderLeftColor: entry.color }}
    >
      <div className="font-medium">{entry.title}</div>
      {entry.lines.map((line, li) => (
        <div key={li} className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-gray-700">
          <span className="text-gray-500">{line.label} —</span>
          {line.chips.map((chip, ci) => (
            <React.Fragment key={ci}>
              {ci > 0 && <span className="text-gray-400">и</span>}
              <ChipView chip={chip} />
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  );
};

export default CombatLogEntryView;
