import pytest
import requests
from typing import Dict, Any
from .conftest import get_api_url

class TestCardCreation:
    """Тесты для создания карточек"""
    
    def test_create_basic_card(self, api_client: requests.Session, wait_for_backend):
        """Тест создания базовой карточки"""
        card_data = {
            "name": "Тестовая карточка",
            "description": "Описание тестовой карточки",
            "rarity": "common"
        }
        
        response = api_client.post(get_api_url("/cards"), json=card_data)
        assert response.status_code == 201
        created_card = response.json()
        
        # Проверяем обязательные поля
        assert "id" in created_card
        assert created_card["name"] == "Тестовая карточка"
        assert created_card["description"] == "Описание тестовой карточки"
        assert created_card["rarity"] == "common"
        assert "card_number" in created_card
        assert created_card["card_number"].startswith("CARD-")
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
    
    def test_create_card_with_all_fields(self, api_client: requests.Session):
        """Тест создания карточки со всеми полями"""
        card_data = {
            "name": "Полная карточка",
            "description": "Карточка со всеми возможными полями",
            "rarity": "rare",
            "properties": ["consumable", "single_use"],
            "price": 500,
            "weight": 2.5,
            "bonus_type": "strength",
            "bonus_value": "+3",
            "image_url": "/test-image.png"
        }
        
        response = api_client.post(get_api_url("/cards"), json=card_data)
        assert response.status_code == 201
        created_card = response.json()
        
        # Проверяем все поля
        assert created_card["name"] == "Полная карточка"
        assert created_card["description"] == "Карточка со всеми возможными полями"
        assert created_card["rarity"] == "rare"
        assert created_card["properties"] == ["consumable", "single_use"]
        assert created_card["price"] == 500
        assert created_card["weight"] == 2.5
        assert created_card["bonus_type"] == "strength"
        assert created_card["bonus_value"] == "+3"
        assert created_card["image_url"] == "/test-image.png"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
    
    def test_create_weapon_card(self, api_client: requests.Session):
        """Тест создания карточки оружия"""
        card_data = {
            "name": "Тестовый меч",
            "description": "Острый меч для тестирования",
            "rarity": "uncommon",
            "properties": ["light", "finesse"],
            "price": 150,
            "weight": 3.0,
            "bonus_type": "damage",
            "bonus_value": "1d8"
        }
        
        response = api_client.post(get_api_url("/cards"), json=card_data)
        assert response.status_code == 201
        created_card = response.json()
        
        assert created_card["name"] == "Тестовый меч"
        assert created_card["properties"] == ["light", "finesse"]
        assert created_card["bonus_type"] == "damage"
        assert created_card["bonus_value"] == "1d8"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{created_card['id']}"))

    def test_create_card_with_damage_type(self, api_client: requests.Session):
        """Тест создания карточки с типом урона"""
        card_data = {
            "name": "Тестовый кинжал",
            "description": "Острый кинжал для тестирования",
            "rarity": "common",
            "properties": ["light", "finesse", "thrown"],
            "price": 2,
            "weight": 1.0,
            "bonus_type": "damage",
            "bonus_value": "1d4",
            "damage_type": "piercing"
        }
        
        print(f"DEBUG: Sending card data: {card_data}")
        
        response = api_client.post(get_api_url("/cards"), json=card_data)
        print(f"DEBUG: Response status: {response.status_code}")
        print(f"DEBUG: Response body: {response.text}")
        
        assert response.status_code == 201
        created_card = response.json()
        
        print(f"DEBUG: Created card: {created_card}")
        
        # Проверяем, что damage_type сохранился
        assert created_card["name"] == "Тестовый кинжал"
        assert created_card["properties"] == ["light", "finesse", "thrown"]
        assert created_card["bonus_type"] == "damage"
        assert created_card["bonus_value"] == "1d4"
        assert created_card["damage_type"] == "piercing", f"Expected 'piercing', got {created_card.get('damage_type')}"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{created_card['id']}"))

    def test_create_card_with_different_damage_types(self, api_client: requests.Session):
        """Тест создания карточек с разными типами урона"""
        damage_types = ["slashing", "piercing", "bludgeoning"]
        
        for damage_type in damage_types:
            card_data = {
                "name": f"Тестовое оружие {damage_type}",
                "description": f"Оружие с типом урона {damage_type}",
                "rarity": "common",
                "properties": ["light"],
                "price": 10,
                "weight": 2.0,
                "bonus_type": "damage",
                "bonus_value": "1d6",
                "damage_type": damage_type
            }
            
            print(f"DEBUG: Testing damage_type: {damage_type}")
            
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            
            print(f"DEBUG: Created card damage_type: {created_card.get('damage_type')}")
            
            assert created_card["damage_type"] == damage_type, f"Expected {damage_type}, got {created_card.get('damage_type')}"
            
            # Очистка
            api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
    
    def test_create_card_with_different_rarities(self, api_client: requests.Session):
        """Тест создания карточек с разными редкостями"""
        rarities = ["common", "uncommon", "rare", "very_rare", "artifact"]
        
        for rarity in rarities:
            card_data = {
                "name": f"Карточка {rarity}",
                "description": f"Тестовая карточка редкости {rarity}",
                "rarity": rarity
            }
            
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            assert created_card["rarity"] == rarity
            
            # Очистка
            api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
    
    def test_create_card_with_different_properties(self, api_client: requests.Session):
        """Тест создания карточек с разными свойствами"""
        properties_sets = [
            ["consumable"],
            ["single_use"],
            ["light", "finesse"],
            ["heavy", "two-handed"],
            ["thrown", "ammunition"],
            ["versatile", "reach"]
        ]
        
        for properties in properties_sets:
            card_data = {
                "name": f"Карточка с {len(properties)} свойствами",
                "description": f"Тестовая карточка с свойствами: {', '.join(properties)}",
                "rarity": "common",
                "properties": properties
            }
            
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            assert created_card["properties"] == properties
            
            # Очистка
            api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
    
    def test_create_card_with_different_bonus_types(self, api_client: requests.Session):
        """Тест создания карточек с разными типами бонусов"""
        bonus_types = [
            ("damage", "1d6"),
            ("defense", "+2"),
            ("attack", "+1"),
            ("armor_class", "15"),
            ("initiative", "+3"),
            ("stealth", "advantage")
        ]
        
        for bonus_type, bonus_value in bonus_types:
            card_data = {
                "name": f"Карточка с бонусом {bonus_type}",
                "description": f"Тестовая карточка с бонусом {bonus_type}",
                "rarity": "common",
                "bonus_type": bonus_type,
                "bonus_value": bonus_value
            }
            
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            assert created_card["bonus_type"] == bonus_type
            assert created_card["bonus_value"] == bonus_value
            
            # Очистка
            api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
    
    def test_card_number_uniqueness(self, api_client: requests.Session):
        """Тест уникальности номеров карточек"""
        card_data = {
            "name": "Тест уникальности",
            "description": "Тестовая карточка",
            "rarity": "common"
        }
        
        # Создаем несколько карточек
        card_numbers = set()
        for i in range(5):
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            card_numbers.add(created_card["card_number"])
            
            # Очистка
            api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
        
        # Проверяем, что все номера уникальны
        assert len(card_numbers) == 5
    
    def test_create_card_validation_errors(self, api_client: requests.Session):
        """Тест валидации при создании карточек"""
        # Отсутствует обязательное поле name
        invalid_data = {
            "description": "Описание",
            "rarity": "common"
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
        
        # Отсутствует обязательное поле description
        invalid_data = {
            "name": "Тест",
            "rarity": "common"
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
        
        # Отсутствует обязательное поле rarity
        invalid_data = {
            "name": "Тест",
            "description": "Описание"
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
        
        # Неверная редкость
        invalid_data = {
            "name": "Тест",
            "description": "Описание",
            "rarity": "invalid_rarity"
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
        
        # Неверная цена
        invalid_data = {
            "name": "Тест",
            "description": "Описание",
            "rarity": "common",
            "price": -10
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
        
        # Неверный вес
        invalid_data = {
            "name": "Тест",
            "description": "Описание",
            "rarity": "common",
            "weight": 0
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
        
        # Неверный тип бонуса
        invalid_data = {
            "name": "Тест",
            "description": "Описание",
            "rarity": "common",
            "bonus_type": "invalid_bonus"
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
    
    def test_create_card_appears_in_library(self, api_client: requests.Session):
        """Тест, что созданная карточка появляется в библиотеке"""
        card_data = {
            "name": "Карточка для библиотеки",
            "description": "Тестовая карточка для проверки появления в библиотеке",
            "rarity": "uncommon",
            "properties": ["consumable"],
            "price": 100
        }
        
        # Создаем карточку
        response = api_client.post(get_api_url("/cards"), json=card_data)
        assert response.status_code == 201
        created_card = response.json()
        card_id = created_card["id"]
        
        # Проверяем, что карточка есть в библиотеке
        response = api_client.get(get_api_url("/cards"))
        assert response.status_code == 200
        cards_data = response.json()
        
        found_card = None
        for card in cards_data["cards"]:
            if card["id"] == card_id:
                found_card = card
                break
        
        assert found_card is not None, "Created card not found in library"
        assert found_card["name"] == "Карточка для библиотеки"
        assert found_card["rarity"] == "uncommon"
        assert found_card["properties"] == ["consumable"]
        assert found_card["price"] == 100
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))
    
    def test_create_multiple_cards_and_verify_count(self, api_client: requests.Session):
        """Тест создания нескольких карточек и проверки их количества"""
        # Получаем начальное количество карточек
        response = api_client.get(get_api_url("/cards"))
        assert response.status_code == 200
        initial_count = response.json()["total"]
        
        # Создаем несколько карточек
        created_ids = []
        for i in range(3):
            card_data = {
                "name": f"Тестовая карточка {i+1}",
                "description": f"Описание карточки {i+1}",
                "rarity": "common"
            }
            
            response = api_client.post(get_api_url("/cards"), json=card_data)
            assert response.status_code == 201
            created_card = response.json()
            created_ids.append(created_card["id"])
        
        # Проверяем, что количество увеличилось
        response = api_client.get(get_api_url("/cards"))
        assert response.status_code == 200
        final_count = response.json()["total"]
        assert final_count == initial_count + 3
        
        # Очистка
        for card_id in created_ids:
            api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_edit_card_functionality(self, api_client: requests.Session):
        """Тест функциональности редактирования карточки"""
        # Создаем карточку для редактирования
        original_data = {
            "name": "Оригинальная карточка",
            "description": "Оригинальное описание",
            "rarity": "common",
            "properties": ["light"],
            "price": 10,
            "weight": 1.0,
            "bonus_type": "damage",
            "bonus_value": "1d6",
            "damage_type": "slashing"
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        card_id = original_card["id"]
        
        # Редактируем карточку
        updated_data = {
            "name": "Обновленная карточка",
            "description": "Обновленное описание",
            "rarity": "rare",
            "properties": ["light", "finesse"],
            "price": 50,
            "weight": 2.0,
            "bonus_type": "damage",
            "bonus_value": "1d8",
            "damage_type": "piercing"
        }
        
        response = api_client.put(get_api_url(f"/cards/{card_id}"), json=updated_data)
        assert response.status_code == 200
        updated_card = response.json()
        
        # Проверяем, что карточка обновилась
        assert updated_card["name"] == "Обновленная карточка"
        assert updated_card["description"] == "Обновленное описание"
        assert updated_card["rarity"] == "rare"
        assert updated_card["properties"] == ["light", "finesse"]
        assert updated_card["price"] == 50
        assert updated_card["weight"] == 2.0
        assert updated_card["bonus_type"] == "damage"
        assert updated_card["bonus_value"] == "1d8"
        assert updated_card["damage_type"] == "piercing"
        
        # Проверяем, что ID остался тем же
        assert updated_card["id"] == card_id
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_create_as_new_card_functionality(self, api_client: requests.Session):
        """Тест функциональности 'Создать как новую карту'"""
        # Создаем исходную карточку
        original_data = {
            "name": "Исходная карточка",
            "description": "Исходное описание",
            "rarity": "uncommon",
            "properties": ["consumable"],
            "price": 25,
            "weight": 0.5,
            "bonus_type": "strength",
            "bonus_value": "+2",
            "damage_type": "bludgeoning"
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        original_id = original_card["id"]
        
        # Создаем новую карту на основе исходной (имитируем функцию "Создать как новую")
        new_card_data = {
            "name": "Новая карточка на основе исходной",
            "description": "Новое описание",
            "rarity": "rare",
            "properties": ["consumable", "single_use"],
            "price": 100,
            "weight": 1.0,
            "bonus_type": "strength",
            "bonus_value": "+3",
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
        assert new_card["price"] == 100
        assert new_card["weight"] == 1.0
        assert new_card["bonus_type"] == "strength"
        assert new_card["bonus_value"] == "+3"
        assert new_card["damage_type"] == "bludgeoning"
        
        # Проверяем, что оригинальная карта осталась неизменной
        response = api_client.get(get_api_url(f"/cards/{original_id}"))
        assert response.status_code == 200
        unchanged_card = response.json()
        assert unchanged_card["name"] == "Исходная карточка"
        assert unchanged_card["description"] == "Исходное описание"
        assert unchanged_card["rarity"] == "uncommon"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{original_id}"))
        api_client.delete(get_api_url(f"/cards/{new_id}"))

    def test_edit_card_partial_update(self, api_client: requests.Session):
        """Тест частичного обновления карточки при редактировании"""
        # Создаем карточку
        original_data = {
            "name": "Карточка для частичного обновления",
            "description": "Полное описание",
            "rarity": "common",
            "properties": ["light", "finesse"],
            "price": 15,
            "weight": 1.5,
            "bonus_type": "damage",
            "bonus_value": "1d6",
            "damage_type": "piercing"
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        card_id = original_card["id"]
        
        # Обновляем только некоторые поля
        partial_update = {
            "name": "Обновленное название",
            "rarity": "rare"
        }
        
        response = api_client.put(get_api_url(f"/cards/{card_id}"), json=partial_update)
        assert response.status_code == 200
        updated_card = response.json()
        
        # Проверяем, что обновились только указанные поля
        assert updated_card["name"] == "Обновленное название"
        assert updated_card["rarity"] == "rare"
        
        # Проверяем, что остальные поля остались неизменными
        assert updated_card["description"] == "Полное описание"
        assert updated_card["properties"] == ["light", "finesse"]
        assert updated_card["price"] == 15
        assert updated_card["weight"] == 1.5
        assert updated_card["bonus_type"] == "damage"
        assert updated_card["bonus_value"] == "1d6"
        assert updated_card["damage_type"] == "piercing"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_edit_card_preserves_damage_type(self, api_client: requests.Session):
        """Тест, что при редактировании карточки сохраняется тип урона"""
        # Создаем карточку с типом урона
        original_data = {
            "name": "Карточка с типом урона",
            "description": "Описание",
            "rarity": "common",
            "bonus_type": "damage",
            "bonus_value": "1d4",
            "damage_type": "piercing"
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        card_id = original_card["id"]
        
        # Редактируем карточку, изменяя только название
        update_data = {
            "name": "Обновленная карточка с типом урона"
        }
        
        response = api_client.put(get_api_url(f"/cards/{card_id}"), json=update_data)
        assert response.status_code == 200
        updated_card = response.json()
        
        # Проверяем, что тип урона сохранился
        assert updated_card["damage_type"] == "piercing"
        assert updated_card["bonus_type"] == "damage"
        assert updated_card["bonus_value"] == "1d4"
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))

    def test_edit_card_with_price_formatting(self, api_client: requests.Session):
        """Тест редактирования карточки с форматированием цены (зм)"""
        # Создаем карточку
        original_data = {
            "name": "Карточка для теста цены",
            "description": "Описание",
            "rarity": "common",
            "price": 5
        }
        
        response = api_client.post(get_api_url("/cards"), json=original_data)
        assert response.status_code == 201
        original_card = response.json()
        card_id = original_card["id"]
        
        # Обновляем цену
        update_data = {
            "price": 1500  # Должно отображаться как "1.5K зм"
        }
        
        response = api_client.put(get_api_url(f"/cards/{card_id}"), json=update_data)
        assert response.status_code == 200
        updated_card = response.json()
        
        # Проверяем, что цена обновилась
        assert updated_card["price"] == 1500
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{card_id}"))
