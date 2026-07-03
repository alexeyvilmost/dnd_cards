import React from 'react';
import { Trash2, ChevronUp, ChevronDown, Dices } from 'lucide-react';
import {
  INITIATIVE_COLORS,
  getInitiativeColor,
  type InitiativeCharacter,
  type InitiativeColorId,
} from '../../types/initiative';

interface InitiativeCharacterBlockProps {
  character: InitiativeCharacter;
  isActive: boolean;
  onUpdate: (id: string, patch: Partial<InitiativeCharacter>) => void;
  onRemove: (id: string) => void;
  onRollInitiative: (id: string) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const InitiativeCharacterBlock: React.FC<InitiativeCharacterBlockProps> = ({
  character,
  isActive,
  onUpdate,
  onRemove,
  onRollInitiative,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) => {
  const color = getInitiativeColor(character.color);
  const hpPercent = character.maxHp > 0
    ? Math.min(100, Math.round((character.currentHp / character.maxHp) * 100))
    : 0;

  const handleNumberChange = (field: 'ac' | 'initiative' | 'maxHp' | 'currentHp', value: string) => {
    const parsed = value === '' ? 0 : parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    onUpdate(character.id, { [field]: parsed });
  };

  const adjustHp = (delta: number) => {
    const next = Math.max(0, character.currentHp + delta);
    onUpdate(character.id, { currentHp: next });
  };

  return (
    <div
      className={`rounded-lg border bg-white shadow-sm transition-all ${
        isActive ? 'ring-2 ring-blue-500 shadow-md' : 'border-gray-200'
      }`}
      style={{ borderLeftWidth: '6px', borderLeftColor: color.hex }}
    >
      <div className="p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-14 h-14 rounded-lg flex items-center justify-center text-2xl font-bold shadow-inner"
            style={{ backgroundColor: color.hex, color: color.text }}
          >
            {character.initiative}
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <input
              type="text"
              value={character.name}
              onChange={(e) => onUpdate(character.id, { name: e.target.value })}
              placeholder="Имя персонажа"
              className="input-field text-lg font-semibold"
            />

            <div className="flex flex-wrap gap-1.5">
              {INITIATIVE_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  title={c.label}
                  onClick={() => onUpdate(character.id, { color: c.id as InitiativeColorId })}
                  className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    character.color === c.id ? 'border-blue-600 scale-110' : 'border-gray-300'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => onMoveUp(character.id)}
              disabled={!canMoveUp}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Выше в порядке"
            >
              <ChevronUp size={18} />
            </button>
            <button
              type="button"
              onClick={() => onMoveDown(character.id)}
              disabled={!canMoveDown}
              className="p-1 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              title="Ниже в порядке"
            >
              <ChevronDown size={18} />
            </button>
            <button
              type="button"
              onClick={() => onRemove(character.id)}
              className="p-1 rounded text-red-500 hover:bg-red-50"
              title="Удалить"
            >
              <Trash2 size={18} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">КД</span>
            <input
              type="number"
              value={character.ac}
              onChange={(e) => handleNumberChange('ac', e.target.value)}
              className="input-field"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Инициатива</span>
            <div className="flex gap-1">
              <input
                type="number"
                value={character.initiative}
                onChange={(e) => handleNumberChange('initiative', e.target.value)}
                className="input-field flex-1"
              />
              <button
                type="button"
                onClick={() => onRollInitiative(character.id)}
                className="px-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-gray-600"
                title="Бросить d20"
              >
                <Dices size={18} />
              </button>
            </div>
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Макс. HP</span>
            <input
              type="number"
              min={0}
              value={character.maxHp}
              onChange={(e) => handleNumberChange('maxHp', e.target.value)}
              className="input-field"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Текущие HP</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => adjustHp(-1)}
                className="px-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium"
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={character.currentHp}
                onChange={(e) => handleNumberChange('currentHp', e.target.value)}
                className="input-field flex-1 text-center"
              />
              <button
                type="button"
                onClick={() => adjustHp(1)}
                className="px-2 rounded-lg border border-gray-300 hover:bg-gray-50 font-medium"
              >
                +
              </button>
            </div>
          </label>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Здоровье</span>
            <span>{character.currentHp} / {character.maxHp}</span>
          </div>
          <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${hpPercent}%`,
                backgroundColor: hpPercent > 50 ? '#22c55e' : hpPercent > 25 ? '#eab308' : '#ef4444',
              }}
            />
          </div>
        </div>

        <label className="block space-y-1">
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Заметки</span>
          <textarea
            value={character.notes}
            onChange={(e) => onUpdate(character.id, { notes: e.target.value })}
            placeholder="Состояния, эффекты, комментарии..."
            rows={2}
            className="input-field resize-y min-h-[4rem]"
          />
        </label>

        {isActive && (
          <div className="text-sm font-medium text-blue-600 bg-blue-50 rounded-md px-3 py-1.5">
            Сейчас ходит
          </div>
        )}
      </div>
    </div>
  );
};

export default InitiativeCharacterBlock;
