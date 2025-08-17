import pytest
import requests
import time
from typing import Generator, Dict, Any

# Базовый URL для API
BASE_URL = "http://localhost:8080/api"

def get_api_url(path: str) -> str:
    """Создает полный URL для API запроса"""
    return f"{BASE_URL}{path}"

@pytest.fixture(scope="session")
def api_client() -> Generator[requests.Session, None, None]:
    """Фикстура для HTTP клиента"""
    session = requests.Session()
    session.headers.update({
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    })
    # Устанавливаем базовый URL
    session.base_url = BASE_URL
    yield session
    session.close()

@pytest.fixture(scope="session")
def wait_for_backend(api_client: requests.Session) -> None:
    """Ждем, пока backend запустится"""
    max_attempts = 30
    for attempt in range(max_attempts):
        try:
            response = api_client.get(f"{BASE_URL}/cards")
            if response.status_code == 200:
                print("Backend is ready!")
                return
        except requests.exceptions.ConnectionError:
            pass
        time.sleep(1)
    pytest.fail("Backend is not available after 30 seconds")

@pytest.fixture
def sample_card_data() -> Dict[str, Any]:
    """Тестовые данные для карточки"""
    return {
        "name": "Тестовая карточка",
        "description": "Описание тестовой карточки для проверки функциональности",
        "rarity": "common",
        "properties": ["consumable"],
        "price": 50,
        "weight": 1.5,
        "bonus_type": "strength",
        "bonus_value": "+2"
    }

@pytest.fixture
def weapon_card_data() -> Dict[str, Any]:
    """Тестовые данные для оружия"""
    return {
        "name": "Тестовый меч",
        "description": "Простой меч для тестирования",
        "rarity": "uncommon",
        "properties": ["light", "finesse"],
        "price": 100,
        "weight": 3.0,
        "bonus_type": "damage",
        "bonus_value": "1d8"
    }

@pytest.fixture(autouse=True)
def clean_database(api_client: requests.Session) -> None:
    """Очищает базу данных перед каждым тестом"""
    # Удаляем все карточки напрямую из базы данных
    import subprocess
    try:
        subprocess.run([
            "docker", "compose", "exec", "-T", "postgres", 
            "psql", "-U", "postgres", "-d", "dnd_cards", 
            "-c", "DELETE FROM cards;"
        ], cwd="/Users/alexeyvilmost/dnd_cards", check=True, capture_output=True)
    except:
        pass

@pytest.fixture
def created_card_id(api_client: requests.Session, sample_card_data: Dict[str, Any]) -> Generator[str, None, None]:
    """Создает тестовую карточку и возвращает её ID"""
    response = api_client.post(f"{BASE_URL}/cards", json=sample_card_data)
    assert response.status_code == 201, f"Failed to create test card: {response.text}"
    card_id = response.json()["id"]
    yield card_id
    # Очистка после теста
    try:
        api_client.delete(f"{BASE_URL}/cards/{card_id}")
    except:
        pass
