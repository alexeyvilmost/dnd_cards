import React from 'react';
import type { Spell } from '../types';
import {
  SPELL_SCHOOL_OPTIONS,
  SPELL_SAVE_TYPE_OPTIONS,
  SPELL_DAMAGE_TYPE_OPTIONS,
  SPELL_CLASS_OPTIONS,
  getSpellLevelLabel,
} from '../types';

// Класс → русская подпись
const SPELL_CLASS_LABEL: Record<string, string> = Object.fromEntries(
  SPELL_CLASS_OPTIONS.map((c) => [c.value, c.label])
);

interface SpellPreviewProps {
  spell: Spell;
  className?: string;
  disableHover?: boolean;
  onClick?: () => void;
}

const schoolLabel = (school?: string | null) =>
  SPELL_SCHOOL_OPTIONS.find((s) => s.value === school)?.label || school || '';

const saveLabel = (v: string) =>
  SPELL_SAVE_TYPE_OPTIONS.find((s) => s.value === v)?.label || v;

const dmgMeta = (type: string) =>
  SPELL_DAMAGE_TYPE_OPTIONS.find((d) => d.value === type);

// "2d8" → "2к8" (для русского BG3-тултипа, как в design_preview)
const diceRu = (dice: string) => dice.replace(/(\d)[dд](\d)/gi, '$1к$2');

// Рендер текста с поддержкой **жирных** сегментов и переносов строк
const renderFormatted = (text: string): React.ReactNode => {
  return text.split('\n').map((line, li) => (
    <React.Fragment key={li}>
      {li > 0 && <br />}
      {line.split('**').map((seg, si) =>
        si % 2 === 1 ? <b key={si}>{seg}</b> : <React.Fragment key={si}>{seg}</React.Fragment>
      )}
    </React.Fragment>
  ));
};

const SpellPreview: React.FC<SpellPreviewProps> = ({
  spell,
  className = '',
  disableHover = false,
  onClick,
}) => {
  const subtype = [getSpellLevelLabel(spell.level), schoolLabel(spell.school)]
    .filter(Boolean)
    .join(' · ');

  // Компоненты V, S, M → В, С, М
  const components: string[] = [];
  if (spell.component_verbal) components.push('В');
  if (spell.component_somatic) components.push('С');
  if (spell.component_material) components.push('М');

  // Строка спасброска (характеристики)
  const saveAbilities = (spell.save_types || []).map(saveLabel).join(', ');

  // Meta-элементы (только релевантные)
  const meta: Array<[string, string]> = [];
  if (spell.range) meta.push(['🎯', spell.range]);
  if (spell.area) meta.push(['⊙', spell.area]);
  if (spell.duration) meta.push(['⏱', spell.duration]);
  if (spell.concentration) meta.push(['◈', 'Концентрация']);
  if (spell.ritual) meta.push(['📖', 'Ритуал']);
  if (components.length) meta.push(['✦', components.join(', ')]);

  // Плашка стоимости: тип действия (по времени сотворения) + слот заклинания
  const ct = (spell.casting_time || '').toLowerCase();
  const costs: Array<{ shape: 'cir' | 'sq' | 'dia'; color: string; label: string }> = [];
  if (ct.includes('бонус')) {
    costs.push({ shape: 'sq', color: '#d88a4a', label: spell.casting_time! });
  } else if (ct.includes('реакц')) {
    costs.push({ shape: 'dia', color: '#6fb6e8', label: spell.casting_time! });
  } else if (spell.casting_time) {
    costs.push({ shape: 'cir', color: '#d8b24a', label: spell.casting_time });
  }
  if (spell.level > 0) {
    costs.push({ shape: 'sq', color: '#9a7ad8', label: `Слот ${spell.level} круга` });
  }

  const hasStats =
    spell.attack_roll ||
    spell.saving_throw ||
    (spell.damage && spell.damage.length > 0) ||
    (spell.is_healing && spell.heal_dice);

  return (
    <div
      className={`sp-tip ${disableHover ? '' : 'sp-hoverable'} ${className}`}
      onClick={onClick}
      style={onClick ? { cursor: 'pointer' } : undefined}
    >
      <style>{`
        .sp-tip{
          position:relative; width:340px; max-width:100%; border-radius:12px; color:#ece3d4;
          background:linear-gradient(160deg,#2b2520,#191410);
          border:1px solid #8a7320;
          box-shadow:0 12px 40px rgba(0,0,0,.6), inset 0 0 0 1px rgba(201,162,39,.08);
          padding:18px 18px 0; overflow:visible;
          font-family:"Segoe UI",system-ui,-apple-system,sans-serif;
        }
        .sp-tip.sp-hoverable{transition:transform .15s ease, box-shadow .15s ease;}
        .sp-tip.sp-hoverable:hover{transform:translateY(-3px);
          box-shadow:0 16px 48px rgba(0,0,0,.7), 0 0 18px rgba(201,162,39,.25), inset 0 0 0 1px rgba(201,162,39,.12);}
        .sp-tip .sp-bigicon{
          position:absolute; top:-26px; right:-18px; width:104px; height:104px;
          filter:drop-shadow(0 0 18px rgba(201,162,39,.55)); pointer-events:none; object-fit:contain;
        }
        .sp-tip h3{margin:0; font-family:"Georgia",serif; font-size:1.35rem; color:#f3ead4;
          padding-right:80px; line-height:1.15;}
        .sp-tip .sp-subtype{color:#a59886; font-size:.9rem; margin:.15rem 0 .8rem; font-style:italic; padding-right:60px;}
        .sp-tip .sp-stats{display:flex; flex-direction:column; gap:.42rem; margin:.5rem 0 .9rem;}
        .sp-srow{display:flex; align-items:center; gap:.55rem;}
        .sp-srow .sp-lbl{color:#a59886; font-size:.82rem; min-width:96px; flex:0 0 auto;}
        .sp-die{width:30px; height:30px; flex:0 0 auto; border-radius:6px;
          background:radial-gradient(circle at 50% 40%,#3a5f3a,#1d331d); border:1px solid #4f7d3a;
          display:flex; align-items:center; justify-content:center; font-weight:700; color:#cfeac0; font-size:.72rem;}
        .sp-die.sp-save{background:radial-gradient(circle at 50% 40%,#5a4a7a,#2a2140); border-color:#6a5a9a; color:#d8c8f0;}
        .sp-srow .sp-bonus{font-weight:700; font-size:1.02rem; color:#f3ead4;}
        .sp-dmgval{display:inline-flex; align-items:center; gap:.32rem; font-weight:700; font-size:1.02rem; flex-wrap:wrap;}
        .sp-dmgval .sp-ic{font-size:.95rem;}
        .sp-dmgsep{color:#a59886; font-weight:400; margin:0 .15rem;}
        .sp-tip .sp-desc{font-size:.92rem; line-height:1.5; color:#d8cdb9; margin:.2rem 0 .9rem; white-space:pre-wrap;}
        .sp-tip .sp-desc b{color:#f0d98a; font-weight:600;}
        .sp-tip .sp-upcast{font-size:.88rem; line-height:1.45; color:#cdbf9a; margin:0 0 .9rem;}
        .sp-tip .sp-upcast .sp-uplbl{color:#e7cf9a; font-weight:600;}
        .sp-tip .sp-saveline{font-size:.88rem; color:#e7cf9a; margin:0 0 .9rem; font-weight:600;}
        .sp-tip .sp-classes{font-size:.82rem; color:#a59886; margin:0 0 .7rem;}
        .sp-tip .sp-classes b{color:#cdbf9a; font-weight:600;}
        .sp-tip .sp-meta{display:flex; gap:1.1rem; flex-wrap:wrap; padding:.7rem 0;
          border-top:1px solid rgba(58,49,39,.5); color:#a59886; font-size:.84rem;}
        .sp-tip .sp-meta span{display:inline-flex; align-items:center; gap:.35rem;}
        .sp-tip .sp-meta i{opacity:.85; font-style:normal;}
        .sp-tip .sp-costbar{display:flex; gap:.6rem; flex-wrap:wrap; margin:0 -18px; padding:.6rem 18px;
          background:linear-gradient(#221b15,#1a140f); border-top:1px solid #4a3f35; border-radius:0 0 12px 12px;}
        .sp-cost{display:inline-flex; align-items:center; gap:.35rem; font-size:.84rem; color:#ece3d4;}
        .sp-cost .sp-sq{width:11px; height:11px; border-radius:3px;}
        .sp-cost .sp-cir{width:11px; height:11px; border-radius:50%;}
        .sp-cost .sp-dia{width:11px; height:11px; transform:rotate(45deg);}
        .sp-spacer{height:14px;}
      `}</style>

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
      <div className="sp-subtype">{subtype || 'Заговор'}</div>

      {hasStats && (
        <div className="sp-stats">
          {spell.attack_roll && (
            <div className="sp-srow">
              <span className="sp-lbl">Атака:</span>
              <div className="sp-die">к20</div>
            </div>
          )}
          {spell.saving_throw && (
            <div className="sp-srow">
              <span className="sp-lbl">Спасбросок:</span>
              <div className="sp-die sp-save">СБ</div>
              {saveAbilities && <span className="sp-bonus">{saveAbilities}</span>}
            </div>
          )}
          {spell.damage && spell.damage.length > 0 && (
            <div className="sp-srow">
              <span className="sp-lbl">Урон:</span>
              <span className="sp-dmgval">
                {spell.damage.map((d, i) => {
                  const m = dmgMeta(d.damage_type);
                  return (
                    <React.Fragment key={i}>
                      {i > 0 && <span className="sp-dmgsep">+</span>}
                      <span style={{ color: m?.color || '#f3ead4' }}>
                        <span className="sp-ic">{m?.glyph || ''}</span> {diceRu(d.dice)}
                        {m?.label ? ` · ${m.label.toLowerCase()}` : ''}
                      </span>
                    </React.Fragment>
                  );
                })}
              </span>
            </div>
          )}
          {spell.is_healing && spell.heal_dice && (
            <div className="sp-srow">
              <span className="sp-lbl">Лечение:</span>
              <span className="sp-dmgval" style={{ color: '#f0d268' }}>
                <span className="sp-ic">❤</span> {diceRu(spell.heal_dice)}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="sp-desc">{renderFormatted(spell.description || 'Описание заклинания')}</div>

      {spell.upcast_description && (
        <div className="sp-upcast">
          <span className="sp-uplbl">{spell.level === 0 ? 'Усиление заговора. ' : 'Повышение уровня. '}</span>
          {renderFormatted(spell.upcast_description)}
        </div>
      )}

      {spell.detailed_description && (
        <div className="sp-upcast">{renderFormatted(spell.detailed_description)}</div>
      )}

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
              <span className={`sp-${c.shape}`} style={{ background: c.color }} />
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
