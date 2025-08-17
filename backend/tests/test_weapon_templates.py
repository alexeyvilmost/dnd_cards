import pytest
import requests
from typing import Dict, Any
from .conftest import get_api_url

class TestWeaponTemplates:
    """Тесты для шаблонов оружия"""
    
    def test_get_weapon_templates(self, api_client: requests.Session, wait_for_backend):
        """Тест получения всех шаблонов оружия"""
        response = api_client.get(get_api_url("/weapon-templates"))
        assert response.status_code == 200
        templates = response.json()
        
        assert isinstance(templates, list)
        assert len(templates) > 0
        
        # Проверяем структуру первого шаблона
        template = templates[0]
        required_fields = ["id", "name", "name_en", "category", "damage_type", 
                          "damage", "weight", "price", "properties", "image_path"]
        for field in required_fields:
            assert field in template
    
    def test_get_weapon_templates_by_category(self, api_client: requests.Session):
        """Тест фильтрации шаблонов по категории"""
        categories = ["simple_melee", "martial_melee", "simple_ranged", "martial_ranged"]
        
        for category in categories:
            response = api_client.get(get_api_url(f"/weapon-templates?category={category}"))
            assert response.status_code == 200
            templates = response.json()
            
            # Проверяем, что все шаблоны имеют указанную категорию
            for template in templates:
                assert template["category"] == category
    
    def test_get_weapon_template_by_id(self, api_client: requests.Session):
        """Тест получения шаблона по ID"""
        # Сначала получаем список шаблонов
        response = api_client.get(get_api_url("/weapon-templates"))
        assert response.status_code == 200
        templates = response.json()
        assert len(templates) > 0
        
        # Получаем первый шаблон по ID
        template_id = templates[0]["id"]
        response = api_client.get(get_api_url(f"/weapon-templates/{template_id}"))
        assert response.status_code == 200
        template = response.json()
        
        assert template["id"] == template_id
        assert "name" in template
        assert "category" in template
        assert "damage" in template
        assert "properties" in template
    
    def test_get_nonexistent_weapon_template(self, api_client: requests.Session):
        """Тест получения несуществующего шаблона"""
        response = api_client.get(get_api_url("/weapon-templates/99999"))
        assert response.status_code == 404
    
    def test_weapon_template_properties_format(self, api_client: requests.Session):
        """Тест формата свойств в шаблонах"""
        response = api_client.get(get_api_url("/weapon-templates"))
        assert response.status_code == 200
        templates = response.json()
        
        for template in templates:
            # Свойства должны быть списком строк
            assert isinstance(template["properties"], list)
            for prop in template["properties"]:
                assert isinstance(prop, str)
    
    def test_weapon_template_validation(self, api_client: requests.Session):
        """Тест валидации данных шаблонов"""
        response = api_client.get(get_api_url("/weapon-templates"))
        assert response.status_code == 200
        templates = response.json()
        
        for template in templates:
            # Проверяем категории
            assert template["category"] in ["simple_melee", "martial_melee", "simple_ranged", "martial_ranged"]
            
            # Проверяем типы урона
            assert template["damage_type"] in ["slashing", "piercing", "bludgeoning"]
            
            # Проверяем диапазоны значений
            assert 0.01 <= template["weight"] <= 1000
            assert 1 <= template["price"] <= 50000
    
    def test_create_card_from_template(self, api_client: requests.Session):
        """Тест создания карточки из шаблона"""
        # Получаем шаблон
        response = api_client.get(get_api_url("/weapon-templates"))
        assert response.status_code == 200
        templates = response.json()
        template = templates[0]  # Берем первый шаблон
        
        # Создаем карточку на основе шаблона
        card_data = {
            "name": template["name"],
            "description": f"{template['name']} - это оружие, наносящее {template['damage']} урона.",
            "rarity": "common",
            "properties": template["properties"],
            "price": template["price"],
            "weight": template["weight"],
            "bonus_type": "damage",
            "bonus_value": template["damage"]
        }
        
        response = api_client.post(get_api_url("/cards"), json=card_data)
        assert response.status_code == 201
        created_card = response.json()
        
        # Проверяем, что карточка создана правильно
        assert created_card["name"] == template["name"]
        assert created_card["properties"] == template["properties"]
        assert created_card["price"] == template["price"]
        assert created_card["weight"] == template["weight"]
        assert created_card["bonus_type"] == "damage"
        assert created_card["bonus_value"] == template["damage"]
        
        # Очистка
        api_client.delete(get_api_url(f"/cards/{created_card['id']}"))
    
    def test_template_categories_coverage(self, api_client: requests.Session):
        """Тест покрытия всех категорий оружия"""
        categories = ["simple_melee", "martial_melee", "simple_ranged", "martial_ranged"]
        found_categories = set()
        
        response = api_client.get(get_api_url("/weapon-templates"))
        assert response.status_code == 200
        templates = response.json()
        
        for template in templates:
            found_categories.add(template["category"])
        
        # Проверяем, что есть шаблоны для всех категорий
        for category in categories:
            assert category in found_categories, f"Missing templates for category: {category}"
    
    def test_template_damage_types_coverage(self, api_client: requests.Session):
        """Тест покрытия всех типов урона"""
        damage_types = ["slashing", "piercing", "bludgeoning"]
        found_damage_types = set()
        
        response = api_client.get(get_api_url("/weapon-templates"))
        assert response.status_code == 200
        templates = response.json()
        
        for template in templates:
            found_damage_types.add(template["damage_type"])
        
        # Проверяем, что есть шаблоны для всех типов урона
        for damage_type in damage_types:
            assert damage_type in found_damage_types, f"Missing templates for damage type: {damage_type}"
