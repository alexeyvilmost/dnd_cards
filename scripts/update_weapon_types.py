#!/usr/bin/env python3
"""
Скрипт для автоматического определения и установки типов оружия для карточек
CARD-0293 - CARD-0330
"""

import requests
import json
import os
import sys

# URL API
BASE_URL = "http://localhost:8080/api"

# Загружаем данные о типах оружия
def load_weapon_types():
    """Загружает данные о типах оружия из JSON файла"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    weapon_types_path = os.path.join(script_dir, '..', 'frontend', 'utils', 'weapon_types.json')
    
    with open(weapon_types_path, 'r', encoding='utf-8') as f:
        return json.load(f)

def get_auth_token():
    """Получает токен авторизации"""
    try:
        login_data = {
            "username": "importer_user", 
            "password": "importer_pass123"
        }
        
        login_response = requests.post(
            f"{BASE_URL}/auth/login",
            json=login_data,
            headers={"Content-Type": "application/json"}
        )
        
        if login_response.status_code == 200:
            result = login_response.json()
            token = result.get('token')
            if token:
                return token
        else:
            # Попробуем зарегистрировать пользователя
            register_data = {
                "username": "importer_user",
                "password": "importer_pass123",
                "email": "importer@example.com",
                "display_name": "Importer User"
            }
            
            requests.post(
                f"{BASE_URL}/auth/register",
                json=register_data,
                headers={"Content-Type": "application/json"}
            )
            
            # Повторная попытка логина
            login_response = requests.post(
                f"{BASE_URL}/auth/login",
                json=login_data,
                headers={"Content-Type": "application/json"}
            )
            
            if login_response.status_code == 200:
                result = login_response.json()
                token = result.get('token')
                if token:
                    return token
                    
    except Exception as e:
        print(f"Ошибка получения токена: {e}")
    
    return None

def find_weapon_type_by_name(card_name, weapon_types_data):
    """Находит тип оружия по названию карточки"""
    if not card_name or card_name.strip() == '':
        return None
    
    normalized_name = card_name.strip().lower()
    
    # Ищем совпадение во всех категориях оружия
    for category in weapon_types_data.get('basic', []):
        weapons = category.get('weapons', [])
        for weapon in weapons:
            normalized_weapon_name = weapon['russian_name'].lower()
            # Проверяем, содержит ли название карточки название оружия
            if normalized_weapon_name in normalized_name:
                return weapon
    
    return None

def get_cards_by_numbers(start_num, end_num, token):
    """Получает карточки по номерам"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    # Получаем все карточки
    response = requests.get(f"{BASE_URL}/cards?limit=1000", headers=headers)
    if response.status_code != 200:
        print(f"Ошибка получения карт: {response.status_code}")
        print(f"Ответ: {response.text}")
        return []
    
    data = response.json()
    all_cards = data.get('cards', [])
    
    # Фильтруем карточки по номерам
    cards_to_update = []
    for num in range(start_num, end_num + 1):
        card_number = f"CARD-{num:04d}"
        for card in all_cards:
            if card.get('card_number') == card_number:
                cards_to_update.append(card)
                break
    
    return cards_to_update

def update_card_weapon_type(card_id, weapon_type_name, token):
    """Обновляет тип оружия карточки"""
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    
    update_data = {
        "weapon_type": weapon_type_name
    }
    
    response = requests.put(f"{BASE_URL}/cards/{card_id}", json=update_data, headers=headers)
    return response.status_code == 200

def main():
    print("=" * 60)
    print("Обновление типов оружия для карточек CARD-0293 - CARD-0330")
    print("=" * 60)
    
    # Загружаем данные о типах оружия
    print("\n1. Загрузка данных о типах оружия...")
    weapon_types_data = load_weapon_types()
    print(f"   Загружено категорий: {len(weapon_types_data.get('basic', []))}")
    
    # Получаем токен авторизации
    print("\n2. Получение токена авторизации...")
    token = get_auth_token()
    if not token:
        print("   [ERROR] Не удалось получить токен авторизации")
        return
    print("   [OK] Токен получен")
    
    # Получаем карточки
    print("\n3. Получение карточек CARD-0293 - CARD-0330...")
    cards = get_cards_by_numbers(293, 330, token)
    print(f"   Найдено карточек: {len(cards)}")
    
    if not cards:
        print("   [ERROR] Карточки не найдены")
        return
    
    # Обрабатываем каждую карточку
    print("\n4. Обработка карточек...")
    updated_count = 0
    skipped_count = 0
    error_count = 0
    
    for card in cards:
        card_number = card.get('card_number', 'N/A')
        card_name = card.get('name', '')
        card_id = card.get('id')
        current_weapon_type = card.get('weapon_type')
        
        # Пропускаем если тип оружия уже установлен
        if current_weapon_type:
            print(f"   [SKIP] {card_number}: {card_name} - тип оружия уже установлен ({current_weapon_type})")
            skipped_count += 1
            continue
        
        # Ищем тип оружия по названию
        found_weapon = find_weapon_type_by_name(card_name, weapon_types_data)
        
        if found_weapon:
            # Обновляем карточку
            if update_card_weapon_type(card_id, found_weapon['name'], token):
                print(f"   [OK] {card_number}: {card_name} -> {found_weapon['russian_name']} ({found_weapon['name']})")
                updated_count += 1
            else:
                print(f"   [ERROR] {card_number}: {card_name} - ошибка обновления")
                error_count += 1
        else:
            print(f"   [WARN] {card_number}: {card_name} - тип оружия не найден")
            skipped_count += 1
    
    # Итоги
    print("\n" + "=" * 60)
    print("ИТОГИ:")
    print(f"   Обновлено: {updated_count}")
    print(f"   Пропущено: {skipped_count}")
    print(f"   Ошибок: {error_count}")
    print("=" * 60)

if __name__ == "__main__":
    main()

