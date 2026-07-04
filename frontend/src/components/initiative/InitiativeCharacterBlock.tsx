import React, { useMemo, useRef, useState } from 'react';
import {
  Trash2, ChevronUp, ChevronDown, Dices, ChevronsDown, ChevronsUp, Copy, BookmarkPlus,
  Sword, Crosshair,
} from 'lucide-react';
import {
  INITIATIVE_COLORS,
  getInitiativeColor,
  hasStatBlock,
  type CreatureType,
  type InitiativeCharacter,
  type InitiativeColorId,
} from '../../types/initiative';
import { parseAttacks } from '../../utils/attackParser';
import StatBlockView from './StatBlockView';

interface InitiativeCharacterBlockProps {
  character: InitiativeCharacter;
  isActive: boolean;
  onUpdate: (id: string, patch: Partial<InitiativeCharacter>) => void;
  onRemove: (id: string) => void;
  onCopy: (id: string) => void;
  onSaveToLibrary: (id: string) => void;
  onRollInitiative: (id: string) => void;
  onAttack: (id: string, kind: 'melee' | 'ranged') => void;
  onDamage: (id: string, amount: number) => void;
  onHeal: (id: string, amount: number) => void;
  onHpEdit: (id: string, from: number, to: number) => void;
  onMoveUp: (id: string) => void;
  onMoveDown: (id: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

const TYPE_LABEL: Record<CreatureType, string> = { monster: 'Монстр', player: 'Игрок' };

const InitiativeCharacterBlock: React.FC<InitiativeCharacterBlockProps> = ({
  character,
  isActive,
  onUpdate,
  onRemove,
  onCopy,
  onSaveToLibrary,
  onRollInitiative,
  onAttack,
  onDamage,
  onHeal,
  onHpEdit,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hpDelta, setHpDelta] = useState('1');
  const hpBeforeEdit = useRef(character.currentHp);

  const color = getInitiativeColor(character.color);
  const hpPercent = character.maxHp > 0
    ? Math.min(100, Math.round((character.currentHp / character.maxHp) * 100))
    : 0;
  const hpColor = hpPercent > 50 ? '#16a34a' : hpPercent > 25 ? '#ca8a04' : '#dc2626';

  const attacks = useMemo(() => parseAttacks(character.description), [character.description]);

  const handleNumberChange = (
    field: 'ac' | 'initiative' | 'initiativeBonus' | 'maxHp' | 'currentHp',
    value: string,
  ) => {
    const parsed = value === '' ? 0 : parseInt(value, 10);
    if (Number.isNaN(parsed)) return;
    const final = field === 'currentHp' ? Math.max(0, parsed) : parsed;
    onUpdate(character.id, { [field]: final });
  };

  const deltaAmount = () => {
    const n = parseInt(hpDelta, 10);
    return Number.isNaN(n) || n < 1 ? 1 : n;
  };

  const cardClass = `rounded-lg border bg-white shadow-sm transition-all ${
    isActive ? 'ring-2 ring-blue-500 shadow-md' : 'border-gray-200'
  }`;

  const moveButtons = (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => onMoveUp(character.id)}
        disabled={!canMoveUp}
        className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Выше в порядке"
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        onClick={() => onMoveDown(character.id)}
        disabled={!canMoveDown}
        className="p-0.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Ниже в порядке"
      >
        <ChevronDown size={16} />
      </button>
    </div>
  );

  // Единый верхний ряд — одинаковый в свёрнутом и развёрнутом виде (#1).
  const topRow = (
    <div className="flex flex-wrap items-center gap-2 px-2 py-1.5 sm:px-3 sm:py-2">
      <div
        className="flex-shrink-0 w-9 h-9 rounded-md flex items-center justify-center text-base font-bold"
        style={{ backgroundColor: color.hex, color: color.text }}
        title="Инициатива"
      >
        {character.initiative}
      </div>

      <input
        type="text"
        value={character.name}
        onChange={(e) => onUpdate(character.id, { name: e.target.value })}
        placeholder="Имя"
        className="flex-shrink-0 w-24 sm:w-32 px-2 py-1 text-sm font-semibold border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      <span
        className="flex-shrink-0 text-xs font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
        title="Класс доспеха"
      >
        КД {character.ac}
      </span>

      {/* Блок изменения HP: количество, +, − (#7) слева от текущих/макс HP */}
      <div className="flex-shrink-0 flex items-center gap-1">
        <input
          type="number"
          min={1}
          value={hpDelta}
          onChange={(e) => setHpDelta(e.target.value)}
          onFocus={(e) => e.target.select()}
          className="w-11 px-1 py-0.5 text-xs tabular-nums text-center border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          title="Сколько хитов добавить/убрать"
        />
        <button
          type="button"
          onClick={() => onHeal(character.id, deltaAmount())}
          className="w-6 h-6 rounded border border-green-300 text-green-700 hover:bg-green-50 text-sm font-medium leading-none"
          title="Восстановить HP"
        >
          +
        </button>
        <button
          type="button"
          onClick={() => onDamage(character.id, deltaAmount())}
          className="w-6 h-6 rounded border border-red-300 text-red-700 hover:bg-red-50 text-sm font-medium leading-none"
          title="Нанести урон"
        >
          −
        </button>
      </div>

      <div className="flex-shrink-0 flex items-center gap-0.5" title="Текущие / макс. HP">
        <input
          type="number"
          min={0}
          value={character.currentHp}
          onChange={(e) => handleNumberChange('currentHp', e.target.value)}
          onFocus={(e) => {
            hpBeforeEdit.current = character.currentHp;
            e.target.select();
          }}
          onBlur={() => {
            if (character.currentHp !== hpBeforeEdit.current) {
              onHpEdit(character.id, hpBeforeEdit.current, character.currentHp);
            }
          }}
          className="w-11 sm:w-12 px-1 py-0.5 text-xs font-medium tabular-nums text-center border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          style={{ color: hpColor }}
          title="Текущие HP — введите значение напрямую"
        />
        <span className="text-xs text-gray-400">/</span>
        <span className="text-xs font-medium text-gray-500 tabular-nums min-w-[1.5rem]">
          {character.maxHp}
        </span>
      </div>

      {/* Кнопки атак — только если описание распарсилось (#4) */}
      {attacks.melee && (
        <button
          type="button"
          onClick={() => onAttack(character.id, 'melee')}
          className="flex-shrink-0 p-1 rounded text-amber-700 hover:bg-amber-50"
          title={`Рукопашная атака: ${attacks.melee.name}`}
        >
          <Sword size={16} />
        </button>
      )}
      {attacks.ranged && (
        <button
          type="button"
          onClick={() => onAttack(character.id, 'ranged')}
          className="flex-shrink-0 p-1 rounded text-amber-700 hover:bg-amber-50"
          title={`Дальнобойная атака: ${attacks.ranged.name}`}
        >
          <Crosshair size={16} />
        </button>
      )}

      <input
        type="text"
        value={character.notes}
        onChange={(e) => onUpdate(character.id, { notes: e.target.value })}
        placeholder="Заметки..."
        className="flex-1 min-w-[6rem] px-2 py-1 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      {isActive && (
        <span className="flex-shrink-0 text-[10px] font-semibold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded hidden sm:inline">
          Ход
        </span>
      )}

      {moveButtons}

      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="flex-shrink-0 p-1 rounded hover:bg-gray-100 text-gray-500"
        title={isExpanded ? 'Свернуть' : 'Развернуть'}
      >
        {isExpanded ? <ChevronsUp size={16} /> : <ChevronsDown size={16} />}
      </button>

      <button
        type="button"
        onClick={() => onCopy(character.id)}
        className="flex-shrink-0 p-1 rounded text-gray-600 hover:bg-gray-100"
        title="Копировать"
      >
        <Copy size={16} />
      </button>

      <button
        type="button"
        onClick={() => onSaveToLibrary(character.id)}
        className="flex-shrink-0 p-1 rounded text-gray-600 hover:bg-gray-100"
        title="Сохранить в библиотеку"
      >
        <BookmarkPlus size={16} />
      </button>

      <button
        type="button"
        onClick={() => onRemove(character.id)}
        className="flex-shrink-0 p-1 rounded text-red-500 hover:bg-red-50"
        title="Удалить"
      >
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className={cardClass} style={{ borderLeftWidth: '4px', borderLeftColor: color.hex }}>
      {topRow}

      {isExpanded && (
        <div className="border-t border-gray-100 p-4 space-y-4">
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

          <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm">
            {(['monster', 'player'] as CreatureType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onUpdate(character.id, { type: t })}
                className={`px-3 py-1 font-medium transition-colors ${
                  character.type === t
                    ? t === 'player'
                      ? 'bg-green-600 text-white'
                      : 'bg-red-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
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
                  title="Бросить d20 + бонус"
                >
                  <Dices size={18} />
                </button>
              </div>
            </label>

            <label className="space-y-1">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Бонус иниц.</span>
              <input
                type="number"
                value={character.initiativeBonus}
                onChange={(e) => handleNumberChange('initiativeBonus', e.target.value)}
                className="input-field"
                title="Прибавляется к d20 при броске инициативы"
              />
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
          </div>

          {hasStatBlock(character.statblock) && <StatBlockView statblock={character.statblock} />}

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

          {character.description ? (
            <div className="space-y-1">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Описание</span>
              <textarea
                value={character.description}
                onChange={(e) => onUpdate(character.id, { description: e.target.value })}
                rows={8}
                className="input-field resize-y min-h-[8rem] text-sm bg-gray-50"
              />
            </div>
          ) : null}

          {isActive && (
            <div className="text-sm font-medium text-blue-600 bg-blue-50 rounded-md px-3 py-1.5">
              Сейчас ходит
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default InitiativeCharacterBlock;
