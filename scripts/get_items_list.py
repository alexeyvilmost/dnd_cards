#!/usr/bin/env python3
"""
Скрипт для получения списка предметов с dnd.su для одобрения
"""

import requests
import re
import time
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def get_items_list():
    """Получает список предметов с нескольких страниц"""
    all_items = []
    max_items = 50  # Ограничиваем количество предметов
    max_pages = 2   # Ограничиваем количество страниц
    
    logger.info(f"Начинаем получение списка предметов (максимум {max_items} предметов, {max_pages} страниц)")
    
    # Получаем предметы с ограниченного количества страниц
    for page in range(1, max_pages + 1):
        logger.info(f"Обрабатываем страницу {page}...")
        
        try:
            url = f"https://dnd.su/items/?search=&source=101&page={page}"
            logger.info(f"Запрашиваем URL: {url}")
            
            response = requests.get(url, timeout=15)
            response.raise_for_status()
            logger.info(f"Получен ответ со страницы {page}, статус: {response.status_code}")
            
            # Ищем ссылки на предметы
            item_links = re.findall(r'href="(/items/[^"]+)"', response.text)
            logger.info(f"Найдено {len(item_links)} ссылок на странице {page}")
            
            if not item_links:
                logger.warning(f"На странице {page} не найдено ссылок на предметы")
                break
            
            processed_on_page = 0
            for i, link in enumerate(item_links):
                if len(all_items) >= max_items:
                    logger.info(f"Достигнуто максимальное количество предметов ({max_items})")
                    break
                    
                full_url = f"https://dnd.su{link}"
                logger.info(f"Обрабатываем предмет {len(all_items)+1}/{max_items}: {full_url}")
                
                # Получаем название предмета
                try:
                    item_response = requests.get(full_url, timeout=15)
                    item_response.raise_for_status()
                    
                    # Ищем название в заголовке h1
                    name_match = re.search(r'<h1[^>]*>(.*?)</h1>', item_response.text)
                    if name_match:
                        name = name_match.group(1).strip()
                        # Очищаем от HTML тегов
                        name = re.sub(r'<[^>]+>', '', name)
                        
                        # Ищем редкость
                        rarity_match = re.search(r'(обычный|необычный|редкий|очень редкий|легендарный)', item_response.text, re.IGNORECASE)
                        rarity = rarity_match.group(1) if rarity_match else "неизвестно"
                        
                        all_items.append({
                            'name': name,
                            'url': full_url,
                            'rarity': rarity
                        })
                        
                        logger.info(f"Успешно добавлен предмет: {name} ({rarity})")
                        processed_on_page += 1
                    else:
                        logger.warning(f"Не найдено название в {full_url}")
                    
                    time.sleep(0.5)  # Увеличиваем паузу между запросами
                    
                except Exception as e:
                    logger.error(f"Ошибка при получении {full_url}: {e}")
                    continue
            
            logger.info(f"Страница {page}: обработано {processed_on_page} предметов из {len(item_links)}")
            time.sleep(2)  # Увеличиваем паузу между страницами
            
            if len(all_items) >= max_items:
                logger.info(f"Достигнуто максимальное количество предметов ({max_items}), завершаем")
                break
            
        except Exception as e:
            logger.error(f"Ошибка при получении страницы {page}: {e}")
            continue
    
    logger.info(f"Завершено. Всего получено предметов: {len(all_items)}")
    return all_items

def main():
    """Основная функция"""
    logger.info("Запуск скрипта получения списка предметов")
    print("Получаем список магических предметов D&D 5e...")
    print("=" * 60)
    
    try:
        items = get_items_list()
        
        print(f"\nНайдено предметов: {len(items)}")
        print("=" * 60)
        
        if items:
            # Показываем все найденные предметы
            print(f"Список предметов для импорта:")
            print("-" * 60)
            
            for i, item in enumerate(items, 1):
                print(f"{i:2d}. {item['name']} ({item['rarity']})")
            
            print("\n" + "=" * 60)
            print(f"Готово! Список из {len(items)} предметов для одобрения.")
            logger.info(f"Успешно получен список из {len(items)} предметов")
        else:
            print("Предметы не найдены!")
            logger.warning("Список предметов пуст")
        
        return items
        
    except Exception as e:
        logger.error(f"Критическая ошибка в main(): {e}")
        print(f"Критическая ошибка: {e}")
        return []

if __name__ == "__main__":
    items = main()
