import pytest
import requests
from typing import Dict, Any
from .conftest import get_api_url

class TestCardsLibrary:
    """Тесты для библиотеки карточек"""
    
    def test_get_cards_list(self, api_client: requests.Session, wait_for_backend):
        """Тест получения списка карточек"""
        response = api_client.get(get_api_url("/cards"))
        assert response.status_code == 200
        data = response.json()
        assert "cards" in data
        assert "total" in data
        assert "page" in data
        assert "limit" in data
        assert isinstance(data["cards"], list)
        assert isinstance(data["total"], int)
        assert isinstance(data["page"], int)
        assert isinstance(data["limit"], int)
    
    def test_get_cards_with_pagination(self, api_client: requests.Session):
        """Тест пагинации карточек"""
        # Первая страница
        response = api_client.get(get_api_url("/cards?page=1&limit=5"))
        assert response.status_code == 200
        data = response.json()
        assert data["page"] == 1
        assert data["limit"] == 5
        assert len(data["cards"]) <= 5
        
        # Вторая страница
        response = api_client.get(get_api_url("/cards?page=2&limit=5"))
        assert response.status_code == 200
        data = response.json()
        assert data["page"] == 2
    
    def test_get_cards_with_rarity_filter(self, api_client: requests.Session):
        """Тест фильтрации по редкости"""
        response = api_client.get(get_api_url("/cards?rarity=common"))
        assert response.status_code == 200
        data = response.json()
        
        # Проверяем, что все карточки имеют указанную редкость
        for card in data["cards"]:
            assert card["rarity"] == "common"
    
    def test_get_cards_with_properties_filter(self, api_client: requests.Session):
        """Тест фильтрации по свойствам"""
        response = api_client.get(get_api_url("/cards?properties=consumable"))
        assert response.status_code == 200
        data = response.json()
        
        # Проверяем, что все карточки имеют указанное свойство
        for card in data["cards"]:
            if card["properties"]:
                assert "consumable" in card["properties"]
    
    def test_get_cards_with_search(self, api_client: requests.Session):
        """Тест поиска по названию"""
        response = api_client.get(get_api_url("/cards?search=Зелье"))
        assert response.status_code == 200
        data = response.json()
        
        # Проверяем, что все карточки содержат искомое слово
        for card in data["cards"]:
            assert "Зелье" in card["name"]
    
    def test_get_single_card(self, api_client: requests.Session, created_card_id: str):
        """Тест получения одной карточки"""
        response = api_client.get(get_api_url(f"/cards/{created_card_id}"))
        assert response.status_code == 200
        card = response.json()
        
        assert card["id"] == created_card_id
        assert "name" in card
        assert "description" in card
        assert "rarity" in card
        assert "card_number" in card
        assert "created_at" in card
        assert "updated_at" in card
    
    def test_get_nonexistent_card(self, api_client: requests.Session):
        """Тест получения несуществующей карточки"""
        response = api_client.get(get_api_url("/cards/00000000-0000-0000-0000-000000000000"))
        assert response.status_code == 404
    
    def test_update_card(self, api_client: requests.Session, created_card_id: str):
        """Тест обновления карточки"""
        update_data = {
            "name": "Обновленная карточка",
            "description": "Новое описание",
            "price": 75
        }
        
        response = api_client.put(get_api_url(f"/cards/{created_card_id}"), json=update_data)
        assert response.status_code == 200
        updated_card = response.json()
        
        assert updated_card["name"] == "Обновленная карточка"
        assert updated_card["description"] == "Новое описание"
        assert updated_card["price"] == 75
        
        # Проверяем, что изменения сохранились
        response = api_client.get(get_api_url(f"/cards/{created_card_id}"))
        assert response.status_code == 200
        card = response.json()
        assert card["name"] == "Обновленная карточка"
    
    def test_update_nonexistent_card(self, api_client: requests.Session):
        """Тест обновления несуществующей карточки"""
        update_data = {"name": "Новое имя"}
        response = api_client.put(get_api_url("/cards/00000000-0000-0000-0000-000000000000"), json=update_data)
        assert response.status_code == 404
    
    def test_delete_card(self, api_client: requests.Session, sample_card_data: Dict[str, Any]):
        """Тест удаления карточки"""
        # Создаем карточку для удаления
        response = api_client.post(get_api_url("/cards"), json=sample_card_data)
        assert response.status_code == 201
        card_id = response.json()["id"]
        
        # Удаляем карточку
        response = api_client.delete(get_api_url(f"/cards/{card_id}"))
        assert response.status_code == 200
        
        # Проверяем, что карточка удалена
        response = api_client.get(get_api_url(f"/cards/{card_id}"))
        assert response.status_code == 404
    
    def test_delete_nonexistent_card(self, api_client: requests.Session):
        """Тест удаления несуществующей карточки"""
        response = api_client.delete(get_api_url("/cards/00000000-0000-0000-0000-000000000000"))
        assert response.status_code == 404
    
    def test_card_validation(self, api_client: requests.Session):
        """Тест валидации данных карточки"""
        # Неверная редкость
        invalid_data = {
            "name": "Тест",
            "description": "Описание",
            "rarity": "invalid_rarity"
        }
        response = api_client.post(get_api_url("/cards"), json=invalid_data)
        assert response.status_code == 400
        
        # Отсутствует обязательное поле
        invalid_data = {
            "name": "Тест",
            "rarity": "common"
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
