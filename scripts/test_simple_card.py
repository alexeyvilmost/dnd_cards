#!/usr/bin/env python3
"""
Тест создания простой карты
"""

import json
import os

import requests

def test_simple_card():
    """Тестирует создание простой карты"""
    
    # Простейшие данные
    card_data = {
        "name": "Тестовая карта",
        "description": "Простое описание",
        "rarity": "common",
        "author": "Test User"
    }
    
    token = os.environ.get("API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("API_TOKEN is required")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    
    print("Отправляем простую карту...")
    print(f"Данные: {json.dumps(card_data, ensure_ascii=False, indent=2)}")
    
    try:
        response = requests.post(
            "http://localhost:8080/api/cards",
            json=card_data,
            headers=headers
        )
        
        print(f"Статус: {response.status_code}")
        print(f"Ответ: {response.text}")
        
        if response.status_code in [200, 201]:
            print("Успех!")
        else:
            print("Ошибка!")
            
    except Exception as e:
        print(f"Исключение: {e}")

if __name__ == "__main__":
    test_simple_card()
