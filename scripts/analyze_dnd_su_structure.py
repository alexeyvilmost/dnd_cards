#!/usr/bin/env python3
"""
Скрипт для анализа структуры HTML на dnd.su
"""

import requests
import re

def analyze_page_structure():
    """Анализирует структуру страницы предмета"""
    url = "https://dnd.su/items/1-adamantine-armor/"
    
    try:
        print(f"Анализируем структуру страницы: {url}")
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        
        html_content = response.text
        
        print("\n=== ПОИСК НАЗВАНИЙ ===")
        
        # Ищем различные варианты заголовков
        patterns = [
            r'<h1[^>]*>(.*?)</h1>',
            r'<h2[^>]*>(.*?)</h2>',
            r'<h3[^>]*>(.*?)</h3>',
            r'<title[^>]*>(.*?)</title>',
            r'class="[^"]*title[^"]*"[^>]*>(.*?)<',
            r'class="[^"]*name[^"]*"[^>]*>(.*?)<'
        ]
        
        for i, pattern in enumerate(patterns, 1):
            matches = re.findall(pattern, html_content, re.DOTALL | re.IGNORECASE)
            print(f"\nПаттерн {i} ({pattern}):")
            for match in matches[:3]:  # Показываем первые 3 совпадения
                clean_match = re.sub(r'<[^>]+>', '', match).strip()
                if clean_match:
                    print(f"  - {clean_match}")
        
        print("\n=== ПОИСК РЕДКОСТИ ===")
        
        # Ищем редкость
        rarity_patterns = [
            r'(обычный|необычный|редкий|очень редкий|легендарный)',
            r'(common|uncommon|rare|very rare|legendary)',
            r'редкость[:\s]*([^<>\n]+)',
            r'rarity[:\s]*([^<>\n]+)'
        ]
        
        for i, pattern in enumerate(rarity_patterns, 1):
            matches = re.findall(pattern, html_content, re.IGNORECASE)
            if matches:
                print(f"Паттерн редкости {i}: {matches}")
        
        print("\n=== ПОИСК СТОИМОСТИ ===")
        
        # Ищем стоимость
        price_patterns = [
            r'стоимость[:\s]*(\d+(?:[\s,]\d+)*)',
            r'цена[:\s]*(\d+(?:[\s,]\d+)*)',
            r'(\d+(?:[\s,]\d+)*)\s*зм',
            r'(\d+(?:[\s,]\d+)*)\s*gp'
        ]
        
        for i, pattern in enumerate(price_patterns, 1):
            matches = re.findall(pattern, html_content, re.IGNORECASE)
            if matches:
                print(f"Паттерн стоимости {i}: {matches}")
        
        print("\n=== СТРУКТУРА СТРАНИЦЫ ===")
        
        # Показываем основные элементы HTML
        if '<h1' in html_content:
            print("✓ Найден h1 заголовок")
        if '<h2' in html_content:
            print("✓ Найден h2 заголовок")
        if '<title' in html_content:
            print("✓ Найден title")
            
        # Ищем классы CSS
        css_classes = re.findall(r'class="([^"]+)"', html_content)
        unique_classes = list(set(css_classes))
        
        print(f"\nНайдено {len(unique_classes)} уникальных CSS классов")
        
        # Показываем классы, которые могут содержать название
        name_related_classes = [cls for cls in unique_classes if any(word in cls.lower() for word in ['title', 'name', 'header', 'item'])]
        if name_related_classes:
            print("Классы, связанные с названием:")
            for cls in name_related_classes[:10]:
                print(f"  - {cls}")
        
        return True
        
    except Exception as e:
        print(f"Ошибка: {e}")
        return False

if __name__ == "__main__":
    analyze_page_structure()
