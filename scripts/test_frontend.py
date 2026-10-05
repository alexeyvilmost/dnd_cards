#!/usr/bin/env python3
"""
Скрипт для проверки основных разделов фронтенда
"""
import requests
import json
import sys
import time
from typing import Dict, Any, Optional
from urllib.parse import urljoin

class FrontendTester:
    def __init__(self, base_url: str = "http://localhost:3000"):
        self.base_url = base_url
        self.session = requests.Session()
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
    
    def test_page(self, path: str, expected_content: Optional[str] = None) -> bool:
        """Тестирует загрузку страницы"""
        url = urljoin(self.base_url, path)
        try:
            response = self.session.get(url, timeout=10)
            
            if response.status_code == 200:
                # Проверяем, что это HTML страница
                if 'text/html' in response.headers.get('content-type', ''):
                    # Проверяем наличие ключевых элементов
                    content = response.text
                    
                    # Базовые проверки для React приложения
                    checks = [
                        ("HTML структура", "<!doctype html>" in content.lower()),
                        ("React приложение", "react" in content.lower() or "app" in content.lower()),
                        ("Vite dev server", "/@vite" in content or "vite" in content.lower()),
                    ]
                    
                    # Дополнительная проверка контента если указана
                    if expected_content:
                        checks.append((f"Контент '{expected_content}'", expected_content.lower() in content.lower()))
                    
                    all_passed = all(check[1] for check in checks)
                    
                    if all_passed:
                        self.log(f"OK {path} -> 200 OK", "SUCCESS")
                        for check_name, check_result in checks:
                            if check_result:
                                self.log(f"  OK {check_name}", "SUCCESS")
                        return True
                    else:
                        self.log(f"⚠ {path} -> 200 OK, но некоторые проверки не прошли", "WARNING")
                        for check_name, check_result in checks:
                            status = "OK" if check_result else "FAIL"
                            color = "SUCCESS" if check_result else "ERROR"
                            self.log(f"  {status} {check_name}", color)
                        return False
                else:
                    self.log(f"FAIL {path} -> Неверный Content-Type: {response.headers.get('content-type')}", "ERROR")
                    return False
            else:
                self.log(f"FAIL {path} -> {response.status_code}", "ERROR")
                return False
                
        except requests.exceptions.RequestException as e:
            self.log(f"FAIL {path} -> Ошибка соединения: {e}", "ERROR")
            return False
        except Exception as e:
            self.log(f"FAIL {path} -> Неожиданная ошибка: {e}", "ERROR")
            return False
    
    def test_static_resources(self):
        """Тестирует загрузку статических ресурсов"""
        self.log("\n=== Тестирование статических ресурсов ===", "INFO")
        
        # Проверяем основные статические файлы
        static_files = [
            ("/favicon.ico", None),
            ("/site_logo.png", None),
            ("/default_image.png", None),
        ]
        
        for path, expected_content in static_files:
            url = urljoin(self.base_url, path)
            try:
                response = self.session.get(url, timeout=5)
                if response.status_code == 200:
                    self.log(f"OK {path} -> 200 OK", "SUCCESS")
                    self.test_results[f"STATIC {path}"] = True
                else:
                    self.log(f"FAIL {path} -> {response.status_code}", "ERROR")
                    self.test_results[f"STATIC {path}"] = False
            except requests.exceptions.RequestException as e:
                self.log(f"FAIL {path} -> Ошибка: {e}", "ERROR")
                self.test_results[f"STATIC {path}"] = False
    
    def test_main_pages(self):
        """Тестирует основные страницы приложения"""
        self.log("\n=== Тестирование основных страниц ===", "INFO")
        
        # Основные страницы приложения
        pages = [
            ("/", "главная страница"),
            ("/cards", "библиотека карт"),
            ("/create-card", "создание карты"),
            ("/groups", "группы"),
            ("/login", "авторизация"),
            ("/register", "регистрация"),
            ("/dice-roller", "бросок костей"),
        ]
        
        for path, description in pages:
            self.log(f"Тестирование {description}...", "INFO")
            result = self.test_page(path)
            self.test_results[f"PAGE {path}"] = result
    
    def test_api_connectivity(self):
        """Тестирует подключение к API"""
        self.log("\n=== Тестирование подключения к API ===", "INFO")
        
        # Проверяем, что фронтенд может подключиться к бекенду
        try:
            # Пробуем сделать запрос к API через фронтенд
            api_url = urljoin(self.base_url, "/api/health")
            response = self.session.get(api_url, timeout=5)
            
            if response.status_code == 200:
                self.log("OK API доступен через фронтенд", "SUCCESS")
                self.test_results["API CONNECTIVITY"] = True
            else:
                self.log(f"⚠ API недоступен: {response.status_code}", "WARNING")
                self.test_results["API CONNECTIVITY"] = False
                
        except requests.exceptions.RequestException as e:
            self.log(f"FAIL Ошибка подключения к API: {e}", "ERROR")
            self.test_results["API CONNECTIVITY"] = False
    
    def test_responsive_design(self):
        """Тестирует базовые аспекты адаптивного дизайна"""
        self.log("\n=== Тестирование адаптивного дизайна ===", "INFO")
        
        # Проверяем наличие viewport meta тега
        try:
            response = self.session.get(self.base_url, timeout=10)
            if response.status_code == 200:
                content = response.text.lower()
                
                viewport_checks = [
                    ("Viewport meta тег", 'name="viewport"' in content),
                    ("Mobile-first подход", 'mobile' in content or 'responsive' in content),
                ]
                
                all_passed = all(check[1] for check in viewport_checks)
                
                for check_name, check_result in viewport_checks:
                    status = "OK" if check_result else "FAIL"
                    color = "SUCCESS" if check_result else "ERROR"
                    self.log(f"  {status} {check_name}", color)
                
                self.test_results["RESPONSIVE DESIGN"] = all_passed
                
        except Exception as e:
            self.log(f"FAIL Ошибка проверки адаптивности: {e}", "ERROR")
            self.test_results["RESPONSIVE DESIGN"] = False
    
    def test_performance(self):
        """Базовое тестирование производительности"""
        self.log("\n=== Тестирование производительности ===", "INFO")
        
        try:
            start_time = time.time()
            response = self.session.get(self.base_url, timeout=15)
            end_time = time.time()
            
            load_time = end_time - start_time
            
            if response.status_code == 200:
                if load_time < 2.0:
                    self.log(f"OK Время загрузки: {load_time:.2f}с (отлично)", "SUCCESS")
                    self.test_results["PERFORMANCE"] = True
                elif load_time < 5.0:
                    self.log(f"⚠ Время загрузки: {load_time:.2f}с (приемлемо)", "WARNING")
                    self.test_results["PERFORMANCE"] = True
                else:
                    self.log(f"FAIL Время загрузки: {load_time:.2f}с (медленно)", "ERROR")
                    self.test_results["PERFORMANCE"] = False
            else:
                self.log(f"FAIL Ошибка загрузки: {response.status_code}", "ERROR")
                self.test_results["PERFORMANCE"] = False
                
        except Exception as e:
            self.log(f"FAIL Ошибка тестирования производительности: {e}", "ERROR")
            self.test_results["PERFORMANCE"] = False
    
    def run_all_tests(self):
        """Запускает все тесты"""
        self.log("Запуск тестирования фронтенда", "INFO")
        self.log(f"Base URL: {self.base_url}", "INFO")
        
        self.test_static_resources()
        self.test_main_pages()
        self.test_api_connectivity()
        self.test_responsive_design()
        self.test_performance()
        
        # Подсчет результатов
        total_tests = len(self.test_results)
        passed_tests = sum(1 for result in self.test_results.values() if result)
        failed_tests = total_tests - passed_tests
        
        self.log("\n" + "="*50, "INFO")
        self.log(f"📊 РЕЗУЛЬТАТЫ ТЕСТИРОВАНИЯ ФРОНТЕНДА", "INFO")
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
    
    parser = argparse.ArgumentParser(description="Тестирование фронтенда")
    parser.add_argument("--url", default="http://localhost:3000", 
                       help="Base URL фронтенда (по умолчанию: http://localhost:3000)")
    
    args = parser.parse_args()
    
    tester = FrontendTester(args.url)
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
