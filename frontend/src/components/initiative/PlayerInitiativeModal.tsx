import React, { useEffect, useMemo, useState } from 'react';
import { Dices, Play, X } from 'lucide-react';
import {
  getInitiativeColor,
  rollInitiativeValue,
  type InitiativeCharacter,
} from '../../types/initiative';

interface PlayerInitiativeModalProps {
  players: InitiativeCharacter[];
  onSubmit: (values: Record<string, number>) => void;
  onCancel: () => void;
}

/**
 * Диалог перед началом боя: просит ввести инициативу для игроков,
 * у которых она ещё не заполнена (монстры кидают её сами).
 */
const PlayerInitiativeModal: React.FC<PlayerInitiativeModalProps> = ({
  players,
  onSubmit,
  onCancel,
}) => {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(players.map((p) => [p.id, ''])),
  );

  const firstId = players[0]?.id;
  useEffect(() => {
    const el = document.getElementById(`player-init-${firstId}`);
    if (el instanceof HTMLInputElement) el.focus();
  }, [firstId]);

  const allFilled = useMemo(
    () => players.every((p) => values[p.id]?.trim() !== '' && !Number.isNaN(Number(values[p.id]))),
    [players, values],
  );

  const setValue = (id: string, value: string) => {
    setValues((prev) => ({ ...prev, [id]: value }));
  };

  const rollFor = (id: string, bonus: number) => {
    setValue(id, String(rollInitiativeValue(bonus)));
  };

  const submit = () => {
    const result: Record<string, number> = {};
    for (const player of players) {
      const raw = values[player.id];
      const num = parseInt(raw, 10);
      result[player.id] = Number.isNaN(num) ? rollInitiativeValue(player.initiativeBonus) : num;
    }
    onSubmit(result);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Инициатива игроков</h2>
          <button type="button" onClick={onCancel} className="rounded p-1 text-gray-400 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
          <p className="text-sm text-gray-600">
            Введите значение инициативы для каждого игрока (или бросьте d20).
          </p>
          {players.map((player) => {
            const color = getInitiativeColor(player.color);
            return (
              <div key={player.id} className="flex items-center gap-2">
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ backgroundColor: color.hex }}
                />
                <span className="flex-1 truncate text-sm font-medium text-gray-800">
                  {player.name || 'Без имени'}
                  {player.initiativeBonus ? (
                    <span className="ml-1 text-xs text-gray-400">
                      ({player.initiativeBonus > 0 ? '+' : ''}
                      {player.initiativeBonus})
                    </span>
                  ) : null}
                </span>
                <input
                  id={`player-init-${player.id}`}
                  type="number"
                  value={values[player.id] ?? ''}
                  onChange={(e) => setValue(player.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && allFilled) submit();
                  }}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1 text-center text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="—"
                />
                <button
                  type="button"
                  onClick={() => rollFor(player.id, player.initiativeBonus)}
                  className="rounded-md border border-gray-300 p-1.5 text-gray-600 hover:bg-gray-50"
                  title="Бросить d20 + бонус"
                >
                  <Dices size={16} />
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
          <button type="button" onClick={onCancel} className="btn-secondary">
            Отмена
          </button>
          <button type="button" onClick={submit} className="btn-primary flex items-center gap-2">
            <Play size={16} />
            Начать бой
          </button>
        </div>
      </div>
    </div>
  );
};

export default PlayerInitiativeModal;
