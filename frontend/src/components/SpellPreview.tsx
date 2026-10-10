import { useSiteSettings } from '../settings';
import ReviewStatusCorner from './ReviewStatusCorner';
import React from 'react';
import type { Spell } from '../types';
import {
  SPELL_SCHOOL_OPTIONS,
  SPELL_CLASS_OPTIONS,
  getSpellLevelLabel,
} from '../types';
import { getDamageColor, getDamageColorOnDark, getDamageLabel, getDamageIconPath } from '../utils/damageTypes';
import { FormattedText } from '../utils/formattedText';
import { SPELL_CARD_CSS } from './spellCardStyle';
import { resourceCostIcon, resourceLabel, useResourceOptions } from '../utils/resources';
import { parseMechanicsStats } from '../engine/describeMechanics';
import { formatFormulaDisplay } from '../engine/formula';
import { useCharacterFormulaCtx } from '../contexts/CharacterFormulaContext';
import OriginalName from './OriginalName';
import UiIcon from './UiIcon';
import SaveDamagePreview from './SaveDamagePreview';
import RollPreviewMeta from './RollPreviewMeta';
import { recoveryPreview } from '../engine/recoveryPreview';

// Класс → русская подпись
const SPELL_CLASS_LABEL: Record<string, string> = Object.fromEntries(
  SPELL_CLASS_OPTIONS.map((c) => [c.value, c.label])
);

interface SpellPreviewProps {
  spell: Spell;
  className?: string;
  disableHover?: boolean;
  /** Hide class availability when inspecting a spell already owned by a character. */
  hideAvailability?: boolean;
  onClick?: () => void;
  /** Контекст заклинателя (лист персонажа): обогащает превью СЛ спасброска и бонусом атаки. */
  spellcasting?: { saveDC?: number; attack?: number };
}

const schoolLabel = (school?: string | null) =>
  SPELL_SCHOOL_OPTIONS.find((s) => s.value === school)?.label || school || '';

const SpellPreview: React.FC<SpellPreviewProps> = ({
  spell,
  className = '',
  disableHover = false,
  hideAvailability = false,
  onClick,
  spellcasting,
}) => {
  const { showDetailedPreview } = useSiteSettings();
  const spellResourceOptions = useResourceOptions();
  const formulaCtx = useCharacterFormulaCtx();
  const fmt = (s: string) => formatFormulaDisplay(s, formulaCtx);

  const subtype = [getSpellLevelLabel(spell.level), schoolLabel(spell.school)]
    .filter(Boolean)
    .join(' · ');

  // Компоненты V, S, M → В, С, М
  const components: string[] = [];
  if (spell.component_verbal) components.push('В');
  if (spell.component_somatic) components.push('С');
  if (spell.component_material) components.push('М');

  // Статистика превью — из МЕХАНИКИ (единственный источник истины; легаси-флаги удалены).
  const mstats = parseMechanicsStats((spell as { mechanics?: Record<string, unknown> | null }).mechanics);
  const showAttack = mstats.attack;
  const dmgEntries = mstats.damage.length
    ? mstats.damage
    : (spell.damage || []).map((d) => ({ value: d.dice, type: d.damage_type }));
  const healEntries = mstats.heal.length
    ? mstats.heal
    : (spell.is_healing && spell.heal_dice ? [spell.heal_dice] : []);

  // Meta-элементы (только релевантные)
  const meta: Array<[string, string]> = [];
  const recovery = recoveryPreview(spell);
  if (recovery) meta.push(['⟳', recovery]);
  if (spell.range) meta.push(['range', spell.range]);
  if (spell.area) meta.push(['⊙', spell.area]);
  if (spell.duration) meta.push(['⏱', spell.duration]);
  if (spell.ritual) meta.push(['📖', 'Ритуал']);
  if (components.length) meta.push(['✦', components.join(', ')]);

  // Плашка стоимости: тип действия (по времени сотворения) + слот заклинания
  // + явно выбранные ресурсы (можно несколько одновременно).
  const ct = (spell.casting_time || '').toLowerCase();
  const costs: Array<{ iconSrc: string; label: string }> = [];
  const builtin = (icon: string, label: string) => costs.push({ iconSrc: `/icons/resources/${icon}.png`, label });
  if (ct.includes('бонус')) {
    builtin('bonus_action', spell.casting_time!);
  } else if (ct.includes('реакц')) {
    builtin('reaction', spell.casting_time!);
  } else if (ct.includes('ритуал') && !spell.casting_time?.trim()) {
    builtin('ritual', 'Ритуал');
  } else if (spell.casting_time) {
    builtin('action', spell.casting_time);
  }
  if (spell.ritual) {
    builtin('ritual', 'Ритуал');
  }
  if (spell.level > 0) {
    builtin('spell_slot', `Слот ${spell.level} круга`);
  }
  // Явно выбранные ресурсы (Ki, очки чародейства и т.п.)
  for (const id of spell.resources || []) {
    costs.push({ iconSrc: resourceCostIcon(spellResourceOptions, id), label: resourceLabel(spellResourceOptions, id) });
  }

  const hasStats = dmgEntries.length > 0 || healEntries.length > 0 || !!mstats.damageOnSaveSuccess?.length;

  return (
    <div
      className={`sp-tip sp-spelltip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <style>{SPELL_CARD_CSS}</style>
      <ReviewStatusCorner entity={spell} entityType="spell" />

      {spell.image_url && spell.image_url.trim() !== '' && (
        <img
          className="sp-bigicon"
          src={spell.image_url}
          alt={spell.name}
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/default_image.png';
          }}
        />
      )}

      <h3>{spell.name || 'Название заклинания'}</h3>
      <div className="sp-subtype"><OriginalName nameEn={spell.name_en} suffix={subtype || 'Заговор'} /></div>

      {hasStats && (
        <div className="sp-stats">
          {dmgEntries.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Урон:</span>
              <span className="sp-dmgval">
                {dmgEntries.map((d, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="sp-dmgsep">+</span>}
                    <span className="sp-dmgitem" style={{ color: getDamageColorOnDark(d.type) }}>
                      {fmt(d.value)}
                      <img className="sp-dmgicon" src={getDamageIconPath(d.type)} alt="" />
                      {getDamageLabel(d.type).toLowerCase()}
                    </span>
                  </React.Fragment>
                ))}
              </span>
            </div>
          )}
          <SaveDamagePreview stats={mstats} />
          {healEntries.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Лечение:</span>
              <span className="sp-dmgval">
                <span className="sp-dmgitem" style={{ color: getDamageColor('healing') }}>
                  {fmt(healEntries.join(' + '))}
                  <img className="sp-dmgicon" src={getDamageIconPath('healing')} alt="" />
                  лечение
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="sp-desc">
        <FormattedText onDark text={spell.description || 'Описание заклинания'} emptyText="Описание заклинания" />
      </div>

      {spell.upcast_description && (
        <div className="sp-upcast">
          <span className="sp-uplbl">{spell.level === 0 ? 'Усиление заговора. ' : 'Повышение уровня. '}</span>
          <FormattedText onDark text={spell.upcast_description} emptyText="" />
        </div>
      )}

      {showDetailedPreview && spell.detailed_description && <div className="sp-upcast"><FormattedText onDark text={spell.detailed_description} emptyText="" /></div>}

      {spell.save_outcome && <div className="sp-saveline">{spell.save_outcome}</div>}

      {!hideAvailability && spell.classes && spell.classes.length > 0 && (
        <div className="sp-classes">
          <b>Классы:</b>{' '}
          {spell.classes
            .map((c) => SPELL_CLASS_LABEL[c] || c)
            .join(', ')}
        </div>
      )}

      {(meta.length > 0 || showAttack || mstats.save) && (
        <div className="sp-meta">
          <RollPreviewMeta stats={mstats} attackBonus={spellcasting?.attack} spellcasting={spellcasting} />
          {meta.map(([icon, label], i) => (
            <span key={i}>
              <UiIcon symbol={icon} />
              {label}
            </span>
          ))}
        </div>
      )}

      {costs.length > 0 ? (
        <div className="sp-costbar">
          {costs.map((c, i) => (
            <span className="sp-cost" key={i}>
              <img
                className="sp-costicon"
                src={c.iconSrc}
                alt=""
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
              {c.label}
            </span>
          ))}
        </div>
      ) : (
        <div className="sp-spacer" />
      )}
    </div>
  );
};

export default SpellPreview;
