package main

import (
	"encoding/json"
	"fmt"
	"os"

	"gorm.io/gorm"
)

// Only the server supplies the check, hazard and immutable content. A browser
// can select an option/capability, never submit a roll, DC or a runtime patch.
func journeyWorker(tx *gorm.DB, endpoint string, input JSONMap, private JSONMap) (*roguelikeWorkerResult, JSONMap, error) {
	client := roguelikeWorkerClient{URL: os.Getenv("RULES_WORKER_URL"), Token: os.Getenv("RULES_WORKER_TOKEN")}
	catalog := emptyRoguelikeFrozenCatalog()
	if private["catalog"] != nil {
		raw, _ := json.Marshal(private["catalog"])
		if err := json.Unmarshal(raw, &catalog); err != nil {
			return nil, nil, err
		}
	}
	seed, _ := private["seed"].(string)
	if seed == "" {
		var err error
		seed, err = newRoguelikeSeed()
		if err != nil {
			return nil, nil, err
		}
	}
	input["seed"] = seed
	input["catalog"] = &catalog
	if private["envelope"] != nil {
		input["envelope"] = private["envelope"]
	}
	for attempt := 0; attempt < 32; attempt++ {
		result, err := client.call(tx.Statement.Context, endpoint, JSONMap{"input": input, "artifactHash": private["artifactHash"]})
		if err != nil {
			return nil, nil, err
		}
		if result.Status != "needs_content" {
			return result, JSONMap{"seed": seed, "catalog": catalog, "artifactHash": result.ArtifactHash, "envelope": result.Envelope}, nil
		}
		previous, _ := json.Marshal(catalog)
		for _, need := range result.Needs {
			if err = catalog.fulfill(tx, need); err != nil {
				return nil, nil, err
			}
		}
		next, _ := json.Marshal(catalog)
		if string(previous) == string(next) {
			return nil, nil, fmt.Errorf("journey catalog made no progress")
		}
	}
	return nil, nil, fmt.Errorf("journey dependency budget exceeded")
}

func applyUrvinEventCommand(tx *gorm.DB, run *RoguelikeRun, request RoguelikeCommandRequest) error {
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	node := j.current()
	event := j.Event
	if node == nil || node.Completed || event == nil || event.Finished {
		return roguelikeError(409, "event_unavailable", "Событие уже завершено")
	}
	var member *CharacterV3
	for _, c := range roguelikeCharacters(run) {
		if c.ID.String() == event.ActorID {
			member = c
		}
	}
	var option *UrvinOption
	for i := range event.Definition.Options {
		if event.Definition.Options[i].ID == event.ChoiceID {
			option = &event.Definition.Options[i]
		}
	}
	if request.Type == "event_choice" {
		if event.ChoiceID != "" {
			return roguelikeError(409, "event_choice_locked", "Выбор уже сохранён")
		}
		for i := range event.Definition.Options {
			if event.Definition.Options[i].ID == roguelikePayloadString(request, "option_id") {
				option = &event.Definition.Options[i]
			}
		}
		for _, c := range roguelikeCharacters(run) {
			if c.ID.String() == roguelikePayloadString(request, "character_id") {
				member = c
			}
		}
		if option == nil || member == nil || member.CurrentHP < 1 {
			return roguelikeError(400, "event_choice_invalid", "Выберите доступный вариант и участника")
		}
		if currencyCopper(run.Character) < option.CostGold*100 {
			return roguelikeError(409, "not_enough_gold", "Недостаточно золота")
		}
		setCurrencyCopper(run.Character, currencyCopper(run.Character)-option.CostGold*100)
		run.Gold = characterGold(run.Character)
		event.ChoiceID = option.ID
		event.ActorID = member.ID.String()
		if err = saveUrvinJourney(run, j); err != nil {
			return err
		}
		if len(option.Checks) == 0 {
			return applyUrvinEventOutcome(tx, run, option.Success, member, request.CommandID.String())
		}
		return nil
	}
	if option == nil || member == nil {
		return roguelikeError(409, "event_choice_required", "Сначала выберите действие")
	}
	switch request.Type {
	case "event_roll", "event_resolve":
		if event.CheckIndex >= len(option.Checks) {
			return roguelikeError(409, "check_complete", "Проверки уже завершены")
		}
		if request.Type == "event_roll" && event.Pending != nil {
			return roguelikeError(409, "check_already_rolled", "Бросок уже сохранён")
		}
		if request.Type == "event_resolve" && (event.Pending == nil || event.Pending["phase"] == "resolved") {
			return roguelikeError(409, "check_not_pending", "Нет незавершённого броска")
		}
		result, private, err := journeyWorker(tx, "/journey-check", JSONMap{"character": member, "commandId": request.CommandID.String(), "check": option.Checks[event.CheckIndex], "resolve": request.Type == "event_resolve", "effectId": roguelikePayloadString(request, "effect_id")}, run.JourneyPrivate)
		if err != nil {
			return err
		}
		run.JourneyPrivate = private
		event.Pending = result.Public
		if result.Public["phase"] == "resolved" {
			if err = applyTrustedRoguelikePatch(member, result.Patch); err != nil {
				return err
			}
		}
		return saveUrvinJourney(run, j)
	case "event_continue":
		if event.Pending == nil || event.Pending["phase"] != "resolved" {
			return roguelikeError(409, "check_not_resolved", "Сначала подтвердите результат проверки")
		}
		roll, ok := event.Pending["roll"].(map[string]any)
		if !ok {
			return fmt.Errorf("missing check result")
		}
		event.Rolls = append(event.Rolls, event.Pending)
		event.Pending = nil
		event.CheckIndex++
		run.JourneyPrivate = JSONMap{}
		if err = saveUrvinJourney(run, j); err != nil {
			return err
		}
		if roll["outcome"] != "success" {
			return applyUrvinEventOutcome(tx, run, option.Failure, member, request.CommandID.String())
		}
		if event.CheckIndex == len(option.Checks) {
			return applyUrvinEventOutcome(tx, run, option.Success, member, request.CommandID.String())
		}
		return nil
	default:
		return roguelikeError(400, "unknown_event_command", "Неизвестная команда события")
	}
}

func applyUrvinEventOutcome(tx *gorm.DB, run *RoguelikeRun, result UrvinOutcome, actor *CharacterV3, commandID string) error {
	j, err := urvinJourney(run)
	if err != nil {
		return err
	}
	j.Event.Finished = true
	if err = saveUrvinJourney(run, j); err != nil {
		return err
	}
	if result.Combat != "" {
		return startUrvinEncounter(tx, run, result.Combat, result.Surprise, result.EncounterID)
	}
	events := []JSONMap{}
	if result.Healing != "" || result.Damage != "" {
		members := []*CharacterV3{actor}
		if result.Healing != "" {
			members = roguelikeCharacters(run)
		}
		for _, member := range members {
			effects := []JSONMap{}
			if result.Healing != "" {
				effects = append(effects, JSONMap{"kind": "healing", "amount": result.Healing})
			}
			if result.Damage != "" {
				effects = append(effects, JSONMap{"kind": "damage", "dice": result.Damage, "type": "bludgeoning"})
			}
			hazard := JSONMap{"id": "urvin-event:" + j.Event.Definition.ID, "name": j.Event.Definition.Name, "sourceKind": "environment", "sourceEntityIds": []string{"urvin-event:" + j.Event.Definition.ID}, "resolution": "automatic", "effects": effects}
			worker, _, err := journeyWorker(tx, "/journey-effect", JSONMap{"character": member, "characters": roguelikeCharacters(run), "commandId": commandID + ":" + member.ID.String(), "hazard": hazard}, JSONMap{})
			if err != nil {
				return err
			}
			for _, participant := range roguelikeCharacters(run) {
				patch, ok := worker.Patches[participant.ID.String()]
				if !ok {
					return fmt.Errorf("incomplete journey party result")
				}
				if err = applyTrustedRoguelikePatch(participant, patch); err != nil {
					return err
				}
			}
			events = append(events, worker.Events...)
		}
	}
	syncUrvinAura(run)
	if err = grantUrvinReward(tx, run, result.Reward, "event"); err != nil {
		return err
	}
	run.LastReward["events"] = events
	if err = finishUrvinRoom(run); err != nil {
		return err
	}
	alive := false
	for _, member := range roguelikeCharacters(run) {
		if member.CurrentHP > 0 {
			alive = true
		}
	}
	if !alive {
		run.Status = RoguelikeStatusDefeat
		run.Phase = RoguelikePhaseEnded
	}
	return nil
}
