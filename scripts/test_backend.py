#!/usr/bin/env python3
"""
Скрипт для проверки всех основных API endpoints бекенда
"""
import requests
import json
import secrets
import sys
from typing import Dict, Any, Optional

class BackendTester:
    def __init__(self, base_url: str = "http://localhost:8080"):
        self.base_url = base_url
        self.session = requests.Session()
        self.auth_token: Optional[str] = None
        self.test_results: Dict[str, bool] = {}
        
    def log(self, message: str, level: str = "INFO"):
        """Логирование с цветовой кодировкой"""
        colors = {
            "INFO": "\033[94m",    # Синий
            "SUCCESS": "\033[92m", # Зеленый
            "ERROR": "\033[91m",   # Красный
            "WARNING": "\033[93m", # Желтый
            "RESET": "\033[0m"     # Сброс
        }
        try:
            print(f"{colors.get(level, '')}[{level}]{colors['RESET']} {message}")
        except UnicodeEncodeError:
            # Fallback для Windows без поддержки эмодзи
            clean_message = message.encode('ascii', 'ignore').decode('ascii')
            print(f"[{level}] {clean_message}")
    
    def test_endpoint(self, method: str, endpoint: str, expected_status: int = 200, 
                     data: Optional[Dict] = None, headers: Optional[Dict] = None) -> bool:
        """Тестирует отдельный endpoint"""
        url = f"{self.base_url}{endpoint}"
        try:
            if method.upper() == "GET":
                response = self.session.get(url, headers=headers)
            elif method.upper() == "POST":
                response = self.session.post(url, json=data, headers=headers)
            elif method.upper() == "PUT":
                response = self.session.put(url, json=data, headers=headers)
            elif method.upper() == "DELETE":
                response = self.session.delete(url, headers=headers)
            else:
                self.log(f"Неподдерживаемый метод: {method}", "ERROR")
                return False
                
            if response.status_code == expected_status:
                self.log(f"OK {method} {endpoint} -> {response.status_code}", "SUCCESS")
                return True
            else:
                self.log(f"FAIL {method} {endpoint} -> {response.status_code} (ожидался {expected_status})", "ERROR")
                if response.text:
                    self.log(f"  Ответ: {response.text[:200]}...", "ERROR")
                return False
                
        except requests.exceptions.RequestException as e:
            self.log(f"FAIL {method} {endpoint} -> Ошибка соединения: {e}", "ERROR")
            return False
    
    def test_health_endpoints(self):
        """Тестирует публичный health endpoint"""
        self.log("\n=== Тестирование Health Endpoints ===", "INFO")
        
        endpoints = [
            ("GET", "/api/health", 200),
        ]
        
        for method, endpoint, status in endpoints:
            self.test_results[f"{method} {endpoint}"] = self.test_endpoint(method, endpoint, status)
    
    def test_auth_endpoints(self):
        """Тестирует endpoints аутентификации"""
        self.log("\n=== Тестирование Auth Endpoints ===", "INFO")
        
        # Тест регистрации (может вернуть 400 если пользователь уже существует)
        suffix = secrets.token_hex(6)
        test_user = {
            "username": f"api_test_{suffix}",
            "password": secrets.token_urlsafe(24),
            "email": f"api_test_{suffix}@example.invalid",
            "display_name": "Test User"
        }
        
        registration_result = self.test_endpoint("POST", "/api/auth/register", 
                                               expected_status=201, data=test_user)
        self.test_results["POST /api/auth/register"] = registration_result
        
        # Тест логина
        login_data = {
            "username": test_user["username"],
            "password": test_user["password"]
        }
        
        try:
            response = self.session.post(f"{self.base_url}/api/auth/login", json=login_data)
            if response.status_code == 200:
                auth_data = response.json()
                self.auth_token = auth_data.get("token")
                self.test_results["POST /api/auth/login"] = True
                self.log("Получен токен аутентификации", "SUCCESS")
            else:
                self.test_results["POST /api/auth/login"] = False
                self.log(f"FAIL Ошибка логина: {response.status_code}", "ERROR")
        except Exception as e:
            self.test_results["POST /api/auth/login"] = False
            self.log(f"FAIL Ошибка логина: {e}", "ERROR")
        
        # Тест профиля (требует авторизации)
        if self.auth_token:
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            self.test_results["GET /api/auth/profile"] = self.test_endpoint(
                "GET", "/api/auth/profile", 200, headers=headers)
    
    def test_cards_endpoints(self):
        """Тестирует endpoints карт"""
        self.log("\n=== Тестирование Cards Endpoints ===", "INFO")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else None
        
        # Тест получения всех карт
        self.test_results["GET /api/cards"] = self.test_endpoint(
            "GET", "/api/cards", 200, headers=headers)
        
        # Тест создания карты
        test_card = {
            "name": "Тестовая карта",
            "description": "Описание тестовой карты",
            "rarity": "common",
            "author": "test_user",
            "type": "weapon",
            "properties": ["light"],
            "weight": 1.0,
            "attunement": False
        }
        
        try:
            response = self.session.post(f"{self.base_url}/api/cards", 
                                       json=test_card, headers=headers)
            if response.status_code == 201:
                card_data = response.json()
                card_id = card_data.get("id")
                self.test_results["POST /api/cards"] = True
                self.log(f"Создана тестовая карта с ID: {card_id}", "SUCCESS")
                
                # Тест получения конкретной карты
                if card_id:
                    self.test_results["GET /api/cards/:id"] = self.test_endpoint(
                        "GET", f"/api/cards/{card_id}", 200, headers=headers)
                    
                    # Тест обновления карты
                    update_data = {"name": "Обновленная тестовая карта"}
                    self.test_results["PUT /api/cards/:id"] = self.test_endpoint(
                        "PUT", f"/api/cards/{card_id}", 200, data=update_data, headers=headers)
                    
                    # Тест удаления карты
                    self.test_results["DELETE /api/cards/:id"] = self.test_endpoint(
                        "DELETE", f"/api/cards/{card_id}", 200, headers=headers)
                        
            else:
                self.test_results["POST /api/cards"] = False
                self.log(f"FAIL Ошибка создания карты: {response.status_code}", "ERROR")
                
        except Exception as e:
            self.test_results["POST /api/cards"] = False
            self.log(f"FAIL Ошибка создания карты: {e}", "ERROR")
    
    def test_groups_endpoints(self):
        """Тестирует endpoints групп"""
        self.log("\n=== Тестирование Groups Endpoints ===", "INFO")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else None
        
        # Тест получения всех групп
        self.test_results["GET /api/groups"] = self.test_endpoint(
            "GET", "/api/groups", 200, headers=headers)
    
    def test_characters_endpoints(self):
        """Тестирует endpoints персонажей"""
        self.log("\n=== Тестирование Characters Endpoints ===", "INFO")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else None
        
        # Тест получения всех персонажей
        self.test_results["GET /api/characters"] = self.test_endpoint(
            "GET", "/api/characters", 200, headers=headers)
        
        # Тест получения персонажей v2
        self.test_results["GET /api/characters-v2"] = self.test_endpoint(
            "GET", "/api/characters-v2", 200, headers=headers)
    
    def test_images_endpoints(self):
        """Тестирует endpoints изображений"""
        self.log("\n=== Тестирование Images Endpoints ===", "INFO")
        
        headers = {"Authorization": f"Bearer {self.auth_token}"} if self.auth_token else None
        
        # Тест получения библиотеки изображений
        self.test_results["GET /api/image-library"] = self.test_endpoint(
            "GET", "/api/image-library", 200, headers=headers)
        
        # Тест получения редкостей
        self.test_results["GET /api/image-library/rarities"] = self.test_endpoint(
            "GET", "/api/image-library/rarities", 200, headers=headers)
    
    def run_all_tests(self):
        """Запускает все тесты"""
        self.log("Запуск тестирования бекенда", "INFO")
        self.log(f"Base URL: {self.base_url}", "INFO")
        
        self.test_health_endpoints()
        self.test_auth_endpoints()
        self.test_cards_endpoints()
        self.test_groups_endpoints()
        self.test_characters_endpoints()
        self.test_images_endpoints()
        
        # Подсчет результатов
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results.values() if result)
        failed_tests = total_tests - passed_tests
        
        self.log("\n" + "="*50, "INFO")
        self.log(f"📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ", "INFO")
        self.log(f"Всего тестов: {total_tests}", "INFO")
        self.log(f"Успешных: {passed_tests}", "SUCCESS" if passed_tests == total_tests else "INFO")
        self.log(f"Проваленных: {failed_tests}", "ERROR" if failed_tests > 0 else "SUCCESS")
        self.log("="*50, "INFO")
        
        # Детальные результаты
        self.log("\n📋 Детальные результаты:", "INFO")
        for test_name, result in self.test_results.items():
            status = "OK" if result else "FAIL"
            color = "SUCCESS" if result else "ERROR"
            self.log(f"  {status} {test_name}", color)
        
        return failed_tests == 0

def main():
    """Основная функция"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Тестирование бекенда")
    parser.add_argument("--url", default="http://localhost:8080", 
                       help="Base URL бекенда (по умолчанию: http://localhost:8080)")
    
    args = parser.parse_args()
    
    tester = BackendTester(args.url)
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
