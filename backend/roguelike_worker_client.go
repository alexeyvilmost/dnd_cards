package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"time"
)

type roguelikeWorkerClient struct {
	URL, Token string
	HTTP       *http.Client
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

func publicWorkerRejection(code, message string) *roguelikeWorkerRejection {
	if code == "artifact_unavailable" {
		return &roguelikeWorkerRejection{"combat_rules_unavailable", "Версия правил этого боя временно недоступна. Действие не применено."}
	}
	if code != "invalid_combat_command" {
		return nil
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
			fmt.Sprintf("Сервис правил отклонил команду начала боя (HTTP %s). Действие не применено.", status),
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
	Public              JSONMap               `json:"public"`
	ArtifactHash        string                `json:"artifactHash"`
	ElapsedSeconds      int                   `json:"elapsedSeconds"`
	GoldSpent           int                   `json:"goldSpent"`
	Events              []JSONMap             `json:"events"`
	Status              string                `json:"status"`
	Needs               []roguelikeWorkerNeed `json:"needs"`
	Envelope            JSONMap               `json:"envelope"`
	Patch               JSONMap               `json:"patch"`
	Patches             map[string]JSONMap    `json:"patches"`
	ContentManifestHash string                `json:"contentManifestHash"`
	RandomValues        []float64             `json:"randomValues"`
	Trace               JSONMap               `json:"trace"`
}

func (client roguelikeWorkerClient) call(ctx context.Context, endpoint string, body any) (*roguelikeWorkerResult, error) {
	if client.URL == "" || len(client.Token) < 32 {
		return nil, fmt.Errorf("rules worker is not configured")
	}
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(client.URL, "/")+endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+client.Token)
	request.Header.Set("Content-Type", "application/json")
	transport := client.HTTP
	if transport == nil {
		transport = &http.Client{Timeout: 20 * time.Second}
	}
	response, err := transport.Do(request)
	if err != nil {
		return nil, fmt.Errorf("rules worker unavailable: %w", err)
	}
	defer response.Body.Close()
	// Never log response bodies: they can contain private combat entropy.
	if response.StatusCode != http.StatusOK {
		var failure struct {
			Error   string `json:"error"`
			Message string `json:"message"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 4096)).Decode(&failure) == nil {
			if rejection := publicWorkerRejection(failure.Error, failure.Message); rejection != nil {
				return nil, rejection
			}
		}
		return nil, fmt.Errorf("rules worker rejected command (HTTP %d)", response.StatusCode)
	}
	const maximum = 16 << 20
	payload, err := io.ReadAll(io.LimitReader(response.Body, maximum+1))
	if err != nil {
		return nil, err
	}
	if len(payload) > maximum {
		return nil, fmt.Errorf("rules worker response too large")
	}
	var result roguelikeWorkerResult
	if err = json.Unmarshal(payload, &result); err != nil {
		return nil, fmt.Errorf("invalid rules worker response")
	}
	if result.Status == "needs_content" {
		if len(result.Needs) == 0 || len(result.Needs) > 2048 {
			return nil, fmt.Errorf("invalid dependency request")
		}
	} else if endpoint == "/journey-check" {
		if len(result.Envelope) == 0 || len(result.Public) == 0 {
			return nil, fmt.Errorf("incomplete journey check")
		}
	} else if (endpoint != "/rest" && endpoint != "/camp-action" && endpoint != "/journey-effect" && len(result.Envelope) == 0) || len(result.Patch) == 0 {
		return nil, fmt.Errorf("incomplete rules worker result")
	}
	return &result, nil
}
