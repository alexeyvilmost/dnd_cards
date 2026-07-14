export type ChipOption = { value: string; label: string };

interface ChipToggleListProps {
  /** Варианты: либо {value,label}, либо простая строка (value=label). */
  options: ReadonlyArray<ChipOption | string>;
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Список чипов-переключателей (множественный выбор) для конструкторов.
 * Чипы, а не нативный <select multiple>: тот требует ctrl+click и сбрасывает выбор при обычном клике.
 */
export const ChipToggleList = ({ options, selected, onChange }: ChipToggleListProps) => {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const o: ChipOption = typeof opt === 'string' ? { value: opt, label: opt } : opt;
        const on = selected.includes(o.value);
        return (
          <button
            type="button"
            key={o.value}
            onClick={() => toggle(o.value)}
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              on
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
};

export default ChipToggleList;
