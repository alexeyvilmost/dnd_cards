# Универсальная система эффектов для D&D 5e

## Обзор проекта

Создание универсальной системы построения эффектов для предметов и черт персонажей в D&D 5e, которая будет интегрирована в лист персонажа и влиять на его характеристики при экипировке предметов.

## 1. Анализ существующих эффектов

### Типы эффектов из карточек:

**Модификации характеристик:**
- Плоские бонусы к навыкам (+1 к Акробатике, +1 к Выживанию)
- Бонусы к спасброскам (+1 к спасброскам Ловкости)
- Изменение характеристик (+2 к максимальному здоровью)

**Боевые модификации:**
- Изменение урона (+1 к урону от атак, -1 к входящему урону)
- Модификации атак (+1 к броскам атаки дальнобойным оружием)
- Критические эффекты (снижение критического урона на 1-2)

**Условные эффекты:**
- Триггеры по событиям ("Когда вам наносят урон...")
- Триггеры по действиям ("Атакуя бонусным действием...")
- Триггеры по условиям ("Сопротивляясь падению...")

**Вероятностные эффекты:**
- Шансовые эффекты (1% шанс не получить урон)
- Бросок костей (бросьте к4, при 4...)

**Специальные способности:**
- Дополнительные действия (бонусное действие для заклинания)
- Изменение механик (не нужен разбег для прыжка)
- Реакции (реакцией нанести урон атакующему)

## 2. Архитектура системы

### Базовые типы эффектов

```typescript
enum EffectType {
  STAT_MODIFIER = "stat_modifier",           // Модификация характеристики
  SKILL_BONUS = "skill_bonus",              // Бонус к навыку
  SAVING_THROW_BONUS = "saving_throw_bonus", // Бонус к спасброску
  DAMAGE_MODIFIER = "damage_modifier",       // Модификация урона
  AC_MODIFIER = "ac_modifier",              // Модификация защиты
  SPEED_MODIFIER = "speed_modifier",        // Модификация скорости
  HP_MODIFIER = "hp_modifier",              // Модификация хитов
  ATTACK_MODIFIER = "attack_modifier",      // Модификация атак
  CONDITIONAL_EFFECT = "conditional_effect", // Условный эффект
  REACTION_EFFECT = "reaction_effect",      // Реакционный эффект
  SPECIAL_ABILITY = "special_ability"       // Специальная способность
}
```

### Условия активации

```typescript
enum TriggerType {
  ALWAYS = "always",                        // Постоянно
  ON_ATTACK = "on_attack",                  // При атаке
  ON_DAMAGE_TAKEN = "on_damage_taken",      // При получении урона
  ON_CRITICAL_HIT = "on_critical_hit",      // При критическом ударе
  ON_SAVING_THROW = "on_saving_throw",      // При спасброске
  ON_SKILL_CHECK = "on_skill_check",        // При проверке навыка
  ON_BONUS_ACTION = "on_bonus_action",      // При бонусном действии
  ON_REACTION = "on_reaction",              // При реакции
  ON_MOVE = "on_move",                      // При движении
  ON_JUMP = "on_jump",                      // При прыжке
  ON_FALL = "on_fall",                      // При падении
  ON_GRAPPLE = "on_grapple",                // При захвате
  ON_PUSH = "on_push",                      // При толчке
  ON_DISARM = "on_disarm",                  // При обезоруживании
  ON_SPELL_CAST = "on_spell_cast",          // При использовании заклинания
  CUSTOM = "custom"                         // Пользовательское условие
}
```

### Целевые параметры

```typescript
enum TargetType {
  // Характеристики
  STRENGTH = "strength",
  DEXTERITY = "dexterity", 
  CONSTITUTION = "constitution",
  INTELLIGENCE = "intelligence",
  WISDOM = "wisdom",
  CHARISMA = "charisma",
  
  // Навыки
  ACROBATICS = "acrobatics",
  ANIMAL_HANDLING = "animal_handling",
  ARCANA = "arcana",
  ATHLETICS = "athletics",
  DECEPTION = "deception",
  HISTORY = "history",
  INSIGHT = "insight",
  INTIMIDATION = "intimidation",
  INVESTIGATION = "investigation",
  MEDICINE = "medicine",
  NATURE = "nature",
  PERCEPTION = "perception",
  PERFORMANCE = "performance",
  PERSUASION = "persuasion",
  RELIGION = "religion",
  SLEIGHT_OF_HAND = "sleight_of_hand",
  STEALTH = "stealth",
  SURVIVAL = "survival",
  
  // Спасброски
  STR_SAVE = "str_save",
  DEX_SAVE = "dex_save",
  CON_SAVE = "con_save",
  INT_SAVE = "int_save",
  WIS_SAVE = "wis_save",
  CHA_SAVE = "cha_save",
  
  // Боевые параметры
  AC = "ac",
  SPEED = "speed",
  HP = "hp",
  MAX_HP = "max_hp",
  ATTACK_ROLL = "attack_roll",
  DAMAGE_ROLL = "damage_roll",
  INCOMING_DAMAGE = "incoming_damage",
  CRITICAL_DAMAGE = "critical_damage",
  
  // Специальные
  CUSTOM = "custom"
}
```

### Основная структура эффекта

```typescript
interface Effect {
  id: string;
  name: string;
  description: string;
  type: EffectType;
  target: TargetType | TargetType[];
  value: number | string; // Числовое значение или формула
  trigger: TriggerType;
  conditions?: EffectCondition[]; // Дополнительные условия
  duration?: string; // Длительность эффекта
  stackable: boolean; // Можно ли складывать с другими эффектами
  priority: number; // Приоритет при применении
  source?: string; // Источник эффекта (предмет, черта, заклинание)
}

interface EffectCondition {
  type: string; // Тип условия
  value: any; // Значение условия
  operator?: string; // Оператор сравнения (=, >, <, >=, <=)
}
```

## 3. Конструктор эффектов

### Этапы создания эффекта:

**Этап 1: Выбор типа эффекта**
- Радио-кнопки или иконки для основных типов
- Описание каждого типа с примерами
- Предварительный просмотр результата

**Этап 2: Настройка цели**
- Выпадающий список характеристик/навыков/параметров
- Возможность множественного выбора для групповых эффектов
- Фильтрация по типу эффекта

**Этап 3: Настройка значения**
- Числовое поле для простых бонусов
- Выбор из предустановленных значений (+1, +2, +3, -1, -2, -3)
- Поле для формул (например, "1d4", "уровень/2")
- Валидация введенных значений

**Этап 4: Условия активации**
- Выбор триггера из списка
- Дополнительные условия (тип урона, тип атаки, и т.д.)
- Настройка вероятности для шансовых эффектов
- Условия для условных эффектов

**Этап 5: Дополнительные параметры**
- Длительность эффекта
- Возможность складывания
- Приоритет применения
- Описание эффекта

## 4. Примеры эффектов

### Простой бонус к навыку
```json
{
  "id": "acrobatics_bonus",
  "name": "Бонус к Акробатике",
  "description": "+1 к проверкам Акробатики",
  "type": "skill_bonus",
  "target": "acrobatics",
  "value": 1,
  "trigger": "always",
  "stackable": true,
  "priority": 1
}
```

### Условный эффект снижения урона
```json
{
  "id": "damage_reduction",
  "name": "Снижение урона",
  "description": "Снизьте входящий урон на 1",
  "type": "damage_modifier",
  "target": "incoming_damage",
  "value": -1,
  "trigger": "on_damage_taken",
  "stackable": true,
  "priority": 2
}
```

### Вероятностный эффект
```json
{
  "id": "damage_negation",
  "name": "Игнорирование урона",
  "description": "С вероятностью 1% атака может не нанести урона",
  "type": "conditional_effect",
  "target": "incoming_damage",
  "value": "roll_d100 <= 1 ? 0 : original_damage",
  "trigger": "on_damage_taken",
  "conditions": [{"type": "probability", "value": 1}],
  "stackable": false,
  "priority": 3
}
```

### Реакционный эффект
```json
{
  "id": "vengeance_damage",
  "name": "Плащ мести",
  "description": "Когда вам наносят урон, вы можете реакцией нанести атакующему 1 ед. урона",
  "type": "reaction_effect",
  "target": "damage_roll",
  "value": 1,
  "trigger": "on_damage_taken",
  "conditions": [{"type": "action_type", "value": "reaction"}],
  "stackable": false,
  "priority": 4
}
```

## 5. Интеграция с листом персонажа

### Система применения эффектов:
1. **При экипировке предмета** - активация всех его эффектов
2. **При снятии предмета** - деактивация эффектов
3. **Пересчет характеристик** - автоматический пересчет всех зависимых параметров
4. **Отображение в интерфейсе** - показ активных эффектов

### Визуализация эффектов:
- Список активных эффектов с возможностью отключения
- Цветовая индикация (зеленый - бонус, красный - штраф)
- Группировка по источникам (предметы, черты, заклинания)
- Детальная информация о каждом эффекте

## 6. Техническая реализация

### Backend изменения:
- Новая таблица `effects` для хранения эффектов
- Связь многие-ко-многим между предметами и эффектами
- API для управления эффектами
- Система применения эффектов к персонажу
- Кэширование расчетов для производительности

### Frontend изменения:
- Конструктор эффектов с пошаговым интерфейсом
- Система отображения активных эффектов
- Интеграция с расчетами характеристик
- Визуальная индикация изменений
- Модальные окна для детального просмотра

### База данных:
```sql
-- Таблица эффектов
CREATE TABLE effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  type VARCHAR(50) NOT NULL,
  target JSONB NOT NULL, -- Массив целевых параметров
  value VARCHAR(100) NOT NULL, -- Значение или формула
  trigger VARCHAR(50) NOT NULL,
  conditions JSONB, -- Дополнительные условия
  duration VARCHAR(100),
  stackable BOOLEAN DEFAULT true,
  priority INTEGER DEFAULT 1,
  source VARCHAR(100), -- Источник эффекта
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Связь предметов и эффектов
CREATE TABLE card_effects (
  card_id UUID REFERENCES cards(id) ON DELETE CASCADE,
  effect_id UUID REFERENCES effects(id) ON DELETE CASCADE,
  PRIMARY KEY (card_id, effect_id)
);

-- Активные эффекты персонажа
CREATE TABLE character_active_effects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  character_id UUID REFERENCES characters_v2(id) ON DELETE CASCADE,
  effect_id UUID REFERENCES effects(id) ON DELETE CASCADE,
  source_type VARCHAR(50) NOT NULL, -- 'item', 'feat', 'spell'
  source_id UUID NOT NULL, -- ID источника
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## 7. Преимущества системы

1. **Гибкость** - можно создать любой эффект из D&D 5e
2. **Расширяемость** - легко добавлять новые типы эффектов
3. **Удобство** - визуальный конструктор для создания эффектов
4. **Совместимость** - работает с существующей системой персонажей
5. **Производительность** - эффективное применение и пересчет эффектов
6. **Модульность** - эффекты можно переиспользовать между предметами

## 8. План реализации

### Фаза 1: Базовая структура
- [ ] Создание таблиц в базе данных
- [ ] Базовые модели и API для эффектов
- [ ] Простые типы эффектов (статы, навыки, спасброски)

### Фаза 2: Конструктор
- [ ] Интерфейс конструктора эффектов
- [ ] Валидация и сохранение эффектов
- [ ] Связывание эффектов с предметами

### Фаза 3: Интеграция
- [ ] Система применения эффектов к персонажу
- [ ] Пересчет характеристик
- [ ] Отображение в листе персонажа

### Фаза 4: Расширенные возможности
- [ ] Условные и реакционные эффекты
- [ ] Вероятностные эффекты
- [ ] Специальные способности

### Фаза 5: Оптимизация
- [ ] Кэширование расчетов
- [ ] Производительность
- [ ] Тестирование

## 9. Вопросы для обсуждения

1. **Приоритеты типов эффектов** - какие типы реализовать в первую очередь?
2. **Сложность конструктора** - насколько детальным должен быть интерфейс?
3. **Производительность** - как часто пересчитывать эффекты?
4. **Совместимость** - как интегрировать с существующими предметами?
5. **Тестирование** - как проверить корректность работы эффектов?

---

*Документ будет обновляться по мере обсуждения и уточнения требований.*














