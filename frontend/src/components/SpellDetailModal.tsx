import { Link } from 'react-router-dom';
import { Edit, Trash2, Copy } from 'lucide-react';
import type { Spell } from '../types';
import {
  SPELL_SCHOOL_OPTIONS,
  SPELL_CLASS_OPTIONS,
  getSpellLevelLabel,
} from '../types';
import { spellsApi } from '../api/client';
import { parseMechanicsStats, abilityFullRu } from '../engine/describeMechanics';
import { FormattedText } from '../utils/formattedText';
import SpellPreview from './SpellPreview';
import EntityImageEditor from './EntityImageEditor';
import { EntityDetailShell, EdmField, EdmFields, EdmDesc, EdmBlock, EdmTag } from './EntityDetailShell';

interface SpellDetailModalProps {
  spell: Spell | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (spellId: string) => void;
  /** Заклинание обновлено (напр. сменили изображение) — для обновления списка. */
  onUpdated?: (spell: Spell) => void;
}

const labelFrom = (
  opts: ReadonlyArray<{ value: string; label: string }>,
  value?: string | null,
) => opts.find((o) => o.value === value)?.label || value || '';

// Школа → тип энергии (цвет иконки), как в scripts/content/gen-spell-icons.mjs.
const SPELL_SCHOOL_ELEMENT: Record<string, string> = {
  abjuration: 'cold',
  conjuration: 'force',
  divination: 'radiant',
  enchantment: 'psychic',
  evocation: 'force',
  illusion: 'psychic',
  necromancy: 'necrotic',
  transmutation: '',
};

// Стихия иконки: по типу урона → лечение → школа (совпадает с батч-генерацией).
const spellElement = (spell: Spell): string => {
  const dt = spell.damage?.[0]?.damage_type;
  if (dt) return dt;
  if (spell.is_healing) return 'healing';
  return SPELL_SCHOOL_ELEMENT[spell.school ?? ''] ?? '';
};

const SPELL_ICON_EXTRA =
  'Thin elegant strokes of energy. The symbol occupies about two-thirds of the frame, centered, with clear margins on all sides.';

const SpellDetailModal: React.FC<SpellDetailModalProps> = ({
  spell,
  isOpen,
  onClose,
  onDelete,
  onUpdated,
}) => {
  if (!isOpen || !spell) return null;

  // Атака/спасбросок — из механики (легаси-флаги удалены).
  const mstats = parseMechanicsStats((spell as { mechanics?: Record<string, unknown> | null }).mechanics);

  const components = [
    spell.component_verbal && 'Вербальный',
    spell.component_somatic && 'Соматический',
    spell.component_material && 'Материальный',
  ].filter(Boolean) as string[];
  const componentsText = (components.length ? components.join(', ') : '—')
    + (spell.component_material && spell.material_text ? ` (${spell.material_text})` : '');

  const hasTags = mstats.attack || mstats.save || spell.concentration || spell.ritual || spell.is_healing;
  const classesText = Boolean(spell.classes?.length || spell.subclasses?.length)
    ? (spell.classes || []).map((c) => labelFrom(SPELL_CLASS_OPTIONS, c)).join(', ')
      + (spell.subclasses?.length ? ` · ${spell.subclasses.join(', ')}` : '')
    : null;

  return (
    <EntityDetailShell
      isOpen={isOpen}
      onClose={onClose}
      title={spell.name}
      titleEn={spell.name_en}
      preview={(
        <EntityImageEditor
          entityId={spell.id}
          initialUrl={spell.image_url || ''}
          persist={async (id, url) => (await spellsApi.updateSpell(id, { image_url: url })).image_url || url}
          generateReq={{ style: 'spell_icon', subject: spell.name, element: spellElement(spell), extra: SPELL_ICON_EXTRA, quality: 'medium' }}
          renderPreview={(url) => <SpellPreview spell={{ ...spell, image_url: url }} disableHover />}
          onUpdated={(url) => onUpdated?.({ ...spell, image_url: url })}
        />
      )}
      actions={(
        <>
          <Link to={`/spell-creator?edit=${spell.id}`} className="edm-btn">
            <Edit size={18} /><span>Редактировать</span>
          </Link>
          <Link to={`/spell-creator?template_id=${spell.id}`} className="edm-btn">
            <Copy size={18} /><span>Использовать как шаблон</span>
          </Link>
          <button type="button" onClick={() => onDelete(spell.id)} className="edm-btn edm-btn--danger">
            <Trash2 size={18} /><span>Удалить</span>
          </button>
        </>
      )}
    >
      <EdmDesc><FormattedText text={spell.description || ''} emptyText="—" /></EdmDesc>

      {hasTags && (
        <div className="edm-tags">
          {mstats.attack && <EdmTag>Бросок атаки</EdmTag>}
          {mstats.save && <EdmTag>Спасбросок</EdmTag>}
          {spell.concentration && <EdmTag>Концентрация</EdmTag>}
          {spell.ritual && <EdmTag>Ритуал</EdmTag>}
          {spell.is_healing && <EdmTag>Лечение</EdmTag>}
        </div>
      )}

      <EdmFields>
        <EdmField label="Уровень">{getSpellLevelLabel(spell.level)}</EdmField>
        <EdmField label="Школа">{labelFrom(SPELL_SCHOOL_OPTIONS, spell.school) || '—'}</EdmField>
        <EdmField label="Время сотворения">{spell.casting_time || '—'}</EdmField>
        <EdmField label="Дистанция">{spell.range || '—'}</EdmField>
        <EdmField label="Длительность">{spell.duration || '—'}</EdmField>
        <EdmField label="Область">{spell.area || '—'}</EdmField>
        <EdmField label="Компоненты">{componentsText}</EdmField>
        <EdmField label="Тип спасброска" hidden={!(mstats.save && mstats.saveAbility)}>{abilityFullRu(mstats.saveAbility)}</EdmField>
        <EdmField label="Урон" hidden={!(spell.damage && spell.damage.length > 0)}>
          {(spell.damage || []).map((d) => `${d.dice} ${d.damage_type}`).join(' + ')}
        </EdmField>
        <EdmField label="Классы" hidden={!classesText}>{classesText}</EdmField>
        <EdmField label="ID заклинания" hidden={!spell.card_number} mono>{spell.card_number}</EdmField>
      </EdmFields>

      {spell.upcast_description && (
        <EdmBlock label="Повышение уровня"><FormattedText text={spell.upcast_description} emptyText="" /></EdmBlock>
      )}
    </EntityDetailShell>
  );
};

export default SpellDetailModal;
