import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Edit, Trash2 } from 'lucide-react';
import type { Background } from '../types';
import { getAbilityLabel } from '../types';
import BackgroundPreview from './BackgroundPreview';

interface BackgroundDetailModalProps {
  background: Background | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const BackgroundDetailModal: React.FC<BackgroundDetailModalProps> = ({ background, isOpen, onClose, onDelete }) => {
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  if (!isOpen || !background) return null;
  const b = background;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-gray-900">{b.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex justify-center pt-6">
              <BackgroundPreview background={b} disableHover={true} />
            </div>
            <div className="space-y-4">
              {b.ability_scores && b.ability_scores.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Характеристики</h3>
                  <p className="text-gray-900">{b.ability_scores.map(getAbilityLabel).join(', ')}</p>
                </div>
              )}
              {b.origin_feat && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Черта происхождения</h3>
                  <p className="text-gray-900">{b.origin_feat}</p>
                </div>
              )}
              {b.skill_proficiencies && b.skill_proficiencies.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Владение навыками</h3>
                  <p className="text-gray-900">{b.skill_proficiencies.join(', ')}</p>
                </div>
              )}
              {b.tool_proficiency && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Владение инструментами</h3>
                  <p className="text-gray-900">{b.tool_proficiency}</p>
                </div>
              )}
              {b.equipment && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Снаряжение</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{b.equipment}</p>
                </div>
              )}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3>
                <p className="text-gray-900 whitespace-pre-wrap">{b.description}</p>
              </div>
              {b.detailed_description && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Дополнительное описание</h3>
                  <p className="text-gray-900 whitespace-pre-wrap">{b.detailed_description}</p>
                </div>
              )}
              {b.card_number && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">ID предыстории</h3>
                  <p className="text-gray-900 font-mono">{b.card_number}</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <Link to={`/background-creator?edit=${b.id}`} className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Edit size={18} /><span>Редактировать</span>
            </Link>
            <button onClick={() => onDelete(b.id)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Trash2 size={18} /><span>Удалить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BackgroundDetailModal;
