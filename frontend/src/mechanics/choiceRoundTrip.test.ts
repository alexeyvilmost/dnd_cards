/**
 * Round-trip выбора через блок-редактор: optionsToChoiceForm (десериализация в форму) →
 * choiceFormToOptions (обратно в options). Регрессия #round-trip: объектные фильтры spell-выбора
 * ({classes,levels,only_available_slots}) НЕ должны схлопываться в 'all' при правке других полей.
 */
import { describe, expect, it } from 'vitest';
import { optionsToChoiceForm } from './blocks';
import { choiceFormToOptions, type ChoiceFormValue } from '../components/mechanics/ChoiceEditor';

// Полный путь: options → форма (как при открытии в редакторе) → options (как при сохранении).
const roundtrip = (options: Record<string, unknown>) =>
  choiceFormToOptions(optionsToChoiceForm({ id: 'c', prompt: 'p', count: 1, options }) as ChoiceFormValue);

describe('choice round-trip: объектные фильтры spell не теряются', () => {
  it('{classes,levels} сид-кастера сохраняется дословно', () => {
    const opts = { source: 'spell', filter: { classes: ['wizard'], levels: [0] } };
    expect(roundtrip(opts).filter).toEqual({ classes: ['wizard'], levels: [0] });
  });

  it('only_available_slots-объект round-trip (чекбокс вкл)', () => {
    const opts = { source: 'spell', filter: { only_available_slots: true } };
    expect(roundtrip(opts).filter).toEqual({ only_available_slots: true });
  });

  it('комбинированный {classes, only_available_slots} сохраняет и классы, и флаг', () => {
    const opts = { source: 'spell', filter: { classes: ['cleric'], only_available_slots: true } };
    expect(roundtrip(opts).filter).toEqual({ classes: ['cleric'], only_available_slots: true });
  });

  it('строковый фильтр «cantrip» не меняется', () => {
    expect(roundtrip({ source: 'spell', filter: 'cantrip' }).filter).toBe('cantrip');
  });

  it('строковый «all» + чекбокс only_available_slots в форме → объектный флаг', () => {
    // Форма с включённым чекбоксом (симулируем ручную установку автором).
    const form = { source: 'spell', filter: 'all', onlyAvailableSlots: true } as ChoiceFormValue;
    expect(choiceFormToOptions(form).filter).toEqual({ only_available_slots: true });
  });
});
