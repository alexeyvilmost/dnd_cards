#!/usr/bin/env python3
"""
Тест добавления полей по одному
"""

import json
import os

import requests


def request_headers():
    token = os.environ.get("API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("API_TOKEN is required")
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    }

def test_with_price():
    """Тестирует добавление поля price"""
    
    card_data = {
        "name": "Тест с ценой",
        "description": "Тестовая карта с ценой",
        "rarity": "common",
        "author": "D&D Importer",
        "price": 300
    }
    
    headers = request_headers()
    
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
    
    headers = request_headers()
    
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
    
    headers = request_headers()
    
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
    
    headers = request_headers()
    
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
