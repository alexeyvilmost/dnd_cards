// Переводы английских названий навыков и характеристик на русский
export const skillTranslations: { [key: string]: string } = {
  'athletics': 'Атлетика',
  'acrobatics': 'Акробатика',
  'sleight_of_hand': 'Ловкость рук',
  'stealth': 'Скрытность',
  'arcana': 'Магия',
  'history': 'История',
  'investigation': 'Расследование',
  'nature': 'Природа',
  'religion': 'Религия',
  'animal_handling': 'Дрессировка',
  'insight': 'Проницательность',
  'medicine': 'Медицина',
  'perception': 'Восприятие',
  'survival': 'Выживание',
  'deception': 'Обман',
  'intimidation': 'Запугивание',
  'performance': 'Выступление',
  'persuasion': 'Убеждение'
};

export const characteristicTranslations: { [key: string]: string } = {
  'strength': 'Сила',
  'dexterity': 'Ловкость',
  'constitution': 'Телосложение',
  'intelligence': 'Интеллект',
  'wisdom': 'Мудрость',
  'charisma': 'Харизма'
};

export const savingThrowTranslations: { [key: string]: string } = {
  'strength': 'Спасбросок Силы',
  'dexterity': 'Спасбросок Ловкости',
  'constitution': 'Спасбросок Телосложения',
  'intelligence': 'Спасбросок Интеллекта',
  'wisdom': 'Спасбросок Мудрости',
  'charisma': 'Спасбросок Харизмы'
};

// Функция для получения русифицированного названия
export const getRussianName = (targetType: string, targetSpecific: string): string => {
  switch (targetType) {
    case 'characteristic':
      return characteristicTranslations[targetSpecific] || targetSpecific;
    case 'skill':
      return skillTranslations[targetSpecific] || targetSpecific;
    case 'saving_throw':
      return savingThrowTranslations[targetSpecific] || targetSpecific;
    default:
      return targetSpecific;
  }
};
