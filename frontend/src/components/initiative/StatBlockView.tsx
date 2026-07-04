import React from 'react';
import { ABILITY_LABELS, type AbilityKey, type StatBlock } from '../../types/initiative';

const ABILITY_ORDER: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

function Line({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <p className="text-sm text-gray-700">
      <span className="font-semibold text-gray-900">{label}:</span> {value}
    </p>
  );
}

interface StatBlockViewProps {
  statblock: StatBlock;
}

/** Полный статблок монстра, импортированный с ttg.club (#3). */
const StatBlockView: React.FC<StatBlockViewProps> = ({ statblock }) => {
  const abilities = statblock.abilities;
  const shownAbilities = abilities ? ABILITY_ORDER.filter((k) => abilities[k]) : [];

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <Line label="Скорость" value={statblock.speed} />
        <Line label="ПО" value={statblock.cr} />
        <Line label="Чувства" value={statblock.senses} />
        <Line label="Языки" value={statblock.languages} />
        <Line label="Спасброски" value={statblock.saves} />
        <Line label="Навыки" value={statblock.skills} />
        <Line label="Уязвимости" value={statblock.vulnerabilities} />
        <Line label="Сопротивления" value={statblock.resistances} />
        <Line label="Иммунитеты" value={statblock.immunities} />
      </div>

      {shownAbilities.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {shownAbilities.map((key) => {
            const a = abilities![key]!;
            return (
              <div key={key} className="rounded-md border border-gray-200 bg-white px-1.5 py-1 text-center">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  {ABILITY_LABELS[key]}
                </div>
                <div className="text-base font-bold text-gray-900">{a.score}</div>
                <div className="text-xs text-gray-600" title="Модификатор / спасбросок">
                  {signed(a.mod)} <span className="text-gray-300">/</span> {signed(a.save)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default StatBlockView;
