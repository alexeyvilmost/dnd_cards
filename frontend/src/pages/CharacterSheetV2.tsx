import { useState, type ReactNode } from 'react';
import { Dices } from 'lucide-react';
import type { AssembledCharacter } from '../character/assemble';
import type { CharacterRuleState } from '../character/rules/types';
import type { CharacterDraft, ForgeCharacter } from '../character/types';
import { ABILITY_KEYS, ABILITY_LABEL_RU } from '../character/types';
import type { CharacterEventRow } from '../character/api';
import type { CharacterContext, EngineEvent, RuntimeState, ValueBreakdown } from '../mvp/contracts';
import { breakdownValue } from '../engine/breakdown';
import { abilityOfSkill } from '../character/rules/foundation';
import { getSkillGrantSource, grantReason } from '../character/rules/resolveCharacterRules';
import { SKILLS, labelOf } from '../mechanics/registries';
import { getSpellLevelLabel, type Card, type Spell } from '../types';
import ForgeAbilityLine from '../components/forge/ForgeAbilityLine';
import SpellPreview from '../components/SpellPreview';
import ValueBreakdownTip from '../components/ValueBreakdownTip';
import EventJournal from '../components/EventJournal';
import SheetActionsPanel from '../components/SheetActionsPanel';
import SheetRuntimePanel from '../components/SheetRuntimePanel';
import SheetHpPanel from '../components/SheetHpPanel';
import SheetEquipmentPanel from '../components/SheetEquipmentPanel';
import './CharacterSheetV2.css';

const fmtMod = (n: number) => (n >= 0 ? `+${n}` : String(n));
const abbr3 = (label: string) => label.slice(0, 3).toUpperCase();
const originLabel = (kind: string) => {
  switch (kind) {
    case 'race': return 'Вид';
    case 'class': return 'Класс';
    case 'feat': return 'Черта';
    case 'background': return 'Предыстория';
    default: return 'Способность';
  }
};

interface Props {
  character: ForgeCharacter;
  assembled: AssembledCharacter;
  ruleState: CharacterRuleState;
  draft: CharacterDraft;
  sheetCtx: CharacterContext | null;
  runtimeState: RuntimeState | null;
  passives: Record<string, unknown>[];
  equipCards: Map<string, Card>;
  acBreakdown: ValueBreakdown | null;
  maxHpBreakdown: ValueBreakdown | null;
  initBreakdown: ValueBreakdown | null;
  speedBreakdown: ValueBreakdown | null;
  spellsByLevel: [number, Spell[]][];
  journal: CharacterEventRow[];
  journalLoading: boolean;
  rollingInit: boolean;
  lineageName: string | null;
  onUpdated: (c: ForgeCharacter) => void;
  onEvents: (events: EngineEvent[]) => void;
  onRollInitiative: () => void;
}

function Card({ title, wide, hook, children }: { title: string; wide?: boolean; hook?: boolean; children?: ReactNode }) {
  return (
    <section className={`cs-card${wide ? ' cs-card--wide' : ''}${hook ? ' cs-card--hook' : ''}`}>
      <div className="cs-card-h">
        <span>{title}</span>
        {hook && <span className="cs-soon">скоро</span>}
      </div>
      {children}
    </section>
  );
}

const CharacterSheetV2 = ({
  character, assembled, ruleState, draft, sheetCtx, runtimeState, passives, equipCards,
  acBreakdown, maxHpBreakdown, initBreakdown, speedBreakdown, spellsByLevel,
  journal, journalLoading, rollingInit, lineageName, onUpdated, onEvents, onRollInitiative,
}: Props) => {
  const [hoveredSpell, setHoveredSpell] = useState<Spell | null>(null);
  const [spellMouse, setSpellMouse] = useState({ x: 0, y: 0 });

  const scores = draft.abilities;
  const pb = ruleState.proficiencyBonus;
  const saves = ruleState.proficiencies.savingThrows;
  const skills = ruleState.proficiencies.skills;
  const maxHP = maxHpBreakdown?.value ?? ruleState.maxHP;
  const currentHP = character.current_hp ?? maxHP;
  const tempHP = runtimeState?.hp.temp ?? 0;
  const ac = acBreakdown?.value ?? ruleState.armorClass;
  const initiative = initBreakdown?.value ?? ruleState.initiativeBonus;
  const speed = speedBreakdown?.value ?? ruleState.speed;
  const spellcasting = ruleState.spellcasting;
  const hpPct = maxHP > 0 ? Math.max(0, Math.min(100, (currentHP / maxHP) * 100)) : 0;

  const subLine = [
    assembled.race?.name, lineageName,
    assembled.klass ? `${assembled.klass.name} ${draft.level}` : null,
    assembled.background?.name,
  ].filter(Boolean).join(' · ');

  const pill = (label: string, value: ReactNode, bd?: ValueBreakdown | null) => (
    <div className="cs-pill">
      <span className="cs-pill-l">{label}</span>
      {bd ? (
        <ValueBreakdownTip breakdown={bd} label={label}><span className="cs-pill-v">{value}</span></ValueBreakdownTip>
      ) : (
        <span className="cs-pill-v">{value}</span>
      )}
    </div>
  );

  return (
    <div className="csheet">
      {/* ── Верхняя лента: личность + жизненные показатели ── */}
      <div className="csheet-top">
        <div className="cs-ident">
          <div className="cs-portrait">
            {character.avatar_url
              ? <img src={character.avatar_url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              : <span>{(character.name || '?').slice(0, 1)}</span>}
          </div>
          <div className="cs-ident-txt">
            <div className="cs-name">{character.name || 'Без имени'}</div>
            <div className="cs-sub">{subLine || '—'}</div>
          </div>
        </div>

        <div className="cs-vitals">
          <div className="cs-ac">
            <ValueBreakdownTip breakdown={acBreakdown ?? { value: ac, parts: [] }} label="Класс доспеха">
              <span className="cs-ac-v">{ac}</span>
            </ValueBreakdownTip>
            <span className="cs-ac-l">КД</span>
          </div>
          <div className="cs-hp">
            <div className="cs-hp-top">
              <span className="cs-hp-cur">{currentHP}</span>
              <span className="cs-hp-max">/ {maxHP}</span>
              {tempHP > 0 && <span className="cs-hp-tmp">+{tempHP}</span>}
              <span className="cs-hp-l">хиты</span>
            </div>
            <div className="cs-hp-bar"><i style={{ width: `${hpPct}%` }} /></div>
          </div>
          {pill('Иниц', fmtMod(initiative), initBreakdown)}
          {pill('Скор', `${speed}`, speedBreakdown)}
          {pill('БМ', fmtMod(pb))}
          {pill('Владение', `+${pb}`)}
          {spellcasting && pill('Заклин.', `СЛ ${spellcasting.saveDC} · ${fmtMod(spellcasting.attack)}`)}
        </div>
      </div>

      {/* ── Три колонки ── */}
      <div className="csheet-cols">

        {/* ЛЕВАЯ: характеристики, чувства, состояния */}
        <div className="csheet-col">
          <Card title="Характеристики">
            <div className="cs-abils">
              {ABILITY_KEYS.map((k) => {
                const score = scores[k] ?? 10;
                const mod = ruleState.abilityMods[k];
                const proficient = saves.includes(k);
                const saveBonus = ruleState.savingThrowBonuses[k];
                const saveBd = sheetCtx && runtimeState ? breakdownValue(`save:${k}`, sheetCtx, runtimeState, passives) : null;
                return (
                  <div key={k} className="cs-abil">
                    <div className="cs-abil-id">
                      <span className="cs-abil-ab">{abbr3(ABILITY_LABEL_RU[k])}</span>
                      <span className="cs-abil-sc">{score}</span>
                    </div>
                    <div className="cs-abil-mod">{fmtMod(mod)}</div>
                    <div className={`cs-abil-save${proficient ? ' on' : ''}`} title={`Спасбросок ${ABILITY_LABEL_RU[k]}`}>
                      <i className="cs-dot" />
                      {saveBd ? (
                        <ValueBreakdownTip breakdown={saveBd} label={`Спасбросок ${ABILITY_LABEL_RU[k]}`}>
                          <span>спас {fmtMod(saveBonus)}</span>
                        </ValueBreakdownTip>
                      ) : <span>спас {fmtMod(saveBonus)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Чувства">
            <div className="cs-kv"><span>Пассивное восприятие</span><b>{ruleState.passivePerception}</b></div>
            <div className="cs-kv cs-muted"><span>Тёмное зрение</span><b>—</b></div>
          </Card>

          <Card title="Состояния" hook>
            <p className="cs-hook-note">Активные состояния и их эффекты появятся здесь.</p>
          </Card>
        </div>

        {/* ЦЕНТР: навыки, владения, черты/способности */}
        <div className="csheet-col">
          <Card title="Навыки">
            <ul className="cs-skills">
              {SKILLS.map((skill) => {
                const proficient = skills.includes(skill.id);
                const expert = ruleState.expertise.skills.includes(skill.id);
                const bonus = ruleState.skillBonuses[skill.id];
                const ability = abilityOfSkill(skill.id);
                const skillBd = sheetCtx && runtimeState ? breakdownValue(`skill:${skill.id}`, sheetCtx, runtimeState, passives) : null;
                const grant = getSkillGrantSource(ruleState, skill.id);
                const tip = [
                  `${abbr3(ABILITY_LABEL_RU[ability])} ${fmtMod(ruleState.abilityMods[ability])}`,
                  proficient ? `влад ${fmtMod(pb)}${grant ? ` (${grantReason(grant)})` : ''}` : null,
                  expert ? `эксп ${fmtMod(pb)}` : null,
                ].filter(Boolean).join(' + ');
                return (
                  <li key={skill.id} className={proficient ? 'on' : ''} title={`${fmtMod(bonus)} = ${tip}`}>
                    <i className="cs-dot" />
                    <span className="cs-skill-nm">{skill.label}{expert ? ' ⁑' : ''}</span>
                    <span className="cs-skill-ab">{abbr3(ABILITY_LABEL_RU[ability])}</span>
                    {skillBd ? (
                      <ValueBreakdownTip breakdown={skillBd} label={skill.label}><span className="cs-skill-v">{fmtMod(bonus)}</span></ValueBreakdownTip>
                    ) : <span className="cs-skill-v">{fmtMod(bonus)}</span>}
                  </li>
                );
              })}
            </ul>
          </Card>

          {(ruleState.proficiencies.tools.length > 0 || ruleState.proficiencies.languages.length > 0) && (
            <Card title="Владения и языки">
              {ruleState.proficiencies.tools.length > 0 && (
                <div className="cs-kv"><span>Инструменты</span><b>{ruleState.proficiencies.tools.map((t) => labelOf([], t) || t).join(', ')}</b></div>
              )}
              {ruleState.proficiencies.languages.length > 0 && (
                <div className="cs-kv"><span>Языки</span><b>{ruleState.proficiencies.languages.join(', ')}</b></div>
              )}
            </Card>
          )}

          <Card title="Черты и способности">
            {assembled.feats.length > 0 && (
              <div className="cs-tags">
                {assembled.feats.map((f) => <span key={f.id} className="cs-tag">{f.name}</span>)}
              </div>
            )}
            <div className="cs-lines">
              {assembled.effects.map(({ effect, origin }) => (
                <ForgeAbilityLine key={effect.id} name={effect.name} imageUrl={effect.image_url}
                  sourceLabel={`${originLabel(origin.kind)} · ${origin.name}`} effect={effect} />
              ))}
              {assembled.actions.map(({ action, origin }) => (
                <ForgeAbilityLine key={action.id} name={action.name} imageUrl={action.image_url}
                  sourceLabel={`${originLabel(origin.kind)} · ${origin.name}`} action={action} />
              ))}
            </div>
            {assembled.feats.length === 0 && assembled.effects.length === 0 && assembled.actions.length === 0 && (
              <p className="cs-hook-note">Нет привязанных способностей.</p>
            )}
          </Card>

          <Card title="Заметки" hook>
            <p className="cs-hook-note">Свободные заметки игрока — скоро.</p>
          </Card>
        </div>

        {/* ПРАВАЯ: действия, ресурсы/ход, хиты, заклинания, снаряжение, журнал */}
        <div className="csheet-col csheet-col--ctrl">
          <SheetActionsPanel character={character} assembled={assembled} ruleState={ruleState}
            equipCards={equipCards} onUpdated={onUpdated} onEvents={onEvents} />

          <SheetRuntimePanel character={character} assembled={assembled} ruleState={ruleState}
            onUpdated={onUpdated} onEvents={onEvents} />

          <SheetHpPanel character={character} maxHp={maxHP} maxHpBreakdown={maxHpBreakdown}
            onUpdated={onUpdated} onEvents={onEvents} />

          {assembled.spells.length > 0 && (
            <Card title="Заклинания">
              {spellsByLevel.map(([level, list]) => (
                <div key={level} className="cs-spell-grp">
                  <div className="cs-spell-lvl">{getSpellLevelLabel(level)}</div>
                  <div className="cs-spell-grid">
                    {list.map((spell) => (
                      <button key={spell.id} type="button" className="cs-spell"
                        title={spell.name}
                        onMouseEnter={(e) => { setHoveredSpell(spell); setSpellMouse({ x: e.clientX, y: e.clientY }); }}
                        onMouseMove={(e) => setSpellMouse({ x: e.clientX, y: e.clientY })}
                        onMouseLeave={() => setHoveredSpell(null)}>
                        {spell.image_url
                          ? <img src={spell.image_url} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/default_image.png'; }} />
                          : <span className="cs-spell-fb">{spell.name.slice(0, 1)}</span>}
                        <span className="cs-spell-badge">{level === 0 ? 'З' : level}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </Card>
          )}

          <SheetEquipmentPanel character={character} ruleState={ruleState} onUpdated={onUpdated} />

          <section className="cs-card cs-card--journal">
            <div className="cs-card-h">
              <span>Журнал</span>
              <button type="button" className="cs-mini-btn" onClick={onRollInitiative} disabled={rollingInit}
                title="Бросок инициативы (к20 + бонус)">
                <Dices size={13} />{rollingInit ? '…' : 'Иниц'}
              </button>
            </div>
            {journalLoading ? <p className="cs-hook-note">Загрузка журнала…</p> : <EventJournal rows={journal} />}
          </section>
        </div>
      </div>

      {ruleState.conflicts.length > 0 && (
        <div className="cs-conflicts">
          {ruleState.conflicts.map((c, i) => <span key={i}>⚠ {c.message}</span>)}
        </div>
      )}

      {hoveredSpell && (
        <div className="cs-spell-pop" style={{
          left: Math.min(spellMouse.x + 16, window.innerWidth - 360),
          top: Math.min(Math.max(spellMouse.y - 40, 10), window.innerHeight - 20),
          transform: spellMouse.y > window.innerHeight / 2 ? 'translateY(-100%)' : 'translateY(0)',
        }}>
          <SpellPreview spell={hoveredSpell} disableHover />
        </div>
      )}
    </div>
  );
};

export default CharacterSheetV2;
