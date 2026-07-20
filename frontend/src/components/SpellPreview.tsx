import React from 'react';
import { Link } from 'react-router-dom';
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
import { parseMechanicsStats, abilityFullRu } from '../engine/describeMechanics';
import OriginalName from './OriginalName';

// Класс → русская подпись
const SPELL_CLASS_LABEL: Record<string, string> = Object.fromEntries(
  SPELL_CLASS_OPTIONS.map((c) => [c.value, c.label])
);

interface SpellPreviewProps {
  spell: Spell;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
  /** Контекст заклинателя (лист персонажа): обогащает превью СЛ спасброска и бонусом атаки. */
  spellcasting?: { saveDC?: number; attack?: number };
}

const fmtBonus = (n: number) => (n >= 0 ? `+${n}` : String(n));

const schoolLabel = (school?: string | null) =>
  SPELL_SCHOOL_OPTIONS.find((s) => s.value === school)?.label || school || '';

// "2d8" → "2к8" (для русского BG3-тултипа, как в design_preview)
const diceRu = (dice: string) => dice.replace(/(\d)[dд](\d)/gi, '$1к$2');

const SpellPreview: React.FC<SpellPreviewProps> = ({
  spell,
  className = '',
  disableHover = false,
  onClick,
  spellcasting,
}) => {
  const spellResourceOptions = useResourceOptions();

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
  const showSave = mstats.save;
  const saveAbilityText = abilityFullRu(mstats.saveAbility);
  const dmgEntries = mstats.damage.length
    ? mstats.damage
    : (spell.damage || []).map((d) => ({ value: d.dice, type: d.damage_type }));
  const healEntries = mstats.heal.length
    ? mstats.heal
    : (spell.is_healing && spell.heal_dice ? [spell.heal_dice] : []);

  // Meta-элементы (только релевантные)
  const meta: Array<[string, string]> = [];
  if (spell.range) meta.push(['🎯', spell.range]);
  if (spell.area) meta.push(['⊙', spell.area]);
  if (spell.duration) meta.push(['⏱', spell.duration]);
  if (spell.concentration) meta.push(['◈', 'Концентрация']);
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

  const hasStats = showAttack || showSave || dmgEntries.length > 0 || healEntries.length > 0;

  return (
    <div
      className={`sp-tip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <style>{SPELL_CARD_CSS}</style>

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

      {spell.id && (
        <Link className="sp-pagelink" to={`/spell/${spell.id}`} onClick={(e) => e.stopPropagation()}>
          Открыть страницу ↗
        </Link>
      )}

      {hasStats && (
        <div className="sp-stats">
          {showAttack && (
            <div className="sp-srow">
              <span className="sp-lbl">Атака:</span>
              <div className="sp-die">к20</div>
              {spellcasting?.attack != null && <span className="sp-bonus">{fmtBonus(spellcasting.attack)}</span>}
            </div>
          )}
          {showSave && (
            <div className="sp-srow">
              <span className="sp-lbl">Спасбросок:</span>
              <span className="sp-bonus">
                {saveAbilityText || 'спасбросок'}
                {spellcasting?.saveDC != null ? ` (СЛ ${spellcasting.saveDC})` : ''}
              </span>
            </div>
          )}
          {dmgEntries.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Урон:</span>
              <span className="sp-dmgval">
                {dmgEntries.map((d, i) => (
                  <React.Fragment key={i}>
                    {i > 0 && <span className="sp-dmgsep">+</span>}
                    <span className="sp-dmgitem" style={{ color: getDamageColorOnDark(d.type) }}>
                      {diceRu(d.value)}
                      <img className="sp-dmgicon" src={getDamageIconPath(d.type)} alt="" />
                      {getDamageLabel(d.type).toLowerCase()}
                    </span>
                  </React.Fragment>
                ))}
              </span>
            </div>
          )}
          {healEntries.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Лечение:</span>
              <span className="sp-dmgval">
                <span className="sp-dmgitem" style={{ color: getDamageColor('healing') }}>
                  {diceRu(healEntries.join(' + '))}
                  <img className="sp-dmgicon" src={getDamageIconPath('healing')} alt="" />
                  лечение
                </span>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="sp-desc">
        <FormattedText text={spell.description || 'Описание заклинания'} emptyText="Описание заклинания" />
      </div>

      {spell.upcast_description && (
        <div className="sp-upcast">
          <span className="sp-uplbl">{spell.level === 0 ? 'Усиление заговора. ' : 'Повышение уровня. '}</span>
          <FormattedText text={spell.upcast_description} emptyText="" />
        </div>
      )}

      {/* Полное описание намеренно НЕ показываем в превью — оно живёт только
          на вики-странице (/spell/:id), чтобы не пугать новичков объёмом. */}

      {spell.save_outcome && <div className="sp-saveline">{spell.save_outcome}</div>}

      {spell.classes && spell.classes.length > 0 && (
        <div className="sp-classes">
          <b>Классы:</b>{' '}
          {spell.classes
            .map((c) => SPELL_CLASS_LABEL[c] || c)
            .join(', ')}
        </div>
      )}

      {meta.length > 0 && (
        <div className="sp-meta">
          {meta.map(([icon, label], i) => (
            <span key={i}>
              <i>{icon}</i>
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
