// Утилита для работы с иконками ресурсов из charges.json

import chargesData from '../../charges/charges.json';

interface Charge {
  id: string;
  name: string;
  russian_name: string;
  description: string;
  cooldown: string;
  image: string;
}

interface ChargesData {
  charges: Charge[];
}

const charges = (chargesData as ChargesData).charges;

/**
 * Получает путь к иконке ресурса по его ID
 * @param chargeId - ID ресурса (например, "bonus_action", "rage_charge")
 * @returns путь к иконке или пустую строку, если не найдено
 */
export const getChargeIcon = (chargeId: string): string => {
  const charge = charges.find(c => c.id === chargeId);
  if (!charge) {
    return '';
  }
  return `/charges/${charge.image}`;
};

/**
 * Получает информацию о ресурсе по его ID
 * @param chargeId - ID ресурса
 * @returns объект с информацией о ресурсе или null
 */
export const getChargeInfo = (chargeId: string): Charge | null => {
  return charges.find(c => c.id === chargeId) || null;
};

/**
 * Получает русское название ресурса
 * @param chargeId - ID ресурса
 * @returns русское название или ID, если не найдено
 */
export const getChargeRussianName = (chargeId: string): string => {
  const charge = getChargeInfo(chargeId);
  return charge?.russian_name || chargeId;
};

/**
 * Получает описание ресурса
 * @param chargeId - ID ресурса
 * @returns описание или пустую строку
 */
export const getChargeDescription = (chargeId: string): string => {
  const charge = getChargeInfo(chargeId);
  return charge?.description || '';
};
