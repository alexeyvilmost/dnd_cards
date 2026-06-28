import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Edit, Trash2 } from 'lucide-react';
import type { Feat } from '../types';
import { getFeatCategoryLabel, getAbilityLabel } from '../types';
import FeatPreview from './FeatPreview';

interface FeatDetailModalProps {
  feat: Feat | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const FeatDetailModal: React.FC<FeatDetailModalProps> = ({ feat, isOpen, onClose, onDelete }) => {
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  if (!isOpen || !feat) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-gray-900">{feat.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex justify-center pt-6">
              <FeatPreview feat={feat} disableHover={true} />
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Категория</h3>
                <p className="text-gray-900">{getFeatCategoryLabel(feat.category)}</p>
              </div>
              {feat.prerequisite && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Требования</h3>
                  <p className="text-gray-900">{feat.prerequisite}</p>
                </div>
              )}
              {feat.ability_increase && feat.ability_increase.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Повышение характеристики</h3>
                  <p className="text-gray-900">{feat.ability_increase.map(getAbilityLabel).join(', ')} +1</p>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {feat.repeatable && (
                  <span className="inline-block bg-indigo-100 text-indigo-800 text-xs font-medium px-2.5 py-1 rounded">Повторяемая</span>
                )}
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3>
                <p className="text-gray-900 whitespace-pre-wrap">{feat.description}</p>
              </div>
              {feat.detailed_description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Дополнительное описание</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{feat.detailed_description}</p>
                </div>
              )}
              {feat.card_number && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">ID черты</h3>
                  <p className="text-gray-900 font-mono">{feat.card_number}</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <Link to={`/feat-creator?edit=${feat.id}`} className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Edit size={18} /><span>Редактировать</span>
            </Link>
            <button onClick={() => onDelete(feat.id)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Trash2 size={18} /><span>Удалить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FeatDetailModal;
