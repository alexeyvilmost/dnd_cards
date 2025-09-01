// Общие переводы свойств для карточек
export const getPropertyLabel = (property: string): string => {
  const propertyLabels: Record<string, string> = {
    'light': 'легкое',
    'heavy': 'тяжелое',
    	'finesse': 'фехтовальное',
    'thrown': 'метательное',
    'versatile': 'универсальное',
    'two-handed': 'двуручное',
    'reach': 'досягаемости',
    'ammunition': 'требует боеприпасы',
    'loading': 'зарядка',
    'special': 'особое',
    'consumable': 'расходуемое',
    'single_use': 'одноразовое'
  };
  return propertyLabels[property] || property;
};

// Переводы категорий оружия
export const getWeaponCategoryLabel = (category: string): string => {
  const categoryLabels: Record<string, string> = {
    'simple_melee': 'простое рукопашное',
    'martial_melee': 'воинское рукопашное',
    'simple_ranged': 'простое дальнобойное',
    'martial_ranged': 'воинское дальнобойное'
  };
  return categoryLabels[category] || category;
};

// Переводы типов урона
export const getDamageTypeLabel = (damageType: string): string => {
  const damageTypeLabels: Record<string, string> = {
    'slashing': 'рубящий',
    'piercing': 'колющий',
    'bludgeoning': 'дробящий'
  };
  return damageTypeLabels[damageType] || damageType;
};
