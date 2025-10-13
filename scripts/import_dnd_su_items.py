#!/usr/bin/env python3
"""
Скрипт для импорта магических предметов D&D 5e с сайта dnd.su
"""

import requests
import json
import time
import re
from typing import List, Dict, Any, Optional
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class DnDSuImporter:
    def __init__(self, api_base_url: str = "http://localhost:8080/api"):
        self.api_base_url = api_base_url
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'DnD-Cards-Importer/1.0'
        })
    
    def parse_item_from_html(self, html_content: str) -> Optional[Dict[str, Any]]:
        """Парсит HTML страницу предмета и извлекает данные"""
        try:
            # Извлекаем название
            name_match = re.search(r'<h1[^>]*>(.*?)</h1>', html_content)
            if not name_match:
                return None
            
            name = name_match.group(1).strip()
            
            # Извлекаем описание (содержимое между h1 и следующим элементом)
            description_match = re.search(r'</h1>\s*(.*?)(?=<h2|$)', html_content, re.DOTALL)
            description = ""
            if description_match:
                description = self.clean_html(description_match.group(1))
            
            # Извлекаем редкость
            rarity = self.extract_rarity(html_content)
            
            # Извлекаем стоимость
            price = self.extract_price(html_content)
            
            # Извлекаем вес (если указан)
            weight = self.extract_weight(html_content)
            
            # Определяем тип предмета
            item_type = self.determine_item_type(name, html_content)
            
            # Определяем слот экипировки
            equipment_slot = self.determine_equipment_slot(name, html_content)
            
            # Извлекаем свойства
            properties = self.extract_properties(html_content)
            
            # Определяем настройку
            attunement = "требуется настройка" if "требуется настройка" in html_content else None
            
            return {
                "name": name,
                "description": description,
                "rarity": rarity,
                "price": price,
                "weight": weight,
                "type": item_type,
                "equipment_slot": equipment_slot,
                "properties": properties,
                "attunement": attunement,
                "source": "D&D 5e Official",
                "template_type": "magic_item"
            }
            
        except Exception as e:
            logger.error(f"Ошибка при парсинге предмета: {e}")
            return None
    
    def clean_html(self, html_text: str) -> str:
        """Очищает HTML теги и форматирует текст"""
        # Убираем HTML теги
        clean_text = re.sub(r'<[^>]+>', '', html_text)
        # Заменяем множественные пробелы на одинарные
        clean_text = re.sub(r'\s+', ' ', clean_text)
        # Убираем пробелы в начале и конце
        clean_text = clean_text.strip()
        return clean_text
    
    def extract_rarity(self, html_content: str) -> str:
        """Извлекает редкость предмета"""
        rarity_patterns = {
            "common": r"обычный|common",
            "uncommon": r"необычный|uncommon", 
            "rare": r"редкий|rare",
            "very_rare": r"очень редкий|very rare",
            "legendary": r"легендарный|legendary"
        }
        
        for rarity, pattern in rarity_patterns.items():
            if re.search(pattern, html_content, re.IGNORECASE):
                return rarity
        
        return "common"  # По умолчанию
    
    def extract_price(self, html_content: str) -> Optional[int]:
        """Извлекает стоимость предмета"""
        price_match = re.search(r"стоимость[:\s]*(\d+(?:[\s,]\d+)*)", html_content, re.IGNORECASE)
        if price_match:
            price_str = price_match.group(1).replace(' ', '').replace(',', '')
            try:
                return int(price_str)
            except ValueError:
                pass
        
        # Попробуем найти стоимость в другом формате
        price_match = re.search(r"(\d+[\s,]*\d*)\s*зм", html_content, re.IGNORECASE)
        if price_match:
            price_str = price_match.group(1).replace(' ', '').replace(',', '')
            try:
                return int(price_str)
            except ValueError:
                pass
        
        return None
    
    def extract_weight(self, html_content: str) -> Optional[int]:
        """Извлекает вес предмета"""
        weight_match = re.search(r"весит[:\s]*(\d+(?:[\s,]\d+)*)\s*(?:фунт|pound)", html_content, re.IGNORECASE)
        if weight_match:
            weight_str = weight_match.group(1).replace(' ', '').replace(',', '')
            try:
                return int(weight_str)
            except ValueError:
                pass
        return None
    
    def determine_item_type(self, name: str, html_content: str) -> str:
        """Определяет тип предмета по названию и описанию"""
        name_lower = name.lower()
        content_lower = html_content.lower()
        
        if any(word in name_lower for word in ['меч', 'sword', 'кинжал', 'dagger', 'топор', 'axe']):
            return 'оружие'
        elif any(word in name_lower for word in ['доспех', 'armor', 'кольчуга', 'mail', 'щит', 'shield']):
            return 'доспех'
        elif any(word in name_lower for word in ['палочка', 'wand', 'посох', 'staff', 'жезл', 'rod']):
            return 'волшебный предмет'
        elif any(word in name_lower for word in ['амулет', 'amulet', 'кольцо', 'ring', 'браслет', 'bracelet']):
            return 'аксессуар'
        elif any(word in name_lower for word in ['з portion', 'зелье', 'elixir', 'мазь', 'ointment']):
            return 'зелье'
        else:
            return 'чудесный предмет'
    
    def determine_equipment_slot(self, name: str, html_content: str) -> Optional[str]:
        """Определяет слот экипировки"""
        name_lower = name.lower()
        content_lower = html_content.lower()
        
        if any(word in name_lower for word in ['кольцо', 'ring']):
            return 'ring'
        elif any(word in name_lower for word in ['амулет', 'amulet', 'кулон', 'pendant']):
            return 'necklace'
        elif any(word in name_lower for word in ['доспех', 'armor', 'кольчуга', 'mail']):
            return 'body'
        elif any(word in name_lower for word in ['щит', 'shield']):
            return 'one_hand'
        elif any(word in name_lower for word in ['меч', 'sword', 'кинжал', 'dagger']):
            return 'one_hand'
        elif any(word in name_lower for word in ['посох', 'staff', 'палочка', 'wand']):
            return 'two_hands'
        
        return None
    
    def extract_properties(self, html_content: str) -> Optional[str]:
        """Извлекает свойства предмета"""
        # Ищем упоминания магических свойств
        properties = []
        
        if 'настройка' in html_content.lower():
            properties.append('настройка')
        
        # Можно добавить больше паттернов для извлечения свойств
        # в зависимости от того, как они описаны на сайте
        
        return ', '.join(properties) if properties else None
    
    def get_item_list(self, page: int = 1) -> List[str]:
        """Получает список ссылок на предметы с указанной страницы"""
        try:
            url = f"https://dnd.su/items/?search=&source=101&page={page}"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            
            # Извлекаем ссылки на предметы
            item_links = re.findall(r'href="(/items/[^"]+)"', response.text)
            
            # Убираем дубликаты и возвращаем полные URL
            unique_links = list(set(item_links))
            return [f"https://dnd.su{link}" for link in unique_links]
            
        except Exception as e:
            logger.error(f"Ошибка при получении списка предметов со страницы {page}: {e}")
            return []
    
    def get_item_details(self, item_url: str) -> Optional[Dict[str, Any]]:
        """Получает детальную информацию о предмете"""
        try:
            response = requests.get(item_url, timeout=10)
            response.raise_for_status()
            return self.parse_item_from_html(response.text)
        except Exception as e:
            logger.error(f"Ошибка при получении деталей предмета {item_url}: {e}")
            return None
    
    def create_card(self, item_data: Dict[str, Any]) -> bool:
        """Создает карту в базе данных"""
        try:
            response = self.session.post(
                f"{self.api_base_url}/cards",
                json=item_data
            )
            response.raise_for_status()
            return True
        except Exception as e:
            logger.error(f"Ошибка при создании карты {item_data.get('name', 'Unknown')}: {e}")
            return False
    
    def import_batch(self, batch_size: int = 50) -> List[str]:
        """Импортирует батч предметов"""
        imported_items = []
        
        # Получаем список предметов с первой страницы
        item_urls = self.get_item_list(1)
        
        if not item_urls:
            logger.error("Не удалось получить список предметов")
            return imported_items
        
        logger.info(f"Найдено {len(item_urls)} предметов для импорта")
        
        for i, item_url in enumerate(item_urls[:batch_size]):
            logger.info(f"Обрабатываем предмет {i+1}/{batch_size}: {item_url}")
            
            item_data = self.get_item_details(item_url)
            if item_data:
                if self.create_card(item_data):
                    imported_items.append(item_data['name'])
                    logger.info(f"✓ Импортирован: {item_data['name']}")
                else:
                    logger.error(f"✗ Ошибка импорта: {item_data['name']}")
            else:
                logger.error(f"✗ Не удалось получить данные для {item_url}")
            
            # Пауза между запросами
            time.sleep(0.5)
        
        return imported_items

def main():
    """Основная функция"""
    importer = DnDSuImporter()
    
    print("🚀 Начинаем импорт магических предметов D&D 5e")
    print("=" * 50)
    
    # Импортируем первый батч
    imported_items = importer.import_batch(50)
    
    print("\n📋 Результаты импорта:")
    print("=" * 50)
    
    if imported_items:
        print(f"✅ Успешно импортировано: {len(imported_items)} предметов")
        print("\n📝 Список импортированных предметов:")
        for i, item_name in enumerate(imported_items, 1):
            print(f"{i:2d}. {item_name}")
    else:
        print("❌ Не удалось импортировать ни одного предмета")
    
    print(f"\n🎯 Готово! Импортировано {len(imported_items)} предметов.")

if __name__ == "__main__":
    main()
