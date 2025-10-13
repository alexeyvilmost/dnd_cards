#!/usr/bin/env python3
"""
Тестовый скрипт для проверки доступа к dnd.su
"""

import requests
import re

def test_dnd_su_access():
    """Тестирует доступ к dnd.su и извлекает список предметов"""
    try:
        print("Тестируем доступ к dnd.su...")
        
        response = requests.get('https://dnd.su/items/?search=&source=101', timeout=10)
        print(f"Статус ответа: {response.status_code}")
        
        # Ищем ссылки на предметы
        item_links = re.findall(r'href="(/items/[^"]+)"', response.text)
        print(f"Найдено ссылок на предметы: {len(item_links)}")
        
        # Показываем первые 15 ссылок
        print("\nПервые 15 ссылок на предметы:")
        print("-" * 50)
        for i, link in enumerate(item_links[:15], 1):
            print(f"{i:2d}. https://dnd.su{link}")
        
        # Тестируем получение деталей одного предмета
        if item_links:
            print(f"\nТестируем получение деталей первого предмета...")
            test_url = f"https://dnd.su{item_links[0]}"
            print(f"URL: {test_url}")
            
            detail_response = requests.get(test_url, timeout=10)
            print(f"Статус ответа деталей: {detail_response.status_code}")
            
            # Ищем название в HTML
            name_match = re.search(r'<h1[^>]*>(.*?)</h1>', detail_response.text)
            if name_match:
                name = name_match.group(1).strip()
                print(f"Название предмета: {name}")
            else:
                print("Не удалось найти название предмета")
        
        return len(item_links)
        
    except Exception as e:
        print(f"Ошибка: {e}")
        return 0

if __name__ == "__main__":
    count = test_dnd_su_access()
    print(f"\nТест завершен. Найдено {count} предметов для импорта.")
