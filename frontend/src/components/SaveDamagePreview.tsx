import type { MechanicsStats } from '../engine/describeMechanics';
import { formatFormulaDisplay, halfDamageFormulaBase } from '../engine/formula';
import { useCharacterFormulaCtx } from '../contexts/CharacterFormulaContext';
import { getDamageLabel } from '../utils/damageTypes';

/** Save outcomes are alternatives, not additional hits in the damage row. */
export default function SaveDamagePreview({ stats }: { stats: MechanicsStats }) {
  const ctx = useCharacterFormulaCtx();
  if (!stats.damageOnSaveSuccess?.length) return null;
  const fmt = (value: string) => formatFormulaDisplay(value, ctx);
  const isHalf = stats.damageOnSaveSuccess.length === stats.damage.length
    && stats.damageOnSaveSuccess.every((entry, index) => {
      const base = halfDamageFormulaBase(entry.value);
      const failed = stats.damage[index];
      return base != null && failed.type === entry.type && fmt(base) === fmt(failed.value);
    });
  return <div className="sp-saveline">
    При успехе: {isHalf ? 'половина урона' : stats.damageOnSaveSuccess.map(entry =>
      `${fmt(entry.value)} ${getDamageLabel(entry.type).toLowerCase()}`).join(' + ')}
  </div>;
}
