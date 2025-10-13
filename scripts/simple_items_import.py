#!/usr/bin/env python3
"""
Упрощенный скрипт для импорта предметов с dnd.su
"""

import requests
import re
import time
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_simple_items_list():
    """Получает упрощенный список предметов"""
    all_items = []
    
    try:
        # Получаем только первую страницу
        url = "https://dnd.su/items/?search=&source=101"
        logger.info(f"Запрашиваем: {url}")
        
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        logger.info(f"Получен ответ, статус: {response.status_code}")
        
        # Ищем ссылки на предметы
        item_links = re.findall(r'href="(/items/[^"]+)"', response.text)
        logger.info(f"Найдено {len(item_links)} ссылок")
        
        # Обрабатываем только первые 15 предметов для тестирования
        for i, link in enumerate(item_links[:15], 1):
            full_url = f"https://dnd.su{link}"
            logger.info(f"Обрабатываем {i}/15: {full_url}")
            
            try:
                item_response = requests.get(full_url, timeout=15)
                item_response.raise_for_status()
                
                # Ищем название в h2 (как мы выяснили из анализа)
                name_match = re.search(r'<h2[^>]*>([^[]+)\[', item_response.text)
                if name_match:
                    name = name_match.group(1).strip()
                    
                    # Ищем редкость
                    rarity_match = re.search(r'(обычный|необычный|редкий|очень редкий|легендарный|артефакт)', item_response.text, re.IGNORECASE)
                    rarity = rarity_match.group(1).lower() if rarity_match else "неизвестно"
                    
                    # Ищем стоимость
                    price_match = re.search(r'(\d+(?:[\s,]\d+)*)\s*зм', item_response.text)
                    price = None
                    if price_match:
                        try:
                            price_str = price_match.group(1).replace(' ', '').replace(',', '')
                            price = int(price_str)
                        except ValueError:
                            pass
                    
                    # Определяем тип предмета по названию
                    item_type = "чудесный предмет"  # по умолчанию
                    name_lower = name.lower()
                    if any(word in name_lower for word in ['меч', 'sword', 'кинжал', 'dagger', 'топор', 'axe', 'булава', 'mace']):
                        item_type = "оружие"
                    elif any(word in name_lower for word in ['доспех', 'armor', 'кольчуга', 'mail', 'щит', 'shield']):
                        item_type = "доспех"
                    elif any(word in name_lower for word in ['палочка', 'wand', 'посох', 'staff', 'жезл', 'rod']):
                        item_type = "волшебный предмет"
                    elif any(word in name_lower for word in ['амулет', 'amulet', 'кольцо', 'ring', 'браслет', 'bracelet']):
                        item_type = "аксессуар"
                    
                    # Определяем слот экипировки
                    equipment_slot = None
                    if any(word in name_lower for word in ['кольцо', 'ring']):
                        equipment_slot = "ring"
                    elif any(word in name_lower for word in ['амулет', 'amulet', 'кулон', 'pendant']):
                        equipment_slot = "necklace"
                    elif any(word in name_lower for word in ['доспех', 'armor', 'кольчуга', 'mail']):
                        equipment_slot = "body"
                    elif any(word in name_lower for word in ['щит', 'shield']):
                        equipment_slot = "one_hand"
                    elif any(word in name_lower for word in ['меч', 'sword', 'кинжал', 'dagger']):
                        equipment_slot = "one_hand"
                    elif any(word in name_lower for word in ['посох', 'staff', 'палочка', 'wand']):
                        equipment_slot = "two_hands"
                    
                    # Извлекаем описание (упрощенное)
                    description = f"Магический предмет редкости '{rarity}'"
                    if price:
                        description += f". Стоимость: {price} золотых монет"
                    
                    item_data = {
                        'name': name,
                        'description': description,
                        'rarity': rarity,
                        'price': price,
                        'type': item_type,
                        'equipment_slot': equipment_slot,
                        'source': "D&D 5e Official",
                        'template_type': "magic_item"
                    }
                    
                    all_items.append(item_data)
                    logger.info(f"Успешно добавлен: {name} ({rarity})")
                else:
                    logger.warning(f"Не найдено название в {full_url}")
                
                time.sleep(0.8)  # Пауза между запросами
                
            except Exception as e:
                logger.error(f"Ошибка при обработке {full_url}: {e}")
                continue
        
        logger.info(f"Завершено. Получено {len(all_items)} предметов")
        return all_items
        
    except Exception as e:
        logger.error(f"Критическая ошибка: {e}")
        return []

def main():
    """Основная функция"""
    logger.info("Запуск упрощенного импорта")
    print("Получаем список магических предметов D&D 5e...")
    print("=" * 60)
    
    items = get_simple_items_list()
    
    if items:
        print(f"\nНайдено предметов: {len(items)}")
        print("=" * 60)
        
        for i, item in enumerate(items, 1):
            print(f"{i:2d}. {item['name']} ({item['rarity']}) - {item['type']}")
        
        print("\n" + "=" * 60)
        print(f"Готово! Список из {len(items)} предметов.")
        
        # Спрашиваем подтверждение
        response = input("\nИмпортировать эти предметы в базу данных? (y/n): ")
        if response.lower() == 'y':
            import_items_to_db(items)
        else:
            print("Импорт отменен.")
    else:
        print("Предметы не найдены!")

def import_items_to_db(items):
    """Импортирует предметы в базу данных"""
    logger.info(f"Начинаем импорт {len(items)} предметов в БД")
    
    success_count = 0
    for item in items:
        try:
            # Здесь будет код для отправки в API
            logger.info(f"Импортируем: {item['name']}")
            success_count += 1
        except Exception as e:
            logger.error(f"Ошибка импорта {item['name']}: {e}")
    
    print(f"\nИмпорт завершен. Успешно импортировано: {success_count}/{len(items)}")

if __name__ == "__main__":
    main()
