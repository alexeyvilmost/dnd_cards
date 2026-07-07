import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { X, Edit, Trash2 } from 'lucide-react';
import type { Concept } from '../types';
import { FormattedText } from '../utils/formattedText';
import ConceptPreview from './ConceptPreview';

interface ConceptDetailModalProps {
  concept: Concept | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete: (conceptId: string) => void;
}

const ConceptDetailModal: React.FC<ConceptDetailModalProps> = ({ concept, isOpen, onClose, onDelete }) => {
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  if (!isOpen || !concept) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-2xl font-bold text-gray-900">{concept.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex justify-center pt-4">
              <ConceptPreview concept={concept} disableHover />
            </div>
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">ID понятия</h3>
                <p className="text-gray-900 font-mono">{concept.concept_id}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-1">Описание</h3>
                <p className="text-gray-900 whitespace-pre-wrap">
                  <FormattedText text={concept.description || ''} emptyText="—" />
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mt-6 pt-6 border-t border-gray-200">
            <Link
              to={`/concept-creator?edit=${concept.concept_id}`}
              className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded flex items-center space-x-2"
            >
              <Edit size={18} />
              <span>Редактировать</span>
            </Link>
            <button
              onClick={() => onDelete(concept.concept_id)}
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

export default ConceptDetailModal;
