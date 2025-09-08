#!/usr/bin/env python3
"""
Скрипт для парсинга предметов с dnd.su
"""

import requests
from bs4 import BeautifulSoup
import json
import time
import re
from urllib.parse import urljoin, urlparse

class DnDSuParser:
    def __init__(self):
        self.base_url = "https://dnd.su"
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        })
        
    def get_item_links(self, category="potion"):
        """Получает ссылки на предметы определенной категории"""
        url = f"{self.base_url}/items/"
        
        try:
            response = self.session.get(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Ищем ссылки на предметы
            item_links = []
            
            # Ищем все ссылки, которые ведут на страницы предметов
            for link in soup.find_all('a', href=True):
                href = link.get('href')
                if href and '/items/' in href and href != '/items/':
                    full_url = urljoin(self.base_url, href)
                    item_links.append(full_url)
            
            # Фильтруем по категории (здесь можно добавить логику фильтрации)
            if category == "potion":
                potion_links = [link for link in item_links if 'зелье' in link.lower() or 'potion' in link.lower()]
                return potion_links
            
            return item_links
            
        except Exception as e:
            print(f"Ошибка при получении списка предметов: {e}")
            return []
    
    def parse_item_page(self, url):
        """Парсит страницу конкретного предмета"""
        try:
            response = self.session.get(url)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')
            
            item_data = {
                'url': url,
                'name': '',
                'type': 'consumable',
                'rarity': 'common',
                'price': 0,
                'weight': 0,
                'description': '',
                'properties': [],
                'source': 'Player\'s Handbook',
                'author': 'Wizards of the Coast'
            }
            
            # Извлекаем название
            title = soup.find('h1')
            if title:
                item_data['name'] = title.get_text().strip()
            
            # Ищем информацию о редкости
            rarity_patterns = {
                'common': ['обычный', 'common'],
                'uncommon': ['необычный', 'uncommon'],
                'rare': ['редкий', 'rare'],
                'very_rare': ['очень редкий', 'very rare'],
                'legendary': ['легендарный', 'legendary'],
                'artifact': ['артефакт', 'artifact']
            }
            
            page_text = soup.get_text().lower()
            for rarity, patterns in rarity_patterns.items():
                if any(pattern in page_text for pattern in patterns):
                    item_data['rarity'] = rarity
                    break
            
            # Извлекаем описание
            description_elements = soup.find_all(['p', 'div'], class_=re.compile(r'description|text|content'))
            if description_elements:
                descriptions = []
                for elem in description_elements:
                    text = elem.get_text().strip()
                    if text and len(text) > 20:  # Фильтруем короткие тексты
                        descriptions.append(text)
                item_data['description'] = ' '.join(descriptions[:3])  # Берем первые 3 абзаца
            
            # Если описание не найдено, ищем в общем тексте
            if not item_data['description']:
                main_content = soup.find('main') or soup.find('div', class_=re.compile(r'content|main'))
                if main_content:
                    item_data['description'] = main_content.get_text().strip()[:500]  # Первые 500 символов
            
            # Определяем тип предмета
            if 'зелье' in item_data['name'].lower() or 'potion' in item_data['name'].lower():
                item_data['type'] = 'consumable'
            elif 'меч' in item_data['name'].lower() or 'sword' in item_data['name'].lower():
                item_data['type'] = 'weapon'
            elif 'доспех' in item_data['name'].lower() or 'armor' in item_data['name'].lower():
                item_data['type'] = 'armor'
            elif 'щит' in item_data['name'].lower() or 'shield' in item_data['name'].lower():
                item_data['type'] = 'armor'
            
            # Устанавливаем базовые значения для зелий
            if item_data['type'] == 'consumable':
                item_data['weight'] = 0.5  # Стандартный вес зелья
                item_data['price'] = self.get_potion_price(item_data['rarity'])
                item_data['properties'] = ['consumable', 'magic']
            
            return item_data
            
        except Exception as e:
            print(f"Ошибка при парсинге страницы {url}: {e}")
            return None
    
    def get_potion_price(self, rarity):
        """Возвращает примерную цену зелья в зависимости от редкости"""
        prices = {
            'common': 50,
            'uncommon': 200,
            'rare': 1000,
            'very_rare': 5000,
            'legendary': 25000,
            'artifact': 100000
        }
        return prices.get(rarity, 50)
    
    def parse_potions(self, max_items=10):
        """Парсит зелья с сайта"""
        print("Получаем список зелий...")
        item_links = self.get_item_links("potion")
        
        if not item_links:
            print("Не удалось получить список предметов")
            return []
        
        print(f"Найдено {len(item_links)} ссылок на предметы")
        
        potions = []
        for i, url in enumerate(item_links[:max_items]):
            print(f"Парсим предмет {i+1}/{min(max_items, len(item_links))}: {url}")
            
            item_data = self.parse_item_page(url)
            if item_data:
                potions.append(item_data)
                print(f"  ✓ {item_data['name']} ({item_data['rarity']})")
            else:
                print(f"  ✗ Не удалось распарсить")
            
            # Пауза между запросами
            time.sleep(1)
        
        return potions

def main():
    parser = DnDSuParser()
    
    # Парсим зелья
    potions = parser.parse_potions(max_items=5)  # Начнем с 5 зелий для теста
    
    if potions:
        # Сохраняем в JSON файл
        output_file = "parsed_potions.json"
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(potions, f, ensure_ascii=False, indent=2)
        
        print(f"\nСохранено {len(potions)} зелий в файл {output_file}")
        
        # Выводим краткую информацию
        for potion in potions:
            print(f"- {potion['name']} ({potion['rarity']}) - {potion['price']} зм")
    else:
        print("Не удалось получить данные о зельях")

if __name__ == "__main__":
    main()
