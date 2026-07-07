import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { spellsApi } from '../api/client';
import type { Spell } from '../types';
import { SPELL_SCHOOL_OPTIONS, SPELL_CLASS_OPTIONS, getSpellLevelLabel } from '../types';
import { getDamageColor, getDamageColorOnDark, getDamageLabel, getDamageIconPath } from '../utils/damageTypes';
import { FormattedText } from '../utils/formattedText';
import { resourceLabel, useResourceOptions } from '../utils/resources';
import { parseMechanicsStats, abilityFullRu } from '../engine/describeMechanics';
import { SPELLPAGE_CSS } from './spellPageStyle';

const SPELL_CLASS_LABEL: Record<string, string> = Object.fromEntries(SPELL_CLASS_OPTIONS.map((c) => [c.value, c.label]));
const schoolLabel = (s?: string | null) => SPELL_SCHOOL_OPTIONS.find((o) => o.value === s)?.label || s || '';
const diceRu = (s: string) => String(s).replace(/(\d)[dд](\d)/gi, '$1к$2');

/** Строка стат-блока: подпись + значение. */
const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="spw-row">
    <span className="spw-row-l">{label}</span>
    <span className="spw-row-v">{children}</span>
  </div>
);

const SpellPage = () => {
  const { id } = useParams<{ id: string }>();
  const resourceOptions = useResourceOptions();
  const [spell, setSpell] = useState<Spell | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true); setError(false);
    spellsApi.getSpell(id)
      .then(setSpell)
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="spellpage"><style>{SPELLPAGE_CSS}</style><div className="spw-center">Загрузка…</div></div>;
  if (error || !spell) return (
    <div className="spellpage"><style>{SPELLPAGE_CSS}</style>
      <div className="spw-center">Заклинание не найдено. <Link className="spw-back" to="/?type=spells">К библиотеке</Link></div>
    </div>
  );

  const subtype = [getSpellLevelLabel(spell.level), schoolLabel(spell.school)].filter(Boolean).join(' · ');

  const components: string[] = [];
  if (spell.component_verbal) components.push('В');
  if (spell.component_somatic) components.push('С');
  if (spell.component_material) components.push('М');

  const mstats = parseMechanicsStats((spell as { mechanics?: Record<string, unknown> | null }).mechanics);
  const saveAbility = abilityFullRu(mstats.saveAbility);
  const dmgEntries = mstats.damage.length
    ? mstats.damage
    : (spell.damage || []).map((d) => ({ value: d.dice, type: d.damage_type }));
  const healEntries = mstats.heal.length
    ? mstats.heal
    : (spell.is_healing && spell.heal_dice ? [spell.heal_dice] : []);

  const classes = (spell.classes || []).map((c) => SPELL_CLASS_LABEL[c] || c);
  const resources = (spell.resources || []).map((r) => resourceLabel(resourceOptions, r));

  return (
    <div className="spellpage">
      <style>{SPELLPAGE_CSS}</style>
      <div className="spw-inner">
        {/* Шапка */}
        <div className="spw-head">
          <Link className="spw-back" to="/?type=spells">← Библиотека заклинаний</Link>
          <h1 className="spw-title">{spell.name}</h1>
          <div className="spw-subtype">{subtype || 'Заговор'}</div>
        </div>

        <div className="spw-cols">
          {/* Центр: компактное описание сверху, полное — ниже */}
          <main className="spw-main">
            <section className="spw-panel">
              <div className="spw-panel-h">Кратко</div>
              <div className="spw-desc">
                <FormattedText text={spell.description || ''} emptyText="Нет описания" />
              </div>
              {spell.upcast_description && (
                <div className="spw-upcast">
                  <span className="spw-upcast-l">{spell.level === 0 ? 'Усиление заговора. ' : 'Повышение уровня. '}</span>
                  <FormattedText text={spell.upcast_description} emptyText="" />
                </div>
              )}
              {spell.save_outcome && <div className="spw-saveline">{spell.save_outcome}</div>}
            </section>

            {spell.detailed_description?.trim() && (
              <section className="spw-panel">
                <div className="spw-panel-h">Полное описание</div>
                <div className="spw-desc spw-desc-full">
                  <FormattedText text={spell.detailed_description} emptyText="" />
                </div>
              </section>
            )}
          </main>

          {/* Правая колонка: изображение + компоненты и урон */}
          <aside className="spw-side">
            {spell.image_url?.trim() && (
              <div className="spw-art">
                <img src={spell.image_url} alt={spell.name} onError={(e) => { (e.target as HTMLImageElement).src = '/default_image.png'; }} />
              </div>
            )}

            <div className="spw-statblock">
              <Row label="Уровень">{getSpellLevelLabel(spell.level)}</Row>
              {spell.school && <Row label="Школа">{schoolLabel(spell.school)}</Row>}
              {spell.casting_time && <Row label="Время">{spell.casting_time}</Row>}
              {spell.range && <Row label="Дистанция">{spell.range}</Row>}
              {spell.area && <Row label="Область">{spell.area}</Row>}
              {spell.duration && <Row label="Длительность">{spell.duration}</Row>}
              {spell.concentration && <Row label="Концентрация">да</Row>}
              {spell.ritual && <Row label="Ритуал">да</Row>}
              <Row label="Компоненты">
                {components.length ? components.join(', ') : '—'}
                {spell.component_material && spell.material_text ? ` (${spell.material_text})` : ''}
              </Row>

              {(mstats.attack || mstats.save || dmgEntries.length > 0 || healEntries.length > 0) && <div className="spw-divider" />}

              {mstats.attack && <Row label="Атака">к20 + бонус атаки заклинателя</Row>}
              {mstats.save && <Row label="Спасбросок">{saveAbility || 'спасбросок'} (СЛ заклинателя)</Row>}
              {dmgEntries.length > 0 && (
                <Row label="Урон">
                  <span className="spw-dmg">
                    {dmgEntries.map((d, i) => (
                      <span key={i} className="spw-dmgitem" style={{ color: getDamageColorOnDark(d.type) }}>
                        {i > 0 && <span className="spw-dmgsep">+</span>}
                        {diceRu(d.value)}
                        <img className="spw-dmgicon" src={getDamageIconPath(d.type)} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                        {getDamageLabel(d.type).toLowerCase()}
                      </span>
                    ))}
                  </span>
                </Row>
              )}
              {healEntries.length > 0 && (
                <Row label="Лечение">
                  <span className="spw-dmgitem" style={{ color: getDamageColor('healing') }}>
                    {diceRu(healEntries.join(' + '))}
                    <img className="spw-dmgicon" src={getDamageIconPath('healing')} alt="" />
                    лечение
                  </span>
                </Row>
              )}

              {(classes.length > 0 || resources.length > 0 || spell.source) && <div className="spw-divider" />}
              {classes.length > 0 && <Row label="Классы">{classes.join(', ')}</Row>}
              {resources.length > 0 && <Row label="Ресурсы">{resources.join(', ')}</Row>}
              {spell.source && <Row label="Источник">{spell.source}</Row>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default SpellPage;
