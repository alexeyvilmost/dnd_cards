import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Edit, Trash2 } from 'lucide-react';
import type { CharacterClass } from '../types';
import ClassPreview from './ClassPreview';

interface ClassDetailModalProps {
  characterClass: CharacterClass | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const ClassDetailModal = ({ characterClass, isOpen, onClose, onDelete }: ClassDetailModalProps) => {
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  if (!isOpen || !characterClass) return null;
  const cl = characterClass;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-gray-900">{cl.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex justify-center pt-6">
              <ClassPreview characterClass={cl} disableHover />
            </div>
            <div className="space-y-4">
              {cl.hit_die && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Кость хитов</h3><p className="text-gray-900">{cl.hit_die}</p></div>
              )}
              {cl.primary_abilities?.length ? (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Основные характеристики</h3><p className="text-gray-900">{cl.primary_abilities.join(', ')}</p></div>
              ) : null}
              {cl.saving_throws?.length ? (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Спасброски</h3><p className="text-gray-900">{cl.saving_throws.join(', ')}</p></div>
              ) : null}
              <div><h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3><p className="text-gray-900 whitespace-pre-wrap">{cl.description}</p></div>
              {cl.detailed_description && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Дополнительное описание</h3><p className="text-gray-900 whitespace-pre-wrap">{cl.detailed_description}</p></div>
              )}
              {cl.card_number && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">ID класса</h3><p className="text-gray-900 font-mono">{cl.card_number}</p></div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <Link to={`/class-creator?edit=${cl.id}`} className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Edit size={18} /><span>Редактировать</span>
            </Link>
            <button onClick={() => onDelete(cl.id)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Trash2 size={18} /><span>Удалить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ClassDetailModal;
