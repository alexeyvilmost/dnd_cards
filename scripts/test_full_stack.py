#!/usr/bin/env python3
"""
Полное тестирование стека: бекенд + фронтенд + интеграция
"""
import subprocess
import sys
import time
from typing import Dict, Any

class FullStackTester:
    def __init__(self, backend_url: str = "http://localhost:8080", 
                 frontend_url: str = "http://localhost:3000"):
        self.backend_url = backend_url
        self.frontend_url = frontend_url
        self.results: Dict[str, Any] = {}
        
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
    
    def run_script(self, script_path: str, args: list = None) -> bool:
        """Запускает Python скрипт и возвращает результат"""
        try:
            cmd = [sys.executable, script_path]
            if args:
                cmd.extend(args)
            
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            
            # Выводим вывод скрипта
            if result.stdout:
                print(result.stdout)
            if result.stderr:
                print(result.stderr)
            
            return result.returncode == 0
            
        except subprocess.TimeoutExpired:
            self.log(f"⏰ Таймаут выполнения скрипта {script_path}", "ERROR")
            return False
        except Exception as e:
            self.log(f"❌ Ошибка выполнения скрипта {script_path}: {e}", "ERROR")
            return False
    
    def test_backend(self) -> bool:
        """Тестирует бекенд"""
        self.log("\nТЕСТИРОВАНИЕ БЕКЕНДА", "INFO")
        self.log("="*50, "INFO")
        
        success = self.run_script("test_backend.py", ["--url", self.backend_url])
        self.results["backend"] = success
        
        if success:
            self.log("OK Бекенд тесты пройдены успешно", "SUCCESS")
        else:
            self.log("FAIL Бекенд тесты провалены", "ERROR")
        
        return success
    
    def test_frontend(self) -> bool:
        """Тестирует фронтенд"""
        self.log("\nТЕСТИРОВАНИЕ ФРОНТЕНДА", "INFO")
        self.log("="*50, "INFO")
        
        success = self.run_script("test_frontend.py", ["--url", self.frontend_url])
        self.results["frontend"] = success
        
        if success:
            self.log("OK Фронтенд тесты пройдены успешно", "SUCCESS")
        else:
            self.log("FAIL Фронтенд тесты провалены", "ERROR")
        
        return success
    
    def test_integration(self) -> bool:
        """Тестирует интеграцию между фронтендом и бекендом"""
        self.log("\nТЕСТИРОВАНИЕ ИНТЕГРАЦИИ", "INFO")
        self.log("="*50, "INFO")
        
        # Проверяем, что оба сервиса доступны
        import requests
        
        try:
            # Проверяем бекенд
            backend_response = requests.get(f"{self.backend_url}/api/health", timeout=5)
            backend_ok = backend_response.status_code == 200
            
            # Проверяем фронтенд
            frontend_response = requests.get(self.frontend_url, timeout=5)
            frontend_ok = frontend_response.status_code == 200
            
            if backend_ok and frontend_ok:
                self.log("OK Оба сервиса доступны", "SUCCESS")
                
                # Дополнительная проверка: фронтенд может обращаться к API
                try:
                    api_response = requests.get(f"{self.frontend_url}/api/health", timeout=5)
                    if api_response.status_code == 200:
                        self.log("OK Фронтенд может обращаться к API", "SUCCESS")
                        self.results["integration"] = True
                        return True
                    else:
                        self.log("⚠ Фронтенд не может обращаться к API", "WARNING")
                        self.results["integration"] = False
                        return False
                except Exception as e:
                    self.log(f"FAIL Ошибка интеграции: {e}", "ERROR")
                    self.results["integration"] = False
                    return False
            else:
                self.log("FAIL Не все сервисы доступны", "ERROR")
                if not backend_ok:
                    self.log("  - Бекенд недоступен", "ERROR")
                if not frontend_ok:
                    self.log("  - Фронтенд недоступен", "ERROR")
                self.results["integration"] = False
                return False
                
        except Exception as e:
            self.log(f"FAIL Ошибка проверки интеграции: {e}", "ERROR")
            self.results["integration"] = False
            return False
    
    def run_all_tests(self) -> bool:
        """Запускает все тесты"""
        self.log("ЗАПУСК ПОЛНОГО ТЕСТИРОВАНИЯ СТЕКА", "INFO")
        self.log(f"Бекенд: {self.backend_url}", "INFO")
        self.log(f"Фронтенд: {self.frontend_url}", "INFO")
        self.log("="*60, "INFO")
        
        # Запускаем тесты
        backend_success = self.test_backend()
        frontend_success = self.test_frontend()
        integration_success = self.test_integration()
        
        # Итоговый результат
        all_success = backend_success and frontend_success and integration_success
        
        self.log("\n" + "="*60, "INFO")
        self.log("📊 ИТОГОВЫЕ РЕЗУЛЬТАТЫ", "INFO")
        self.log("="*60, "INFO")
        
        self.log(f"Бекенд: {'OK Успешно' if backend_success else 'FAIL Провалено'}", 
                "SUCCESS" if backend_success else "ERROR")
        self.log(f"Фронтенд: {'OK Успешно' if frontend_success else 'FAIL Провалено'}", 
                "SUCCESS" if frontend_success else "ERROR")
        self.log(f"Интеграция: {'OK Успешно' if integration_success else 'FAIL Провалено'}", 
                "SUCCESS" if integration_success else "ERROR")
        
        self.log("\n" + "="*60, "INFO")
        if all_success:
            self.log("ВСЕ ТЕСТЫ ПРОЙДЕНЫ УСПЕШНО!", "SUCCESS")
            self.log("Система готова к использованию", "SUCCESS")
        else:
            self.log("⚠ НЕКОТОРЫЕ ТЕСТЫ ПРОВАЛЕНЫ", "WARNING")
            self.log("Проверьте логи выше для деталей", "WARNING")
        self.log("="*60, "INFO")
        
        return all_success

def main():
    """Основная функция"""
    import argparse
    
    parser = argparse.ArgumentParser(description="Полное тестирование стека")
    parser.add_argument("--backend", default="http://localhost:8080", 
                       help="URL бекенда (по умолчанию: http://localhost:8080)")
    parser.add_argument("--frontend", default="http://localhost:3000", 
                       help="URL фронтенда (по умолчанию: http://localhost:3000)")
    
    args = parser.parse_args()
    
    tester = FullStackTester(args.backend, args.frontend)
    success = tester.run_all_tests()
    
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
