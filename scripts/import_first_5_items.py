#!/usr/bin/env python3
"""
Скрипт для импорта первых 5 магических предметов в базу данных
"""

import requests
import json
import time
import logging

# Настройка логирования
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

class ItemsImporter:
    def __init__(self, api_base_url: str = "http://localhost:8080/api", auth_token: str = None):
        self.api_base_url = api_base_url
        self.session = requests.Session()
        headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'DnD-Cards-Importer/1.0'
        }
        if auth_token:
            headers['Authorization'] = f'Bearer {auth_token}'
        self.session.headers.update(headers)
    
    def create_card(self, item_data: dict) -> bool:
        """Создает карту в базе данных"""
        try:
            logger.info(f"Создаем карту: {item_data['name']}")
            
            response = self.session.post(
                f"{self.api_base_url}/cards",
                json=item_data
            )
            
            if response.status_code == 200 or response.status_code == 201:
                result = response.json()
                logger.info(f"Успешно создана карта: {item_data['name']} (ID: {result.get('id', 'unknown')})")
                return True
            else:
                logger.error(f"Ошибка создания карты {item_data['name']}: {response.status_code} - {response.text}")
                logger.error(f"Отправленные данные: {json.dumps(item_data, ensure_ascii=False, indent=2)}")
                return False
                
        except Exception as e:
            logger.error(f"Ошибка при создании карты {item_data.get('name', 'Unknown')}: {e}")
            return False

def main():
    """Основная функция"""
    logger.info("Начинаем импорт первых 5 магических предметов D&D 5e")
    print("Загружаем первые 5 магических предметов...")
    print("=" * 60)
    
    # Данные первых 5 предметов
    items_data = [
        {
            "name": "Адамантиновый доспех",
            "description": "Доспех (средний или тяжёлый, кроме шкурного), необычный. Эти доспехи усилены адамантином, одним из самых прочных из существующих веществ. Пока вы носите эти доспехи, все критические попадания по вам считаются обычными попаданиями.",
            "rarity": "uncommon",
            "price": 300,
            "weight": 45.0,
            "type": "доспех",
            "properties": ["защита"],
            "source": "D&D 5e Official - Dungeon Master's Guide",
            "author": "D&D Importer"
        },
        {
            "name": "Алхимический сосуд",
            "description": "Чудесный предмет, необычный. Этот керамический кувшин, кажется способным вместить 1 галлон жидкости и весит 12 фунтов вне зависимости от того, полный он или пустой. Вы можете действием назвать одну жидкость из таблицы, отчего кувшин начнёт её производить.",
            "rarity": "uncommon", 
            "price": 250,
            "weight": 12.0,
            "type": "чудесный предмет",
            "properties": ["магическое создание жидкостей"],
            "source": "D&D 5e Official - Dungeon Master's Guide",
            "author": "D&D Importer"
        },
        {
            "name": "Амулет здоровья",
            "description": "Чудесный предмет, редкий (требуется настройка). Пока вы носите этот амулет, ваше значение Телосложения равно 19. Если ваше Телосложение без него уже 19 или выше, то амулет не оказывает на вас никакого действия.",
            "rarity": "rare",
            "price": 2500,
            "weight": 1.0,
            "type": "аксессуар",
            "properties": ["настройка", "бонус к характеристике"],
            "attunement": "требуется настройка",
            "source": "D&D 5e Official - Dungeon Master's Guide",
            "author": "D&D Importer"
        },
        {
            "name": "Амулет планов",
            "description": "Чучесный предмет, очень редкий (требуется настройка). Пока вы носите этот амулет, вы можете действием назвать хорошо знакомое вам место на другом плане. После этого необходимо совершить проверку Интеллекта Сл 15. При успехе вы накладываете заклинание уход в иной мир.",
            "rarity": "very_rare",
            "price": 25000,
            "weight": 1.0,
            "type": "аксессуар", 
            "properties": ["настройка", "телепортация"],
            "attunement": "требуется настройка",
            "source": "D&D 5e Official - Dungeon Master's Guide",
            "author": "D&D Importer"
        },
        {
            "name": "Аппарат Квалиша",
            "description": "Чучесный предмет, легендарный. На первый взгляд этот предмет выглядит как Большая запечатанная железная бочка, весящая 500 фунтов. У бочки есть потайной затвор, который можно найти успешной проверкой Интеллекта (Расследование) Сл 20.",
            "rarity": "legendary",
            "price": 75000,
            "weight": 500.0,
            "type": "чучесный предмет",
            "properties": ["подводное исследование"],
            "source": "D&D 5e Official - Dungeon Master's Guide", 
            "author": "D&D Importer"
        }
    ]
    
    # Получаем токен авторизации
    auth_token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDc2OTVmMmUtOGY2YS00ZmYyLWIzMmQtYzc1NTZmYjU4YTMxIiwidXNlcm5hbWUiOiJpbXBvcnRlcl91c2VyIiwiaXNzIjoiZG5kLWNhcmRzLWJhY2tlbmQiLCJzdWIiOiJkNzY5NWYyZS04ZjZhLTRmZjItYjMyZC1jNzU1NmZiNThhMzEiLCJleHAiOjE3NjA0MDU4NTAsIm5iZiI6MTc2MDMxOTQ1MCwiaWF0IjoxNzYwMzE5NDUwfQ.7vn0WyCMG3BtuxSISNFbg2yLm9clEB21sPKWqNsK96M"
    
    importer = ItemsImporter(auth_token=auth_token)
    
    success_count = 0
    for i, item_data in enumerate(items_data, 1):
        print(f"\n{i}. Импортируем: {item_data['name']}")
        print(f"   Редкость: {item_data['rarity']}")
        print(f"   Тип: {item_data['type']}")
        print(f"   Цена: {item_data['price']} зм")
        
        if importer.create_card(item_data):
            success_count += 1
            print(f"   [OK] Успешно импортирован")
        else:
            print(f"   [ERROR] Ошибка импорта")
        
        time.sleep(1)  # Пауза между импортами
    
    print("\n" + "=" * 60)
    print(f"Импорт завершен!")
    print(f"Успешно импортировано: {success_count}/{len(items_data)} предметов")
    
    if success_count > 0:
        print(f"\nПроверьте результат в интерфейсе приложения!")
        print(f"Первые {success_count} магических предметов D&D 5e добавлены в базу данных.")

if __name__ == "__main__":
    main()
