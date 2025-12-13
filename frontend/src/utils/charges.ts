import chargesData from '../../charges/charges.json';

export interface Charge {
  id: string;
  name: string;
  russian_name: string;
  description: string;
  cooldown: string;
  image: string;
}

export const getAllCharges = (): Charge[] => {
  return chargesData.charges || [];
};

export const getChargeById = (id: string): Charge | undefined => {
  return getAllCharges().find(charge => charge.id === id);
};

export const getChargeImagePath = (imageName: string): string => {
  return `/charges/${imageName}`;
};

