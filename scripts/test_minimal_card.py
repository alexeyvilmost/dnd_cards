#!/usr/bin/env python3
"""
Тест создания карты с минимальными данными из D&D предметов
"""

import json
import os

import requests

def test_minimal_card():
    """Тестирует создание карты с минимальными данными"""
    
    # Минимальные данные для Адамантинового доспеха
    card_data = {
        "name": "Адамантиновый доспех",
        "description": "Доспех (средний или тяжёлый, кроме шкурного), необычный. Эти доспехи усилены адамантином, одним из самых прочных из существующих веществ. Пока вы носите эти доспехи, все критические попадания по вам считаются обычными попаданиями.",
        "rarity": "uncommon",
        "author": "D&D Importer"
    }
    
    token = os.environ.get("API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("API_TOKEN is required")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }
    
    print("Отправляем карту с минимальными данными...")
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
    test_minimal_card()
