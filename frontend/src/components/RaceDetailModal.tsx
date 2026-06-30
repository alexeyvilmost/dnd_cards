import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Edit, Trash2 } from 'lucide-react';
import type { Race } from '../types';
import RacePreview from './RacePreview';

interface RaceDetailModalProps {
  race: Race | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (id: string) => void;
}

const RaceDetailModal: React.FC<RaceDetailModalProps> = ({ race, isOpen, onClose, onDelete }) => {
  useEffect(() => {
    if (!isOpen) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [isOpen, onClose]);

  if (!isOpen || !race) return null;
  const r = race;
  const speed = [r.speed ? `${r.speed} фт` : '', r.extra_speeds || ''].filter(Boolean).join(', ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-gray-900">{r.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><X size={24} /></button>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex justify-center pt-6">
              <RacePreview race={r} disableHover={true} />
            </div>
            <div className="space-y-4">
              {r.creature_type && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Тип существа</h3><p className="text-gray-900">{r.creature_type}</p></div>
              )}
              {r.size && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Размер</h3><p className="text-gray-900">{r.size}</p></div>
              )}
              {speed && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Скорость</h3><p className="text-gray-900">{speed}</p></div>
              )}
              {r.darkvision != null && r.darkvision > 0 && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Тёмное зрение</h3><p className="text-gray-900">{r.darkvision} фт</p></div>
              )}
              {r.traits && r.traits.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Видовые особенности</h3>
                  <ul className="space-y-1">
                    {r.traits.map((t, i) => (
                      <li key={i} className="text-gray-900"><span className="font-semibold">{t.name}.</span> {t.description}</li>
                    ))}
                  </ul>
                </div>
              )}
              {r.lineages && r.lineages.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-1">Происхождения / подвиды</h3>
                  <ul className="space-y-1">
                    {r.lineages.map((l, i) => (
                      <li key={i} className="text-gray-900"><span className="font-semibold">{l.name}.</span> {l.description}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div><h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3><p className="text-gray-900 whitespace-pre-wrap">{r.description}</p></div>
              {r.detailed_description && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">Дополнительное описание</h3><p className="text-gray-900 whitespace-pre-wrap">{r.detailed_description}</p></div>
              )}
              {r.card_number && (
                <div><h3 className="text-sm font-medium text-gray-700 mb-1">ID вида</h3><p className="text-gray-900 font-mono">{r.card_number}</p></div>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <Link to={`/race-creator?edit=${r.id}`} className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Edit size={18} /><span>Редактировать</span>
            </Link>
            <button onClick={() => onDelete(r.id)} className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded flex items-center space-x-2">
              <Trash2 size={18} /><span>Удалить</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RaceDetailModal;
