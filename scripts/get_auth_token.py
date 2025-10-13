#!/usr/bin/env python3
"""
Скрипт для получения токена авторизации
"""

import requests
import json

def get_auth_token():
    """Получает токен авторизации"""
    try:
        # Сначала попробуем зарегистрировать пользователя
        register_data = {
            "username": "importer_user",
            "password": "importer_pass123",
            "email": "importer@example.com",
            "display_name": "Importer User"
        }
        
        print("Регистрируем пользователя...")
        register_response = requests.post(
            "http://localhost:8080/api/auth/register",
            json=register_data,
            headers={"Content-Type": "application/json"}
        )
        
        print(f"Статус регистрации: {register_response.status_code}")
        print(f"Ответ регистрации: {register_response.text}")
        
        if register_response.status_code in [200, 201]:  # Успешная регистрация
            print("Пользователь успешно зарегистрирован")
        elif register_response.status_code == 400:  # Пользователь уже существует
            print("Пользователь уже существует, продолжаем логин")
        else:
            print(f"Ошибка регистрации: {register_response.status_code}")
            return None
        
        # Теперь логинимся
        login_data = {
            "username": "importer_user", 
            "password": "importer_pass123"
        }
        
        print("Получаем токен авторизации...")
        login_response = requests.post(
            "http://localhost:8080/api/auth/login",
            json=login_data,
            headers={"Content-Type": "application/json"}
        )
        
        if login_response.status_code == 200:
            result = login_response.json()
            token = result.get('token')
            if token:
                print(f"Токен получен: {token[:20]}...")
                return token
            else:
                print("Токен не найден в ответе")
                print(f"Ответ: {result}")
        else:
            print(f"Ошибка авторизации: {login_response.status_code}")
            print(f"Ответ: {login_response.text}")
            
    except Exception as e:
        print(f"Ошибка: {e}")
    
    return None

if __name__ == "__main__":
    token = get_auth_token()
    if token:
        print(f"\nИспользуйте этот токен: {token}")
    else:
        print("Не удалось получить токен")
