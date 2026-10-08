package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

type roguelikeWorkerClient struct {
	URL, Token     string
	HTTP           *http.Client
	CombatBase     JSONMap
	CombatBaseHash string
}

// Only fixed, player-facing errors cross the worker boundary. Never forward
// arbitrary exception messages: snapshots and entropy are private.
type roguelikeWorkerRejection struct{ Code, Message string }

func (err *roguelikeWorkerRejection) Error() string { return err.Message }

var (
	missingPinnedPattern = regexp.MustCompile(`^missing pinned (race|class|background|feat|effect|action|spell|card|resource) ([A-Za-z0-9][A-Za-z0-9_.-]{0,127}): `)
	publicCatalogPattern = regexp.MustCompile(`^(Каталог не содержит |Неоднозначная ссылка каталога: )(race|class|background|feat|effect|action|spell|card|resource)/[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$`)
	workerHTTPPattern    = regexp.MustCompile(`(?i)rules worker rejected command \(HTTP (\d+)\)`)
)

// Rule rejection details may contain actor IDs, inventory or private values.
// The known code is sufficient to explain the failure without forwarding them.
func publicStructuredWorkerRejection(code string) *roguelikeWorkerRejection {
	rejections := map[string]roguelikeWorkerRejection{
		"ActorNotFound":           {"combat_actor_missing", "Участник отсутствует в снимке боя"},
		"ActorDead":               {"combat_actor_dead", "Погибший участник не может выполнить действие"},
		"WorldObjectNotFound":     {"combat_object_missing", "Объект отсутствует на поле боя"},
		"CardNotFound":            {"combat_item_missing", "Предмет отсутствует в снимке боя"},
		"ItemNotOwned":            {"combat_item_not_owned", "Участнику не принадлежит выбранный предмет"},
		"NotArmor":                {"combat_item_not_armor", "Выбранный предмет нельзя надеть как доспех"},
		"ActionNotGranted":        {"combat_action_not_granted", "Участнику недоступно выбранное действие"},
		"FeatureNotGranted":       {"combat_feature_not_granted", "Участнику недоступна выбранная способность"},
		"ActionNotFound":          {"combat_action_missing", "Действие отсутствует в снимке боя"},
		"InvalidActionDefinition": {"combat_action_invalid", "Механика действия в снимке боя несовместима с правилами"},
		"HazardNotFound":          {"combat_hazard_missing", "Опасность отсутствует в снимке боя"},
		"InvalidHazardDefinition": {"combat_hazard_invalid", "Механика опасности в снимке боя несовместима с правилами"},
		"HideNotEligible":         {"combat_hide_unavailable", "Участник сейчас не может спрятаться"},
		"InvalidFacts":            {"combat_facts_invalid", "Условия действия не подтверждены состоянием боя"},
		"CapabilityDenied":        {"combat_capability_denied", "Условия способности сейчас не выполнены"},
		"InvalidSpellDeclaration": {"combat_spell_declaration_invalid", "Выбранный уровень или источник заклинания недоступен"},
		"DuplicateCommand":        {"combat_command_duplicate", "Эта команда боя уже применена"},
		"InsufficientResources":   {"combat_insufficient_resources", "Недостаточно ресурсов для выбранного действия"},
		"InvalidDecision":         {"combat_decision_invalid", "Выбор не соответствует ожидающему решению"},
		"InvalidCommandId":        {"combat_command_id_invalid", "Идентификатор команды боя некорректен"},
		"InvalidActionTiming":     {"combat_action_timing_invalid", "Действие недоступно в текущей фазе боя"},
		"InvalidInitiative":       {"combat_initiative_invalid", "Порядок инициативы не соответствует состоянию боя"},
		"InvalidTargets":          {"combat_targets_invalid", "Выберите допустимые цели действия"},
		"TargetNotWilling":        {"combat_target_not_willing", "Для действия требуется согласная цель"},
		"TargetArmored":           {"combat_target_armored", "Действие нельзя применить к цели в доспехах"},
		"InvalidEquipmentState":   {"combat_equipment_invalid", "Экипировка не позволяет выполнить действие"},
		"AttackActionNotFound":    {"combat_attack_missing", "Ожидающая серия атак отсутствует"},
		"AttackActionClosed":      {"combat_attack_closed", "Серия атак уже завершена"},
		"AttackActionBlocked":     {"combat_attack_blocked", "Продолжение серии атак сейчас недоступно"},
		"WeaponNotEquipped":       {"combat_weapon_not_equipped", "Оружие для этой атаки не экипировано"},
		"NotWeapon":               {"combat_item_not_weapon", "Выбранный предмет не является оружием"},
		"GrappleNotFound":         {"combat_grapple_missing", "Ожидаемого захвата больше нет"},
		"NoFreeGraspingPart":      {"combat_grasp_unavailable", "Для захвата нет свободной руки или другой подходящей части тела"},
		"TargetTooLarge":          {"combat_target_too_large", "Цель слишком велика для этого действия"},
		"MissingSpatialFacts":     {"combat_spatial_facts_missing", "Не удалось подтвердить расположение цели"},
		"OutOfRange":              {"combat_out_of_range", "Цель вне дальности действия"},
		"LineOfSightBlocked":      {"combat_line_of_sight_blocked", "Путь действия к цели перекрыт"},
		"IllegalRelation":         {"combat_target_relation_invalid", "Действие нельзя применить к цели с таким отношением"},
		"NotActorsTurn":           {"combat_not_actors_turn", "Сейчас ход другого участника"},
		"NoPendingResolution":     {"combat_resolution_missing", "Нет ожидающего решения для этой команды"},
		"ResolutionInProgress":    {"combat_resolution_pending", "Сначала завершите текущее решение"},
		"StaleDecision":           {"combat_decision_stale", "Ожидающее решение изменилось; обновите страницу"},
		"TurnAlreadyStarted":      {"combat_turn_started", "Этот ход уже начат"},
		"TurnNotStarted":          {"combat_turn_not_started", "Сначала начните ход участника"},
		"RulesetMismatch":         {"combat_rules_version", "Команда использует несовместимую версию правил боя"},
		"StaleRevision":           {"combat_revision_stale", "Состояние боя изменилось; обновите страницу"},
	}
	if rejection, ok := rejections[code]; ok {
		rejection.Message += ". Действие не применено."
		return &rejection
	}
	return nil
}

func publicWorkerRejection(code, message, rejectionCode string) *roguelikeWorkerRejection {
	if code == "rules_already_current" {
		return &roguelikeWorkerRejection{"combat_rules_current", "Этот бой уже использует текущую версию правил. Состояние не изменено."}
	}
	if code == "artifact_unavailable" {
		return &roguelikeWorkerRejection{"combat_rules_unavailable", "Версия правил этого боя временно недоступна. Действие не применено."}
	}
	if code != "invalid_combat_command" {
		return nil
	}
	if rejection := publicStructuredWorkerRejection(rejectionCode); rejection != nil {
		return rejection
	}
	// Compatibility with an older server wrapper around a pinned artifact.
	// The entire exception suffix is discarded, even for recognized codes.
	if prefix, _, ok := strings.Cut(message, ": "); ok {
		if rejection := publicStructuredWorkerRejection(prefix); rejection != nil {
			return rejection
		}
	}
	if message == "Неизвестная команда боя" {
		return &roguelikeWorkerRejection{"combat_command_unsupported", "Эта версия боя не поддерживает команду. Обновите страницу; действие не применено."}
	}
	board := map[string]string{
		"Карта столкновения отсутствует":                    "combat_map_missing",
		"Нет карты, вмещающей всех участников и их размеры": "combat_map_unfit",
		"Некорректное зерно карты":                          "combat_map_seed_invalid",
		"Некорректный состав столкновения":                  "combat_roster_invalid",
		"Некорректный участник столкновения":                "combat_roster_invalid",
		"Некорректная группа":                               "combat_party_invalid",
		"Слишком много противников":                         "combat_roster_invalid",
		"Несовместимая версия каталога":                     "combat_catalog_version",
		"Несовместимая версия каталога боя":                 "combat_catalog_version",
		"Несовместимая версия правил боя":                   "combat_rules_version",
		"Некорректная ревизия персонажа":                    "combat_revision_invalid",
		"Чужой персонаж в снимке боя":                       "combat_character_mismatch",
		"Повреждён поток случайности боя":                   "combat_entropy_corrupt",
		"Неполный каталог искусностей оружия":               "combat_catalog_incomplete",
		"Каталог требует явный тип эффекта":                 "combat_catalog_incomplete",
	}
	if mapped, ok := board[message]; ok {
		return &roguelikeWorkerRejection{mapped, message + ". Действие не применено."}
	}
	for _, prefix := range []struct {
		prefix string
		code   string
	}{
		{"Каталог не содержит ", "combat_catalog_missing_ref"},
		{"Неоднозначная ссылка каталога: ", "combat_catalog_ambiguous_ref"},
	} {
		if strings.HasPrefix(message, prefix.prefix) && publicCatalogPattern.MatchString(message) {
			return &roguelikeWorkerRejection{prefix.code, message + ". Действие не применено."}
		}
	}
	allowed := map[string]bool{
		"Сначала завершите текущее решение или дождитесь своего хода": true,
		"Сначала завершите текущее решение":                           true,
		"Бой уже завершён":         true,
		"Цель вне дальности":       true,
		"Недостаточно перемещения": true,
		"До клетки нет доступного маршрута с оставшимся перемещением": true,
		"Прыжок превышает доступную дистанцию":                        true,
		"Для прыжка нужно встать":                                     true,
		"Способность доступна только после соответствующего события":  true,
		"Сейчас ход другого участника":                                true,
		"Выберите свободную клетку":                                   true,
		"Выберите клетку на поле":                                     true,
		"Центр области вне дальности":                                 true,
		"Центр области закрыт полным укрытием":                        true,
		"Сначала завершите открытую реакцию на бросок к20":            true,
		"Сначала завершите дополнительное перемещение":                true,
		"Ресурсы для этой реакции больше недоступны":                  true,
		"Укажите действие влияния на бросок":                          true,
		"Выбранное влияние больше недоступно":                         true,
		"Проверка уже завершена":                                      true,
		"Воздействие недоступно":                                      true,
		"Нет ожидающей проверки":                                      true,
		"Событие требует решения":                                     true,
	}
	if allowed[message] {
		return &roguelikeWorkerRejection{"combat_command_unavailable", message + ". Действие не применено."}
	}
	return nil
}

// Maps worker/catalog/init failures to fixed client-visible codes without leaking
// private combat entropy or infrastructure internals.
func publicRoguelikeWorkerFailure(err error) *roguelikeWorkerRejection {
	if err == nil {
		return nil
	}
	var rejection *roguelikeWorkerRejection
	if errors.As(err, &rejection) {
		return rejection
	}
	msg := err.Error()
	if match := missingPinnedPattern.FindStringSubmatch(msg); len(match) == 3 {
		kind, reference := match[1], match[2]
		return &roguelikeWorkerRejection{
			"combat_catalog_incomplete",
			fmt.Sprintf("Не удалось собрать каталог боя: в библиотеке нет %s «%s». Действие не применено.", kind, reference),
		}
	}
	switch {
	case strings.Contains(msg, "rules worker is not configured"):
		return &roguelikeWorkerRejection{"combat_worker_unconfigured", "Сервис правил боя не настроен на сервере. Действие не применено."}
	case strings.Contains(msg, "rules worker unavailable"):
		return &roguelikeWorkerRejection{"combat_worker_unavailable", "Сервис правил боя недоступен. Действие не применено."}
	case workerHTTPPattern.MatchString(msg):
		status := workerHTTPPattern.FindStringSubmatch(msg)[1]
		return &roguelikeWorkerRejection{
			"combat_worker_rejected",
			fmt.Sprintf("Сервис правил отклонил команду боя (HTTP %s). Действие не применено.", status),
		}
	case strings.Contains(msg, "incomplete rules worker result"):
		return &roguelikeWorkerRejection{"combat_worker_incomplete", "Сервис правил вернул неполный результат инициализации боя. Действие не применено."}
	case strings.Contains(msg, "invalid rules worker response"):
		return &roguelikeWorkerRejection{"combat_worker_invalid", "Сервис правил вернул некорректный ответ. Действие не применено."}
	case strings.Contains(msg, "rules worker response too large"):
		return &roguelikeWorkerRejection{"combat_worker_oversized", "Ответ сервиса правил слишком большой. Действие не применено."}
	case strings.Contains(msg, "catalog resolution made no progress"):
		return &roguelikeWorkerRejection{"combat_catalog_stalled", "Сбор каталога боя зациклился: зависимость не разрешается. Действие не применено."}
	case strings.Contains(msg, "catalog dependency budget exceeded"):
		return &roguelikeWorkerRejection{"combat_catalog_budget", "Слишком много зависимостей каталога боя. Действие не применено."}
	case strings.Contains(msg, "unknown catalog dependency"):
		return &roguelikeWorkerRejection{"combat_catalog_unknown_need", "Каталог боя запросил неизвестный тип зависимости. Действие не применено."}
	case strings.Contains(msg, "unknown catalog entity type"):
		return &roguelikeWorkerRejection{"combat_catalog_unknown_entity", "Каталог боя запросил неизвестный тип сущности. Действие не применено."}
	case strings.Contains(msg, "invalid dependency request"):
		return &roguelikeWorkerRejection{"combat_catalog_invalid_need", "Сервис правил запросил некорректный набор зависимостей. Действие не применено."}
	case strings.Contains(msg, "catalog entity missing id"):
		return &roguelikeWorkerRejection{"combat_catalog_invalid_entity", "В каталог боя попала сущность без идентификатора. Действие не применено."}
	}
	return nil
}

type roguelikeWorkerNeed struct {
	Kind       string `json:"kind"`
	EntityType string `json:"entityType"`
	Reference  string `json:"reference"`
	EffectType string `json:"effectType"`
}
type roguelikeWorkerResult struct {
	initializationDependencies []roguelikeWorkerNeed
	initializationProof        *roguelikeInitializationProof
	CatalogSelection           *roguelikeCatalogSelection      `json:"catalogSelection"`
	InitiativeOptions          []JSONMap                       `json:"initiativeOptions"`
	PreparedCommand            *CharacterRuntimeCommandRequest `json:"preparedCommand"`
	Public                     JSONMap                         `json:"public"`
	ArtifactHash               string                          `json:"artifactHash"`
	ElapsedSeconds             int                             `json:"elapsedSeconds"`
	GoldSpent                  int                             `json:"goldSpent"`
	Events                     []JSONMap                       `json:"events"`
	Status                     string                          `json:"status"`
	Needs                      []roguelikeWorkerNeed           `json:"needs"`
	Envelope                   JSONMap                         `json:"envelope"`
	CombatOpeningState         JSONMap                         `json:"combatOpeningState"`
	Patch                      JSONMap                         `json:"patch"`
	PreviousPatch              JSONMap                         `json:"previousPatch"`
	Patches                    map[string]JSONMap              `json:"patches"`
	ContentManifestHash        string                          `json:"contentManifestHash"`
	RandomValues               []float64                       `json:"randomValues"`
	Trace                      JSONMap                         `json:"trace"`
}

func (client roguelikeWorkerClient) call(ctx context.Context, endpoint string, body any) (*roguelikeWorkerResult, error) {
	defer performanceSince(ctx, "worker_client_total_ms")()
	if client.URL == "" || len(client.Token) < 32 {
		return nil, fmt.Errorf("rules worker is not configured")
	}
	release, err := sharedWorkerAdmission.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	marshalDone := performanceSince(ctx, "backend_worker_marshal_ms")
	data, err := json.Marshal(body)
	marshalDone()
	performanceAdd(ctx, "worker_calls", 1)
	performanceAdd(ctx, "worker_request_bytes", float64(len(data)))
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		return nil, fmt.Errorf("rules worker unavailable: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(client.URL, "/")+endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+client.Token)
	request.Header.Set("Content-Type", "application/json")
	if os.Getenv("RULES_WORKER_MIRRORS_ENABLED") == "1" {
		request.Header.Set("X-Rules-Wire", workerMirrorWire)
		if input, ok := body.(map[string]any); ok && endpoint == "/transition" && client.CombatBase != nil && client.CombatBaseHash != "" && input["frameKey"] == client.CombatBaseHash {
			request.Header.Set("X-Rules-Wire", workerDeltaWire)
		}
	}
	if requestID, ok := ctx.Value(requestCorrelationKey{}).(string); ok && validRequestID(requestID) {
		request.Header.Set("X-Request-ID", requestID)
	}
	if performanceFrom(ctx) != nil {
		request.Header.Set("X-Performance-Trace", "1")
	}
	transport := client.HTTP
	if transport == nil {
		transport = &http.Client{Timeout: 20 * time.Second}
	}
	roundTripDone := performanceSince(ctx, "worker_http_headers_ms")
	response, err := transport.Do(request)
	roundTripDone()
	if err != nil {
		return nil, fmt.Errorf("rules worker unavailable: %w", err)
	}
	defer response.Body.Close()
	if performanceFrom(ctx) != nil {
		var metrics map[string]float64
		raw := response.Header.Get("X-Rules-Performance")
		if len(raw) <= 8192 && json.Unmarshal([]byte(raw), &metrics) == nil {
			for _, key := range []string{"worker_body_read_ms", "worker_parse_ms", "worker_artifact_load_ms", "worker_artifact_cache_hit", "worker_frame_cache_hit", "worker_prediction_hit", "worker_prediction_projection_hit", "worker_prepared_mirror_hit", "worker_state_delta_hit", "worker_state_delta_ms", "worker_prediction_wait_ms", "worker_speculative_execute_ms", "worker_speculative_prepare_ms", "worker_speculative_mirror_ms", "worker_execute_ms", "worker_project_ms", "worker_snapshot_hash_ms", "worker_stringify_ms", "worker_mirror_compact_ms", "worker_partial_mirror_ms", "worker_callback_to_send_ms", "worker_process_cpu_ms"} {
				if value, exists := metrics[key]; exists {
					performanceAdd(ctx, key, value)
				}
			}
		}
		if response.Header.Get("X-Request-ID") == request.Header.Get("X-Request-ID") {
			performanceAdd(ctx, "worker_correlated_calls", 1)
		}
	}
	// Never log response bodies: they can contain private combat entropy.
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Error         string `json:"error"`
			Message       string `json:"message"`
			RejectionCode string `json:"rejectionCode"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&failure) == nil {
			if response.StatusCode == http.StatusConflict && (failure.Error == "frame_unavailable" || failure.Error == "projection_unavailable") {
				return nil, errCombatFrameUnavailable
			}
			if rejection := publicWorkerRejection(failure.Error, failure.Message, failure.RejectionCode); rejection != nil {
				return nil, rejection
			}
		}
		return nil, fmt.Errorf("rules worker rejected command (HTTP %d)", response.StatusCode)
	}
	const maximum = 16 << 20
	readDone := performanceSince(ctx, "backend_worker_body_read_ms")
	payload, err := io.ReadAll(io.LimitReader(response.Body, maximum+1))
	readDone()
	performanceAdd(ctx, "worker_response_bytes", float64(len(payload)))
	if err != nil {
		return nil, err
	}
	if len(payload) > maximum {
		return nil, fmt.Errorf("rules worker response too large")
	}
	var result roguelikeWorkerResult
	if request.Header.Get("X-Rules-Wire") == workerMirrorWire || request.Header.Get("X-Rules-Wire") == workerDeltaWire {
		expandDone := performanceSince(ctx, "backend_worker_mirror_expand_ms")
		var decoded *roguelikeWorkerResult
		if request.Header.Get("X-Rules-Wire") == workerDeltaWire {
			decoded, err = decodeWorkerStateDelta(payload, client.CombatBase, client.CombatBaseHash)
		} else {
			decoded, err = decodeWorkerMirrors(payload)
		}
		expandDone()
		if err != nil {
			return nil, err
		}
		result = *decoded
	} else {
		decodeDone := performanceSince(ctx, "backend_worker_unmarshal_ms")
		err = json.Unmarshal(payload, &result)
		decodeDone()
	}
	if err != nil {
		return nil, fmt.Errorf("invalid rules worker response")
	}
	if result.Status == "needs_content" {
		if len(result.Needs) == 0 || len(result.Needs) > 2048 {
			return nil, fmt.Errorf("invalid dependency request")
		}
	} else if endpoint == "/prefetch" {
		hash, ok := result.Trace["afterHash"].(string)
		if result.Status != "ready" || !ok || !roguelikeSnapshotHash.MatchString(hash) {
			return nil, fmt.Errorf("invalid combat prefetch result")
		}
	} else if endpoint == "/upgrade" {
		if len(result.Envelope) == 0 || !roguelikeSnapshotHash.MatchString(result.ArtifactHash) || len(result.Trace) == 0 {
			return nil, fmt.Errorf("incomplete rules upgrade result")
		}
	} else if endpoint == "/initiative-options" {
		if result.Status != "ready" || result.InitiativeOptions == nil || len(result.InitiativeOptions) > 256 {
			return nil, fmt.Errorf("incomplete initiative options result")
		}
	} else if endpoint == "/equipment" {
		if result.Status != "ready" || result.PreparedCommand == nil {
			return nil, fmt.Errorf("incomplete equipment intent result")
		}
	} else if endpoint == "/journey-check" {
		if len(result.Envelope) == 0 || len(result.Public) == 0 {
			return nil, fmt.Errorf("incomplete journey check")
		}
	} else if (endpoint != "/rest" && endpoint != "/camp-action" && endpoint != "/camp-inventory" && endpoint != "/journey-effect" && len(result.Envelope) == 0) || len(result.Patch) == 0 {
		return nil, fmt.Errorf("incomplete rules worker result")
	}
	return &result, nil
}
