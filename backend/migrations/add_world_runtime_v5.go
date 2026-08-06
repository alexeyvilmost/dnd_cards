package migrations

import (
	"database/sql"
	"fmt"
)

// worldRuntimeV5DDL is a defense-in-depth persistence guard for the canonical
// schema-v5 JSON snapshot. The TypeScript migration/serializer remains the full
// schema normalizer; this SQL deliberately repeats the structural and
// cross-record invariants whose violation would make a persisted snapshot
// ambiguous, unloadable, or detached from its immutable ruleset release.
const worldRuntimeV5DDL = `
CREATE OR REPLACE FUNCTION canonical_snapshot_schema_matches(
	snapshot JSONB,
	expected_schema_version INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
	declared_schema_version NUMERIC;
BEGIN
	IF snapshot IS NULL
		OR expected_schema_version IS NULL
		OR expected_schema_version < 1
		OR jsonb_typeof(snapshot) IS DISTINCT FROM 'object' THEN
		RETURN FALSE;
	END IF;

	-- Schema 1-4 rows predate the in-document discriminator. Preserve those
	-- rows, but never let an explicitly declared version disagree with SQL.
	IF NOT (snapshot ? 'schemaVersion') THEN
		RETURN expected_schema_version < 5;
	END IF;
	IF jsonb_typeof(snapshot->'schemaVersion') IS DISTINCT FROM 'number' THEN
		RETURN FALSE;
	END IF;
	declared_schema_version := (snapshot->>'schemaVersion')::NUMERIC;
	RETURN declared_schema_version = trunc(declared_schema_version)
		AND declared_schema_version = expected_schema_version;
EXCEPTION WHEN OTHERS THEN
	RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION canonical_world_state_v5_string_array_is_valid(
	candidate JSONB,
	allow_empty BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
	total_count BIGINT;
	unique_count BIGINT;
BEGIN
	IF candidate IS NULL
		OR allow_empty IS NULL
		OR jsonb_typeof(candidate) IS DISTINCT FROM 'array'
		OR (NOT allow_empty AND jsonb_array_length(candidate) = 0) THEN
		RETURN FALSE;
	END IF;
	IF EXISTS (
		SELECT 1
		FROM jsonb_array_elements(candidate) AS entries(element)
		WHERE jsonb_typeof(element) IS DISTINCT FROM 'string'
			OR btrim(element #>> ARRAY[]::TEXT[]) = ''
	) THEN
		RETURN FALSE;
	END IF;
	SELECT count(*), count(DISTINCT element #>> ARRAY[]::TEXT[])
	INTO total_count, unique_count
	FROM jsonb_array_elements(candidate) AS entries(element);
	RETURN total_count = unique_count;
EXCEPTION WHEN OTHERS THEN
	RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION canonical_world_state_v5_is_valid(
	snapshot JSONB,
	expected_schema_version INTEGER,
	expected_revision BIGINT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
	actor_row RECORD;
	object_row RECORD;
	feature_row RECORD;
	actor JSONB;
	object JSONB;
	lifecycle JSONB;
	adjudication JSONB;
	action_ids JSONB;
	feature_sources JSONB;
	pacts JSONB;
	blade JSONB;
	bond JSONB;
	chain JSONB;
	template JSONB;
	familiar JSONB;
	familiar_actor JSONB;
	tome_state JSONB;
	tome JSONB;
	book JSONB;
	weapon JSONB;
	runtime JSONB;
	hp JSONB;
	attack_profile JSONB;
	ruleset JSONB;
	scene JSONB;
	pending JSONB;
	projection JSONB;
	pending_actor JSONB;
	pending_bond JSONB;
	world_revision NUMERIC;
	observed_revision NUMERIC;
	numeric_value NUMERIC;
	actor_id TEXT;
	object_id TEXT;
	weapon_object_id TEXT;
	weapon_card_id TEXT;
	pending_actor_id TEXT;
	content_hash TEXT;
	has_held_by BOOLEAN;
	has_held_hand BOOLEAN;
	duplicate_hand BOOLEAN;
	duplicate_bond BOOLEAN;
	expected_damage_type TEXT;
BEGIN
	IF snapshot IS NULL
		OR expected_schema_version IS DISTINCT FROM 5
		OR expected_revision IS NULL
		OR expected_revision < 0
		OR NOT canonical_snapshot_schema_matches(snapshot, expected_schema_version)
		OR jsonb_typeof(snapshot->'id') IS DISTINCT FROM 'string'
		OR btrim(snapshot->>'id') = ''
		OR jsonb_typeof(snapshot->'ruleset') IS DISTINCT FROM 'object'
		OR jsonb_typeof(snapshot->'revision') IS DISTINCT FROM 'number'
		OR jsonb_typeof(snapshot->'logicalClock') IS DISTINCT FROM 'number'
		OR jsonb_typeof(snapshot->'actors') IS DISTINCT FROM 'object'
		OR jsonb_typeof(snapshot->'objects') IS DISTINCT FROM 'object'
		OR jsonb_typeof(snapshot->'scene') IS DISTINCT FROM 'object'
		OR NOT canonical_world_state_v5_string_array_is_valid(
			snapshot->'processedCommandIds', TRUE
		)
		OR jsonb_typeof(snapshot->'concentrations') IS DISTINCT FROM 'object'
		OR jsonb_typeof(snapshot->'attackActions') IS DISTINCT FROM 'object'
		OR jsonb_typeof(snapshot->'grapples') IS DISTINCT FROM 'object'
	THEN
		RETURN FALSE;
	END IF;

	world_revision := (snapshot->>'revision')::NUMERIC;
	IF world_revision < 0
		OR world_revision <> trunc(world_revision)
		OR world_revision <> expected_revision THEN
		RETURN FALSE;
	END IF;
	numeric_value := (snapshot->>'logicalClock')::NUMERIC;
	IF numeric_value < 0 OR numeric_value <> trunc(numeric_value) THEN
		RETURN FALSE;
	END IF;

	ruleset := snapshot->'ruleset';
	content_hash := ruleset->>'contentHash';
	IF ruleset->>'systemId' IS DISTINCT FROM 'dnd5e-2024'
		OR jsonb_typeof(ruleset->'releaseId') IS DISTINCT FROM 'string'
		OR btrim(ruleset->>'releaseId') = ''
		OR jsonb_typeof(ruleset->'contentHash') IS DISTINCT FROM 'string'
		OR content_hash !~ '^sha256:[0-9a-f]{64}$'
		OR jsonb_typeof(ruleset->'errataVersion') IS DISTINCT FROM 'string'
		OR btrim(ruleset->>'errataVersion') = '' THEN
		RETURN FALSE;
	END IF;

	scene := snapshot->'scene';
	IF scene->>'mode' = 'exploration' THEN
		NULL;
	ELSIF scene->>'mode' = 'encounter' THEN
		IF NOT canonical_world_state_v5_string_array_is_valid(scene->'initiative', FALSE)
			OR jsonb_typeof(scene->'activeIndex') IS DISTINCT FROM 'number'
			OR jsonb_typeof(scene->'round') IS DISTINCT FROM 'number'
			OR jsonb_typeof(scene->'turnStarted') IS DISTINCT FROM 'boolean' THEN
			RETURN FALSE;
		END IF;
		numeric_value := (scene->>'activeIndex')::NUMERIC;
		IF numeric_value < 0
			OR numeric_value <> trunc(numeric_value)
			OR numeric_value >= jsonb_array_length(scene->'initiative') THEN
			RETURN FALSE;
		END IF;
		numeric_value := (scene->>'round')::NUMERIC;
		IF numeric_value < 1 OR numeric_value <> trunc(numeric_value) THEN
			RETURN FALSE;
		END IF;
		IF EXISTS (
			SELECT 1
			FROM jsonb_array_elements_text(scene->'initiative') AS initiative(actor_key)
			WHERE NOT (snapshot->'actors' ? actor_key)
		) THEN
			RETURN FALSE;
		END IF;
	ELSE
		RETURN FALSE;
	END IF;

	FOR actor_row IN SELECT key, value FROM jsonb_each(snapshot->'actors') LOOP
		actor_id := actor_row.key;
		actor := actor_row.value;
		IF jsonb_typeof(actor) IS DISTINCT FROM 'object'
			OR jsonb_typeof(actor->'id') IS DISTINCT FROM 'string'
			OR actor->>'id' IS DISTINCT FROM actor_id
			OR jsonb_typeof(actor->'name') IS DISTINCT FROM 'string'
			OR btrim(actor->>'name') = ''
			OR COALESCE(actor->>'kind', '') NOT IN ('playerCharacter', 'monster', 'summonedActor')
			OR jsonb_typeof(actor->'controllerId') IS DISTINCT FROM 'string'
			OR btrim(actor->>'controllerId') = ''
			OR jsonb_typeof(actor->'capabilities') IS DISTINCT FROM 'object'
			OR NOT canonical_world_state_v5_string_array_is_valid(
				actor#>'{capabilities,actionIds}', TRUE
			)
			OR jsonb_typeof(actor->'character') IS DISTINCT FROM 'object'
			OR jsonb_typeof(actor#>'{character,abilityMods}') IS DISTINCT FROM 'object'
			OR jsonb_typeof(actor#>'{character,profBonus}') IS DISTINCT FROM 'number'
			OR jsonb_typeof(actor#>'{character,level}') IS DISTINCT FROM 'number'
			OR jsonb_typeof(actor->'runtime') IS DISTINCT FROM 'object'
			OR jsonb_typeof(actor->'lifecycle') IS DISTINCT FROM 'object'
			OR jsonb_typeof(actor->'attackProfile') IS DISTINCT FROM 'object'
		THEN
			RETURN FALSE;
		END IF;
		action_ids := actor#>'{capabilities,actionIds}';
		feature_sources := COALESCE(actor#>'{capabilities,featureSources}', '{}'::JSONB);
		IF actor#>'{capabilities,featureSources}' IS NOT NULL
			AND jsonb_typeof(actor#>'{capabilities,featureSources}') IS DISTINCT FROM 'object' THEN
			RETURN FALSE;
		END IF;
		FOR feature_row IN SELECT key, value FROM jsonb_each(feature_sources) LOOP
			IF btrim(feature_row.key) = ''
				OR NOT canonical_world_state_v5_string_array_is_valid(feature_row.value, FALSE) THEN
				RETURN FALSE;
			END IF;
		END LOOP;

		runtime := actor->'runtime';
		hp := runtime->'hp';
		IF jsonb_typeof(hp) IS DISTINCT FROM 'object'
			OR jsonb_typeof(hp->'current') IS DISTINCT FROM 'number'
			OR jsonb_typeof(hp->'max') IS DISTINCT FROM 'number'
			OR jsonb_typeof(hp->'temp') IS DISTINCT FROM 'number'
			OR jsonb_typeof(runtime->'resources') IS DISTINCT FROM 'object'
			OR jsonb_typeof(runtime->'maxResources') IS DISTINCT FROM 'object'
			OR jsonb_typeof(runtime->'equipment') IS DISTINCT FROM 'object'
			OR jsonb_typeof(runtime->'inventory') IS DISTINCT FROM 'array'
			OR jsonb_typeof(runtime->'activeEffects') IS DISTINCT FROM 'array' THEN
			RETURN FALSE;
		END IF;
		FOR numeric_value IN
			SELECT value::NUMERIC
			FROM jsonb_each_text(hp)
			WHERE key IN ('current', 'max', 'temp')
		LOOP
			IF numeric_value <> trunc(numeric_value) THEN
				RETURN FALSE;
			END IF;
		END LOOP;
		IF (hp->>'max')::NUMERIC < 1 OR (hp->>'temp')::NUMERIC < 0 THEN
			RETURN FALSE;
		END IF;

		attack_profile := actor->'attackProfile';
		IF jsonb_typeof(attack_profile->'attacksPerAction') IS DISTINCT FROM 'number'
			OR jsonb_typeof(attack_profile->'size') IS DISTINCT FROM 'number'
			OR jsonb_typeof(attack_profile->'reachFt') IS DISTINCT FROM 'number'
			OR NOT canonical_world_state_v5_string_array_is_valid(
				attack_profile->'graspingParts', TRUE
			)
			OR NOT canonical_world_state_v5_string_array_is_valid(
				attack_profile->'sourceEntityIds', FALSE
			) THEN
			RETURN FALSE;
		END IF;
		numeric_value := (attack_profile->>'attacksPerAction')::NUMERIC;
		IF numeric_value < 1 OR numeric_value <> trunc(numeric_value) THEN
			RETURN FALSE;
		END IF;
		numeric_value := (attack_profile->>'size')::NUMERIC;
		IF numeric_value < 0 OR numeric_value > 5 OR numeric_value <> trunc(numeric_value) THEN
			RETURN FALSE;
		END IF;
		IF (attack_profile->>'reachFt')::NUMERIC <= 0 THEN
			RETURN FALSE;
		END IF;

		lifecycle := actor->'lifecycle';
		IF lifecycle->>'status' = 'alive' THEN
			IF lifecycle ? 'adjudication' THEN
				RETURN FALSE;
			END IF;
		ELSIF lifecycle->>'status' = 'dead' THEN
			adjudication := lifecycle->'adjudication';
			IF jsonb_typeof(adjudication) IS DISTINCT FROM 'object'
				OR adjudication->>'type' IS DISTINCT FROM 'ActorDeathAdjudicated'
				OR adjudication->>'provenance' IS DISTINCT FROM 'canonical_actor_lifecycle'
				OR jsonb_typeof(adjudication->'factId') IS DISTINCT FROM 'string'
				OR btrim(adjudication->>'factId') = ''
				OR adjudication->>'factId' <> btrim(adjudication->>'factId')
				OR jsonb_typeof(adjudication->'actorId') IS DISTINCT FROM 'string'
				OR adjudication->>'actorId' IS DISTINCT FROM actor_id
				OR jsonb_typeof(adjudication->'adjudicatedBy') IS DISTINCT FROM 'string'
				OR btrim(adjudication->>'adjudicatedBy') = ''
				OR adjudication->>'adjudicatedBy' <> btrim(adjudication->>'adjudicatedBy')
				OR jsonb_typeof(adjudication->'observedAtWorldRevision') IS DISTINCT FROM 'number'
				OR jsonb_typeof(adjudication->'rulesetContentHash') IS DISTINCT FROM 'string'
				OR adjudication->>'rulesetContentHash' IS DISTINCT FROM content_hash
			THEN
				RETURN FALSE;
			END IF;
			observed_revision := (adjudication->>'observedAtWorldRevision')::NUMERIC;
			IF observed_revision < 0
				OR observed_revision <> trunc(observed_revision)
				OR observed_revision >= world_revision THEN
				RETURN FALSE;
			END IF;
		ELSE
			RETURN FALSE;
		END IF;
		IF lifecycle->>'status' = 'dead' AND snapshot->'concentrations' ? actor_id THEN
			RETURN FALSE;
		END IF;

		IF actor ? 'warlockPacts' THEN
			pacts := actor->'warlockPacts';
			IF jsonb_typeof(pacts) IS DISTINCT FROM 'object'
				OR pacts = '{}'::JSONB
				OR EXISTS (
					SELECT 1
					FROM jsonb_object_keys(pacts) AS pact_keys(pact_key)
					WHERE pact_key NOT IN ('blade', 'chain', 'tome')
				) THEN
				RETURN FALSE;
			END IF;

			IF pacts ? 'blade' THEN
				blade := pacts->'blade';
				IF jsonb_typeof(blade) IS DISTINCT FROM 'object'
					OR blade->>'kind' IS DISTINCT FROM 'blade'
					OR blade->>'ownerActorId' IS DISTINCT FROM actor_id
					OR jsonb_typeof(blade->'sourceEntityId') IS DISTINCT FROM 'string'
					OR btrim(blade->>'sourceEntityId') = ''
					OR jsonb_typeof(feature_sources->'warlock.pact.blade') IS DISTINCT FROM 'array'
					OR NOT (feature_sources->'warlock.pact.blade' ? (blade->>'sourceEntityId'))
					OR jsonb_typeof(blade->'bondActionId') IS DISTINCT FROM 'string'
					OR btrim(blade->>'bondActionId') = ''
					OR NOT (action_ids ? (blade->>'bondActionId'))
					OR NOT (blade ? 'activeBond') THEN
					RETURN FALSE;
				END IF;
				bond := blade->'activeBond';
				IF jsonb_typeof(bond) NOT IN ('null', 'object') THEN
					RETURN FALSE;
				END IF;
				IF jsonb_typeof(bond) = 'object' THEN
					IF lifecycle->>'status' = 'dead' THEN
						RETURN FALSE;
					END IF;
					weapon_object_id := bond->>'weaponObjectId';
					weapon_card_id := bond->>'weaponCardId';
					weapon := snapshot->'objects'->weapon_object_id;
					IF jsonb_typeof(bond->'weaponObjectId') IS DISTINCT FROM 'string'
						OR btrim(weapon_object_id) = ''
						OR jsonb_typeof(bond->'weaponCardId') IS DISTINCT FROM 'string'
						OR btrim(weapon_card_id) = ''
						OR jsonb_typeof(bond->'weaponType') IS DISTINCT FROM 'string'
						OR btrim(bond->>'weaponType') = ''
						OR jsonb_typeof(bond->'normalDamageType') IS DISTINCT FROM 'string'
						OR btrim(bond->>'normalDamageType') = ''
						OR bond->>'sourceEntityId' IS DISTINCT FROM blade->>'sourceEntityId'
						OR bond->>'warlockActorId' IS DISTINCT FROM actor_id
						OR jsonb_typeof(weapon) IS DISTINCT FROM 'object'
						OR weapon->>'kind' IS DISTINCT FROM 'item'
						OR weapon->>'itemCardId' IS DISTINCT FROM weapon_card_id
						OR (weapon ? 'attunedToActorId'
							AND weapon->>'attunedToActorId' IS DISTINCT FROM actor_id)
						OR jsonb_typeof(bond->'conjured') IS DISTINCT FROM 'boolean'
						OR jsonb_typeof(bond->'bondedAtRevision') IS DISTINCT FROM 'number'
						OR jsonb_typeof(bond->'secondsBeyondFiveFeet') IS DISTINCT FROM 'number'
						OR NOT (bond ? 'lastDistanceBoardRevision') THEN
						RETURN FALSE;
					END IF;
					IF (bond->>'conjured')::BOOLEAN AND (
						weapon->>'ownerActorId' IS DISTINCT FROM actor_id
						OR weapon->>'sourceActorId' IS DISTINCT FROM actor_id
						OR weapon->>'sourceActionId' IS DISTINCT FROM blade->>'sourceEntityId'
						OR jsonb_typeof(weapon->'tags') IS DISTINCT FROM 'array'
						OR NOT (weapon->'tags' ? 'pact_weapon')
					) THEN
						RETURN FALSE;
					END IF;
					numeric_value := (bond->>'bondedAtRevision')::NUMERIC;
					IF numeric_value < 0 OR numeric_value <> trunc(numeric_value)
						OR numeric_value > world_revision THEN
						RETURN FALSE;
					END IF;
					numeric_value := (bond->>'secondsBeyondFiveFeet')::NUMERIC;
					IF numeric_value < 0 OR numeric_value <> trunc(numeric_value)
						OR numeric_value >= 60 THEN
						RETURN FALSE;
					END IF;
					IF jsonb_typeof(bond->'lastDistanceBoardRevision') <> 'null' THEN
						IF jsonb_typeof(bond->'lastDistanceBoardRevision') IS DISTINCT FROM 'number' THEN
							RETURN FALSE;
						END IF;
						numeric_value := (bond->>'lastDistanceBoardRevision')::NUMERIC;
						IF numeric_value < 0 OR numeric_value <> trunc(numeric_value) THEN
							RETURN FALSE;
						END IF;
					END IF;
				END IF;
			END IF;

			IF pacts ? 'chain' THEN
				chain := pacts->'chain';
				IF jsonb_typeof(chain) IS DISTINCT FROM 'object'
					OR chain->>'kind' IS DISTINCT FROM 'chain'
					OR chain->>'ownerActorId' IS DISTINCT FROM actor_id
					OR jsonb_typeof(chain->'sourceEntityId') IS DISTINCT FROM 'string'
					OR btrim(chain->>'sourceEntityId') = ''
					OR jsonb_typeof(feature_sources->'warlock.pact.chain') IS DISTINCT FROM 'array'
					OR NOT (feature_sources->'warlock.pact.chain' ? (chain->>'sourceEntityId'))
					OR jsonb_typeof(chain->'template') IS DISTINCT FROM 'object'
					OR NOT (chain ? 'activeFamiliar') THEN
					RETURN FALSE;
				END IF;
				template := chain->'template';
				IF jsonb_typeof(template->'findFamiliarActionId') IS DISTINCT FROM 'string'
					OR btrim(template->>'findFamiliarActionId') = ''
					OR NOT (action_ids ? (template->>'findFamiliarActionId'))
					OR template->>'normalFormSource' IS DISTINCT FROM 'find_familiar_spell'
					OR NOT canonical_world_state_v5_string_array_is_valid(
						template->'specialFormIds', FALSE
					)
					OR jsonb_array_length(template->'specialFormIds') <> 8
					OR NOT (template->'specialFormIds' @> '["imp","pseudodragon","quasit","skeleton","slaad_tadpole","sphinx_of_wonder","sprite","venomous_snake"]'::JSONB) THEN
					RETURN FALSE;
				END IF;
				familiar := chain->'activeFamiliar';
				IF jsonb_typeof(familiar) NOT IN ('null', 'object') THEN
					RETURN FALSE;
				END IF;
				IF jsonb_typeof(familiar) = 'object' THEN
					familiar_actor := snapshot->'actors'->(familiar->>'actorId');
					IF jsonb_typeof(familiar->'actorId') IS DISTINCT FROM 'string'
						OR btrim(familiar->>'actorId') = ''
						OR familiar->>'actorId' IS NOT DISTINCT FROM actor_id
						OR familiar->>'ownerActorId' IS DISTINCT FROM actor_id
						OR familiar->>'sourceEntityId' IS DISTINCT FROM chain->>'sourceEntityId'
						OR jsonb_typeof(familiar->'formId') IS DISTINCT FROM 'string'
						OR btrim(familiar->>'formId') = ''
						OR jsonb_typeof(familiar->'reactionAvailable') IS DISTINCT FROM 'boolean'
						OR jsonb_typeof(familiar_actor) IS DISTINCT FROM 'object'
						OR familiar_actor->>'kind' IS DISTINCT FROM 'summonedActor' THEN
						RETURN FALSE;
					END IF;
				END IF;
			END IF;

			IF pacts ? 'tome' THEN
				tome_state := pacts->'tome';
				IF jsonb_typeof(tome_state) IS DISTINCT FROM 'object'
					OR tome_state->>'kind' IS DISTINCT FROM 'tome'
					OR tome_state->>'ownerActorId' IS DISTINCT FROM actor_id
					OR jsonb_typeof(tome_state->'sourceEntityId') IS DISTINCT FROM 'string'
					OR btrim(tome_state->>'sourceEntityId') = ''
					OR jsonb_typeof(feature_sources->'warlock.pact.tome') IS DISTINCT FROM 'array'
					OR NOT (feature_sources->'warlock.pact.tome' ? (tome_state->>'sourceEntityId'))
					OR jsonb_typeof(tome_state->'tome') IS DISTINCT FROM 'object' THEN
					RETURN FALSE;
				END IF;
				tome := tome_state->'tome';
				book := snapshot->'objects'->(tome->>'bookObjectId');
				IF tome->>'sourceEntityId' IS DISTINCT FROM tome_state->>'sourceEntityId'
					OR tome->>'ownerActorId' IS DISTINCT FROM actor_id
					OR jsonb_typeof(tome->'bookObjectId') IS DISTINCT FROM 'string'
					OR btrim(tome->>'bookObjectId') = ''
					OR jsonb_typeof(book) IS DISTINCT FROM 'object'
					OR book->>'kind' IS DISTINCT FROM 'item'
					OR book->>'ownerActorId' IS DISTINCT FROM actor_id
					OR book->>'carriedByActorId' IS DISTINCT FROM actor_id
					OR book->>'sourceActorId' IS DISTINCT FROM actor_id
					OR book->>'sourceActionId' IS DISTINCT FROM tome_state->>'sourceEntityId'
					OR jsonb_typeof(book->'tags') IS DISTINCT FROM 'array'
					OR NOT (book->'tags' ? 'book_of_shadows')
					OR NOT (book->'tags' ? 'spellcasting_focus')
					OR NOT canonical_world_state_v5_string_array_is_valid(
						tome->'cantripActionIds', FALSE
					)
					OR jsonb_array_length(tome->'cantripActionIds') <> 3
					OR NOT canonical_world_state_v5_string_array_is_valid(
						tome->'ritualActionIds', FALSE
					)
					OR jsonb_array_length(tome->'ritualActionIds') <> 2
					OR NOT canonical_world_state_v5_string_array_is_valid(
						tome->'spellGrantIds', FALSE
					)
					OR jsonb_array_length(tome->'spellGrantIds') <> 5
					OR COALESCE(tome->>'createdAfterRest', '') NOT IN ('short', 'long')
					OR jsonb_typeof(actor#>'{spellcastingAccess,grants}') IS DISTINCT FROM 'array'
					OR jsonb_typeof(actor#>'{spellcastingAccess,preparedSources}') IS DISTINCT FROM 'object' THEN
					RETURN FALSE;
				END IF;
				IF EXISTS (
					SELECT 1
					FROM jsonb_array_elements_text(
						(tome->'cantripActionIds') || (tome->'ritualActionIds')
					) AS selected(action_id)
					WHERE NOT (action_ids ? action_id)
				) OR (
					SELECT count(DISTINCT action_id)
					FROM jsonb_array_elements_text(
						(tome->'cantripActionIds') || (tome->'ritualActionIds')
					) AS selected(action_id)
				) <> 5 THEN
					RETURN FALSE;
				END IF;
				IF (
					SELECT count(*)
					FROM jsonb_array_elements(actor#>'{spellcastingAccess,grants}') AS grants(grant_entry)
					WHERE grant_entry->>'sourceId' = tome->>'bookObjectId'
				) <> 5
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements_text(tome->'spellGrantIds') AS selected(grant_id)
						WHERE (
							SELECT count(*)
							FROM jsonb_array_elements(
								actor#>'{spellcastingAccess,grants}'
							) AS grants(grant_entry)
							WHERE grant_entry->>'grantId' = selected.grant_id
								AND grant_entry->>'sourceId' = tome->>'bookObjectId'
						) <> 1
					)
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements(actor#>'{spellcastingAccess,grants}') AS grants(grant_entry)
						WHERE grant_entry->>'sourceId' = tome->>'bookObjectId'
							AND (
								jsonb_typeof(grant_entry) IS DISTINCT FROM 'object'
								OR NOT (tome->'spellGrantIds' ? (grant_entry->>'grantId'))
								OR NOT (
									(tome->'cantripActionIds') || (tome->'ritualActionIds')
									? (grant_entry->>'actionId')
								)
								OR grant_entry->>'spellcastingAbility' IS DISTINCT FROM 'cha'
								OR (
									tome->'cantripActionIds' ? (grant_entry->>'actionId')
									AND (
										grant_entry->>'access' IS DISTINCT FROM 'cantrip'
										OR jsonb_typeof(grant_entry->'level') IS DISTINCT FROM 'number'
										OR (grant_entry->>'level')::NUMERIC <> 0
										OR grant_entry ? 'slotResource'
									)
								)
								OR (
									tome->'ritualActionIds' ? (grant_entry->>'actionId')
									AND (
										grant_entry->>'access' IS DISTINCT FROM 'always_prepared'
										OR jsonb_typeof(grant_entry->'level') IS DISTINCT FROM 'number'
										OR (grant_entry->>'level')::NUMERIC <> 1
										OR grant_entry->>'ritual' IS DISTINCT FROM 'true'
										OR jsonb_typeof(grant_entry->'slotResource') IS DISTINCT FROM 'string'
										OR btrim(grant_entry->>'slotResource') = ''
									)
								)
							)
					) THEN
					RETURN FALSE;
				END IF;
			END IF;
		END IF;
	END LOOP;

	FOR object_row IN SELECT key, value FROM jsonb_each(snapshot->'objects') LOOP
		object_id := object_row.key;
		object := object_row.value;
		IF jsonb_typeof(object) IS DISTINCT FROM 'object'
			OR jsonb_typeof(object->'id') IS DISTINCT FROM 'string'
			OR object->>'id' IS DISTINCT FROM object_id
			OR jsonb_typeof(object->'name') IS DISTINCT FROM 'string'
			OR btrim(object->>'name') = ''
			OR COALESCE(object->>'kind', '') NOT IN ('environment', 'item', 'spell_effect')
			OR COALESCE(object->>'size', '') NOT IN (
				'tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'
			) THEN
			RETURN FALSE;
		END IF;
		IF object ? 'itemCardId' AND (
			jsonb_typeof(object->'itemCardId') IS DISTINCT FROM 'string'
			OR btrim(object->>'itemCardId') = ''
			OR object->>'kind' IS DISTINCT FROM 'item'
		) THEN
			RETURN FALSE;
		END IF;
		IF object ? 'tags'
			AND NOT canonical_world_state_v5_string_array_is_valid(object->'tags', TRUE) THEN
			RETURN FALSE;
		END IF;
		IF object ? 'ownerActorId' AND (
			jsonb_typeof(object->'ownerActorId') IS DISTINCT FROM 'string'
			OR btrim(object->>'ownerActorId') = ''
			OR NOT (snapshot->'actors' ? (object->>'ownerActorId'))
		) THEN
			RETURN FALSE;
		END IF;
		IF object ? 'carriedByActorId' AND (
			jsonb_typeof(object->'carriedByActorId') IS DISTINCT FROM 'string'
			OR btrim(object->>'carriedByActorId') = ''
			OR object->>'kind' IS DISTINCT FROM 'item'
			OR NOT (snapshot->'actors' ? (object->>'carriedByActorId'))
		) THEN
			RETURN FALSE;
		END IF;
		IF object ? 'sourceActorId' AND (
			jsonb_typeof(object->'sourceActorId') IS DISTINCT FROM 'string'
			OR btrim(object->>'sourceActorId') = ''
			OR NOT (snapshot->'actors' ? (object->>'sourceActorId'))
		) THEN
			RETURN FALSE;
		END IF;
		IF object ? 'sourceActionId' AND (
			jsonb_typeof(object->'sourceActionId') IS DISTINCT FROM 'string'
			OR btrim(object->>'sourceActionId') = ''
		) THEN
			RETURN FALSE;
		END IF;
		IF object ? 'attunedToActorId' AND (
			jsonb_typeof(object->'attunedToActorId') IS DISTINCT FROM 'string'
			OR btrim(object->>'attunedToActorId') = ''
			OR object->>'kind' IS DISTINCT FROM 'item'
			OR NOT (snapshot->'actors' ? (object->>'attunedToActorId'))
		) THEN
			RETURN FALSE;
		END IF;
		has_held_by := object ? 'heldByActorId';
		has_held_hand := object ? 'heldInHand';
		IF has_held_by <> has_held_hand THEN
			RETURN FALSE;
		END IF;
		IF has_held_by AND (
			jsonb_typeof(object->'heldByActorId') IS DISTINCT FROM 'string'
			OR btrim(object->>'heldByActorId') = ''
			OR jsonb_typeof(object->'heldInHand') IS DISTINCT FROM 'string'
			OR COALESCE(object->>'heldInHand', '') NOT IN ('main_hand', 'off_hand')
			OR object->>'kind' IS DISTINCT FROM 'item'
			OR object->>'carriedByActorId' IS DISTINCT FROM object->>'heldByActorId'
			OR NOT (snapshot->'actors' ? (object->>'heldByActorId'))
		) THEN
			RETURN FALSE;
		END IF;
	END LOOP;

	SELECT TRUE INTO duplicate_hand
	FROM jsonb_each(snapshot->'objects') AS held
	WHERE held.value ? 'heldByActorId' AND held.value ? 'heldInHand'
	GROUP BY held.value->>'heldByActorId', held.value->>'heldInHand'
	HAVING count(*) > 1
	LIMIT 1;
	IF COALESCE(duplicate_hand, FALSE) THEN
		RETURN FALSE;
	END IF;

	SELECT TRUE INTO duplicate_bond
	FROM jsonb_each(snapshot->'actors') AS bonded
	WHERE jsonb_typeof(bonded.value#>'{warlockPacts,blade,activeBond}') = 'object'
	GROUP BY bonded.value#>>'{warlockPacts,blade,activeBond,weaponObjectId}'
	HAVING count(*) > 1
	LIMIT 1;
	IF COALESCE(duplicate_bond, FALSE) THEN
		RETURN FALSE;
	END IF;

	FOR object_row IN SELECT key, value FROM jsonb_each(snapshot->'grapples') LOOP
		object := object_row.value;
		IF snapshot#>>ARRAY['actors', object->>'grapplerActorId', 'lifecycle', 'status'] = 'dead'
			OR snapshot#>>ARRAY['actors', object->>'targetActorId', 'lifecycle', 'status'] = 'dead' THEN
			RETURN FALSE;
		END IF;
	END LOOP;

	IF NOT (snapshot ? 'pendingResolution')
		OR jsonb_typeof(snapshot->'pendingResolution') NOT IN ('null', 'object') THEN
		RETURN FALSE;
	END IF;
	pending := snapshot->'pendingResolution';
	IF jsonb_typeof(pending) = 'object' AND pending ? 'pactBladeProjection' THEN
		projection := pending->'pactBladeProjection';
		pending_actor_id := pending->>'sourceActorId';
		pending_actor := snapshot->'actors'->pending_actor_id;
		pending_bond := pending_actor#>'{warlockPacts,blade,activeBond}';
		weapon_object_id := projection->>'weaponObjectId';
		weapon_card_id := projection->>'weaponCardId';
		weapon := snapshot->'objects'->weapon_object_id;
		IF COALESCE(pending->>'type', '') NOT IN ('attack_reaction', 'protection_reaction')
			OR pending->>'actionId' IS DISTINCT FROM 'core.attack.weapon'
			OR COALESCE(pending->>'attackContinuationKind', '') NOT IN (
				'weapon_melee', 'weapon_ranged'
			)
			OR jsonb_typeof(pending->'weaponCardId') IS DISTINCT FROM 'string'
			OR jsonb_typeof(pending->'weaponHand') IS DISTINCT FROM 'string'
			OR jsonb_typeof(projection) IS DISTINCT FROM 'object'
			OR jsonb_typeof(pending_actor) IS DISTINCT FROM 'object'
			OR pending_actor#>>'{lifecycle,status}' IS DISTINCT FROM 'alive'
			OR jsonb_typeof(pending_bond) IS DISTINCT FROM 'object'
			OR pending_bond->>'weaponObjectId' IS DISTINCT FROM weapon_object_id
			OR pending_bond->>'weaponCardId' IS DISTINCT FROM weapon_card_id
			OR jsonb_typeof(weapon) IS DISTINCT FROM 'object'
			OR weapon->>'kind' IS DISTINCT FROM 'item'
			OR weapon->>'itemCardId' IS DISTINCT FROM weapon_card_id
			OR weapon->>'heldByActorId' IS DISTINCT FROM pending_actor_id
			OR COALESCE(projection->>'weaponHand', '') NOT IN ('main', 'off')
			OR (projection->>'weaponHand' = 'main' AND weapon->>'heldInHand' <> 'main_hand')
			OR (projection->>'weaponHand' = 'off' AND weapon->>'heldInHand' <> 'off_hand')
			OR COALESCE(projection->>'abilityChoice', '') NOT IN ('str', 'dex', 'cha')
			OR projection->>'attackAbility' IS DISTINCT FROM projection->>'abilityChoice'
			OR projection->>'damageAbility' IS DISTINCT FROM projection->>'abilityChoice'
			OR COALESCE(projection->>'damageChoice', '') NOT IN (
				'normal', 'necrotic', 'psychic', 'radiant'
			)
			OR jsonb_typeof(projection->'resolvedDamageType') IS DISTINCT FROM 'string'
			OR btrim(projection->>'resolvedDamageType') = ''
			OR pending->>'weaponCardId' IS DISTINCT FROM weapon_card_id
			OR pending->>'weaponHand' IS DISTINCT FROM projection->>'weaponHand' THEN
			RETURN FALSE;
		END IF;
		expected_damage_type := CASE projection->>'damageChoice'
			WHEN 'normal' THEN pending_bond->>'normalDamageType'
			ELSE projection->>'damageChoice'
		END;
		IF projection->>'resolvedDamageType' IS DISTINCT FROM expected_damage_type THEN
			RETURN FALSE;
		END IF;
	END IF;

	RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
	-- Malformed JSON casts are invalid input. This function intentionally never
	-- converts SQL NULL or a data exception into CHECK's permissive NULL result.
	RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION canonical_world_state_release_binding_is_valid(
	snapshot JSONB,
	expected_release_id UUID,
	expected_rules_artifact_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
PARALLEL SAFE
AS $$
DECLARE
	release_row RECORD;
BEGIN
	IF snapshot IS NULL
		OR expected_release_id IS NULL
		OR expected_rules_artifact_hash IS NULL
		OR jsonb_typeof(snapshot#>'{ruleset}') IS DISTINCT FROM 'object' THEN
		RETURN FALSE;
	END IF;
	SELECT system_id, artifact_version, content_hash, errata_version
	INTO release_row
	FROM ruleset_releases
	WHERE id = expected_release_id
		AND rules_artifact_hash = expected_rules_artifact_hash;
	IF NOT FOUND THEN
		RETURN FALSE;
	END IF;
	RETURN snapshot#>>'{ruleset,systemId}' IS NOT DISTINCT FROM release_row.system_id
		AND snapshot#>>'{ruleset,releaseId}' IS NOT DISTINCT FROM release_row.artifact_version
		AND snapshot#>>'{ruleset,contentHash}' IS NOT DISTINCT FROM release_row.content_hash
		AND snapshot#>>'{ruleset,errataVersion}' IS NOT DISTINCT FROM release_row.errata_version;
EXCEPTION WHEN OTHERS THEN
	RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_canonical_world_state_release_binding()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
	snapshot_value JSONB;
BEGIN
	IF NEW.snapshot_schema_version < 5 THEN
		RETURN NEW;
	END IF;
	IF TG_TABLE_NAME = 'game_sessions' THEN
		snapshot_value := NEW.current_snapshot;
	ELSIF TG_TABLE_NAME = 'session_snapshots' THEN
		snapshot_value := NEW.snapshot;
	ELSE
		RAISE EXCEPTION 'unsupported canonical snapshot table %', TG_TABLE_NAME
			USING ERRCODE = '23514';
	END IF;
	IF NOT COALESCE(canonical_world_state_release_binding_is_valid(
		snapshot_value,
		NEW.ruleset_release_id,
		NEW.rules_artifact_hash
	), FALSE) THEN
		RAISE EXCEPTION '% snapshot ruleset does not match immutable release %',
			TG_TABLE_NAME, NEW.ruleset_release_id
			USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$;

DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM game_sessions AS session
		WHERE session.snapshot_schema_version >= 5
			AND (
				session.snapshot_schema_version <> 5
				OR NOT COALESCE(canonical_snapshot_schema_matches(
					session.current_snapshot, session.snapshot_schema_version
				), FALSE)
				OR NOT COALESCE(canonical_world_state_v5_is_valid(
					session.current_snapshot,
					session.snapshot_schema_version,
					session.revision
				), FALSE)
				OR NOT COALESCE(canonical_world_state_release_binding_is_valid(
					session.current_snapshot,
					session.ruleset_release_id,
					session.rules_artifact_hash
				), FALSE)
			)
	) THEN
		RAISE EXCEPTION 'existing game_sessions schema-v5+ snapshot failed canonical preflight'
			USING ERRCODE = '23514';
	END IF;
	IF EXISTS (
		SELECT 1
		FROM session_snapshots AS historical
		WHERE historical.snapshot_schema_version >= 5
			AND (
				historical.snapshot_schema_version <> 5
				OR NOT COALESCE(canonical_snapshot_schema_matches(
					historical.snapshot, historical.snapshot_schema_version
				), FALSE)
				OR NOT COALESCE(canonical_world_state_v5_is_valid(
					historical.snapshot,
					historical.snapshot_schema_version,
					historical.revision
				), FALSE)
				OR NOT COALESCE(canonical_world_state_release_binding_is_valid(
					historical.snapshot,
					historical.ruleset_release_id,
					historical.rules_artifact_hash
				), FALSE)
			)
	) THEN
		RAISE EXCEPTION 'existing session_snapshots schema-v5+ snapshot failed canonical preflight'
			USING ERRCODE = '23514';
	END IF;
END;
$$;

DO $$
DECLARE
	constraint_definition TEXT;
BEGIN
	SELECT pg_get_constraintdef(oid)
	INTO constraint_definition
	FROM pg_constraint
	WHERE conname = 'ck_game_sessions_world_runtime_v5'
		AND conrelid = 'game_sessions'::REGCLASS;
	IF constraint_definition IS NULL THEN
		ALTER TABLE game_sessions
			ADD CONSTRAINT ck_game_sessions_world_runtime_v5 CHECK (
				canonical_snapshot_schema_matches(current_snapshot, snapshot_schema_version)
				AND (
					snapshot_schema_version < 5
					OR (
						snapshot_schema_version = 5
						AND COALESCE(canonical_world_state_v5_is_valid(
							current_snapshot,
							snapshot_schema_version,
							revision
						), FALSE)
					)
				)
			) NOT VALID;
	ELSIF position('canonical_snapshot_schema_matches' IN constraint_definition) = 0
		OR position('canonical_world_state_v5_is_valid' IN constraint_definition) = 0 THEN
		RAISE EXCEPTION 'ck_game_sessions_world_runtime_v5 has an unexpected definition';
	END IF;

	SELECT pg_get_constraintdef(oid)
	INTO constraint_definition
	FROM pg_constraint
	WHERE conname = 'ck_session_snapshots_world_runtime_v5'
		AND conrelid = 'session_snapshots'::REGCLASS;
	IF constraint_definition IS NULL THEN
		ALTER TABLE session_snapshots
			ADD CONSTRAINT ck_session_snapshots_world_runtime_v5 CHECK (
				canonical_snapshot_schema_matches(snapshot, snapshot_schema_version)
				AND (
					snapshot_schema_version < 5
					OR (
						snapshot_schema_version = 5
						AND COALESCE(canonical_world_state_v5_is_valid(
							snapshot,
							snapshot_schema_version,
							revision
						), FALSE)
					)
				)
			) NOT VALID;
	ELSIF position('canonical_snapshot_schema_matches' IN constraint_definition) = 0
		OR position('canonical_world_state_v5_is_valid' IN constraint_definition) = 0 THEN
		RAISE EXCEPTION 'ck_session_snapshots_world_runtime_v5 has an unexpected definition';
	END IF;
END;
$$;

ALTER TABLE game_sessions
	VALIDATE CONSTRAINT ck_game_sessions_world_runtime_v5;
ALTER TABLE session_snapshots
	VALIDATE CONSTRAINT ck_session_snapshots_world_runtime_v5;

DROP TRIGGER IF EXISTS game_sessions_world_release_binding_v5 ON game_sessions;
CREATE TRIGGER game_sessions_world_release_binding_v5
	BEFORE INSERT OR UPDATE OF
		ruleset_release_id, rules_artifact_hash, current_snapshot, snapshot_schema_version
	ON game_sessions
	FOR EACH ROW EXECUTE FUNCTION enforce_canonical_world_state_release_binding();

DROP TRIGGER IF EXISTS session_snapshots_world_release_binding_v5 ON session_snapshots;
CREATE TRIGGER session_snapshots_world_release_binding_v5
	BEFORE INSERT OR UPDATE OF
		ruleset_release_id, rules_artifact_hash, snapshot, snapshot_schema_version
	ON session_snapshots
	FOR EACH ROW EXECUTE FUNCTION enforce_canonical_world_state_release_binding();

CREATE INDEX IF NOT EXISTS idx_game_sessions_actors_v5
	ON game_sessions USING GIN ((current_snapshot->'actors'))
	WHERE snapshot_schema_version = 5;
CREATE INDEX IF NOT EXISTS idx_game_sessions_objects_v5
	ON game_sessions USING GIN ((current_snapshot->'objects'))
	WHERE snapshot_schema_version = 5;
CREATE INDEX IF NOT EXISTS idx_game_sessions_pending_v5
	ON game_sessions USING GIN ((current_snapshot->'pendingResolution'))
	WHERE snapshot_schema_version = 5 AND current_snapshot->'pendingResolution' <> 'null'::JSONB;
CREATE INDEX IF NOT EXISTS idx_session_snapshots_actors_v5
	ON session_snapshots USING GIN ((snapshot->'actors'))
	WHERE snapshot_schema_version = 5;
CREATE INDEX IF NOT EXISTS idx_session_snapshots_objects_v5
	ON session_snapshots USING GIN ((snapshot->'objects'))
	WHERE snapshot_schema_version = 5;
`

func addWorldRuntimeV5(db *sql.DB) error {
	if _, err := db.Exec(worldRuntimeV5DDL); err != nil {
		return fmt.Errorf("add world runtime v5: %w", err)
	}
	return nil
}
