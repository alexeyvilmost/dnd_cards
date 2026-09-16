/** Exact prices and change: one gold = ten silver = one hundred copper. */
const rates: Record<string, number> = { copper: 1, silver: 10, electrum: 50, gold: 100, platinum: 1000 };
export function priceInCopper(price: number, currency = 'gold'): number {
  const value = price * (rates[currency] ?? NaN);
  if (!Number.isFinite(value) || value < 0) throw new Error('Некорректная цена или валюта');
  return Math.ceil(value - 1e-8);
}
export function walletInCopper(wallet: Record<string, number>): number {
  return Object.entries(rates).reduce((sum, [key, rate]) => sum + Math.max(0, Number(wallet[key]) || 0) * rate, 0);
}
export function spendCopper(wallet: Record<string, number>, cost: number): Record<string, number> | null {
  if (!Number.isSafeInteger(cost) || cost < 0) return null;
  const rest = walletInCopper(wallet) - cost;
  if (!Number.isSafeInteger(rest) || rest < 0) return null;
  if (cost === 0) return {...wallet};
  return {...wallet, platinum: 0, electrum: 0, gold: Math.floor(rest / 100), silver: Math.floor(rest % 100 / 10), copper: rest % 10};
}
export function formatCopper(value: number): string {
  const gold = Math.floor(value / 100), silver = Math.floor(value % 100 / 10), copper = value % 10;
  return [gold && `${gold} зм`, silver && `${silver} см`, copper && `${copper} мм`].filter(Boolean).join(' ') || '0 мм';
}
