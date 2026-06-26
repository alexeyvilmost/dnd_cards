import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Edit, Trash2 } from 'lucide-react';
import type { Spell } from '../types';
import {
  SPELL_SCHOOL_OPTIONS,
  SPELL_CLASS_OPTIONS,
  SPELL_SAVE_TYPE_OPTIONS,
  getSpellLevelLabel,
} from '../types';
import SpellPreview from './SpellPreview';

interface SpellDetailModalProps {
  spell: Spell | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (spellId: string) => void;
}

const labelFrom = (
  opts: ReadonlyArray<{ value: string; label: string }>,
  value?: string | null
) => opts.find((o) => o.value === value)?.label || value || '';

const SpellDetailModal: React.FC<SpellDetailModalProps> = ({
  spell,
  isOpen,
  onClose,
  onDelete,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !spell) return null;

  const components = [
    spell.component_verbal && 'Вербальный',
    spell.component_somatic && 'Соматический',
    spell.component_material && 'Материальный',
  ].filter(Boolean) as string[];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />

      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-gray-900">{spell.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Превью карточки */}
            <div className="flex justify-center pt-6">
              <SpellPreview spell={spell} disableHover={true} />
            </div>

            {/* Детальная информация */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Уровень</h3>
                  <p className="text-gray-900">{getSpellLevelLabel(spell.level)}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Школа</h3>
                  <p className="text-gray-900">{labelFrom(SPELL_SCHOOL_OPTIONS, spell.school) || '—'}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Время сотворения</h3>
                  <p className="text-gray-900">{spell.casting_time || '—'}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Дистанция</h3>
                  <p className="text-gray-900">{spell.range || '—'}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Длительность</h3>
                  <p className="text-gray-900">{spell.duration || '—'}</p>
                </div>
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Область</h3>
                  <p className="text-gray-900">{spell.area || '—'}</p>
                </div>
              </div>

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Компоненты</h3>
                <p className="text-gray-900">
                  {components.length ? components.join(', ') : '—'}
                  {spell.component_material && spell.material_text ? ` (${spell.material_text})` : ''}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {spell.attack_roll && <Tag>Бросок атаки</Tag>}
                {spell.saving_throw && <Tag>Спасбросок</Tag>}
                {spell.concentration && <Tag>Концентрация</Tag>}
                {spell.ritual && <Tag>Ритуал</Tag>}
                {spell.is_healing && <Tag>Лечение</Tag>}
              </div>

              {spell.saving_throw && spell.save_types && spell.save_types.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Тип спасброска</h3>
                  <p className="text-gray-900">
                    {spell.save_types.map((s) => labelFrom(SPELL_SAVE_TYPE_OPTIONS, s)).join(', ')}
                  </p>
                </div>
              )}

              {spell.damage && spell.damage.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Урон</h3>
                  <p className="text-gray-900">
                    {spell.damage.map((d) => `${d.dice} ${d.damage_type}`).join(' + ')}
                  </p>
                </div>
              )}

              {Boolean(spell.classes?.length || spell.subclasses?.length) && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Классы</h3>
                  <p className="text-gray-900">
                    {(spell.classes || []).map((c) => labelFrom(SPELL_CLASS_OPTIONS, c)).join(', ')}
                    {spell.subclasses?.length ? ` · ${spell.subclasses.join(', ')}` : ''}
                  </p>
                </div>
              )}

              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3>
                <p className="text-gray-900 whitespace-pre-wrap">{spell.description}</p>
              </div>

              {spell.upcast_description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Повышение уровня</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{spell.upcast_description}</p>
                </div>
              )}

              {spell.detailed_description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Дополнительное описание</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{spell.detailed_description}</p>
                </div>
              )}

              {spell.card_number && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">ID заклинания</h3>
                  <p className="text-gray-900 font-mono">{spell.card_number}</p>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <Link
              to={`/spell-creator?edit=${spell.id}`}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Edit size={18} />
              <span>Редактировать</span>
            </Link>
            <button
              onClick={() => onDelete(spell.id)}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Trash2 size={18} />
              <span>Удалить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="inline-block bg-indigo-100 text-indigo-800 text-xs font-medium px-2.5 py-1 rounded">
    {children}
  </span>
);

export default SpellDetailModal;
