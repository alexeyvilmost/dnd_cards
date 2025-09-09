package main

import (
	"encoding/json"
	"fmt"
	"log"
)

func main() {
	// Данные персонажа Лортар
	characterData := `{"id":"f38ae5d4-455b-4df1-9e1d-79f4a006ca6c","user_id":"a029c4a8-ff3b-4fbb-9a5e-f6f6b2fc1c0a","group_id":null,"name":"Лортар","data":"{\"isDefault\":true,\"jsonType\":\"character\",\"template\":\"default\",\"name\":{\"value\":\"Лортар\"},\"info\":{\"charClass\":{\"name\":\"charClass\",\"value\":\"Паладин/Колдун\"},\"charSubclass\":{\"name\":\"charSubclass\",\"value\":\"Клятва Мести\"},\"level\":{\"name\":\"level\",\"value\":4},\"background\":{\"name\":\"background\",\"value\":\"Прислужник\"},\"playerName\":{\"name\":\"playerName\",\"value\":\"\"},\"race\":{\"name\":\"race\",\"value\":\"Человек\"},\"alignment\":{\"name\":\"alignment\",\"value\":\"\"},\"experience\":{\"name\":\"experience\",\"value\":2}},\"subInfo\":{\"age\":{\"name\":\"age\",\"value\":\"\"},\"height\":{\"name\":\"height\",\"value\":\"\"},\"weight\":{\"name\":\"weight\",\"value\":\"\"},\"eyes\":{\"name\":\"eyes\",\"value\":\"\"},\"skin\":{\"name\":\"skin\",\"value\":\"\"},\"hair\":{\"name\":\"hair\",\"value\":\"\"}},\"spellsInfo\":{\"base\":{\"name\":\"base\",\"value\":\"\",\"code\":\"cha\"},\"save\":{\"name\":\"save\",\"value\":\"\"},\"mod\":{\"name\":\"mod\",\"value\":\"\"},\"available\":{\"classes\":[\"paladin\",\"warlock\",\"wizard\",\"cleric\",\"ranger\"]}},\"spells\":{\"slots-1\":{\"value\":3,\"filled\":0}},\"spellsPact\":{\"slots-1\":{\"value\":1,\"filled\":0}},\"proficiency\":2,\"stats\":{\"str\":{\"name\":\"str\",\"score\":15,\"modifier\":0},\"dex\":{\"name\":\"dex\",\"score\":13,\"modifier\":0},\"con\":{\"name\":\"con\",\"score\":14,\"modifier\":0},\"int\":{\"name\":\"int\",\"score\":9,\"modifier\":0},\"wis\":{\"name\":\"wis\",\"score\":11,\"modifier\":0},\"cha\":{\"name\":\"cha\",\"score\":16,\"modifier\":0}},\"saves\":{\"str\":{\"name\":\"str\",\"isProf\":false},\"dex\":{\"name\":\"dex\",\"isProf\":false},\"con\":{\"name\":\"con\",\"isProf\":false},\"int\":{\"name\":\"int\",\"isProf\":false},\"wis\":{\"name\":\"wis\",\"isProf\":true},\"cha\":{\"name\":\"cha\",\"isProf\":true}},\"skills\":{\"acrobatics\":{\"baseStat\":\"dex\",\"name\":\"acrobatics\"},\"investigation\":{\"baseStat\":\"int\",\"name\":\"investigation\"},\"athletics\":{\"baseStat\":\"str\",\"name\":\"athletics\",\"isProf\":1},\"perception\":{\"baseStat\":\"wis\",\"name\":\"perception\"},\"survival\":{\"baseStat\":\"wis\",\"name\":\"survival\"},\"performance\":{\"baseStat\":\"cha\",\"name\":\"performance\"},\"intimidation\":{\"baseStat\":\"cha\",\"name\":\"intimidation\",\"isProf\":1},\"history\":{\"baseStat\":\"int\",\"name\":\"history\"},\"sleight of hand\":{\"baseStat\":\"dex\",\"name\":\"sleight of hand\"},\"arcana\":{\"baseStat\":\"int\",\"name\":\"arcana\",\"isProf\":1},\"medicine\":{\"baseStat\":\"wis\",\"name\":\"medicine\"},\"deception\":{\"baseStat\":\"cha\",\"name\":\"deception\",\"isProf\":1},\"nature\":{\"baseStat\":\"int\",\"name\":\"nature\"},\"insight\":{\"baseStat\":\"wis\",\"name\":\"insight\",\"isProf\":1},\"religion\":{\"baseStat\":\"int\",\"name\":\"religion\",\"isProf\":1},\"stealth\":{\"baseStat\":\"dex\",\"name\":\"stealth\"},\"persuasion\":{\"baseStat\":\"cha\",\"name\":\"persuasion\",\"isProf\":1},\"animal handling\":{\"baseStat\":\"wis\",\"name\":\"animal handling\"}},\"vitality\":{\"hp-dice-current\":{\"value\":4},\"hp-dice-multi\":{},\"speed\":{\"value\":30},\"hit-die\":{\"value\":\"d10\"},\"shield\":{\"value\":true},\"ac\":{\"value\":17},\"hp-max\":{\"value\":33},\"hp-current\":{\"value\":33},\"isDying\":false,\"deathFails\":0,\"deathSuccesses\":0,\"hp-temp\":{\"value\":0}},\"attunementsList\":[{\"id\":\"attunement-1756273295327\",\"checked\":false,\"value\":\"\"}],\"weaponsList\":[{\"id\":\"weapon-1756273295327\",\"name\":{\"value\":\"Удар молотом\"},\"mod\":{\"value\":\"+0\"},\"dmg\":{\"value\":\"1к8 дробящего\"},\"isProf\":true,\"notes\":{\"value\":\"+3 к урону от ХАР\"},\"ability\":\"cha\"},{\"id\":\"weapon-1756275099111\",\"name\":{\"value\":\"Бросок копья\"},\"mod\":{\"value\":\"+0\"},\"dmg\":{\"value\":\"1к6 колющего\"},\"isProf\":true,\"notes\":{\"value\":\"дис. 20/60 +2 к урону\"}}],\"weapons\":{},\"text\":{\"attacks\":{\"value\":{\"id\":\"hover-toolbar-attacks-7763592\",\"data\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"italic\"}],\"text\":\"Увеличение характеристик\"},{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\".\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"+1 ко всем характеристикам\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Оборона. \"},{\"type\":\"text\",\"text\":\"+1 к КД\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Божественное здоровье.\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Иммунитет к болезням\"}]}]}}},\"prof\":{\"value\":{\"data\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"italic\"}],\"text\":\"Языки:\"},{\"type\":\"text\",\"text\":\" Общий, Орочий. +Эльфийский и Дварфийский (от Прислужника)\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"italic\"}],\"text\":\"Прислужник:\"},{\"type\":\"text\",\"text\":\" владение \"},{\"type\":\"text\",\"marks\":[{\"type\":\"underline\"}],\"text\":\"Проницательностью \"},{\"type\":\"text\",\"text\":\"и \"},{\"type\":\"text\",\"marks\":[{\"type\":\"underline\"}],\"text\":\"Религией\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"italic\"}],\"text\":\"Паладин: \"},{\"type\":\"text\",\"text\":\"владение \"},{\"type\":\"text\",\"marks\":[{\"type\":\"underline\"}],\"text\":\"Атлетикой\"},{\"type\":\"text\",\"text\":\" и \"},{\"type\":\"text\",\"marks\":[{\"type\":\"underline\"}],\"text\":\"Убеждением\"},{\"type\":\"text\",\"text\":\". Владение спасбросками МДР и ХАР.\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"italic\"}],\"text\":\"Колдун:\"},{\"type\":\"text\",\"text\":\" владение \"},{\"type\":\"text\",\"marks\":[{\"type\":\"underline\"}],\"text\":\"Магией\"},{\"type\":\"text\",\"text\":\" и \"},{\"type\":\"text\",\"marks\":[{\"type\":\"underline\"}],\"text\":\"Обманом\"},{\"type\":\"text\",\"text\":\".\"}]}]}}},\"allies\":{\"value\":{\"data\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"УМЕНИЕ: ПРИЮТ ДЛЯ ВЕРУЮЩИХ\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Вы и ваши спутники можете рассчитывать на бесплатное лечение и уход в храмах, святынях и других подобных местах, посвящённых вашей вере. Вам придётся предоставить материальные компоненты для заклинаний, если таковые понадобятся. Те, кто разделяют вашу веру, могут обеспечить вам (но только вам) скромное существование.\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"У вас также могут быть связи с каким-то конкретным храмом, посвящённым вашему божеству или пантеону, в котором у вас есть жилая комната. Пока вы находитесь с этим храмом в хороших отношениях, находясь неподалёку от него, вы можете попросить у его служителей помощи, если она не подвергнет их опасности.\"}]}]}}},\"feats\":{\"value\":{\"data\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Кольчуга. \"},{\"type\":\"text\",\"text\":\"КЗ 16 (Тяжелая броня)\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Щит.\"},{\"type\":\"text\",\"text\":\" +2 к КЗ\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Боевой молот.\"},{\"type\":\"text\",\"text\":\" 1к8 дробящего\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Метательные копья (5).\"},{\"type\":\"text\",\"text\":\" 1к6 колющего\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Набор священника.\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Священный символ.\"},{\"type\":\"text\",\"text\":\" Эмблема\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Проклятый клинок. \"},{\"type\":\"text\",\"text\":\"Клинок невероятной силы, переданный наставником на сохранение.\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Используется только в самом крайнем случае, есть риск смерти при использовании.\"}]}]}},\"customLabel\":\"СНаряжение\"},\"traits\":{\"value\":{\"id\":\"hover-toolbar-traits-9729942\",\"data\":{\"type\":\"doc\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"underline\"}],\"text\":\"Паладин: Клятва мести\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Божественное чувство.\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Действием можно на 6 секунд узнать местоположение Исчадий, Небожителей и Нежити в пределах 60 футов (без полного укрытия). 4 р/д.\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Наложение рук. 1р/д\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"15 (УР ПАЛ*3) очков здоровья, которые можно восстановить прикосновением. ОД\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Божественная кара.\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Попав атакой оружием, можно потратить ячейку любого класса, чтобы нанести 2к8 урона излучением +1к8 урона излучением за уровень ячейки\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"underline\"}],\"text\":\"Божественный канал. 1р/к\"}]},{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Праведное восстановление\"},{\"type\":\"text\",\"text\":\": [БД] Восстановить 1 ячейку 1 уровня\"}]}]},{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Порицание врага\"},{\"type\":\"text\",\"text\":\": [ОД] Испугать существо на 1 минуту. Испытание МДР, Исчадия и Нежить с помехой\"}]}]},{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Обет вражды\"},{\"type\":\"text\",\"text\":\": [БД]  Преимущество по цели на 1 минуту. Дальность: 10 фт.\"}]}]}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\"},{\"type\":\"paragraph\"},{\"type\":\"paragraph\"},{\"type\":\"paragraph\"},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"},{\"type\":\"underline\"}],\"text\":\"Колдун: Ведьмовской клинок.\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Проклятый воитель.\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Для одного оружия, которым вы владеете, можно использовать ХАР вместо СИЛ/ЛВК для бросков атаки и урона.\"}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"marks\":[{\"type\":\"bold\"}],\"text\":\"Проклятие ведьмовского клинка. 1р/к\"}]},{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Бонусным действием можно проклясть цель, которую вы можете видеть в пределах 30 футов.\"}]},{\"type\":\"bulletList\",\"content\":[{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"+2 (БВ) к урону от атак по цели\"}]}]},{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"Критический урон при 19 и 20.\"}]}]},{\"type\":\"listItem\",\"content\":[{\"type\":\"paragraph\",\"content\":[{\"type\":\"text\",\"text\":\"После смерти цели вы восстанавливаете себе 4 (1 + ХАР) здоровья.\"}]}]}]},{\"type\":\"paragraph\"},{\"type\":\"paragraph\",\"content\":[{\"type\":\"roller\"}]}]}},\"size\":7}},\"coins\":{\"gp\":{\"value\":15}},\"resources\":{\"resource-1756274787558\":{\"id\":\"resource-1756274787558\",\"name\":\"\",\"current\":0,\"max\":1,\"location\":\"feats\"},\"resource-1756275997980\":{\"id\":\"resource-1756275997980\",\"name\":\"\",\"current\":0,\"max\":1,\"location\":\"traits\"}},\"bonusesSkills\":{},\"bonusesStats\":{},\"conditions\":[],\"createdAt\":\"2025-08-27T05:42:03.924Z\",\"prof\":{\"armor-light\":{\"value\":true},\"armor-medium\":{\"value\":true},\"armor-heavy\":{\"value\":true},\"armor-label\":{\"value\":true},\"weapon-simple\":{\"value\":true},\"weapon-martial\":{\"value\":true}}}"}`

	var character map[string]interface{}
	if err := json.Unmarshal([]byte(characterData), &character); err != nil {
		log.Fatalf("Ошибка парсинга JSON: %v", err)
	}

	// Получаем data поле
	if dataField, exists := character["data"]; exists {
		if dataStr, ok := dataField.(string); ok {
			var dataJson map[string]interface{}
			if err := json.Unmarshal([]byte(dataStr), &dataJson); err != nil {
				log.Fatalf("Ошибка парсинга data JSON: %v", err)
			}

			// Анализируем traits
			analyzeTraits(dataJson)
		}
	}
}

func analyzeTraits(dataJson map[string]interface{}) {
	fmt.Printf("Анализ структуры traits для персонажа Лортар:\n")

	// Получаем traits
	if textField, exists := dataJson["text"]; exists {
		if textMap, ok := textField.(map[string]interface{}); ok {
			if traitsField, exists := textMap["traits"]; exists {
				if traitsMap, ok := traitsField.(map[string]interface{}); ok {
					if valueField, exists := traitsMap["value"]; exists {
						if valueMap, ok := valueField.(map[string]interface{}); ok {
							if dataField, exists := valueMap["data"]; exists {
								if dataMap, ok := dataField.(map[string]interface{}); ok {
									if contentField, exists := dataMap["content"]; exists {
										if contentArray, ok := contentField.([]interface{}); ok {
											fmt.Printf("Количество элементов в traits: %d\n\n", len(contentArray))

											for i, item := range contentArray {
												if itemMap, ok := item.(map[string]interface{}); ok {
													fmt.Printf("=== Элемент %d ===\n", i+1)
													fmt.Printf("Тип: %v\n", itemMap["type"])

													if itemMap["type"] == "bulletList" {
														fmt.Printf("*** НАЙДЕН BULLETLIST! ***\n")
														if content, ok := itemMap["content"].([]interface{}); ok {
															fmt.Printf("Количество элементов списка: %d\n", len(content))

															for j, listItem := range content {
																if listItemMap, ok := listItem.(map[string]interface{}); ok {
																	fmt.Printf("  Элемент списка %d: тип %v\n", j+1, listItemMap["type"])

																	if listItemMap["type"] == "listItem" {
																		if listContent, ok := listItemMap["content"].([]interface{}); ok {
																			for k, listContentItem := range listContent {
																				if listContentItemMap, ok := listContentItem.(map[string]interface{}); ok {
																					fmt.Printf("    Содержимое %d: тип %v\n", k+1, listContentItemMap["type"])

																					if listContentItemMap["type"] == "paragraph" {
																						if paragraphContent, ok := listContentItemMap["content"].([]interface{}); ok {
																							for l, textItem := range paragraphContent {
																								if textItemMap, ok := textItem.(map[string]interface{}); ok {
																									if text, ok := textItemMap["text"].(string); ok {
																										fmt.Printf("      Текст %d: %s\n", l+1, text)
																									}
																									if marks, ok := textItemMap["marks"].([]interface{}); ok {
																										fmt.Printf("      Стили %d: %v\n", l+1, marks)
																									}
																								}
																							}
																						}
																					}
																				}
																			}
																		}
																	}
																}
															}
														}
													} else {
														// Обычный параграф
														if content, ok := itemMap["content"].([]interface{}); ok {
															fmt.Printf("Количество подэлементов: %d\n", len(content))

															for j, subItem := range content {
																if subItemMap, ok := subItem.(map[string]interface{}); ok {
																	fmt.Printf("  Подэлемент %d: тип %v\n", j+1, subItemMap["type"])

																	if text, ok := subItemMap["text"].(string); ok {
																		fmt.Printf("    Текст: %s\n", text)
																	}

																	if marks, ok := subItemMap["marks"].([]interface{}); ok {
																		fmt.Printf("    Стили: %v\n", marks)
																	}
																}
															}
														}
													}
													fmt.Println()
												}
											}
										}
									}
								}
							}
						}
					}
				}
			}
		}
	}
}

