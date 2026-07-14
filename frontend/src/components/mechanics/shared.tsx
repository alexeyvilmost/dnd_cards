import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

// Общий каркас блочных редакторов механики. Раньше всё это копировалось по файлам:
// класс поля — в 6 редакторов, гард+патч+кнопки списка — в 3.

/** Единый класс полей редакторов механики. */
export const MECH_INPUT_CLS = 'w-full px-2 py-1 border rounded text-sm';

/**
 * Операции над списком строк редактора: гард массива + патч/удаление/добавление.
 * Рендер строки у каждого редактора свой — здесь только каркас.
 */
export function rowList<T extends object>(value: T[] | undefined, onChange: (v: T[]) => void) {
  const rows = Array.isArray(value) ? value : [];
  return {
    rows,
    patch: (i: number, p: Partial<T>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r))),
    remove: (i: number) => onChange(rows.filter((_, j) => j !== i)),
    add: (row: T) => onChange([...rows, row]),
  };
}

export const RowDeleteButton = ({ onClick, title = 'Удалить' }: { onClick: () => void; title?: string }) => (
  <button type="button" className="p-1 text-red-400 hover:text-red-600" onClick={onClick} title={title}>
    <Trash2 size={15} />
  </button>
);

export const RowAddButton = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800" onClick={onClick}>
    <Plus size={13} /> {children}
  </button>
);
