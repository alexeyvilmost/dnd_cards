#!/usr/bin/env python3
"""
Тест создания простой карты
"""

import requests
import json

def test_simple_card():
    """Тестирует создание простой карты"""
    
    # Простейшие данные
    card_data = {
        "name": "Тестовая карта",
        "description": "Простое описание",
        "rarity": "common",
        "author": "Test User"
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDc2OTVmMmUtOGY2YS00ZmYyLWIzMmQtYzc1NTZmYjU4YTMxIiwidXNlcm5hbWUiOiJpbXBvcnRlcl91c2VyIiwiaXNzIjoiZG5kLWNhcmRzLWJhY2tlbmQiLCJzdWIiOiJkNzY5NWYyZS04ZjZhLTRmZjItYjMyZC1jNzU1NmZiNThhMzEiLCJleHAiOjE3NjA0MDU4NTAsIm5iZiI6MTc2MDMxOTQ1MCwiaWF0IjoxNzYwMzE5NDUwfQ.7vn0WyCMG3BtuxSISNFbg2yLm9clEB21sPKWqNsK96M'
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
