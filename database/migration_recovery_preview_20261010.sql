-- Recovery metadata audit: 427 live actions and 511 live spells, 2026-10-10.
-- Explicit production migration, NOT an automatic startup migration.
-- Pair with recoveryPreview.ts UI change; does not change execution or saved states.
-- Source policy fingerprints make catalog drift fail atomically for review.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(hashtext('catalog-recovery-preview-20261010'));
CREATE TEMP TABLE recovery_preview_plan(payload jsonb) ON COMMIT DROP;
INSERT INTO recovery_preview_plan VALUES ($plan$[
  {
    "id": "018a043c-ddc3-5378-a942-8b95e2e567ab",
    "card_number": "ACT-VAR-ACT-wild-shape-spider",
    "name": "Дикая форма — Паук",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "36a6d8b0fc44259460787478ece9ecf0",
    "expected_content_hash": "85de78706251afb4157dcc6073c6cf03"
  },
  {
    "id": "01c4caa3-88e0-4d11-b8fb-214622617d9f",
    "card_number": "ACT-action-surge",
    "name": "Всплеск действий",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "5e3c3d586b2ba7a8e3bc927987970fa1",
    "expected_content_hash": "b7915c6801b353d50cc0e50ee6ed44a8"
  },
  {
    "id": "02245dba-ea11-40c4-974a-ae021425b50e",
    "card_number": "ACT-subclass-EFFECT-0115",
    "name": "Двуличность",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "aecf992c54ab3fe150eb728edc3d69f3",
    "expected_content_hash": "18b42718e35cc388f388c2a7c0cc7b41"
  },
  {
    "id": "0238e7bb-7104-5df2-9627-a2ec92bc3c0c",
    "card_number": "ACT-item-completion-0601",
    "name": "Сапоги уворота — Невероятное уклонение",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых: 1к6 зарядов",
    "reason": "mechanics.uses",
    "expected_hash": "095f6e5a96751179c5a8c940187eec8a",
    "expected_content_hash": "3e35a7c555624e053889d18e6f623606"
  },
  {
    "id": "04bb3876-8bc2-572a-85c3-4a30d7ef65b1",
    "card_number": "ACT-item-completion-0473",
    "name": "Перчатки ловли стрел — Отклонить выстрел",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "fcb1082b4f36ef92fecb56e3e0da8bb6",
    "expected_content_hash": "82593f62978be85f92a53eb5b21c88b0"
  },
  {
    "id": "08e57d30-25f1-5503-a12f-6c050dd4ad09",
    "card_number": "ACT-item-influence-0646",
    "name": "Верный  талисман — Преимущество к20",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "7f4f5ec3b79b79bea326969ae948b8a9",
    "expected_content_hash": "c8e27b36fa0d48a8b33dd9f99bd341f1"
  },
  {
    "id": "0a141718-26af-5d42-a2d5-b63c180227c7",
    "card_number": "ACT-item-completion-high-853-form-longsword",
    "name": "Первичная сфера — Принять форму: Длинный меч",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "e9ea7ca19ade465a1e5714193378c004",
    "expected_content_hash": "b7955c4b9529c2d8d6d16e011fbdf7c6"
  },
  {
    "id": "0aaf9b03-6e34-5b97-abe9-f022db454b79",
    "card_number": "ACT-item-completion-high-853-form-light_hammer",
    "name": "Первичная сфера — Принять форму: Лёгкий молот",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "82f8d01e9d2e30645e66c471a2b766fc",
    "expected_content_hash": "86289878b3e5f001a8e3341661a1eafd"
  },
  {
    "id": "0e1ad776-b0e0-49fe-ad71-5fd8eebe7c71",
    "card_number": "ACT-subclass-EFFECT-0125",
    "name": "Шаги феи",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "680b6eae1dd5cf2983e54649ed552502",
    "expected_content_hash": "9b74725237af6566937a479c925fb560"
  },
  {
    "id": "0e6a6970-f20b-56e7-b478-98893284e20f",
    "card_number": "ACT-item-completion-0382",
    "name": "Темное ожерелье — Заменить успешный бросок",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "39c55e15bd3acf6b4fb2709b89abd580",
    "expected_content_hash": "a6577ea12f9caf0351a019c9dd3fe4bc"
  },
  {
    "id": "0effed63-685b-5afa-aa1f-1bda142df10f",
    "card_number": "ACT-item-completion-high-853-form-shortbow",
    "name": "Первичная сфера — Принять форму: Гоблинский короткий лук",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "a99c8e9499b8f230a1549a97e59059db",
    "expected_content_hash": "a1b85124456c74bd926f32d7a6cac62b"
  },
  {
    "id": "10a1ea07-7e27-45c0-944d-fcb3b36129c1",
    "card_number": "ACT-subclass-EFFECT-0085",
    "name": "Звёздный облик",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "ecba1491eab04bc276b366d830775d65",
    "expected_content_hash": "9ef1c48a3804e7cf37148340123aef86"
  },
  {
    "id": "12400000-0000-4000-8000-000000000002",
    "card_number": "ACT-feat-musician-song",
    "name": "Ободряющая песня",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "2dd406554fad90a4b728a0114e954be2",
    "expected_content_hash": "9b8dd0817c7c2fecdb3cd907fe7d9971"
  },
  {
    "id": "12400000-0000-4000-8000-000000000003",
    "card_number": "ACT-feat-crafter-fast-craft",
    "name": "Быстрое изготовление",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "91065f40f8db5ac501dcba3942d2ea5c",
    "expected_content_hash": "6e1dd866fce05425fa5877f9767e37ef"
  },
  {
    "id": "12400000-0000-4000-8000-000000000004",
    "card_number": "action_basic_heroic_inspiration",
    "name": "Использовать героическое вдохновение",
    "recharge": "custom",
    "recharge_custom": "Получение нового Героического вдохновения; долгий отдых — при наличии соответствующей способности",
    "reason": "shared resource",
    "expected_hash": "08151cb194e848e1a47d9c82503d60b3",
    "expected_content_hash": "068c4f16759586e7fc81e8f4962921ab"
  },
  {
    "id": "135b2dd8-1baa-5184-aa63-8778ef8fa426",
    "card_number": "ACT-item-completion-high-853-form-quarterstaff",
    "name": "Первичная сфера — Принять форму: Посох теневого мага",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "b91fc225782afaf7549e16b497e9c2eb",
    "expected_content_hash": "149fcfa9095fcbdcee0fd1dbd2215cff"
  },
  {
    "id": "14dfe040-e350-4319-aa5d-9820da463779",
    "card_number": "ACT-feat-lucky-disadvantage",
    "name": "Очко удачи: Помеха",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "ee1ee4da7cc6210d02eee9b5ecb9b9d5",
    "expected_content_hash": "d503d9cfd4f556a0205dd27ba429ad75"
  },
  {
    "id": "14f0c427-4a2e-5233-a03b-3111230830b2",
    "card_number": "ACT-item-completion-high-853-form-longbow",
    "name": "Первичная сфера — Принять форму: Длинный лук",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "3776689d43ebf711b98e4a70ec5e85f9",
    "expected_content_hash": "f2a163411b3bbffcf978acf4b54956b8"
  },
  {
    "id": "15400000-0000-4000-8000-000000000002",
    "card_number": "ACT-channel-divinity-divine-spark-heal",
    "name": "Божественная искра: исцеление",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "fb5e6669f52c218eeb0eb0c4aace537c",
    "expected_content_hash": "0de39bdd68520a01b52919dcc0f6af51"
  },
  {
    "id": "15400000-0000-4000-8000-000000000003",
    "card_number": "ACT-channel-divinity-divine-spark-radiant",
    "name": "Божественная искра: урон излучением",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "a666b238df132bfcfc8721b355dc90ab",
    "expected_content_hash": "c10998299ea774e9c2bd04685be3b08c"
  },
  {
    "id": "15400000-0000-4000-8000-000000000004",
    "card_number": "ACT-channel-divinity-turn-undead",
    "name": "Изгнание нежити",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "460390fa7fa1a00cf01b78661fdcb853",
    "expected_content_hash": "34d8955df31197a69663953dc70cac4f"
  },
  {
    "id": "15400000-0000-4000-8000-000000000005",
    "card_number": "ACT-wild-companion",
    "name": "Дикий спутник",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "a6476b8940dd1e4a911d6e5d07ef34d3",
    "expected_content_hash": "3b7f3d1ea56307a926217093305b562d"
  },
  {
    "id": "15400000-0000-4000-8000-000000000006",
    "card_number": "ACT-monk-flurry-of-blows",
    "name": "Шквал ударов",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "8e3d8518606148ca2a2db6a172e80def",
    "expected_content_hash": "f48c6c99730692af3879cfd7b4dde696"
  },
  {
    "id": "15400000-0000-4000-8000-000000000008",
    "card_number": "ACT-monk-patient-defense-focus",
    "name": "Терпеливая оборона: Фокус",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "f6d3cd54f5fd629010d0159308cbdf12",
    "expected_content_hash": "30ade060a27b0611cc74535d273e51b9"
  },
  {
    "id": "15400000-0000-4000-8000-000000000010",
    "card_number": "ACT-monk-step-of-the-wind-focus",
    "name": "Шаг ветра: Фокус",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "8b36c2d08eedd1b8aea2fe39aa337a2f",
    "expected_content_hash": "a32df022420535f993912ee34960e58b"
  },
  {
    "id": "15400000-0000-4000-8000-000000000011",
    "card_number": "ACT-monk-uncanny-metabolism",
    "name": "Необычный метаболизм",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "f1ee7470ccd385bef30d009f9780d2f9",
    "expected_content_hash": "986db5e8ea8a7b7cc0a9e41aa3f2bd84"
  },
  {
    "id": "15400000-0000-4000-8000-000000000015",
    "card_number": "ACT-font-create-slot-1",
    "name": "Создать ячейку 1 круга",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "1bf8a5c0cad16dca4fcfe67e0c3ce8a2",
    "expected_content_hash": "7e58ab6d344f73f783df66fc239d65d6"
  },
  {
    "id": "15400000-0000-4000-8000-000000000017",
    "card_number": "ACT-magical-cunning",
    "name": "Магическая хитрость",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "086d848432f5a2b4c39530ad72d7781b",
    "expected_content_hash": "2cc841b68e3745ebea5578339c8f9726"
  },
  {
    "id": "15400000-0000-4000-8000-000000000018",
    "card_number": "ACT-tactical-mind",
    "name": "Тактический ум",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "535d3fdcf00e2db7dcd20e07f4dfa7d1",
    "expected_content_hash": "82a9f49af268b31b9e1e809fb5a0770e"
  },
  {
    "id": "16200000-0000-4000-8000-000000000401",
    "card_number": "ACT-metamagic-quickened",
    "name": "Подготовить Ускоренное заклинание",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "e5133f4f0ded64f758788eaa9d3dad67",
    "expected_content_hash": "87645f09729c20b8719552005ab4f7fa"
  },
  {
    "id": "16200000-0000-4000-8000-000000000402",
    "card_number": "ACT-metamagic-transmuted",
    "name": "Подготовить Преобразованное заклинание",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "47b6548b0cf3f7765272d17b897d5dfb",
    "expected_content_hash": "19c0ae77c40dcdf8ce109b78edec1019"
  },
  {
    "id": "16500000-0000-4000-8000-000000000002",
    "card_number": "ACT-monk-deflect-redirect",
    "name": "Перенаправить отражённую атаку",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "159ff1fcbb0ec37e93187bd999d5f1fd",
    "expected_content_hash": "0f928c3bffdf3840d97d0f8443b1c107"
  },
  {
    "id": "16500000-0000-4000-8000-000000000003",
    "card_number": "ACT-paladin-divine-sense",
    "name": "Божественное чувство",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "ec5313ecdc2a2f524c97aa427dba54c4",
    "expected_content_hash": "cdd01ab90ee08f463be619226fa02de0"
  },
  {
    "id": "16700000-0000-4000-8000-000000000003",
    "card_number": "ACT-druid-wild-resurgence-slot",
    "name": "Дикое возрождение: ячейка",
    "recharge": "custom",
    "recharge_custom": "Использования: Долгий отдых · Дикий облик: Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "mechanics.uses",
    "expected_hash": "661159d346c14102ecf78f08666483c0",
    "expected_content_hash": "07c73caa0e29bcdf441c6a0102fc3bcc"
  },
  {
    "id": "16700000-0000-4000-8000-000000000004",
    "card_number": "ACT-monk-stunning-strike",
    "name": "Оглушающий удар",
    "recharge": "custom",
    "recharge_custom": "Использования: Каждый ход · Очки фокусировки: Короткий или долгий отдых",
    "reason": "mechanics.uses",
    "expected_hash": "732f63043efc5a2340f929184902eea0",
    "expected_content_hash": "e30734b10e7cadd93d5e60d9d941a690"
  },
  {
    "id": "16700000-0000-4000-8000-000000000010",
    "card_number": "ACT-dragonborn-draconic-flight",
    "name": "Драконьий полёт",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "274f3a97dfe173c7e8654e3efd5ae706",
    "expected_content_hash": "9ce23bee816f4cb980814ce77d72a768"
  },
  {
    "id": "16700000-0000-4000-8000-000000000012",
    "card_number": "ACT-cleric-turn-undead-sear",
    "name": "Изгнание нежити: Поражение нежити",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "2213067e0a25f013ee69d21012c763d9",
    "expected_content_hash": "92cae9c45559ab3cd51ca50d3bedaad4"
  },
  {
    "id": "16700000-0000-4000-8000-000000000019",
    "card_number": "ACT-font-create-slot-2",
    "name": "Создать ячейку 2 круга",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "6616d8ce6b265ea35e7b779ad082b769",
    "expected_content_hash": "f86dd31102012d14e6e9de430d9f2dc3"
  },
  {
    "id": "16700000-0000-4000-8000-000000000020",
    "card_number": "ACT-font-create-slot-3",
    "name": "Создать ячейку 3 круга",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "3ca0dabca61c3a104e580ffdbf3ef2c5",
    "expected_content_hash": "39054aabb081ff8954e48edf03509aff"
  },
  {
    "id": "17200000-0000-4000-8000-000000000002",
    "card_number": "ACT-general-poisoner",
    "name": "Нанести яд",
    "recharge": "custom",
    "recharge_custom": "Изготовление новых доз яда; отдых не пополняет запас",
    "reason": "shared resource",
    "expected_hash": "14d4346f0f480c36b36b2404e2cd6ac5",
    "expected_content_hash": "c9ca48cedd1f649429511cfa442549e9"
  },
  {
    "id": "17200000-0000-4000-8000-000000000004",
    "card_number": "ACT-general-chef-treat",
    "name": "Съесть угощение",
    "recharge": "custom",
    "recharge_custom": "Приготовление новых угощений (после долгого отдыха или за 1 час)",
    "reason": "shared resource",
    "expected_hash": "ddd8529f0e0375e8752db08c29828073",
    "expected_content_hash": "3e5608378b5a2cbb9f0a27f53a958211"
  },
  {
    "id": "17200000-0000-4000-8000-000000000005",
    "card_number": "ACT-general-crusher-push",
    "name": "Крушитель: оттолкнуть",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "0f0121b6a7dc5fe237b07eb72aa2b705",
    "expected_content_hash": "be603372b7855eef65377764f367a2cf"
  },
  {
    "id": "17200000-0000-4000-8000-000000000007",
    "card_number": "ACT-general-slasher-slow",
    "name": "Рубака: замедлить",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "b74be797c4ee4371f8e7e5e64ffb5b5c",
    "expected_content_hash": "5de3edd67f0d45b604997faf625b9d1a"
  },
  {
    "id": "17e13187-d809-4357-a467-4116b30eb359",
    "card_number": "ACT-breath-fire",
    "name": "Оружие дыхания (огонь)",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "02b7c8f8feba2638c5c5abf39115f5a4",
    "expected_content_hash": "3850364cc436d029e3655684a44ad9ff"
  },
  {
    "id": "18200000-0000-4000-8000-000000000001",
    "card_number": "ACT-general-inspiring-leader-wis",
    "name": "Воодушевляющее выступление — Мудрость",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "4f58420999c4bf04df1902c7bd028af5",
    "expected_content_hash": "244678cbcd202dbf7869fda54b8e2a08"
  },
  {
    "id": "18200000-0000-4000-8000-000000000002",
    "card_number": "ACT-general-inspiring-leader-cha",
    "name": "Воодушевляющее выступление — Харизма",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "f58e5ebadec4bc19e8ce38092f2c37e4",
    "expected_content_hash": "4a5bb81d3dfc3453ecac5c3882ecd866"
  },
  {
    "id": "18200000-0000-4000-8000-000000000011",
    "card_number": "ACT-general-shield-master-push",
    "name": "Мастер щитов: толкнуть",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "cd6a7065bb3de59413a28ac573235b35",
    "expected_content_hash": "55c944808238c8916f267b92ee878997"
  },
  {
    "id": "18200000-0000-4000-8000-000000000012",
    "card_number": "ACT-general-shield-master-prone",
    "name": "Мастер щитов: сбить с ног",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "f5b815ec4dd0ce24114774e58149e3da",
    "expected_content_hash": "72381af46c84c2425a1ff0d044f47a97"
  },
  {
    "id": "18200000-0000-4000-8000-000000000013",
    "card_number": "ACT-general-charger-damage",
    "name": "Натиск: дополнительный урон",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "cd87fcd01960e393c8a3e95938ca46b8",
    "expected_content_hash": "57a898a19d585e640da7a2c7e5fd1861"
  },
  {
    "id": "18200000-0000-4000-8000-000000000014",
    "card_number": "ACT-general-charger-push",
    "name": "Натиск: оттолкнуть",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "db37786b91a8b28a08ae1c87e160a737",
    "expected_content_hash": "fb18ee0b4334a3fea1155beeb3ec2209"
  },
  {
    "id": "1b927c22-3b22-52a7-8fbe-f935b10e89ed",
    "card_number": "ACT-item-completion-0509",
    "name": "Бусы из зубов мёртвых — Сопротивление",
    "recharge": "custom",
    "recharge_custom": "Не восстанавливаются",
    "reason": "mechanics.uses",
    "expected_hash": "e0067d3fcb8c6b3cb79ec9dd97c47063",
    "expected_content_hash": "0d328f5df96530a853fbcc0f2f3a1914"
  },
  {
    "id": "1c132a06-07db-5836-93dc-6c343c727e4a",
    "card_number": "ACT-item-audit-fire-breath",
    "name": "Выдохнуть огонь",
    "recharge": "custom",
    "recharge_custom": "Новая порция зелья; заряды действуют 1 час и не восстанавливаются отдыхом",
    "reason": "shared resource",
    "expected_hash": "dad22d7c4d0c1f82c850d6d6915595e3",
    "expected_content_hash": "432d415a697dfb53bf59fe4d9cdfb076"
  },
  {
    "id": "1cd19d26-3011-4859-9430-c8787fe99ba7",
    "card_number": "ACT-second-wind",
    "name": "Второе дыхание",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "mechanics.uses",
    "expected_hash": "f8d75fafe6fa34b59040dc4eef4d00f4",
    "expected_content_hash": "d110e56dce077b0a81f88c5e3ec377a1"
  },
  {
    "id": "1d361f9d-b595-57bd-b7b7-7acb84b7288e",
    "card_number": "ACT-item-influence-0544-adv",
    "name": "Шляпа капитана — Преимущество",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "e49099a3a0bcf8d4970a52165ef247ec",
    "expected_content_hash": "3283a815395a70f934e02391f6f76e51"
  },
  {
    "id": "20fa7233-e7b1-57a6-ac83-7eaa0e7a44f5",
    "card_number": "ACT-item-completion-high-853-form-battleaxe",
    "name": "Первичная сфера — Принять форму: Боевой топор",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "d79c313b91bed7ff444a2e81c3760ca6",
    "expected_content_hash": "0fa13f26327efdd8ba25f1d1ff787722"
  },
  {
    "id": "21000000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-evasive-footwork",
    "name": "Уклоняющийся шаг",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "c5bfaf87ff877bd6f85fc996ced80cba",
    "expected_content_hash": "78751ef5e7e4f7485cc333e756e65709"
  },
  {
    "id": "21100000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-menacing-attack",
    "name": "Устрашающая атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "c647734d57814085ce0e3b735d9345bc",
    "expected_content_hash": "f82c27a826442f8d33c219036c5b483d"
  },
  {
    "id": "21200000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-trip-attack",
    "name": "Опрокидывающая атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "9bc16d1240bbbba7c4c665ef9f607c7b",
    "expected_content_hash": "b115135f45dc82d2a569e46a2eb56650"
  },
  {
    "id": "21300000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-goading-attack",
    "name": "Провоцирующая атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "8ea974ad9912c327a3f639f80d2c0d8b",
    "expected_content_hash": "92409ccb9ecea747b46167ffe1b5a326"
  },
  {
    "id": "21500000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-distracting-strike",
    "name": "Отвлекающий удар",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "770526f601e099e653aca2caed757d8d",
    "expected_content_hash": "a7243901201c897adb86c07466344718"
  },
  {
    "id": "21600000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-parry",
    "name": "Парирование",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "9f72ce5535281b749aab75038de90f5c",
    "expected_content_hash": "7698aafabc69a5c273c0f3aec5ccc6fe"
  },
  {
    "id": "21700000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-rally",
    "name": "Сплочение",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "561aa0ae302a73d39b0902336f5e737e",
    "expected_content_hash": "5a63c83f75591a49d6e1ff982a3ee554"
  },
  {
    "id": "21800000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-pushing-attack",
    "name": "Толкающая атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "18ffb36076bcf7d70e1258848f290bc5",
    "expected_content_hash": "9edc0d201fe73763fdc5689dfb0d3c2c"
  },
  {
    "id": "21900000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-feinting-attack",
    "name": "Обманная атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "e30c4e7889153fd8821feb1af5f67023",
    "expected_content_hash": "0050ae6f7690e671a3fe3677b08b6c22"
  },
  {
    "id": "219873f7-cc3a-5fb1-a98d-f1443b6abe0f",
    "card_number": "ACT-item-completion-high-889-hit-teleport",
    "name": "Глефа Алентар +3 — Телепортировать поражённую цель",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "b635ef0d2edfd00e97a0797adcc5b3d9",
    "expected_content_hash": "4723d44425df81fbad55c6ca0014e2da"
  },
  {
    "id": "22000000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-commanding-presence",
    "name": "Командное присутствие",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "8ce8778225755745901c7fa1b1e08215",
    "expected_content_hash": "aa3bc6531635ca627c55ba0b0c3b29db"
  },
  {
    "id": "22000000-0000-4000-8000-000000000002",
    "card_number": "ACT-bm-tactical-assessment",
    "name": "Тактическая оценка",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "69efd800e20edc9e1305881b4603a5ca",
    "expected_content_hash": "d582c847b3b0684de4046a2f4b40b0a1"
  },
  {
    "id": "22100000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-ambush",
    "name": "Засада",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "d9d4d8487f234432bb3430defdf51447",
    "expected_content_hash": "65426a6f8b08b12c7b61618b03846db2"
  },
  {
    "id": "22200000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-precision",
    "name": "Точная атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "7fc2100a1e3231c4fc8c488da50533eb",
    "expected_content_hash": "8cbb760e3f47fc0b585dbcf75912e5a9"
  },
  {
    "id": "22300000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-lunging",
    "name": "Атака с выпадом",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "782508b727cac3bc331ad5456c716376",
    "expected_content_hash": "e799fd53641adc23be17fd4397dcf671"
  },
  {
    "id": "22400000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-sweeping",
    "name": "Размашистая атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "5eb6b55c28a43f91b64e446850fe0f51",
    "expected_content_hash": "90bb04668943a5f5bc4963fda1e9d24c"
  },
  {
    "id": "22500000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-riposte",
    "name": "Ответный удар",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "5cb78e967d9fcd4674c3b27d48d2fffd",
    "expected_content_hash": "1c94a06930ff9c4988893ed3b8145e7a"
  },
  {
    "id": "22600000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-bait-switch",
    "name": "Приманка и подмена",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "362c53dafc9a09afcfb9f3ffe6a15969",
    "expected_content_hash": "e7eb1f889cbfd590d0a0b88c83266344"
  },
  {
    "id": "22700000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-commanders-strike",
    "name": "Удар командующего",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "d5a2a9531ccf0e63c5b39ce3d0832c46",
    "expected_content_hash": "0162d73a44746fb6a11db078f91e5201"
  },
  {
    "id": "22800000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-maneuvering-attack",
    "name": "Маневрирующая атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "b0b976c96cb602ad9e4272f7ff4eaaf0",
    "expected_content_hash": "b5863470ccd4ec754d99a7a3c42d2891"
  },
  {
    "id": "22900000-0000-4000-8000-000000000001",
    "card_number": "ACT-bm-disarming-attack",
    "name": "Обезоруживающая атака",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "3fee088e2affc619a22980459919b081",
    "expected_content_hash": "c0ee139a0d77e9a1bcb5e1de882c25be"
  },
  {
    "id": "22c0ccd3-1546-511a-a68e-196a52a48ee1",
    "card_number": "ACT-item-completion-high-853-form-light_crossbow",
    "name": "Первичная сфера — Принять форму: Треснутый арбалет",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "5c01494ce4ecbe06c328e479ff74a349",
    "expected_content_hash": "176bad44e40153b97945957e2bef6380"
  },
  {
    "id": "23100000-0000-4000-8000-000000000001",
    "card_number": "ACT-psi-warrior-strike",
    "name": "Псионический удар",
    "recharge": "custom",
    "recharge_custom": "Кости псионической энергии воина: Короткий отдых: +1; долгий отдых: все заряды · Ограничение действия: Не чаще одного раза за ход",
    "reason": "shared resource",
    "expected_hash": "2d646c74a2b4fbfa1d9368fe3991de70",
    "expected_content_hash": "923c68ef8fd8a9b201bd0306931c0262"
  },
  {
    "id": "23200000-0000-4000-8000-000000000001",
    "card_number": "ACT-psi-warrior-protective-field",
    "name": "Защитное поле",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "9f04759960d0e7a0adbf903532c857e0",
    "expected_content_hash": "d7b57f8de723b0d979c9e2a84b78842c"
  },
  {
    "id": "23300000-0000-4000-8000-000000000001",
    "card_number": "ACT-psi-warrior-movement",
    "name": "Телекинетическое перемещение",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "154872b4797a995979de5974180bf323",
    "expected_content_hash": "55d5c529469bf69e5a8c52aa609c08ef"
  },
  {
    "id": "23300000-0000-4000-8000-000000000002",
    "card_number": "ACT-psi-warrior-restore-movement",
    "name": "Восстановить телекинетическое перемещение",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "02dea18d4c7a6ee7f0ee68a591b84593",
    "expected_content_hash": "c343a52ea9481b10beaa0a893802d589"
  },
  {
    "id": "23755d94-791a-5586-a491-4815cfbd3ff7",
    "card_number": "ACT-item-completion-high-853-form-lance",
    "name": "Первичная сфера — Принять форму: Длинное копьё",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "9dd7ebdacf019a1e54e738966060868a",
    "expected_content_hash": "cd81ca5aff0522712a8ef0cd2fb9b64f"
  },
  {
    "id": "264a073f-0f24-445f-af58-445d083bd69f",
    "card_number": "ACT-subclass-EFFECT-0170",
    "name": "Гнев природы",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "63d84bcf4f505ceac7e3a12cc25879e3",
    "expected_content_hash": "984ff5f4148f6e4e82ec6d3400512bb4"
  },
  {
    "id": "29004a22-9464-5b5d-afa9-15531e2cd588",
    "card_number": "ACT-item-completion-high-853-form-whip",
    "name": "Первичная сфера — Принять форму: Кнут",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "ee1c9c1616c731ec45d1e60e57e3e4a6",
    "expected_content_hash": "1e3dcf1c1c062786061c41f2c9a7dc55"
  },
  {
    "id": "2a688422-dc0e-5413-a5c6-0c9513d15384",
    "card_number": "ACT-VAR-ACT-aasimar-revelation-shroud",
    "name": "Небесное откровение — Некротический покров",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "4438caa52faf84e1f7d11b0bab02881c",
    "expected_content_hash": "297262e1e1828052acde7f873b6400c5"
  },
  {
    "id": "2b0682f0-514b-405a-b8fc-c2361351f26e",
    "card_number": "ACT-subclass-EFFECT-0106",
    "name": "Боевой священник",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "190462dceabfde81035ed0ee6c6c6e36",
    "expected_content_hash": "da531886813cb3ea4804d9ce4a2523b1"
  },
  {
    "id": "30043de6-a432-564a-9d9c-f7d06aa0e5b0",
    "card_number": "ACT-item-completion-0597",
    "name": "Сапоги с шипами — Прыжок с шипами",
    "recharge": "custom",
    "recharge_custom": "Каждый бой",
    "reason": "mechanics.uses",
    "expected_hash": "1359c40714df240c60a0b19f53630415",
    "expected_content_hash": "57cc8def09e96dc69605b5a4db50d03d"
  },
  {
    "id": "33088306-4704-55cc-a19e-f79860956dd0",
    "card_number": "ACT-item-completion-high-853-form-javelin",
    "name": "Первичная сфера — Принять форму: Метательное копьё",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "a4984afc7ba9ad3157a50ef41a0cb438",
    "expected_content_hash": "67fb68bf541e30ffacecfd9b9704915c"
  },
  {
    "id": "35cb71a5-9074-54cc-a22d-80a458f17fe1",
    "card_number": "ACT-item-completion-high-853-form-mace",
    "name": "Первичная сфера — Принять форму: Булава",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "1d6e87b8f9122ad369811972850785ac",
    "expected_content_hash": "b71cd0d9eebd9a685a038bb4ea823f97"
  },
  {
    "id": "361051c6-e824-4d62-bd1e-a017fa863102",
    "card_number": "ACT-subclass-EFFECT-0037",
    "name": "Воин богов",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "98709babbf99b3e9e412f803980a75ef",
    "expected_content_hash": "9faf5e41c9f91b390c7975bec05070a8"
  },
  {
    "id": "381eeae1-de58-425d-abcb-bc12076f083f",
    "card_number": "ACT-subclass-EFFECT-0244",
    "name": "Поток хаоса",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "a7f0c6281030c9a6a1c2f3b49365d446",
    "expected_content_hash": "428f4083de2b27028ae7631d2363cad7"
  },
  {
    "id": "3ea9a83b-20f6-4fa7-b2d7-011f1942a7bb",
    "card_number": "ACT-breath-acid",
    "name": "Оружие дыхания (кислота)",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "4b3eecdc477658707be28b18e38e7dcf",
    "expected_content_hash": "a10f70ea79a9ff89129ce62dc371b055"
  },
  {
    "id": "3f2d9ce8-c2c1-5d03-a15a-52b41e822360",
    "card_number": "ACT-item-completion-high-853-form-scimitar",
    "name": "Первичная сфера — Принять форму: Скимитар",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "e6f5cd3894a555f8162de9b8ff8d6f57",
    "expected_content_hash": "0d877c5c9c3ed196c047113d7a8cb3e2"
  },
  {
    "id": "43563e11-7e1c-5d2a-8960-e51d683193fb",
    "card_number": "ACT-item-completion-0596",
    "name": "Сапоги Тьмы — Шаг в темноту",
    "recharge": "custom",
    "recharge_custom": "Каждый бой",
    "reason": "mechanics.uses",
    "expected_hash": "da33e67ea37459d8b0c5a76956a3b00f",
    "expected_content_hash": "84007d239b50cf0a152144c878a08e1d"
  },
  {
    "id": "44752a41-56fa-4321-b5ac-ff56c08372bc",
    "card_number": "ACT-goliath-hill",
    "name": "Толчок холмов",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "5fbca784ffd9e5c18039cc51efd4afbb",
    "expected_content_hash": "f118e05ebe82d62358774a7a214bff0a"
  },
  {
    "id": "48a971f3-82d1-5f29-a00c-f146fee26315",
    "card_number": "ACT-VAR-ACT-wild-shape-riding-horse",
    "name": "Дикая форма — Верховая лошадь",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "43d69aa153607963159663fd89159192",
    "expected_content_hash": "777c793e49a6e3e626a02f9798b41381"
  },
  {
    "id": "48af7804-ad4f-5570-ac7e-2be061980886",
    "card_number": "ACT-VAR-ACT-aasimar-revelation-wings",
    "name": "Небесное откровение — Небесные крылья",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "49ad1d46bf79ad449a99bee6cdc12cf5",
    "expected_content_hash": "1f24ac3c31487bb62a63b3a2ac026b92"
  },
  {
    "id": "49301c1f-4e30-40fc-b44c-ed5ecf304eaf",
    "card_number": "ACT-aasimar-revelation",
    "name": "Небесное откровение",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "75293420199b8a399f1b424fe1e28352",
    "expected_content_hash": "f6452c33945a585d380088622166bce4"
  },
  {
    "id": "4a66067e-ef15-5240-bf58-5a1b51993b62",
    "card_number": "ACT-item-influence-0113",
    "name": "Ожерелье красноречия — Преимущество проверки Харизмы",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "e4af05a01a8cc3be889905ba72ec52cd",
    "expected_content_hash": "c183a895e63ed6b5f93331839bbe7289"
  },
  {
    "id": "4bf81ca7-b874-5650-aa90-6561fd4767c3",
    "card_number": "ACT-item-completion-high-853-form-musket",
    "name": "Первичная сфера — Принять форму: Мушкет",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "d034a989870a26182b25b7551a0420b6",
    "expected_content_hash": "cf3c6b9aee4d04e636fcdb260e97a597"
  },
  {
    "id": "4d973aa4-a38c-5b1d-96f8-2fb0e879a83a",
    "card_number": "ACT-item-completion-0506",
    "name": "Амулет агностика — Божественный совет",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "dfa606c3077370ead289a2cd2e003fc9",
    "expected_content_hash": "4d13c4f6b4672cbf495ee073c36343fc"
  },
  {
    "id": "4fc46d43-5fa9-565a-a47c-c671dbaf35a9",
    "card_number": "ACT-item-completion-high-853-form-dart",
    "name": "Первичная сфера — Принять форму: Дротик",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "5f811aa35b0b2cf742be43d9fb375c4d",
    "expected_content_hash": "e4f5c010c52447fb583a5571e97edd8c"
  },
  {
    "id": "507a13bf-ca6a-4d14-89e4-21016293e0a7",
    "card_number": "ACT-bardic-inspiration",
    "name": "Вдохновение барда",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; с 5-го уровня барда — также короткий отдых",
    "reason": "shared resource",
    "expected_hash": "df10297e6bf9a27c5f2d3baa4956b2ce",
    "expected_content_hash": "348f1dc5dadda235d1a2be182d2a22de"
  },
  {
    "id": "50cf573c-454e-53f6-8e7d-3de928aecb12",
    "card_number": "ACT-item-completion-0601-failure",
    "name": "Сапоги уворота — Увёртливость — провал",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых: 1к6 зарядов",
    "reason": "mechanics.uses",
    "expected_hash": "77e83c073247b811ebe21cc5603506ed",
    "expected_content_hash": "72d9b88759c1b4b977d846080cee05af"
  },
  {
    "id": "518471cb-145b-52d0-818d-0c5442d0d0bb",
    "card_number": "ACT-item-completion-0669-slot-5",
    "name": "Амулет восстановления — Восстановить ячейку 5",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "7dddaf2a8f53c6b69d3c035fe9c54326",
    "expected_content_hash": "a565997d02d8843f29030987cec371c3"
  },
  {
    "id": "51b65d3e-879a-5f01-9a16-c2d46c3bfa07",
    "card_number": "ACT-item-completion-0535",
    "name": "Снежинка — Принять удар",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "1bd74d7a5e3f74de56a7a2f1c5906a84",
    "expected_content_hash": "0421d3d58ec3a760c34a260390596497"
  },
  {
    "id": "523934b2-926d-491d-b209-58ba1a8f66e3",
    "card_number": "ACT-breath-poison",
    "name": "Оружие дыхания (яд)",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "b7a487b4d1d51b1e7295bd05f9129265",
    "expected_content_hash": "2f33e1fac4efaac844d42c8703af39a1"
  },
  {
    "id": "53ddcaa8-50ae-502c-a6a0-75c22ab60c4f",
    "card_number": "ACT-VAR-ACT-bm-pushing-attack-10",
    "name": "Толкающая атака — 10 фт.",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "f1b12930aa3b17b84238e5c157763089",
    "expected_content_hash": "80ceb39c7b69ae7c89f114d0c22f3dc5"
  },
  {
    "id": "54225aa5-e875-5c15-aa6f-52437075799d",
    "card_number": "ACT-item-completion-high-853-form-maul",
    "name": "Первичная сфера — Принять форму: Молот",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "9f7f4ee913cd176b9f7f45af9ae7efd7",
    "expected_content_hash": "4873d323e0739d16e686893f773f2674"
  },
  {
    "id": "57237120-72f2-511a-837e-936de8c8f54f",
    "card_number": "ACT-item-completion-0669-slot-8",
    "name": "Амулет восстановления — Восстановить ячейку 8",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "60dcfabf1f82f5e6c6a9a731b13639c1",
    "expected_content_hash": "b536a3971e7568c19e93d0ad05189bea"
  },
  {
    "id": "58af20d9-f80a-42dd-8e9d-844740fcffe1",
    "card_number": "ACT-goliath-large-form",
    "name": "Крупная форма",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "60ebbe4bff4d4d2d33d794c57f814a55",
    "expected_content_hash": "b0a94005410ed987816bbc02773c3cf5"
  },
  {
    "id": "5c1acaa2-e735-5ed7-a641-d8f8e24ae301",
    "card_number": "ACT-item-completion-high-853-form-halberd",
    "name": "Первичная сфера — Принять форму: Алебарда",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "40dea1f68759e272463770f6abd60e6d",
    "expected_content_hash": "dd71e4199f66b640c3103c50aa035502"
  },
  {
    "id": "5dcefc87-ed4f-5a9f-afca-9ff03db10746",
    "card_number": "ACT-item-completion-high-853-form-greatsword",
    "name": "Первичная сфера — Принять форму: Клинок тени",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "421a6bfb7f4dd27af34309625a8120d1",
    "expected_content_hash": "cdf50d6f530b3dc55d13587285c40a3b"
  },
  {
    "id": "5ec851a1-0818-4937-874e-887e813ba459",
    "card_number": "ACTION-0002",
    "name": "Проворный рывок",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "66e4ad1ee884fec221c6df276c2806ac",
    "expected_content_hash": "736735a286f075a7e9c2dbf7bf03874d"
  },
  {
    "id": "5f18fc6f-3821-4602-8c1f-33bdcd4060f3",
    "card_number": "ACT-goliath-fire",
    "name": "Огненный ожог",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "31296e4b10bba6390aaced74634552a7",
    "expected_content_hash": "b00adf101e4be97e606bc2385a95343d"
  },
  {
    "id": "611f1be7-1eac-4b69-beaa-5a802d362b03",
    "card_number": "ACT-goliath-storm",
    "name": "Громовой удар",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "e18714b179a9045583e96b657a683c32",
    "expected_content_hash": "007d0b0fa964924ed0527dfab527bec0"
  },
  {
    "id": "62563212-85c5-56c4-aea1-e4eec9e3b3d3",
    "card_number": "ACT-VAR-ACT-metamagic-transmuted-acid",
    "name": "Подготовить Преобразованное заклинание — Кислота",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "eed19a39f90eabcdfcadfa4bc7389076",
    "expected_content_hash": "2d06a9cc05f3522ea6c5fa87f2fca9d2"
  },
  {
    "id": "6833b4e2-5442-59e1-acdf-aece6b813a1e",
    "card_number": "ACT-VAR-ACT-bm-bait-switch-self",
    "name": "Приманка и подмена — Я",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "05eb101875e93f2ae327ae92d203e720",
    "expected_content_hash": "26b528d67ef9c112fb3d18236019675b"
  },
  {
    "id": "69e2affe-7938-5e0c-af47-45ab32fba7f7",
    "card_number": "ACT-VAR-ACT-bm-pushing-attack-0",
    "name": "Толкающая атака — Не отталкивать",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "1339edc9c8f481ee8d511661100815e2",
    "expected_content_hash": "bde2da8048074411a0b6426132ca6869"
  },
  {
    "id": "6d9d5acc-948f-52f2-888c-35e2f9099bad",
    "card_number": "ACT-item-completion-0669-slot-1",
    "name": "Амулет восстановления — Восстановить ячейку 1",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "9b27290929ca6c4293e3b1008769afdf",
    "expected_content_hash": "90a810030a561175d5e3a99037ecab5e"
  },
  {
    "id": "72b7a4ec-761b-52bf-a597-fa3af45ab4da",
    "card_number": "ACT-VAR-ACT-metamagic-transmuted-cold",
    "name": "Подготовить Преобразованное заклинание — Холод",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "8f532cf15ea6213eaa40f57dfbe78a77",
    "expected_content_hash": "42711ec22ddfe00a4a89e95f4ace0a19"
  },
  {
    "id": "72fd68ef-c608-5ef5-a409-8843d7853047",
    "card_number": "ACT-VAR-ACT-wild-shape-wolf",
    "name": "Дикая форма — Волк",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "eed9061fcdaea61f060ce40b7bd3542a",
    "expected_content_hash": "2690f6e28349fcc1eddc4da85c1414a9"
  },
  {
    "id": "73a156da-d88e-5830-bf58-036623d919e6",
    "card_number": "ACT-item-completion-0510",
    "name": "Мешочек кофе Мамы Бо — Выпить порцию кофе",
    "recharge": "custom",
    "recharge_custom": "Не восстанавливаются",
    "reason": "mechanics.uses",
    "expected_hash": "0b229861ede1f245c946f098fc93b9ac",
    "expected_content_hash": "8af5815c5dd6ca6ab727e4a8eb229a83"
  },
  {
    "id": "74ac809a-41ea-4246-91d9-f89351f3a876",
    "card_number": "ACT-feat-healer-medic",
    "name": "Полевой медик",
    "recharge": "custom",
    "recharge_custom": "Не восстанавливаются; требуется новый комплект целителя",
    "reason": "shared resource",
    "expected_hash": "4f274ac0f05d645890550d3fb0136f9b",
    "expected_content_hash": "4db76599e97e63d244eec3dccbb408fb"
  },
  {
    "id": "7517b42e-4417-407f-a16c-5fa0c9e81282",
    "card_number": "ACT-goliath-stone",
    "name": "Каменная стойкость",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "87ef057a8a13ec84210a4b78cc13a3e9",
    "expected_content_hash": "d5544b6cb0c2d334c1d20df578b0b954"
  },
  {
    "id": "75436bae-5886-5157-aa94-acbd3e5ddf38",
    "card_number": "ACT-item-completion-high-853-form-flail",
    "name": "Первичная сфера — Принять форму: Цеп",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "77ef1dd09c10b7ed1d31c31631991a4e",
    "expected_content_hash": "e6750d7ffdd6e18ffef2e6a5d7de4117"
  },
  {
    "id": "767b0600-9f23-433c-b79d-c98bfa9de65f",
    "card_number": "ACT-feat-lucky-advantage",
    "name": "Очко удачи: Преимущество",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "97d66e97f02de6dbee96bca600ed61c2",
    "expected_content_hash": "f14d577d3803df1fcf00f15d391fdeff"
  },
  {
    "id": "773e821a-eafa-5a43-a491-9a68f11b98b8",
    "card_number": "ACT-item-completion-high-853-form-pistol",
    "name": "Первичная сфера — Принять форму: Пистоль",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "0167438ac5ce5f6b7a0bfe30d2bc6d32",
    "expected_content_hash": "0adcb349a36cc2464d37bce021180be6"
  },
  {
    "id": "79377ff8-39b4-5052-a9a7-29a6bc467a22",
    "card_number": "ACT-item-completion-high-853-form-war_pick",
    "name": "Первичная сфера — Принять форму: Боевая кирка",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "782b4c451fe4fbda94fd1e44cae3a14c",
    "expected_content_hash": "c83f5ecdd5e6256a3eab75d9a3996368"
  },
  {
    "id": "7d5ac189-e4b9-4e30-921c-ffaadcd013e4",
    "card_number": "action_barbarian_rage_2",
    "name": "Ярость",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "per-turn restriction",
    "expected_hash": "3681842e4ddd2595625eb9f03394899b",
    "expected_content_hash": "034934646dc5ccef248092b9ecc937f1"
  },
  {
    "id": "7ee8be70-2ae7-4519-a237-6de14c0bef1c",
    "card_number": "ACT-goliath-frost",
    "name": "Морозная поступь",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "07bd95d8d09ba8d341882b08cf2a9f9d",
    "expected_content_hash": "63ab3f2917592e57de011947d89347a4"
  },
  {
    "id": "815f7963-ccac-4480-8a4d-6c790d8d2bcb",
    "card_number": "ACT-rage",
    "name": "Ярость",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "12dcaf5473ac649a42bc5bdd125497c8",
    "expected_content_hash": "6088ce2d45315f04f34a5ea53a8a35f8"
  },
  {
    "id": "8295a341-92ef-485b-b1de-7a5d7712fe4e",
    "card_number": "ACT-goliath-cloud",
    "name": "Облачная телепортация",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "9e0de65d82a54ecd2fc508a0284dadb1",
    "expected_content_hash": "c1ba413500918fe896a4057f2ab44f25"
  },
  {
    "id": "83799659-f232-5ab4-a2d1-5e3dd710c82f",
    "card_number": "ACT-VAR-ACT-metamagic-transmuted-poison",
    "name": "Подготовить Преобразованное заклинание — Яд",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "2da30a8e4ad926bf1149f6cfae82e4b8",
    "expected_content_hash": "97d622912c3d01a3db49958f1555a071"
  },
  {
    "id": "83eb1ddf-764d-519e-aa4d-1fd782982a2b",
    "card_number": "ACT-VAR-ACT-bm-pushing-attack-15",
    "name": "Толкающая атака — 15 фт.",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "6f7fb5845d4c80e6580b74a10328cc5f",
    "expected_content_hash": "d5ade66b5c99d70b58f0afe57443d989"
  },
  {
    "id": "84afe9f3-1d82-5713-a2dd-edb33fc96aa8",
    "card_number": "ACT-item-completion-high-853-form-handaxe",
    "name": "Первичная сфера — Принять форму: Ручной топор",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "b046b8b94719d20e6783d61248ca42e6",
    "expected_content_hash": "eb66ed8569d0d2a09d972d8adee5111f"
  },
  {
    "id": "86d9a5c7-1a45-57c2-b29f-8a06eccca017",
    "card_number": "ACT-item-completion-0669-slot-9",
    "name": "Амулет восстановления — Восстановить ячейку 9",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "e5fb1d1ca499ae2e06388070c684d2d9",
    "expected_content_hash": "abc57ff0f79e1de5bde69f45332ce442"
  },
  {
    "id": "8919b36b-c065-53ac-a754-4b956b0b21c5",
    "card_number": "ACT-item-completion-high-853-form-heavy_crossbow",
    "name": "Первичная сфера — Принять форму: Тяжелый арбалет",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "e6570dd5bd22127ad21a25638dcf7765",
    "expected_content_hash": "54697241f079f134dfdce16340065d5a"
  },
  {
    "id": "8a8e482e-5bde-52e2-a762-88ad95eefd84",
    "card_number": "ACT-item-completion-0601-success",
    "name": "Сапоги уворота — Увёртливость — успех",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых: 1к6 зарядов",
    "reason": "mechanics.uses",
    "expected_hash": "4d0300db62fac288840ba4dad7b9fed1",
    "expected_content_hash": "fca4f6d4d01aaa5f288fcbbc68be6288"
  },
  {
    "id": "8cda6b71-2836-5ad2-b76a-d80ab77bd013",
    "card_number": "ACT-item-influence-0378",
    "name": "Мгновение — Переброс к20 реакцией",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "2e599e4bd3f802e87a2e64c5972d9041",
    "expected_content_hash": "db00512dfaec98bb325f614f887697f3"
  },
  {
    "id": "8f6a5a28-2403-5747-ba70-88c34a4ecc50",
    "card_number": "ACT-item-completion-0669-slot-6",
    "name": "Амулет восстановления — Восстановить ячейку 6",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "e9fc05aebb125a1117283de6c6cfa2d2",
    "expected_content_hash": "6795c39b5b589adc62c4237d081ba120"
  },
  {
    "id": "8fcedb0c-e610-4e8b-be8c-aaddcce0a388",
    "card_number": "ACT-subclass-EFFECT-0147",
    "name": "Исцеляющая рука",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "ce67f0780cf6fd690d1fd278a16186ab",
    "expected_content_hash": "f634cf93cf8c2dc89a4fd2463efc599d"
  },
  {
    "id": "918682c8-741e-48cc-87bf-6917391f65a5",
    "card_number": "ACT-subclass-EFFECT-0120",
    "name": "Сияние рассвета",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "cd1e0820f5cd9e4f5034e36b7b7f678f",
    "expected_content_hash": "e8fc7ca62e900ae73a489bd9b4bbe438"
  },
  {
    "id": "944e08e0-ee20-5f66-b7c8-fe2d1e382589",
    "card_number": "ACT-item-completion-0669-slot-7",
    "name": "Амулет восстановления — Восстановить ячейку 7",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "a05fd3b739038fec3761349132d6db2c",
    "expected_content_hash": "411b7972c8706592f3a77b211d2e0f83"
  },
  {
    "id": "9816d36f-764a-53db-9c50-51ebd4fac230",
    "card_number": "ACT-item-influence-0640",
    "name": "Кольцо уклонения — Успешный спасбросок Ловкости",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "e8b78bce1180271ccca8382440108097",
    "expected_content_hash": "5157c0c6b2fba17497e5d4c8100184ad"
  },
  {
    "id": "98544707-3234-5798-ab3f-219d41d43802",
    "card_number": "ACT-item-completion-0630",
    "name": "Кольцо бдительности — Контратака",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "ede9756e12f81d06dd5db49901c6cbd8",
    "expected_content_hash": "ca69fe18602f410bc7898599680a8db3"
  },
  {
    "id": "9ac466a2-1b35-5a22-b33a-336a038b7441",
    "card_number": "ACT-item-completion-0440",
    "name": "Сапоги смывки — Ускользнуть после урона",
    "recharge": "custom",
    "recharge_custom": "Каждый бой",
    "reason": "mechanics.uses",
    "expected_hash": "7035d8cd01ea72acbbfae8bebd188f93",
    "expected_content_hash": "40daa28762fcd56b0a0beefc2078c652"
  },
  {
    "id": "9b129505-21cb-579e-9a6b-17abe0b9ffee",
    "card_number": "ACT-item-influence-0544-dis",
    "name": "Шляпа капитана — Помеха",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "shared resource",
    "expected_hash": "c9f690dcbc74c32a31921bc4ffa1dc7f",
    "expected_content_hash": "bad5b76a6d1ab20d5f0a56878ee12004"
  },
  {
    "id": "9b4b8e9f-df5a-55c9-af21-b15c5c5dd6f8",
    "card_number": "ACT-item-influence-0381",
    "name": "Кольцо хронургии — Переброс к20",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "e7dae30100e263074676f9177c44b8da",
    "expected_content_hash": "cd0c85dfd0faa776a059ad4ca7f56916"
  },
  {
    "id": "9c45053c-b84c-444f-b405-23ea2cc5447c",
    "card_number": "ACT-subclass-EFFECT-0100",
    "name": "Гнев моря",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "42d3c51c9d28a7ac37b2d7dc0541ee2c",
    "expected_content_hash": "d7e62d3c238215c858f5208109b403d9"
  },
  {
    "id": "a227f2bf-6e88-45f7-83f9-44a709aa6f2b",
    "card_number": "ACT-breath-lightning",
    "name": "Оружие дыхания (молния)",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "19d1eba713d8005c7227c4a372039ba4",
    "expected_content_hash": "a2668a5bebd46d38a800ebf4fe38e096"
  },
  {
    "id": "a2f3ad52-51be-4f2f-8aeb-c3bccb9a750b",
    "card_number": "ACT-subclass-EFFECT-0182",
    "name": "Несравненный атлет",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "7e67cf8d03179fbb61e4ffecadc89f94",
    "expected_content_hash": "9e4cbbc58b79de54c9a489d0f94dd5b1"
  },
  {
    "id": "a357149f-913f-5cb8-ae05-814c627ca232",
    "card_number": "ACT-VAR-ACT-aasimar-revelation-radiance",
    "name": "Небесное откровение — Внутренний свет",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "3c47e8386205657e94b0a01faca06270",
    "expected_content_hash": "68978cb9d41ea6e94ba3e9d418492fcf"
  },
  {
    "id": "a7b4e1eb-440f-5936-a4fd-b3fc6194a9e7",
    "card_number": "ACT-item-completion-high-853-form-sling",
    "name": "Первичная сфера — Принять форму: Праща",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "a611caa5aa1c2c3af364e17403e5b270",
    "expected_content_hash": "a3bee4a45312998dbcc939dc2c424e53"
  },
  {
    "id": "a8454b46-6356-424b-9f82-c656b29bccc2",
    "card_number": "ACT-subclass-EFFECT-0090",
    "name": "Помощь земли",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "6d67bf14c94dbbc776f9b69c62cb8f7f",
    "expected_content_hash": "43f946556ff45de9494694a9b9c8929b"
  },
  {
    "id": "a86819e4-ab9e-4a74-bdde-957e7e3e9f1f",
    "card_number": "ACTION-0001",
    "name": "Магическое восстановление",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "7a1821b61cf17a24e9434f005bbe33c3",
    "expected_content_hash": "dca620038cfcc2111e474de38c8a7233"
  },
  {
    "id": "a9f35e08-eaee-5940-a14b-5d095b7eff78",
    "card_number": "ACT-item-completion-high-853-form-greataxe",
    "name": "Первичная сфера — Принять форму: Секира",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "cfdde8a703960fb43b212f89f73591d4",
    "expected_content_hash": "d685a68a524317e6cf24da68c8f8f9f5"
  },
  {
    "id": "ac062e13-e05c-5e8d-ac23-78c12fa6aed5",
    "card_number": "ACT-VAR-ACT-wild-shape-rat",
    "name": "Дикая форма — Крыса",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "7f4fdbc25e24e0edb1891a96b8b91b6a",
    "expected_content_hash": "1be9e795a7b8e78b38b9bf073507acc5"
  },
  {
    "id": "adf91a43-3085-59b8-ac3b-ede38034fb00",
    "card_number": "ACT-VAR-ACT-metamagic-transmuted-lightning",
    "name": "Подготовить Преобразованное заклинание — Молния",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "d4fcc06bbfa549c9823b0fff5fbd67c2",
    "expected_content_hash": "124a5fdefce2032abfeb05df1f61f291"
  },
  {
    "id": "af883db0-cab6-58f1-9681-4d1c5337ee8e",
    "card_number": "ACT-item-completion-low-0186",
    "name": "Посох колдуна",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "a8363a3e7322b675b33c841cd59d4308",
    "expected_content_hash": "d662356b586397447ec532ddb48b5a96"
  },
  {
    "id": "b0cfa7c0-860e-52a6-a3c2-9584a6ad5773",
    "card_number": "ACT-item-influence-0383",
    "name": "Длиный меч точности — Критическое попадание этим мечом",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "d96cf191abd6c44802658b3cf082f755",
    "expected_content_hash": "582ebcf7b1a9799c26b8bb5a7dfdfe37"
  },
  {
    "id": "b14e00e8-c3fe-586f-b48e-e6c4380ffaba",
    "card_number": "ACT-item-completion-0450",
    "name": "Наручи паладина — Ослепить атакующего",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "fd0cc3a9355c333c0e59005423af2905",
    "expected_content_hash": "c398e66fdf9f1d1f366e90ae2b26111d"
  },
  {
    "id": "b318a782-af35-543d-a536-0ff8b5717887",
    "card_number": "ACT-VAR-ACT-bm-pushing-attack-5",
    "name": "Толкающая атака — 5 фт.",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "c8c775c05cc1ab8dc7a921a1e78ff2d2",
    "expected_content_hash": "8d0a89e853f759587419291db8384c1e"
  },
  {
    "id": "b78dda66-26ba-46d6-8b1d-78424ee22f42",
    "card_number": "ACT-subclass-EFFECT-0176",
    "name": "Священное оружие",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "1dda168f49d57dccddb5b59699a40fcb",
    "expected_content_hash": "0f166ef9de741be58706ec5645aaab67"
  },
  {
    "id": "b7f8278d-b902-42c7-ad04-3a8f694542e1",
    "card_number": "ACT-breath-cold",
    "name": "Оружие дыхания (холод)",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "0a7e9b5818a274ceafb5e4b4b13608b5",
    "expected_content_hash": "287df9721cafb7fd5d67cc336592fe6e"
  },
  {
    "id": "bc0d93ce-ec65-47fc-b2ce-8e6aa99776d4",
    "card_number": "ACT-subclass-EFFECT-0142",
    "name": "Лечащий свет",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "12b30574277b74f28be132b0e164fd6c",
    "expected_content_hash": "7d665c07196f7744636a36082381ad9f"
  },
  {
    "id": "bce02040-c633-5303-a8af-c2ebd489c160",
    "card_number": "ACT-item-completion-high-853-form-warhammer",
    "name": "Первичная сфера — Принять форму: Боевой молот",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "f071bc5c0c15de21dd02a23ad6627b5f",
    "expected_content_hash": "48c2e9e667a452a82769c880224974e0"
  },
  {
    "id": "bd15af12-0ec2-475c-8922-edec35ab7d69",
    "card_number": "ACT-subclass-EFFECT-0166",
    "name": "Обет вражды",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "859b7056630cd756332c91c6579dd21c",
    "expected_content_hash": "bca6f02714805adf9da32c31de1a3fcd"
  },
  {
    "id": "bde62543-93fa-5ee4-b67b-60abd1412b96",
    "card_number": "ACT-item-completion-0669-slot-3",
    "name": "Амулет восстановления — Восстановить ячейку 3",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "16137cc30f1018aee5d6e9a5b42dbbce",
    "expected_content_hash": "729613674963bcba9be8d3c38c29f4b3"
  },
  {
    "id": "bdefa964-95e1-542d-ad86-319c7a03c000",
    "card_number": "ACT-item-completion-high-853-form-greatclub",
    "name": "Первичная сфера — Принять форму: Палица",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "b6c50cf6c04078e3bf074577ef458655",
    "expected_content_hash": "39ddaec0e3c917618ec04e5acde84240"
  },
  {
    "id": "bdff2c0b-8423-53e9-a44b-84580c873009",
    "card_number": "ACT-item-completion-high-853-form-morningstar",
    "name": "Первичная сфера — Принять форму: Моргенштерн",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "bf6711800755bce4320c44c9552467c1",
    "expected_content_hash": "0d55bd37701152eb17eeb0510f4087d5"
  },
  {
    "id": "c1e5077d-f7d9-580d-a20d-c70ef7ba2f38",
    "card_number": "ACT-VAR-ACT-metamagic-transmuted-thunder",
    "name": "Подготовить Преобразованное заклинание — Гром",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "a99e9ee60398c4f87398de8484318680",
    "expected_content_hash": "2b6f1617d5008bd9c9166e7026dd6a9c"
  },
  {
    "id": "c5522f24-8d59-59f4-8009-a8a63a728975",
    "card_number": "ACT-item-completion-0530",
    "name": "Чаша отраженной памяти — Воспоминание",
    "recharge": "custom",
    "recharge_custom": "Не восстанавливаются",
    "reason": "mechanics.uses",
    "expected_hash": "89a51594a6d849850050b095eefd5222",
    "expected_content_hash": "a51463dc381d2e0501925716cc27ebd0"
  },
  {
    "id": "c6f83aa9-5454-43bd-b8a0-65658dc529ec",
    "card_number": "ACT-subclass-EFFECT-0111",
    "name": "Сохранение жизни",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "9a31c3f0df702d7f948595e180a34aa4",
    "expected_content_hash": "610ced15b7d40f4fdfa583d712736240"
  },
  {
    "id": "c87f8907-de0c-5750-a984-0d48d4c68898",
    "card_number": "ACT-item-completion-high-853-form-sickle",
    "name": "Первичная сфера — Принять форму: Серп",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "b33ddbe0bf00567636b5d6bda78e1d19",
    "expected_content_hash": "590430cd15442a4c79bb9243c27d9d44"
  },
  {
    "id": "cdb4a53f-0f37-5a95-8b64-ee10523f1627",
    "card_number": "ACT-item-completion-0669-slot-2",
    "name": "Амулет восстановления — Восстановить ячейку 2",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "f8b102391b6da4083dc1f2d2461c2df5",
    "expected_content_hash": "984362f230c077150658322157fd7415"
  },
  {
    "id": "d59d969f-6f83-5b21-831b-3a4f2babdb51",
    "card_number": "ACT-item-completion-0669-slot-4",
    "name": "Амулет восстановления — Восстановить ячейку 4",
    "recharge": "custom",
    "recharge_custom": "Ежедневно (в механике — долгий отдых)",
    "reason": "shared resource",
    "expected_hash": "62c97a7e2b6c9b69f5e9ea56e9448317",
    "expected_content_hash": "6e737b74f5351168847da8bac4c9affd"
  },
  {
    "id": "d5c8d7bc-d92f-547d-8cdd-a1e72cba4316",
    "card_number": "ACT-item-completion-0595",
    "name": "Сапоги решительности — Сохранить концентрацию",
    "recharge": "custom",
    "recharge_custom": "Каждый ход",
    "reason": "mechanics.uses",
    "expected_hash": "5abff0c7d8b024ee7a89fa4231257092",
    "expected_content_hash": "7f8a338a4d158d28f6e3243599d2821c"
  },
  {
    "id": "d7e549b7-8468-48ff-a762-850b328d9d1e",
    "card_number": "ACT-breath-weapon",
    "name": "Оружие дыхания",
    "recharge": "long_rest",
    "recharge_custom": null,
    "reason": "mechanics.uses",
    "expected_hash": "b5f1c6fb4b9c91307138bbfc4ed3d3f2",
    "expected_content_hash": "a8a5188f8e426e99834b4d1463d4ae03"
  },
  {
    "id": "dbdedd3e-8e4b-5499-a95d-51b149e9576f",
    "card_number": "ACT-item-completion-high-853-form-glaive",
    "name": "Первичная сфера — Принять форму: Глефа",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "83fbe87d592322969a3d6b419e101a60",
    "expected_content_hash": "3c9091f2fae299b32b931097cf48d004"
  },
  {
    "id": "df4bde2f-1b20-593a-93f8-7921ec6bf239",
    "card_number": "ACT-item-completion-0475",
    "name": "Перчатки хранителя — Отвергнуть новый отрицательный эффект",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "80761be2d37c2ff34b110b2cc26259e7",
    "expected_content_hash": "15c05b4f8c4bfb152c70026b3fc1ef4d"
  },
  {
    "id": "e174b934-705d-55e5-acf9-4ab391e2b00f",
    "card_number": "ACT-item-completion-high-853-form-dagger",
    "name": "Первичная сфера — Принять форму: Ржавый кенжал",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "722ed3f36d9aca04e2095ff4537ac1c7",
    "expected_content_hash": "c0acf1b045307154b1b5041d3b2fc700"
  },
  {
    "id": "e2271ce7-b234-500e-b0be-82fece31e4f7",
    "card_number": "ACT-item-completion-0514",
    "name": "Брошь последнего шанса — Последний шанс",
    "recharge": "custom",
    "recharge_custom": "Не восстанавливаются",
    "reason": "mechanics.uses",
    "expected_hash": "62fe8bf0271f5fc255a366a11fec308e",
    "expected_content_hash": "8cfb41e4a64bdebc7179008ea5adf2ef"
  },
  {
    "id": "e336253c-cf9e-4cda-ac60-d2527081d85e",
    "card_number": "ACT-subclass-EFFECT-0016",
    "name": "Мантия вдохновения",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; с 5-го уровня барда — также короткий отдых",
    "reason": "shared resource",
    "expected_hash": "a5ead12d1ab434b3f3727486618d7236",
    "expected_content_hash": "22ab52eda4a727f5d32546718c7f5c60"
  },
  {
    "id": "e45cb3ed-827d-49d7-b52d-8cd29c681897",
    "card_number": "ACT-wild-shape",
    "name": "Дикая форма",
    "recharge": "custom",
    "recharge_custom": "Короткий отдых: +1; долгий отдых: все заряды",
    "reason": "shared resource",
    "expected_hash": "a2574eea82ee0fad0779e5528335b00e",
    "expected_content_hash": "9da2f935f48ec4da4c489bf56307faa8"
  },
  {
    "id": "e6270999-bc03-56a2-a053-72527ce894d6",
    "card_number": "ACT-item-completion-high-853-form-hand_crossbow",
    "name": "Первичная сфера — Принять форму: Ручной арбалет",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "3451f5fdb4b69a462bbc97fb3b3ed66f",
    "expected_content_hash": "b7db512687960f6f5c278b32351aa090"
  },
  {
    "id": "e9e42e7c-4f13-53f3-98e3-73b7d8749ebf",
    "card_number": "ACT-item-completion-0369",
    "name": "Меч рыцаря смерти +2 — Призвать обычную Тень",
    "recharge": "custom",
    "recharge_custom": "Ежедневно",
    "reason": "mechanics.uses",
    "expected_hash": "c76ce559acac3a38e363ac0ae52bcd1a",
    "expected_content_hash": "1b6224a2fe56b3fffa8a224d366f2cd1"
  },
  {
    "id": "ea14982d-b457-5d6b-a5fc-da59ea8052a7",
    "card_number": "ACT-item-completion-high-853-form-shortsword",
    "name": "Первичная сфера — Принять форму: Короткий меч",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "3be6b807d07b526de706cd316a1a569f",
    "expected_content_hash": "3587415da3c235d1607e465046ed27e3"
  },
  {
    "id": "ec0dca93-cb38-5b5a-a865-06f81cc85169",
    "card_number": "ACT-item-completion-high-853-form-blowgun",
    "name": "Первичная сфера — Принять форму: Духовая трубка",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "8bd6fbebbd08ffc90bccd6c3863875a3",
    "expected_content_hash": "5681caacebbe410bff712f33ee31a331"
  },
  {
    "id": "ec56961f-d94a-52f9-8d2f-933d784bd799",
    "card_number": "ACT-item-completion-0542",
    "name": "Бинты мученика — Кровавое исцеление",
    "recharge": "custom",
    "recharge_custom": "Не восстанавливаются",
    "reason": "mechanics.uses",
    "expected_hash": "b5875ba7f18411b3667b771ba1c1ace3",
    "expected_content_hash": "077e621556bd88270bddb6c66b407191"
  },
  {
    "id": "ed185785-cc86-5822-a741-07a0810d79d6",
    "card_number": "ACT-item-completion-high-853-form-club",
    "name": "Первичная сфера — Принять форму: Кофель-нагель",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "4efdce7f1bc7f4f2398ffa6767c4fcfa",
    "expected_content_hash": "76fc26fa856334a5595e3d2725c52b06"
  },
  {
    "id": "ed29dba6-c135-5e55-afe4-c58ecdcefe6f",
    "card_number": "ACT-item-completion-high-853-form-trident",
    "name": "Первичная сфера — Принять форму: Трезубец",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "5e79789d45bcd3d18d9b2f017f93295c",
    "expected_content_hash": "d28b83f81fa0cd4445608a6e91942123"
  },
  {
    "id": "ee301046-09ac-520d-aeba-5faa1b3f20ad",
    "card_number": "ACT-item-completion-high-853-form-spear",
    "name": "Первичная сфера — Принять форму: Копьё",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "580a44b399c59d72eba6d92cb2f06653",
    "expected_content_hash": "acf5e5b71ad876438644d51e85890cbb"
  },
  {
    "id": "ef1163a9-4d12-5357-a323-acaacbf921b4",
    "card_number": "ACT-VAR-ACT-bm-bait-switch-target",
    "name": "Приманка и подмена — Союзник",
    "recharge": "short_rest",
    "recharge_custom": null,
    "reason": "shared resource",
    "expected_hash": "9521efeb94608ff357598861cc79773b",
    "expected_content_hash": "9614f4636488edad5bbd592aa82e6f2e"
  },
  {
    "id": "f0d5375b-c1cd-5256-a59c-f2da6ef1751d",
    "card_number": "ACT-item-completion-high-853-form-pike",
    "name": "Первичная сфера — Принять форму: Пика",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "79e74379d98a2ba4032bcf44345ff025",
    "expected_content_hash": "06b4cb55fbb0804b614d443f935b17b4"
  },
  {
    "id": "f35ea734-3fe6-5c53-a04d-1e076fa0e671",
    "card_number": "ACT-item-completion-high-853-form-rapier",
    "name": "Первичная сфера — Принять форму: Рапира",
    "recharge": "custom",
    "recharge_custom": "Не чаще одного раза за ход",
    "reason": "per-turn restriction",
    "expected_hash": "6d2862c8e908139bfc3638f7b9494422",
    "expected_content_hash": "786ad9c3dffaa9f223624884ec39c779"
  },
  {
    "id": "fba82b98-8732-5b23-ad0a-d5f2f34561ca",
    "card_number": "ACT-VAR-ACT-metamagic-transmuted-fire",
    "name": "Подготовить Преобразованное заклинание — Огонь",
    "recharge": "custom",
    "recharge_custom": "Долгий отдых; дополнительные способы восстановления — из способностей персонажа",
    "reason": "shared resource",
    "expected_hash": "f6b3bfc98752350ebf39393d10ae3973",
    "expected_content_hash": "cf63ffdb9c26ff2944ea232e79258e1b"
  }
]$plan$::jsonb);
CREATE TEMP TABLE recovery_preview_dependencies(payload jsonb) ON COMMIT DROP;
INSERT INTO recovery_preview_dependencies VALUES ($deps$[
  {
    "table": "resources",
    "id": "1455b71d-2f9c-4710-97f7-922822eb8157",
    "name": "Очки фокусировки",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "8a382719135817f26420b771fa70fe4b"
  },
  {
    "table": "resources",
    "id": "17e944aa-9355-4b95-93ca-b0ff1adcce8e",
    "name": "Божественный канал",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "5ea9164a90b752271e6f77ef5d934a94"
  },
  {
    "table": "resources",
    "id": "1b2dfe51-e204-4aa8-9842-771df0d70840",
    "name": "Кости псионической энергии воина",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "ff39d5e42c4c04d5b9f06a5b4372b317"
  },
  {
    "table": "resources",
    "id": "20b203d1-642a-4cbd-82ed-7d2ee5a90395",
    "name": "Заряды: Второе дыхание",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "1337961f0edb29e117e31e7975da9cf9"
  },
  {
    "table": "resources",
    "id": "274a64ea-7905-4084-a83d-124cf33ea37e",
    "name": "Очки удачи",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "904b6f2ed35c8632816053eca8a89f40"
  },
  {
    "table": "resources",
    "id": "2dc989f7-85d2-4de2-a7e5-10363331cbaa",
    "name": "Телекинетическое перемещение",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "7b3b8582b06e1f981d79c644f650ce61"
  },
  {
    "table": "resources",
    "id": "33ef164d-eef4-4dbf-8ba0-0ac5d5016013",
    "name": "Заряды: Шляпа капитана — Преимущество",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "81f1bca9bea2f1ef66228ef945eb88d6"
  },
  {
    "table": "resources",
    "id": "3e4a83df-5b66-49f4-86bb-43c8247f397a",
    "name": "Вдохновение барда",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "9876a3bbb02975f9078d908a5d9bd063"
  },
  {
    "table": "resources",
    "id": "5fe6a4ea-1835-47ed-b8f0-ce47652bddd6",
    "name": "Общий запас: potion_fire_breath",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "c4115e9e14e6a38a8c25eca76797ca0e"
  },
  {
    "table": "resources",
    "id": "65b92b45-72b4-4f20-82ce-9dc4c8dbaff7",
    "name": "Воодушевляющее выступление",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "71ca44f997c17ac3bae3088afff80b46"
  },
  {
    "table": "resources",
    "id": "6e807e67-2714-4277-9685-55455bf0c226",
    "name": "Угощения",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "b0929201544a451fbc4f90ffdc0b9aeb"
  },
  {
    "table": "resources",
    "id": "8e7ef3d1-03be-5f2b-856d-08aa1df76b8a",
    "name": "Амулет восстановления — заряды",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "33bd680cd1c05d7a568adabc06f4840b"
  },
  {
    "table": "resources",
    "id": "9464314c-ef52-4676-ac57-e3a8ee19c46c",
    "name": "Дикий облик",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "ffd89028b1e2417c83faf19910741995"
  },
  {
    "table": "resources",
    "id": "9ab8c8bc-474f-411f-9ca3-906f0229e11c",
    "name": "Заряды: Глефа Алентар +3",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "2a9df17a35ad36331ce1c2b0ee991d3b"
  },
  {
    "table": "resources",
    "id": "b0f7617d-12d3-4e26-98bc-0687810f8242",
    "name": "Заряд ярости",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "9d237be1d8110fc969d0791e50677172"
  },
  {
    "table": "resources",
    "id": "b7195f49-a2b3-4e1c-8a8c-6c2b0eb43ffb",
    "name": "Героическое вдохновение",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "68306a68194bd7665bf1e0470e6719eb"
  },
  {
    "table": "resources",
    "id": "d36ace16-ecbc-4615-8727-e792cde23a06",
    "name": "Кости превосходства",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "a5327fb700496308cab2df166a363de5"
  },
  {
    "table": "resources",
    "id": "da34c4bb-c252-46ad-b958-4c599cb741f9",
    "name": "Дозы яда",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "f8015a000f008b8fbd1630de6a34b0e8"
  },
  {
    "table": "resources",
    "id": "e0cb148c-4611-4eb4-b0aa-152edab3f953",
    "name": "Очки чародейства",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "b6309f02f3f1c203b03267fe7c32abad"
  },
  {
    "table": "resources",
    "id": "e1b17f8c-6205-4a48-8239-e2bb32ec876f",
    "name": "Наследие великанов",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "140fe9905f796792bbc7f1acd6b52c4f"
  },
  {
    "table": "resources",
    "id": "e41d1cec-a2e6-4a61-9018-b7a5118e4c9f",
    "name": "Заряды: Комплект целителя",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "86de5ff4efdcfb23ab44f3640fe14e2b"
  },
  {
    "table": "resources",
    "id": "e77c9e46-40a5-482e-bcde-4b4902b53261",
    "name": "Заряд магического восстановления",
    "fields": [
      "resource_id",
      "recharge",
      "description"
    ],
    "expected_hash": "0a8d0f3f5f8df750e39ddca4a176382b"
  },
  {
    "table": "classes",
    "id": "03265901-3b0a-4d3e-ab2c-001a6cab59c3",
    "name": "Паладин",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "749b1e1b1354d953ada23d7e6a7fa860"
  },
  {
    "table": "classes",
    "id": "66a58227-41e6-4c56-b548-1253d98f6f09",
    "name": "Чародей",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "ff8d6ab242ee7906e59faecf32acc2bd"
  },
  {
    "table": "classes",
    "id": "932a15ad-a7c5-4062-b13a-899933b94231",
    "name": "Друид",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "e6704cf0882546f9ceb871cbe36e4695"
  },
  {
    "table": "classes",
    "id": "9cc3ffcd-8de0-4bc1-a1c3-0a0e67952ab8",
    "name": "Варвар",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "778424e24840d513703b6cb87951b33e"
  },
  {
    "table": "classes",
    "id": "a2039ecc-4989-4942-9210-fc315c365847",
    "name": "Мастер боя",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "f4fbe6abcf8db16a73598f93befd0581"
  },
  {
    "table": "classes",
    "id": "a72db803-1dc0-4535-9f31-a55eb016658b",
    "name": "Пси-воин",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "afb1b993f956d941a6e67b062e8f510a"
  },
  {
    "table": "classes",
    "id": "be96272c-8585-438d-ac32-b2788f1b1741",
    "name": "Бард",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "c2d7d12d70f9f19dcc1b197d23e22216"
  },
  {
    "table": "classes",
    "id": "d3b22b24-a4f1-4dab-8038-c89bfee62843",
    "name": "Волшебник",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "36dce91ee038bcf86182def89cc04777"
  },
  {
    "table": "classes",
    "id": "de7259fa-305e-429d-a209-fa79ec302afd",
    "name": "Жрец",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "42622aa3d3e04d989e96b1ce08597eee"
  },
  {
    "table": "classes",
    "id": "ed17e7b6-366f-43ef-a94c-2d62dd5d7b20",
    "name": "Монах",
    "fields": [
      "resources",
      "level_progression"
    ],
    "expected_hash": "3ec26aed27b8de211bd8d9d8aef92b6d"
  },
  {
    "table": "effects",
    "id": "16700000-0000-4000-8000-000000000103",
    "name": "Источник вдохновения",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "0906626314efaac0619bfe90647cf6b7"
  },
  {
    "table": "effects",
    "id": "16700000-0000-4000-8000-000000000112",
    "name": "Чародейское восстановление",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "77ef1dda09003dc3b096525bcc47da74"
  },
  {
    "table": "effects",
    "id": "17000000-0000-4000-8000-000000000028",
    "name": "Отравитель — правила",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "15dd7a583d25cc9d29e58a190d23560e"
  },
  {
    "table": "effects",
    "id": "17000000-0000-4000-8000-000000000040",
    "name": "Шеф-повар — правила",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "aedc390c0bd1b53187cd486e6992a769"
  },
  {
    "table": "effects",
    "id": "61f8a5df-e5f9-4960-be38-6b45556fb05d",
    "name": "Находчивый",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "9521f534dfc29a7419af2b4de0af40b6"
  },
  {
    "table": "effects",
    "id": "d9d01bae-a768-46ee-9902-758c933bc8b0",
    "name": "Очки удачи",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "ef0f5ba7b8847d9f9e71cdb227016043"
  },
  {
    "table": "cards",
    "id": "2af6b727-8da5-4256-865d-9835ad24c846",
    "name": "Амулет восстановления",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "1d04bb58d694a57c8aa869e8c89df4bc"
  },
  {
    "table": "cards",
    "id": "367d455f-be62-484b-b77b-4813809c4d17",
    "name": "Зелье огненного дыхания",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "32160e82055835d12c5076f81c97c52a"
  },
  {
    "table": "cards",
    "id": "3b24b455-c346-4c4d-8156-a5d8b189f647",
    "name": "Сапоги уворота",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "461a0a6ede717a179ace26f9f3aa7e89"
  },
  {
    "table": "cards",
    "id": "6112aaef-39b3-4b91-a0fa-96f56987ebb2",
    "name": "Комплект целителя",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "8e00c40ae2bd68f17792af6d2c7f66f6"
  },
  {
    "table": "cards",
    "id": "a279ed6e-1f1a-4767-86dd-5d51eab4c209",
    "name": "Шляпа капитана",
    "fields": [
      "mechanics",
      "description",
      "detailed_description"
    ],
    "expected_hash": "5495c834e8806426d2491e1a9f827a75"
  },
  {
    "table": "feats",
    "id": "375793bf-abe1-46ab-be7f-427f01df0a25",
    "name": "Шеф-повар",
    "fields": [
      "description",
      "detailed_description",
      "related_effects"
    ],
    "expected_hash": "36b2884eb54e079a41ac5c393f2b578f"
  },
  {
    "table": "feats",
    "id": "cdd5ddd3-c032-46a5-89b4-8b52c5e05b96",
    "name": "Отравитель",
    "fields": [
      "description",
      "detailed_description",
      "related_effects"
    ],
    "expected_hash": "4e6f5137534de0cbb269d0390fd60ab5"
  },
  {
    "table": "actions",
    "id": "1cd19d26-3011-4859-9430-c8787fe99ba7",
    "name": "Второе дыхание",
    "fields": [
      "mechanics",
      "description"
    ],
    "expected_hash": "88fc9b1d2ac98b2a2ff2c571cd33594c"
  },
  {
    "table": "actions",
    "id": "1d361f9d-b595-57bd-b7b7-7acb84b7288e",
    "name": "Шляпа капитана — Преимущество",
    "fields": [
      "mechanics",
      "description"
    ],
    "expected_hash": "1924d51cd085c4a5a2b4d736e0022e5a"
  }
]$deps$::jsonb);

DO $migration$
DECLARE
  plan jsonb;
  dep jsonb;
  current_row actions%ROWTYPE;
  fingerprint text;
  fields_sql text;
  changed integer := 0;
BEGIN
  -- Lock policies before validating them; no trigger disabling is required.
  FOR dep IN SELECT value FROM recovery_preview_dependencies, jsonb_array_elements(payload) ORDER BY value->>'table', value->>'id' LOOP
    SELECT string_agg(quote_ident(value), ',') INTO fields_sql FROM jsonb_array_elements_text(dep->'fields');
    EXECUTE format('SELECT md5(jsonb_build_array(%s)::text) FROM %I WHERE id=$1 AND deleted_at IS NULL FOR SHARE', fields_sql,dep->>'table')
      INTO fingerprint USING (dep->>'id')::uuid;
    IF fingerprint IS DISTINCT FROM dep->>'expected_hash' THEN
      RAISE EXCEPTION 'Recovery preview migration: source changed: % %', dep->>'table',dep->>'name';
    END IF;
  END LOOP;
  FOR plan IN SELECT value FROM recovery_preview_plan, jsonb_array_elements(payload) ORDER BY value->>'id' LOOP
    SELECT * INTO current_row FROM actions WHERE id=(plan->>'id')::uuid AND deleted_at IS NULL FOR UPDATE;
    IF NOT FOUND OR current_row.card_number IS DISTINCT FROM plan->>'card_number' THEN
      RAISE EXCEPTION 'Recovery preview migration: action missing: %',plan->>'card_number';
    END IF;
    IF md5(jsonb_build_array(current_row.card_number,current_row.description,current_row.mechanics)::text) IS DISTINCT FROM plan->>'expected_content_hash' THEN
      RAISE EXCEPTION 'Recovery preview migration: action content changed: %',plan->>'card_number';
    END IF;
    IF current_row.recharge IS NOT DISTINCT FROM plan->>'recharge'
       AND current_row.recharge_custom IS NOT DISTINCT FROM plan->>'recharge_custom' THEN
      CONTINUE;
    END IF;
    fingerprint := md5(jsonb_build_array(current_row.card_number,current_row.description,current_row.mechanics,current_row.recharge,current_row.recharge_custom)::text);
    IF fingerprint IS DISTINCT FROM plan->>'expected_hash' THEN
      RAISE EXCEPTION 'Recovery preview migration: action changed: %',plan->>'card_number';
    END IF;
    UPDATE actions SET recharge=plan->>'recharge',recharge_custom=plan->>'recharge_custom' WHERE id=current_row.id;
    -- The legacy review trigger regards recharge as mechanical. This migration
    -- changes display metadata only; retain the original review in the same tx.
    UPDATE actions SET support=current_row.support WHERE id=current_row.id AND support IS DISTINCT FROM current_row.support;
    changed := changed + 1;
  END LOOP;
  RAISE NOTICE 'Recovery preview migration: % actions updated',changed;
END;
$migration$;
COMMIT;
