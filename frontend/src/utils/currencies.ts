import type { Currency } from '../types';

export interface CurrencyInfo {
  value: Currency | string;
  label: string;
  short: string;
  color: string;
  icon: string;
}

export const CURRENCIES: CurrencyInfo[] = [
  { value: 'gold', label: 'Золото', short: 'ЗМ', color: '#d97706', icon: '/icons/currency/gold.png' },
  { value: 'silver', label: 'Серебро', short: 'СМ', color: '#94a3b8', icon: '/icons/currency/silver.png' },
  { value: 'copper', label: 'Медь', short: 'ММ', color: '#b45309', icon: '/icons/currency/copper.png' },
];

export const DEFAULT_CURRENCY: Currency = 'gold';

const MAP: Record<string, CurrencyInfo> = Object.fromEntries(CURRENCIES.map((c) => [c.value, c]));

export const getCurrencyInfo = (currency?: string | null): CurrencyInfo =>
  MAP[currency || DEFAULT_CURRENCY] || MAP[DEFAULT_CURRENCY];

export const getCurrencyIconPath = (currency?: string | null): string =>
  getCurrencyInfo(currency).icon;

export const formatPriceAmount = (amount: number, abbreviate = true): string => {
  if (abbreviate && Math.abs(amount) >= 1000) {
    const k = amount / 1000;
    return `${Number.isInteger(k) ? k : k.toFixed(1)}K`;
  }
  return Number.isInteger(amount) ? `${amount}` : parseFloat(amount.toFixed(2)).toString();
};
