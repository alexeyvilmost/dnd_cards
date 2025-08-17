import pytest
import requests
from typing import Dict, Any
from .conftest import get_api_url

class TestUniversalInterface:
    """Тесты для универсального интерфейса создания/редактирования карт"""
    
    def test_create_mode_functionality(self, api_client: requests.Session):
        """Тест функциональности режима создания"""
        card_data = {
            "name": "Карточка из режима создания",
            "description": "Создана через универсальный интерфейс",
            "rarity": "common",
            "properties": ["light"],
            "price": 10,
            "weight": 1.0,
            "bonus_type": "damage",
            "bonus_value": "1d6",
            "damage_type": "slashing"
        }
        
        response = api_client.post(get_api_url("/cards"), json=card_data)
        assert response.status_code == 201
        created_card = response.json()
        
        # Проверяем, что карточка создалась корректно
        assert created_card["name"] == "Карточка из режима создания"
        assert created_card["description"] == "Создана через универсальный интерфейс"
        assert created_card["rarity"] == "common"
        assert created_card["properties"] == ["light"]
        assert created_card["price"] == 10
        assert created_card["weight"] == 1.0
        assert created_card["bonus_type"] == "damage"
        assert created_card["bonus_value"] == "1d6"
        assert created_card["damage_type"] == "slashing"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{created_card['id']}"))

    def test_edit_mode_functionality(self, api_client: requests.Session):
        """Тест функциональности режима редактирования"""
        # Создаем карточку для редактирования
        original_data = {
            "name": "Карточка для редактирования",
            "description": "Исходное описание",
            "rarity": "common",
            "properties": ["light"],
            "price": 5,
            "weight": 0.5,
            "bonus_type": "damage",
            "bonus_value": "1d4",
            "damage_type": "piercing"
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        card_id = original_card["id"]
        
        # Редактируем карточку
        updated_data = {
            "name": "Отредактированная карточка",
            "description": "Обновленное описание",
            "rarity": "rare",
            "properties": ["light", "finesse"],
            "price": 25,
            "weight": 1.0,
            "bonus_type": "damage",
            "bonus_value": "1d6",
            "damage_type": "piercing"
        }
        
        response = api_client.put(get_api_url(f"/cards/{card_id}"), json=updated_data)
        assert response.status_code == 200
        updated_card = response.json()
        
        # Проверяем, что карточка обновилась
        assert updated_card["name"] == "Отредактированная карточка"
        assert updated_card["description"] == "Обновленное описание"
        assert updated_card["rarity"] == "rare"
        assert updated_card["properties"] == ["light", "finesse"]
        assert updated_card["price"] == 25
        assert updated_card["weight"] == 1.0
        assert updated_card["bonus_type"] == "damage"
        assert updated_card["bonus_value"] == "1d6"
        assert updated_card["damage_type"] == "piercing"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_create_as_new_from_edit_mode(self, api_client: requests.Session):
        """Тест функции 'Создать как новую карту' из режима редактирования"""
        # Создаем исходную карточку
        original_data = {
            "name": "Исходная карточка для копирования",
            "description": "Исходное описание",
            "rarity": "uncommon",
            "properties": ["consumable"],
            "price": 15,
            "weight": 0.3,
            "bonus_type": "strength",
            "bonus_value": "+1",
            "damage_type": "bludgeoning"
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        original_id = original_card["id"]
        
        # Создаем новую карту на основе исходной (имитируем "Создать как новую")
        new_card_data = {
            "name": "Новая карточка на основе исходной",
            "description": "Новое описание",
            "rarity": "rare",
            "properties": ["consumable", "single_use"],
            "price": 50,
            "weight": 0.5,
            "bonus_type": "strength",
            "bonus_value": "+2",
            "damage_type": "bludgeoning"
        }
        
        response = api_client.post(get_api_url("/cards"), json=new_card_data)
        assert response.status_code == 201
        new_card = response.json()
        new_id = new_card["id"]
        
        # Проверяем, что новая карта создалась с новым ID
        assert new_card["id"] != original_id
        assert new_card["name"] == "Новая карточка на основе исходной"
        assert new_card["description"] == "Новое описание"
        assert new_card["rarity"] == "rare"
        assert new_card["properties"] == ["consumable", "single_use"]
        assert new_card["price"] == 50
        assert new_card["weight"] == 0.5
        assert new_card["bonus_type"] == "strength"
        assert new_card["bonus_value"] == "+2"
        assert new_card["damage_type"] == "bludgeoning"
        
        # Проверяем, что оригинальная карта осталась неизменной
        response = api_client.get(get_api_url(f"/cards/{original_id}"))
        assert response.status_code == 200
        unchanged_card = response.json()
        assert unchanged_card["name"] == "Исходная карточка для копирования"
        assert unchanged_card["description"] == "Исходное описание"
        assert unchanged_card["rarity"] == "uncommon"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{original_id}"))
        api_client.delete(get_api_url(f"/cards/{new_id}"))

    def test_edit_mode_preserves_all_fields(self, api_client: requests.Session):
        """Тест, что режим редактирования сохраняет все поля карточки"""
        # Создаем карточку со всеми полями
        original_data = {
            "name": "Полная карточка",
            "description": "Полное описание",
            "rarity": "rare",
            "properties": ["light", "finesse", "thrown"],
            "price": 100,
            "weight": 2.5,
            "bonus_type": "damage",
            "bonus_value": "1d8",
            "damage_type": "piercing",
            "image_url": "/test-image.png"
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        card_id = original_card["id"]
        
        # Редактируем только название
        update_data = {
            "name": "Обновленная полная карточка"
        }
        
        response = api_client.put(get_api_url(f"/cards/{card_id}"), json=update_data)
        assert response.status_code == 200
        updated_card = response.json()
        
        # Проверяем, что все остальные поля сохранились
        assert updated_card["name"] == "Обновленная полная карточка"
        assert updated_card["description"] == "Полное описание"
        assert updated_card["rarity"] == "rare"
        assert updated_card["properties"] == ["light", "finesse", "thrown"]
        assert updated_card["price"] == 100
        assert updated_card["weight"] == 2.5
        assert updated_card["bonus_type"] == "damage"
        assert updated_card["bonus_value"] == "1d8"
        assert updated_card["damage_type"] == "piercing"
        assert updated_card["image_url"] == "/test-image.png"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_price_formatting_in_both_modes(self, api_client: requests.Session):
        """Тест форматирования цены (зм) в обоих режимах"""
        # Тест создания с разными ценами
        test_cases = [
            {"price": 1, "expected": "1 зм"},
            {"price": 50, "expected": "50 зм"},
            {"price": 1000, "expected": "1.0K зм"},
            {"price": 1500, "expected": "1.5K зм"},
            {"price": 10000, "expected": "10.0K зм"}
        ]
        
        for i, test_case in enumerate(test_cases):
            # Создаем карточку
            card_data = {
                "name": f"Карточка с ценой {test_case['price']}",
                "description": "Тест форматирования цены",
                "rarity": "common",
                "price": test_case["price"]
            }
            
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            card_id = created_card["id"]
            
            # Проверяем, что цена сохранилась корректно
            assert created_card["price"] == test_case["price"]
            
            # Обновляем цену
            new_price = test_case["price"] * 2
            update_data = {"price": new_price}
            
            response = api_client.put(get_api_url(f"/cards/{card_id}"), json=update_data)
            assert response.status_code == 200
            updated_card = response.json()
            
            # Проверяем, что цена обновилась
            assert updated_card["price"] == new_price
            
            # Очистка
            api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_damage_type_preservation_in_edit_mode(self, api_client: requests.Session):
        """Тест сохранения типа урона в режиме редактирования"""
        damage_types = ["slashing", "piercing", "bludgeoning"]
        
        for damage_type in damage_types:
            # Создаем карточку с типом урона
            card_data = {
                "name": f"Карточка с уроном {damage_type}",
                "description": "Тест сохранения типа урона",
                "rarity": "common",
                "bonus_type": "damage",
                "bonus_value": "1d6",
                "damage_type": damage_type
            }
            
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            card_id = created_card["id"]
            
            # Проверяем, что тип урона сохранился
            assert created_card["damage_type"] == damage_type
            
            # Редактируем карточку
            update_data = {
                "name": f"Обновленная карточка с уроном {damage_type}",
                "rarity": "rare"
            }
            
            response = api_client.put(get_api_url(f"/cards/{card_id}"), json=update_data)
            assert response.status_code == 200
            updated_card = response.json()
            
            # Проверяем, что тип урона сохранился после редактирования
            assert updated_card["damage_type"] == damage_type
            assert updated_card["bonus_type"] == "damage"
            assert updated_card["bonus_value"] == "1d6"
            
            # Очистка
            api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_error_handling_in_edit_mode(self, api_client: requests.Session):
        """Тест обработки ошибок в режиме редактирования"""
        # Создаем карточку
        card_data = {
            "name": "Карточка для теста ошибок",
            "description": "Описание",
            "rarity": "common"
        }
        
        response = api_client.post(get_api_url("/cards"), json=card_data)
        assert response.status_code == 201
        created_card = response.json()
        card_id = created_card["id"]
        
        # Пытаемся обновить с неверными данными
        invalid_updates = [
            {"rarity": "invalid_rarity"},
            {"price": -10},
            {"weight": 0},
            {"bonus_type": "invalid_bonus"}
        ]
        
        for invalid_update in invalid_updates:
            response = api_client.put(get_api_url(f"/cards/{card_id}"), json=invalid_update)
            assert response.status_code == 400, f"Expected 400 for invalid update: {invalid_update}"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))
