#!/usr/bin/env python3
import requests
import json

# URL API
BASE_URL = "http://localhost:8080/api"

def get_all_cards():
    """Получить все карты"""
    response = requests.get(f"{BASE_URL}/cards?limit=100")
    if response.status_code == 200:
        data = response.json()
        return data.get('cards', [])
    else:
        print(f"Ошибка получения карт: {response.status_code}")
        return []

def update_card_to_template(card_id, card_data):
    """Обновить карту, сделав её шаблоном"""
    # Обновляем только поле is_template
    update_data = {
        "is_template": "template"
    }
    
    response = requests.put(f"{BASE_URL}/cards/{card_id}", json=update_data)
    if response.status_code == 200:
        print(f"✅ Обновлена карта: {card_data['name']}")
        return True
    else:
        print(f"❌ Ошибка обновления карты {card_data['name']}: {response.status_code}")
        print(f"   Ответ: {response.text}")
        return False

def main():
    print("Получение всех карт...")
    cards = get_all_cards()
    
    if not cards:
        print("Карты не найдены")
        return
    
    print(f"Найдено карт: {len(cards)}")
    
    # Обновляем только карты с is_template = "false"
    cards_to_update = [card for card in cards if card.get('is_template') == 'false']
    print(f"Карт для обновления: {len(cards_to_update)}")
    
    if not cards_to_update:
        print("Нет карт для обновления")
        return
    
    success_count = 0
    for card in cards_to_update:
        if update_card_to_template(card['id'], card):
            success_count += 1
    
    print(f"\nОбновлено карт: {success_count}/{len(cards_to_update)}")

if __name__ == "__main__":
    main()
