#!/usr/bin/env python3
"""
Скрипт для получения токена авторизации
"""

import os

import requests

def get_auth_token():
    """Получает токен авторизации"""
    explicit_token = os.environ.get("API_TOKEN", "").strip()
    if explicit_token:
        return explicit_token

    api_url = os.environ.get("API_URL", "http://localhost:8080").rstrip("/")
    username = os.environ.get("CONTENT_ADMIN_USERNAME", "").strip()
    password = os.environ.get("CONTENT_ADMIN_PASSWORD", "")
    if not username or not password:
        raise RuntimeError(
            "Set API_TOKEN or both CONTENT_ADMIN_USERNAME and "
            "CONTENT_ADMIN_PASSWORD"
        )
    try:
        login_data = {
            "username": username,
            "password": password,
        }
        print("Получаем токен авторизации...")
        login_response = requests.post(
            f"{api_url}/api/auth/login",
            json=login_data,
            headers={"Content-Type": "application/json"}
        )
        
        if login_response.status_code == 200:
            result = login_response.json()
            token = result.get('token')
            if token:
                print("Токен получен")
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
        print("\nВНИМАНИЕ: следующая строка является секретом и не должна попадать в логи.")
        print(token)
    else:
        print("Не удалось получить токен")
