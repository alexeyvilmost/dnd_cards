#!/usr/bin/env python3
"""
Тест добавления полей по одному
"""

import requests
import json

def test_with_price():
    """Тестирует добавление поля price"""
    
    card_data = {
        "name": "Тест с ценой",
        "description": "Тестовая карта с ценой",
        "rarity": "common",
        "author": "D&D Importer",
        "price": 300
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDc2OTVmMmUtOGY2YS00ZmYyLWIzMmQtYzc1NTZmYjU4YTMxIiwidXNlcm5hbWUiOiJpbXBvcnRlcl91c2VyIiwiaXNzIjoiZG5kLWNhcmRzLWJhY2tlbmQiLCJzdWIiOiJkNzY5NWYyZS04ZjZhLTRmZjItYjMyZC1jNzU1NmZiNThhMzEiLCJleHAiOjE3NjA0MDU4NTAsIm5iZiI6MTc2MDMxOTQ1MCwiaWF0IjoxNzYwMzE5NDUwfQ.7vn0WyCMG3BtuxSISNFbg2yLm9clEB21sPKWqNsK96M'
    }
    
    print("Тест с полем price...")
    
    try:
        response = requests.post(
            "http://localhost:8080/api/cards",
            json=card_data,
            headers=headers
        )
        
        print(f"Статус: {response.status_code}")
        if response.status_code not in [200, 201]:
            print(f"Ошибка: {response.text}")
        else:
            print("Успех с price!")
            
    except Exception as e:
        print(f"Исключение: {e}")

def test_with_weight():
    """Тестирует добавление поля weight"""
    
    card_data = {
        "name": "Тест с весом",
        "description": "Тестовая карта с весом",
        "rarity": "common",
        "author": "D&D Importer",
        "weight": 45.0
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDc2OTVmMmUtOGY2YS00ZmYyLWIzMmQtYzc1NTZmYjU4YTMxIiwidXNlcm5hbWUiOiJpbXBvcnRlcl91c2VyIiwiaXNzIjoiZG5kLWNhcmRzLWJhY2tlbmQiLCJzdWIiOiJkNzY5NWYyZS04ZjZhLTRmZjItYjMyZC1jNzU1NmZiNThhMzEiLCJleHAiOjE3NjA0MDU4NTAsIm5iZiI6MTc2MDMxOTQ1MCwiaWF0IjoxNzYwMzE5NDUwfQ.7vn0WyCMG3BtuxSISNFbg2yLm9clEB21sPKWqNsK96M'
    }
    
    print("\nТест с полем weight...")
    
    try:
        response = requests.post(
            "http://localhost:8080/api/cards",
            json=card_data,
            headers=headers
        )
        
        print(f"Статус: {response.status_code}")
        if response.status_code not in [200, 201]:
            print(f"Ошибка: {response.text}")
        else:
            print("Успех с weight!")
            
    except Exception as e:
        print(f"Исключение: {e}")

def test_with_type():
    """Тестирует добавление поля type"""
    
    card_data = {
        "name": "Тест с типом",
        "description": "Тестовая карта с типом",
        "rarity": "common",
        "author": "D&D Importer",
        "type": "доспех"
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDc2OTVmMmUtOGY2YS00ZmYyLWIzMmQtYzc1NTZmYjU4YTMxIiwidXNlcm5hbWUiOiJpbXBvcnRlcl91c2VyIiwiaXNzIjoiZG5kLWNhcmRzLWJhY2tlbmQiLCJzdWIiOiJkNzY5NWYyZS04ZjZhLTRmZjItYjMyZC1jNzU1NmZiNThhMzEiLCJleHAiOjE3NjA0MDU4NTAsIm5iZiI6MTc2MDMxOTQ1MCwiaWF0IjoxNzYwMzE5NDUwfQ.7vn0WyCMG3BtuxSISNFbg2yLm9clEB21sPKWqNsK96M'
    }
    
    print("\nТест с полем type...")
    
    try:
        response = requests.post(
            "http://localhost:8080/api/cards",
            json=card_data,
            headers=headers
        )
        
        print(f"Статус: {response.status_code}")
        if response.status_code not in [200, 201]:
            print(f"Ошибка: {response.text}")
        else:
            print("Успех с type!")
            
    except Exception as e:
        print(f"Исключение: {e}")

def test_with_properties():
    """Тестирует добавление поля properties"""
    
    card_data = {
        "name": "Тест со свойствами",
        "description": "Тестовая карта со свойствами",
        "rarity": "common",
        "author": "D&D Importer",
        "properties": "защита"
    }
    
    headers = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoiZDc2OTVmMmUtOGY2YS00ZmYyLWIzMmQtYzc1NTZmYjU4YTMxIiwidXNlcm5hbWUiOiJpbXBvcnRlcl91c2VyIiwiaXNzIjoiZG5kLWNhcmRzLWJhY2tlbmQiLCJzdWIiOiJkNzY5NWYyZS04ZjZhLTRmZjItYjMyZC1jNzU1NmZiNThhMzEiLCJleHAiOjE3NjA0MDU4NTAsIm5iZiI6MTc2MDMxOTQ1MCwiaWF0IjoxNzYwMzE5NDUwfQ.7vn0WyCMG3BtuxSISNFbg2yLm9clEB21sPKWqNsK96M'
    }
    
    print("\nТест с полем properties...")
    
    try:
        response = requests.post(
            "http://localhost:8080/api/cards",
            json=card_data,
            headers=headers
        )
        
        print(f"Статус: {response.status_code}")
        if response.status_code not in [200, 201]:
            print(f"Ошибка: {response.text}")
        else:
            print("Успех с properties!")
            
    except Exception as e:
        print(f"Исключение: {e}")

if __name__ == "__main__":
    test_with_price()
    test_with_weight()
    test_with_type()
    test_with_properties()
