import { abilityFullRu, type MechanicsStats } from '../engine/describeMechanics';
import { formatFormulaDisplay } from '../engine/formula';
import { useCharacterFormulaCtx } from '../contexts/CharacterFormulaContext';
import UiIcon from './UiIcon';

/** Shared roll metadata; formulas use the same character context as damage. */
export default function RollPreviewMeta({ stats, attackBonus, spellcasting }: {
  stats: MechanicsStats;
  attackBonus?: number;
  spellcasting?: { saveDC?: number; attack?: number };
}) {
  const ctx = useCharacterFormulaCtx();
  const resolvedAttack = attackBonus ?? stats.attackBonusOverride
    ?? (stats.attackAbility === 'spellcasting' ? spellcasting?.attack
      ?? (ctx?.profBonus !== undefined && ctx.spellcastingMod !== undefined
        ? Number(formatFormulaDisplay('prof + spellcasting', ctx)) : undefined) : undefined);
  const saves = stats.saveRequirements ?? (stats.save ? [{ ability: stats.saveAbility, dc: null }] : []);
  return <>
    {stats.attack && <span className="sp-roll-meta"><UiIcon symbol="attack" />
      Бросок атаки{resolvedAttack != null && Number.isFinite(resolvedAttack)
        ? ` (${resolvedAttack >= 0 ? '+' : ''}${resolvedAttack})` : ''}
    </span>}
    {saves.map((save, index) => {
      const raw = String(save.dc ?? '');
      const standardSpellDc = /^(spell_save_dc|8\+(prof|prof_bonus)\+spellcasting)$/.test(raw.replace(/\s/g, ''));
      const fromFormula = raw ? Number(formatFormulaDisplay(raw, ctx)) : NaN;
      const dc = (standardSpellDc || save.dc == null) && spellcasting?.saveDC !== undefined
        ? spellcasting.saveDC : fromFormula;
      return <span className="sp-roll-meta" key={index}><UiIcon symbol="save" />
        Спасбросок{save.ability ? `: ${abilityFullRu(save.ability)}` : ''}
        {Number.isFinite(dc) && dc > 0 ? ` (СЛ ${dc})` : ''}
      </span>;
    })}
  </>;
}
