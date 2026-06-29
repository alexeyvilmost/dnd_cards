import type { Currency } from '../types';

// Единый расширяемый реестр валют. Иконка — общий coin.png, перекрашенный CSS-фильтром
// под цвет валюты (новые ассеты не нужны; чтобы добавить валюту — допишите запись).
export interface CurrencyInfo {
  value: Currency | string;
  label: string;   // полное название
  short: string;   // краткое (ЗМ/СМ/ММ)
  color: string;   // цвет текста цены
  filter: string;  // CSS filter для перекраски coin.png
}

const GOLD_FILTER =
  'brightness(0) saturate(100%) invert(48%) sepia(79%) saturate(2476%) hue-rotate(360deg) brightness(118%) contrast(119%)';
const SILVER_FILTER = 'brightness(0) saturate(100%) invert(85%) sepia(6%) saturate(200%) brightness(95%) contrast(90%)';
const COPPER_FILTER =
  'brightness(0) saturate(100%) invert(45%) sepia(60%) saturate(900%) hue-rotate(-12deg) brightness(95%) contrast(95%)';

export const CURRENCIES: CurrencyInfo[] = [
  { value: 'gold', label: 'Золото', short: 'ЗМ', color: '#d97706', filter: GOLD_FILTER },
  { value: 'silver', label: 'Серебро', short: 'СМ', color: '#94a3b8', filter: SILVER_FILTER },
  { value: 'copper', label: 'Медь', short: 'ММ', color: '#b45309', filter: COPPER_FILTER },
];

export const DEFAULT_CURRENCY: Currency = 'gold';

const MAP: Record<string, CurrencyInfo> = Object.fromEntries(CURRENCIES.map((c) => [c.value, c]));

// Пустое/неизвестное значение трактуется как золото (обратная совместимость со старыми картами).
export const getCurrencyInfo = (currency?: string | null): CurrencyInfo =>
  MAP[currency || DEFAULT_CURRENCY] || MAP[DEFAULT_CURRENCY];

// Форматирование суммы. abbreviate=true → 1200 -> 1.2K. Поддерживает float.
export const formatPriceAmount = (amount: number, abbreviate = true): string => {
  if (abbreviate && Math.abs(amount) >= 1000) {
    const k = amount / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  // целое — без дробной части; дробное — до 2 знаков, без хвостовых нулей
  return Number.isInteger(amount) ? `${amount}` : parseFloat(amount.toFixed(2)).toString();
};
