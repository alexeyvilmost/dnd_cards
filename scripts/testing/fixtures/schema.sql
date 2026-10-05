--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11
-- Dumped by pg_dump version 17.11

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: canonical_snapshot_schema_matches(jsonb, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_snapshot_schema_matches(snapshot jsonb, expected_schema_version integer) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
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


--
-- Name: canonical_world_state_release_binding_is_valid(jsonb, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_world_state_release_binding_is_valid(snapshot jsonb, expected_release_id uuid, expected_rules_artifact_hash text) RETURNS boolean
    LANGUAGE plpgsql STABLE PARALLEL SAFE
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


--
-- Name: canonical_world_state_v5_is_valid(jsonb, integer, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_world_state_v5_is_valid(snapshot jsonb, expected_schema_version integer, expected_revision bigint) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
    AS $_$
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
$_$;


--
-- Name: canonical_world_state_v5_string_array_is_valid(jsonb, boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.canonical_world_state_v5_string_array_is_valid(candidate jsonb, allow_empty boolean) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE
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


--
-- Name: check_property_contains(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.check_property_contains(prop_value text, search_val text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    prop_text TEXT;
BEGIN
    -- Если значение пустое, возвращаем false
    IF prop_value IS NULL OR prop_value = '' THEN
        RETURN FALSE;
    END IF;

    -- Приводим к тексту для анализа
    prop_text := prop_value::TEXT;

    -- Пробуем как JSON массив (начинается с [)
    IF prop_text LIKE '[%' THEN
        BEGIN
            RETURN prop_text::jsonb @> ('["' || search_val || '"]')::jsonb;
        EXCEPTION WHEN OTHERS THEN
            -- Если не удалось распарсить как JSON, продолжаем
        END;
    END IF;

    -- Пробуем как PostgreSQL массив (начинается с {)
    IF prop_text LIKE '{%' THEN
        BEGIN
            RETURN ARRAY[search_val]::text[] <@ prop_text::text[];
        EXCEPTION WHEN OTHERS THEN
            -- Если не удалось распарсить как массив, продолжаем
        END;
    END IF;

    -- Простая проверка строки (fallback)
    RETURN prop_text LIKE '%"' || search_val || '"%' OR prop_text LIKE '%' || search_val || '%';
END;
$$;


--
-- Name: enforce_canonical_world_state_release_binding(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_canonical_world_state_release_binding() RETURNS trigger
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


--
-- Name: entity_reference_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entity_reference_changed() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
 IF TG_OP = 'DELETE' THEN
   DELETE FROM entity_reference_nodes WHERE entity_type=TG_ARGV[0] AND entity_id=COALESCE(to_jsonb(OLD)->>'id',to_jsonb(OLD)->>'key');
   RETURN OLD;
 END IF;
 PERFORM entity_reference_sync(TG_ARGV[0],to_jsonb(NEW));
 RETURN NEW;
END $$;


--
-- Name: entity_reference_extract(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entity_reference_extract(source_kind text, document jsonb) RETURNS TABLE(target_type text, target_key text, level integer, path text)
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE field text; kind text;
BEGIN
 FOREACH field IN ARRAY ARRAY['mechanics','script','battle_profile','related_cards','related_actions','related_effects','mastery','contents','equipment_options','starting_equipment','level_progression','resources','resource','origin_feat','parent_class_id','parent_race_id','classes','subclasses','action_ids','effect_ids','ai','bonus_value'] LOOP
   IF NOT (document ? field) THEN CONTINUE; END IF;
   IF field='bonus_value' AND source_kind<>'card' THEN CONTINUE; END IF;
   IF source_kind='action' AND field='resource' AND jsonb_typeof(document->field)='string' THEN
     RETURN QUERY SELECT * FROM entity_reference_walk(to_jsonb(regexp_split_to_array(document->>field,'\s*,\s*')),source_kind,'resources',0,'resource');
     CONTINUE;
   END IF;
   kind := entity_reference_field_kind(field);
   IF field IN ('contents','equipment_options','starting_equipment','level_progression','mechanics','script','battle_profile','ai') THEN kind := NULL; END IF;
   RETURN QUERY SELECT * FROM entity_reference_walk(document->field,source_kind,field,0,kind);
 END LOOP;
END $$;


--
-- Name: entity_reference_field_kind(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entity_reference_field_kind(field text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$ SELECT CASE
 WHEN field IN ('related_cards','card_id','cardId','item_id','itemId','item_ids','card_ids','weapon_id','weaponId','weapon_card_id','armor_card_id','requires_held_item','held_weapon_card','held_weapon_cards','item_card_id','key_item_card_id','requires_fuel_card_id','requires_item_source','requires_equipped_item_id') THEN 'card'
 WHEN field IN ('related_actions','action_id','actionId','action_ids','actionIds','actions','granted_actions','grant_actions','action_ref','actionRef','granted_action_refs','entry_action_ref','exit_action_ref','requires_runtime_action_grant','variant_of_action_id','action_variant_ids') THEN 'action'
 WHEN field IN ('related_effects','effect_id','effectId','effect_ids','effectIds','effects','granted_effects','grant_effects','mastery','mastery_effect_id','condition_id','conditionId','condition_immunities','on_failure_condition','if_condition_immunity','inside_condition','condition') THEN 'effect'
 WHEN field IN ('spell_id','spellId','spell_ids','spellIds','spells','spell_ref','spellRef','prepared_spells','known_spells','grantedSpell','variant_of_spell_id','spell_variant_ids') THEN 'spell'
 WHEN field IN ('feat_id','featId','feat_ids','featIds','feats','origin_feat') THEN 'feat'
 WHEN field IN ('class_id','classId','class_ids','class','classes','subclasses','parent_class_id','spell_class_list_ids','spellClass') THEN 'class'
 WHEN field IN ('race_id','raceId','race_ids','parent_race_id') THEN 'race'
 WHEN field IN ('resource_id','resourceId','resource','resource_ids','resources','slotResource','materialCostResource','free_use_resource','remove_cost_resources','consume_resource') THEN 'resource'
 WHEN field IN ('variable_id','variableId','variable','variable_ids') THEN 'variable'
 WHEN field IN ('monster_id','monsterId','monster_ids','monster_ref','monsterRef','template_id','templateId') THEN 'monster'
 WHEN field IN ('decision_policies') THEN 'passive'
 WHEN field IN ('source_entity_ids','sourceEntityIds') THEN '*'
 ELSE NULL END $$;


--
-- Name: entity_reference_sync(text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entity_reference_sync(source_kind text, document jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE source_key text; alias_values text[]; stable_values text[];
BEGIN
 source_key := COALESCE(document->>'id',document->>'key');
 IF source_key IS NULL THEN RETURN; END IF;
 IF document->>'deleted_at' IS NOT NULL THEN
   DELETE FROM entity_reference_nodes WHERE entity_type=source_kind AND entity_id=source_key;
   RETURN;
 END IF;
 SELECT array_agg(DISTINCT alias) INTO stable_values FROM unnest(ARRAY[source_key,document->>'card_number',document->>'resource_id',document->>'variable_id',document->>'concept_id',document->>'slug',document->>'key',CASE WHEN source_kind='effect' THEN document#>>'{mechanics,condition,id}' END,CASE WHEN source_kind='class' THEN replace(lower(regexp_replace(document->>'card_number','^CLASS[-_]','','i')),'-','_') END]) alias WHERE alias IS NOT NULL AND alias<>'';
 SELECT array_agg(DISTINCT alias) INTO alias_values FROM unnest(stable_values || ARRAY[CASE WHEN source_kind='class' THEN btrim(document->>'name') END,CASE WHEN source_kind='class' THEN lower(btrim(document->>'name') COLLATE "und-x-icu") END,CASE WHEN source_kind='class' THEN btrim(document->>'name_en') END,CASE WHEN source_kind='class' THEN lower(btrim(document->>'name_en') COLLATE "und-x-icu") END,CASE WHEN source_kind='spell' THEN btrim(regexp_replace(lower(replace(document->>'name_en','''','')),'[^a-z0-9]+','_','g'),'_') END]) alias WHERE alias IS NOT NULL AND alias<>'';
 INSERT INTO entity_reference_nodes(entity_type,entity_id,name,aliases,stable_aliases)
 VALUES(source_kind,source_key,COALESCE(document->>'name',''),alias_values,stable_values)
 ON CONFLICT(entity_type,entity_id) DO UPDATE SET name=EXCLUDED.name, aliases=EXCLUDED.aliases,stable_aliases=EXCLUDED.stable_aliases;
 DELETE FROM entity_reference_edges WHERE source_type=source_kind AND source_id=source_key;
 INSERT INTO entity_reference_edges(source_type,source_id,target_type,target_key,level,path)
 SELECT DISTINCT source_kind, source_key, e.target_type, e.target_key, e.level, e.path FROM entity_reference_extract(source_kind,document) e
 ON CONFLICT DO NOTHING;
END $$;


--
-- Name: entity_reference_targets(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entity_reference_targets(wanted_type text, wanted_key text) RETURNS TABLE(entity_type text, entity_id text, name text)
    LANGUAGE sql STABLE
    AS $_$
 SELECT candidate.entity_type,candidate.entity_id,candidate.name FROM (
  SELECT n.entity_type,n.entity_id,n.name,n.stable_aliases @> ARRAY[wanted_key] AS exact,
   count(*) FILTER (WHERE n.stable_aliases @> ARRAY[wanted_key]) OVER () AS exact_matches,
   count(*) OVER () AS matches
  FROM entity_reference_nodes n WHERE n.aliases @> ARRAY[wanted_key]
  AND (wanted_type=n.entity_type OR wanted_type='*' OR wanted_type='$' || n.entity_type)
 ) candidate WHERE (exact AND exact_matches=1) OR (exact_matches=0 AND matches=1)
$_$;


--
-- Name: entity_reference_walk(jsonb, text, text, integer, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.entity_reference_walk(node jsonb, source_kind text, at_path text, bound_level integer DEFAULT 0, expected_kind text DEFAULT NULL::text) RETURNS TABLE(target_type text, target_key text, level integer, path text)
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE member record; growth record; idx integer; child_kind text; object_kind text; scalar text; child_level integer; parsed jsonb; operation text; token text[];
BEGIN
  IF node IS NULL OR node = 'null'::jsonb THEN RETURN; END IF;
  IF length(at_path) > 4096 THEN RETURN; END IF;
  IF jsonb_typeof(node) = 'string' THEN
    scalar := node #>> '{}';
    -- Relative costs bind to an actor/item at execution time. They are not
    -- identities in the resource/card/condition library.
    IF expected_kind='resource' AND scalar IN ('spell_slot','self_uses','self_item','equipped_weapon_ammo','item','hit_die') THEN RETURN; END IF;
    IF expected_kind='resource' AND scalar ~ '^(uses_|freeuse-|hit_dice_d|material_|current_hp$|max_hp$)' THEN expected_kind := '$resource'; END IF;
    -- Some older text columns contain serialized JSON arrays.
    IF expected_kind IS NOT NULL AND left(ltrim(scalar),1) IN ('[','{') THEN
      BEGIN parsed := scalar::jsonb; EXCEPTION WHEN invalid_text_representation THEN RETURN; END;
      RETURN QUERY SELECT * FROM entity_reference_walk(parsed,source_kind,at_path,bound_level,expected_kind);
    ELSIF expected_kind IS NOT NULL AND scalar <> '' AND scalar !~ '[\[\]\n\r]' THEN
      RETURN QUERY SELECT expected_kind, scalar, bound_level, at_path;
    ELSIF expected_kind IS NULL AND (at_path ~ '(^|\.)(formula|amount|dice|count|max|value|distance|bonus|default_value|dc|cr_max|limit|investigation_dc|bonus_value)$' OR at_path ~ '\.(formula_bindings|event_formula_bindings)\.[^.]+$') THEN
      FOR token IN SELECT regexp_matches(scalar,'class_level:([A-Za-z0-9_-]+)','g') LOOP
        RETURN QUERY SELECT 'class'::text,token[1],bound_level,at_path;
      END LOOP;
      -- Formula identifiers resolve only to registered variables; builtin
      -- arithmetic/stat tokens are discarded by the resolved index view.
      FOR token IN SELECT regexp_matches(regexp_replace(scalar,'class_level:[A-Za-z0-9_-]+','','g'),'\m([A-Za-z_][A-Za-z0-9_]*)\M','g') LOOP
        RETURN QUERY SELECT '$variable'::text,token[1],bound_level,at_path;
      END LOOP;
    END IF;
    RETURN;
  END IF;
  IF jsonb_typeof(node) = 'array' THEN
    idx := 0;
    FOR member IN SELECT value FROM jsonb_array_elements(node) LOOP
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '[' || idx || ']',bound_level,expected_kind);
      idx := idx + 1;
    END LOOP;
    RETURN;
  END IF;
  IF jsonb_typeof(node) <> 'object' THEN RETURN; END IF;
  -- Binding keys name local formula slots, even if a key happens to equal
  -- 'resource', 'effect_id', or another library-reference field name.
  IF at_path ~ '\.(formula_bindings|event_formula_bindings)$' THEN
    FOR member IN SELECT key,value FROM jsonb_each(node) LOOP
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '.' || member.key,bound_level,NULL);
    END LOOP;
    RETURN;
  END IF;
  operation := COALESCE(node->>'kind',node->>'type',node->>'op','');
  IF operation IN ('narrative','description','text') THEN RETURN; END IF;
  object_kind := COALESCE(node->>'entity_type',node->>'entityType',node->>'kind',node->>'type', expected_kind);
  IF operation IN ('grant_action','grant_effect','grant_spell','grant_feat','grant_item') THEN object_kind := substring(operation FROM 7); END IF;
  IF operation IN ('condition_immunity','you_have_condition','target_has_condition','save_avoids_condition','state') THEN object_kind := 'effect'; END IF;
  IF object_kind = 'equipment' THEN object_kind := '$card'; END IF;
  IF operation = 'state' THEN object_kind := '$effect'; END IF;
  IF object_kind = 'species' THEN object_kind := 'race'; END IF;
  IF object_kind = 'subclass' THEN object_kind := 'class'; END IF;
  IF object_kind = 'item' THEN object_kind := 'card'; END IF;
  IF object_kind = 'condition' THEN object_kind := 'effect'; END IF;
  IF object_kind NOT IN ('card','action','effect','spell','feat','background','class','race','resource','variable','concept','monster','passive','$card','$effect') THEN object_kind := NULL; END IF;
  -- Monster loadouts embed a library card snapshot whose display `type` is
  -- weapon/armor, while the containing field owns the card identity.
  IF at_path ~ '^ai\.held_weapon_cards?(\[[0-9]+\])?$' THEN object_kind := 'card'; END IF;
  IF node ? 'source' AND at_path ~ '\.options$' THEN object_kind := NULL; END IF;
  IF node->>'source' IN ('effect','action','spell','feat','item','card','class','race','resource','variable','monster') THEN object_kind := CASE WHEN node->>'source'='item' THEN 'card' ELSE node->>'source' END; END IF;
  child_level := bound_level;
  IF source_kind IN ('race','class') AND node->>'min_level' ~ '^[0-9]{1,3}$' THEN
    child_level := (node->>'min_level')::integer;
  END IF;
  FOR member IN SELECT key,value FROM jsonb_each(node) LOOP
    IF member.key IN ('description','detailed_description','condition_description','upcast_description','name','name_en','label','text','flavor','notes','prompt','reason','narrative','image_url','support','references','referenced_by','source','idempotency_key') THEN CONTINUE; END IF;
    child_kind := entity_reference_field_kind(member.key);
    IF at_path='ai.action_weapon_ids' THEN
      RETURN QUERY SELECT 'action'::text,member.key,child_level,at_path || '.' || member.key;
      child_kind := 'card';
    END IF;
    IF at_path='resources' AND source_kind='class' THEN
      IF jsonb_typeof(member.value->'by_level')='object' THEN
        FOR growth IN SELECT key,value FROM jsonb_each(member.value->'by_level') LOOP
          IF growth.key ~ '^[0-9]{1,3}$' AND growth.value <> '0'::jsonb AND growth.value <> '"0"'::jsonb THEN
            RETURN QUERY SELECT 'resource'::text,member.key,growth.key::integer,at_path || '.' || member.key || '.by_level.' || growth.key;
          END IF;
        END LOOP;
      ELSE
        RETURN QUERY SELECT 'resource'::text,member.key,child_level,at_path || '.' || member.key;
      END IF;
    END IF;
    IF member.key IN ('id','entity_id','entityId','ref') THEN child_kind := object_kind; END IF;
    IF member.key IN ('value','values') AND object_kind IS NOT NULL AND object_kind NOT IN ('resource','variable') THEN child_kind := object_kind; END IF;
    IF member.key='value' AND object_kind IS NULL AND operation<>'' AND operation NOT IN ('modifier','damage','damage_rider','healing','reduce_damage','temp_hp','set_value','grant_ability_score','grant_speed','grant_sense') THEN CONTINUE; END IF;
    IF member.key IN ('items','options') AND object_kind IS NOT NULL THEN child_kind := object_kind; END IF;
    IF member.key IN ('filter','recommended','recommendations') AND jsonb_typeof(member.value)='array' AND object_kind IS NOT NULL THEN child_kind := object_kind; END IF;
    IF member.key = 'id' AND at_path = 'mechanics.condition' THEN child_kind := NULL; END IF;
    IF member.key = 'id' AND (node ? 'grants' OR (object_kind = 'effect' AND node ? 'value')) THEN child_kind := NULL; END IF;
    IF member.key IN ('includes','leaves') AND at_path = 'mechanics' THEN child_kind := 'effect'; END IF;
    IF member.key = 'level_source' AND jsonb_typeof(member.value) = 'string' AND member.value #>> '{}' NOT IN ('character','self_level','total') THEN child_kind := 'class'; END IF;
    IF member.key = 'key' AND at_path ~ '\.presentation$' THEN child_kind := 'passive'; END IF;
    IF member.key='card_number' AND operation='remove_effect' THEN child_kind := 'effect'; END IF;
    IF member.key='resource' AND member.value='"spell_slot"'::jsonb AND node->>'level' ~ '^[1-9]$' THEN
      RETURN QUERY SELECT 'resource'::text,'spell_slot_' || (node->>'level'),child_level,at_path || '.resource';
      CONTINUE;
    END IF;
    IF member.key = 'grant' AND jsonb_typeof(member.value) = 'string' THEN child_kind := NULL; END IF;
    IF at_path = 'level_progression' AND member.key ~ '^[0-9]{1,3}$' AND source_kind IN ('race','class') THEN
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '.' || member.key,member.key::integer,NULL);
    ELSE
      RETURN QUERY SELECT * FROM entity_reference_walk(member.value,source_kind,at_path || '.' || member.key,child_level,child_kind);
    END IF;
  END LOOP;
END $_$;


--
-- Name: invalidate_content_support(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.invalidate_content_support() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
		BEGIN
			IF TG_OP = 'INSERT' THEN
				NEW.support = jsonb_build_object('status', 'not_tested');
			ELSIF (to_jsonb(NEW) - ARRAY['support', 'updated_at', 'version', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[])
				IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['support', 'updated_at', 'version', 'author', 'condition_description', 'custom_rarity_color', 'description', 'description_font_size', 'detailed_description', 'detailed_description_alignment', 'detailed_description_font_size', 'image_cloudinary_id', 'image_cloudinary_url', 'image_generated', 'image_generation_prompt', 'image_url', 'name', 'name_en', 'rarity', 'show_detailed_description', 'source', 'text_alignment', 'text_font_size', 'upcast_description']::text[]) THEN
				NEW.support = jsonb_build_object('status', 'not_verified');
			ELSIF NEW.support IS DISTINCT FROM OLD.support
				AND COALESCE(NEW.support->>'status', '') NOT IN (
					'verified', 'verified_partial', 'not_verified', 'not_tested',
					'narrative', 'partial_narrative_verified', 'partial_narrative_not_verified',
					'partial_narrative_verified_partial'
				) THEN
				RAISE EXCEPTION 'Unknown manual content review status' USING ERRCODE = '23514';
			END IF;
			RETURN NEW;
		END;
		$$;


--
-- Name: prevent_character_system_change(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.prevent_character_system_change() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
		BEGIN
			IF NEW.system_id IS DISTINCT FROM OLD.system_id THEN
				RAISE EXCEPTION 'system_id существующего персонажа нельзя изменить'
					USING ERRCODE = 'check_violation';
			END IF;
			RETURN NEW;
		END;
		$$;


--
-- Name: protect_ruleset_release_artifact(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.protect_ruleset_release_artifact() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'ruleset_releases is retained; DELETE is not permitted'
			USING ERRCODE = '55000';
	END IF;
	IF ROW(
		NEW.system_id, NEW.ruleset_version, NEW.errata_version,
		NEW.manifest_schema_version, NEW.protocol_schema_version,
		NEW.artifact_version, NEW.serializer_version,
		NEW.rules_artifact_hash, NEW.content_hash, NEW.manifest_hash,
		NEW.manifest, NEW.manifest_canonical_bytes, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.system_id, OLD.ruleset_version, OLD.errata_version,
		OLD.manifest_schema_version, OLD.protocol_schema_version,
		OLD.artifact_version, OLD.serializer_version,
		OLD.rules_artifact_hash, OLD.content_hash, OLD.manifest_hash,
		OLD.manifest, OLD.manifest_canonical_bytes, OLD.created_at
	) THEN
		RAISE EXCEPTION 'immutable ruleset release artifact % cannot be changed', OLD.id
			USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;


--
-- Name: reject_canonical_runtime_append_only_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_canonical_runtime_append_only_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
		USING ERRCODE = '55000';
	RETURN OLD;
END;
$$;


--
-- Name: reject_character_runtime_command_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_character_runtime_command_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	RAISE EXCEPTION 'character runtime command receipts are append-only'
		USING ERRCODE = '55000';
END;
$$;


--
-- Name: reject_game_command_input_mutation(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reject_game_command_input_mutation() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
	IF ROW(
		NEW.session_id, NEW.command_id, NEW.semantic_command_id,
		NEW.ruleset_release_id, NEW.rules_artifact_hash,
		NEW.source_actor_id, NEW.controller_user_id, NEW.spatial_fact_set_id,
		NEW.command_type, NEW.expected_revision, NEW.base_snapshot_seq,
		NEW.base_state_hash, NEW.command_schema_version, NEW.serializer_version,
		NEW.canonical_body, NEW.canonical_bytes, NEW.request_hash,
		NEW.execution_input, NEW.execution_input_canonical_bytes,
		NEW.execution_input_hash, NEW.admitted_at
	) IS DISTINCT FROM ROW(
		OLD.session_id, OLD.command_id, OLD.semantic_command_id,
		OLD.ruleset_release_id, OLD.rules_artifact_hash,
		OLD.source_actor_id, OLD.controller_user_id, OLD.spatial_fact_set_id,
		OLD.command_type, OLD.expected_revision, OLD.base_snapshot_seq,
		OLD.base_state_hash, OLD.command_schema_version, OLD.serializer_version,
		OLD.canonical_body, OLD.canonical_bytes, OLD.request_hash,
		OLD.execution_input, OLD.execution_input_canonical_bytes,
		OLD.execution_input_hash, OLD.admitted_at
	) THEN
		RAISE EXCEPTION 'immutable input of game command %/% cannot be changed', OLD.session_id, OLD.command_id
			USING ERRCODE = '55000';
	END IF;
	IF OLD.result_hash IS NOT NULL AND ROW(
		NEW.result_body, NEW.result_canonical_bytes, NEW.result_hash
	) IS DISTINCT FROM ROW(
		OLD.result_body, OLD.result_canonical_bytes, OLD.result_hash
	) THEN
		RAISE EXCEPTION 'canonical result of game command %/% cannot be changed', OLD.session_id, OLD.command_id
			USING ERRCODE = '55000';
	END IF;
	IF OLD.committed_fencing_token IS NOT NULL
		AND NEW.committed_fencing_token IS DISTINCT FROM OLD.committed_fencing_token THEN
		RAISE EXCEPTION 'fencing token of game command %/% cannot be changed', OLD.session_id, OLD.command_id
			USING ERRCODE = '55000';
	END IF;
	RETURN NEW;
END;
$$;


--
-- Name: saved_item_card_ids(jsonb, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.saved_item_card_ids(equipment jsonb, inventory jsonb) RETURNS TABLE(card_id text)
    LANGUAGE sql IMMUTABLE
    AS $$
 SELECT value #>> '{}' FROM jsonb_each(CASE WHEN jsonb_typeof(equipment)='object' THEN equipment ELSE '{}'::jsonb END)
 WHERE key IN ('head','body','main_hand','off_hand','gloves','boots','cloak','necklace','ring_1','ring_2')
 AND jsonb_typeof(value)='string'
 UNION
 SELECT row->>'card_id' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(inventory)='array' THEN inventory ELSE '[]'::jsonb END) row
 WHERE jsonb_typeof(row->'card_id')='string' AND
 CASE WHEN jsonb_typeof(row->'qty')='number' THEN (row->>'qty')::numeric > 0 AND trunc((row->>'qty')::numeric)=(row->>'qty')::numeric ELSE false END
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
		BEGIN
			NEW.updated_at = CURRENT_TIMESTAMP;
			RETURN NEW;
		END;
		$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    detailed_description text,
    image_url text,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    rarity character varying(50) DEFAULT 'common'::character varying NOT NULL,
    card_number character varying(50) NOT NULL,
    resource text,
    recharge character varying(50),
    recharge_custom text,
    script jsonb,
    action_type character varying(50) NOT NULL,
    type character varying(50),
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255),
    legacy_tags text[],
    price integer,
    weight numeric(5,2),
    properties text[],
    related_cards text[],
    related_actions text[],
    is_extended boolean DEFAULT false,
    description_font_size integer,
    text_alignment character varying(20),
    text_font_size integer,
    show_detailed_description boolean DEFAULT false,
    detailed_description_alignment character varying(20),
    detailed_description_font_size integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    distance character varying(100),
    mechanics jsonb,
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb,
    CONSTRAINT actions_action_type_check CHECK (((action_type)::text = ANY (ARRAY[('base_action'::character varying)::text, ('class_feature'::character varying)::text, ('item_property'::character varying)::text, ('species_ability'::character varying)::text]))),
    CONSTRAINT actions_recharge_check CHECK (((recharge)::text = ANY (ARRAY[('custom'::character varying)::text, ('per_turn'::character varying)::text, ('per_battle'::character varying)::text, ('short_rest'::character varying)::text, ('long_rest'::character varying)::text])))
);


--
-- Name: animation_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.animation_profiles (
    key text NOT NULL,
    definition jsonb NOT NULL,
    CONSTRAINT animation_profiles_definition_check CHECK ((jsonb_typeof(definition) = 'object'::text))
);


--
-- Name: audio_cues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audio_cues (
    key text NOT NULL,
    name text NOT NULL,
    channel text NOT NULL,
    url text NOT NULL,
    gain double precision DEFAULT 1 NOT NULL,
    loop boolean DEFAULT false NOT NULL,
    license text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    CONSTRAINT audio_cues_channel_check CHECK ((channel = ANY (ARRAY['music'::text, 'effects'::text, 'ui'::text]))),
    CONSTRAINT audio_cues_gain_check CHECK (((gain >= (0)::double precision) AND (gain <= (1)::double precision)))
);


--
-- Name: backgrounds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.backgrounds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    detailed_description text,
    image_url text,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    rarity character varying(50) DEFAULT 'common'::character varying NOT NULL,
    card_number character varying(50) NOT NULL,
    ability_scores jsonb,
    origin_feat character varying(255),
    skill_proficiencies jsonb,
    tool_proficiency text,
    equipment text,
    type character varying(50),
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255),
    legacy_tags jsonb,
    is_extended boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    equipment_options jsonb,
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb
);


--
-- Name: cards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cards (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name character varying(255) NOT NULL,
    properties text,
    description text NOT NULL,
    image_url text,
    rarity character varying(50) NOT NULL,
    card_number character varying(20) NOT NULL,
    price numeric,
    weight numeric(5,2),
    bonus_type character varying(50),
    bonus_value character varying(20),
    damage_type character varying(20),
    defense_type character varying(20),
    description_font_size integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    is_extended boolean,
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255) DEFAULT 'Bag Of Holding'::character varying,
    type character varying(50),
    related_cards text,
    related_actions text,
    related_effects text,
    attunement text,
    legacy_tags text,
    is_template character varying(20) DEFAULT 'false'::character varying,
    detailed_description text,
    slot character varying(20),
    text_alignment character varying(20),
    text_font_size integer,
    detailed_description_alignment character varying(20),
    detailed_description_font_size integer,
    show_detailed_description boolean DEFAULT false,
    effects jsonb,
    weapon_type character varying(50),
    requires_attunement boolean DEFAULT false,
    range character varying(50),
    elemental_damage_value character varying(20),
    elemental_damage_type character varying(20),
    battle_profile jsonb,
    custom_rarity_color character varying(7),
    container_mode character varying(20),
    contents jsonb,
    price_currency character varying(20),
    price_abbreviated boolean DEFAULT true,
    mechanics jsonb,
    enchant_bonus integer,
    mastery character varying(64),
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb,
    CONSTRAINT cards_bonus_type_check CHECK (((bonus_type)::text = ANY (ARRAY[('damage'::character varying)::text, ('defense'::character varying)::text]))),
    CONSTRAINT cards_damage_type_check CHECK ((((damage_type)::text = ANY (ARRAY[('bludgeoning'::character varying)::text, ('piercing'::character varying)::text, ('slashing'::character varying)::text, ('acid'::character varying)::text, ('cold'::character varying)::text, ('fire'::character varying)::text, ('force'::character varying)::text, ('lightning'::character varying)::text, ('necrotic'::character varying)::text, ('poison'::character varying)::text, ('psychic'::character varying)::text, ('radiant'::character varying)::text, ('thunder'::character varying)::text])) OR (damage_type IS NULL))),
    CONSTRAINT cards_defense_type_check CHECK (((defense_type)::text = ANY (ARRAY[('cloth'::character varying)::text, ('light'::character varying)::text, ('medium'::character varying)::text, ('heavy'::character varying)::text]))),
    CONSTRAINT cards_description_font_size_check CHECK (((description_font_size >= 6) AND (description_font_size <= 20))),
    CONSTRAINT cards_detailed_description_alignment_check CHECK (((detailed_description_alignment)::text = ANY (ARRAY[('left'::character varying)::text, ('center'::character varying)::text, ('right'::character varying)::text]))),
    CONSTRAINT cards_detailed_description_font_size_check CHECK (((detailed_description_font_size >= 8) AND (detailed_description_font_size <= 24))),
    CONSTRAINT cards_is_template_check CHECK (((is_template)::text = ANY (ARRAY[('false'::character varying)::text, ('template'::character varying)::text, ('only_template'::character varying)::text]))),
    CONSTRAINT cards_price_check CHECK (((price IS NULL) OR ((price > (0)::numeric) AND (price <= (1000000)::numeric)))),
    CONSTRAINT cards_rarity_check CHECK (((rarity)::text = ANY (ARRAY[('common'::character varying)::text, ('uncommon'::character varying)::text, ('rare'::character varying)::text, ('very_rare'::character varying)::text, ('artifact'::character varying)::text, ('relic'::character varying)::text, ('custom'::character varying)::text]))),
    CONSTRAINT cards_slot_check CHECK ((((slot)::text = ANY (ARRAY[('head'::character varying)::text, ('body'::character varying)::text, ('arms'::character varying)::text, ('feet'::character varying)::text, ('cloak'::character varying)::text, ('one_hand'::character varying)::text, ('versatile'::character varying)::text, ('two_hands'::character varying)::text, ('necklace'::character varying)::text, ('ring'::character varying)::text])) OR (slot IS NULL))),
    CONSTRAINT cards_text_alignment_check CHECK ((((text_alignment)::text = ANY (ARRAY[('left'::character varying)::text, ('center'::character varying)::text, ('right'::character varying)::text])) OR (text_alignment IS NULL))),
    CONSTRAINT cards_text_font_size_check CHECK (((text_font_size >= 8) AND (text_font_size <= 24))),
    CONSTRAINT cards_weight_check CHECK (((weight >= 0.01) AND (weight <= (1000)::numeric)))
);


--
-- Name: catalog_mechanics_278_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_mechanics_278_archive (
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    audit_id text NOT NULL,
    before_fields jsonb,
    before_support jsonb,
    patch jsonb NOT NULL,
    review jsonb NOT NULL,
    inserted boolean NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_mechanics_278_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_mechanics_278_transition (
    version text NOT NULL,
    manifest_sha256 text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_mechanics_279_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_mechanics_279_archive (
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    audit_id text NOT NULL,
    before_fields jsonb,
    before_support jsonb,
    patch jsonb NOT NULL,
    review jsonb NOT NULL,
    inserted boolean NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_mechanics_279_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_mechanics_279_transition (
    version text NOT NULL,
    manifest_sha256 text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_mechanics_280_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_mechanics_280_archive (
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    audit_id text NOT NULL,
    before_fields jsonb,
    before_support jsonb,
    patch jsonb NOT NULL,
    review jsonb NOT NULL,
    inserted boolean NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: catalog_mechanics_280_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catalog_mechanics_280_transition (
    version text NOT NULL,
    manifest_sha256 text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: character_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    character_id uuid NOT NULL,
    ts timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    type character varying(64) NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    client_event_id uuid
);


--
-- Name: character_runtime_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_runtime_commands (
    user_id uuid NOT NULL,
    command_id uuid NOT NULL,
    request_hash character varying(71) NOT NULL,
    ruleset_ref jsonb NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_character_runtime_commands_request_hash CHECK (((request_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_character_runtime_commands_response CHECK ((jsonb_typeof(response) = 'object'::text)),
    CONSTRAINT ck_character_runtime_commands_ruleset_ref CHECK ((jsonb_typeof(ruleset_ref) = 'object'::text))
);


--
-- Name: character_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.character_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    preset_key character varying(80),
    "character" jsonb NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT character_templates_character_check CHECK (((jsonb_typeof("character") = 'object'::text) AND (NOT ("character" ?| ARRAY['id'::text, 'user_id'::text, 'user'::text, 'group_id'::text, 'group'::text, 'current_encounter_id'::text, 'access_mode'::text, 'runtime_revision'::text])))),
    CONSTRAINT character_templates_name_check CHECK ((length(TRIM(BOTH FROM name)) > 0)),
    CONSTRAINT character_templates_version_check CHECK ((version > 0))
);


--
-- Name: characters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    group_id uuid,
    name character varying(100) NOT NULL,
    data text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    weapon_proficiencies jsonb,
    damage_resistances jsonb,
    language_proficiencies jsonb,
    armor_proficiencies jsonb
);


--
-- Name: characters_v2; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters_v2 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    group_id uuid,
    name character varying(255) NOT NULL,
    race character varying(100) NOT NULL,
    class character varying(100) NOT NULL,
    level integer DEFAULT 1 NOT NULL,
    speed integer DEFAULT 30 NOT NULL,
    strength integer DEFAULT 10 NOT NULL,
    dexterity integer DEFAULT 10 NOT NULL,
    constitution integer DEFAULT 10 NOT NULL,
    intelligence integer DEFAULT 10 NOT NULL,
    wisdom integer DEFAULT 10 NOT NULL,
    charisma integer DEFAULT 10 NOT NULL,
    max_hp integer DEFAULT 1 NOT NULL,
    current_hp integer DEFAULT 1 NOT NULL,
    saving_throw_proficiencies text,
    skill_proficiencies text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    active_effects jsonb DEFAULT '[]'::jsonb,
    resources jsonb DEFAULT '{}'::jsonb,
    max_resources jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT characters_v2_charisma_check CHECK (((charisma >= 1) AND (charisma <= 30))),
    CONSTRAINT characters_v2_constitution_check CHECK (((constitution >= 1) AND (constitution <= 30))),
    CONSTRAINT characters_v2_current_hp_check CHECK ((current_hp >= 0)),
    CONSTRAINT characters_v2_dexterity_check CHECK (((dexterity >= 1) AND (dexterity <= 30))),
    CONSTRAINT characters_v2_intelligence_check CHECK (((intelligence >= 1) AND (intelligence <= 30))),
    CONSTRAINT characters_v2_level_check CHECK (((level >= 1) AND (level <= 20))),
    CONSTRAINT characters_v2_max_hp_check CHECK ((max_hp >= 1)),
    CONSTRAINT characters_v2_speed_check CHECK ((speed >= 1)),
    CONSTRAINT characters_v2_strength_check CHECK (((strength >= 1) AND (strength <= 30))),
    CONSTRAINT characters_v2_wisdom_check CHECK (((wisdom >= 1) AND (wisdom <= 30)))
);


--
-- Name: characters_v3; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.characters_v3 (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    group_id uuid,
    name character varying(255) NOT NULL,
    avatar_url text,
    race_id uuid,
    lineage_id character varying(100),
    class_id uuid,
    background_id uuid,
    level integer DEFAULT 1 NOT NULL,
    feat_ids jsonb,
    spell_ids jsonb,
    abilities jsonb,
    skill_proficiencies jsonb,
    saving_throw_proficiencies jsonb,
    tool_proficiencies jsonb,
    languages jsonb,
    resolved_choices jsonb,
    max_hp integer DEFAULT 0,
    current_hp integer DEFAULT 0,
    speed integer DEFAULT 30,
    proficiency_bonus integer DEFAULT 2,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    skill_expertise jsonb,
    tool_expertise jsonb,
    rule_state jsonb,
    armor_class integer DEFAULT 10,
    initiative_bonus integer DEFAULT 0,
    passive_perception integer DEFAULT 10,
    equipment jsonb DEFAULT '{}'::jsonb,
    inventory_items jsonb DEFAULT '[]'::jsonb,
    resources jsonb DEFAULT '{}'::jsonb,
    max_resources jsonb DEFAULT '{}'::jsonb,
    active_effects jsonb DEFAULT '[]'::jsonb,
    turn_state jsonb DEFAULT '{}'::jsonb,
    currency jsonb DEFAULT '{}'::jsonb,
    current_encounter_id uuid,
    description text DEFAULT ''::text NOT NULL,
    notes text DEFAULT ''::text NOT NULL,
    action_ids jsonb DEFAULT '[]'::jsonb,
    effect_ids jsonb DEFAULT '[]'::jsonb,
    resource_ids jsonb DEFAULT '[]'::jsonb,
    system_id character varying(100) DEFAULT 'dnd5e-2024'::character varying NOT NULL,
    ruleset_version character varying(100) DEFAULT '2024'::character varying NOT NULL,
    character_type character varying(30) DEFAULT 'free'::character varying NOT NULL,
    character_schema_version integer DEFAULT 1 NOT NULL,
    runtime_revision bigint DEFAULT 0 NOT NULL,
    class_levels jsonb DEFAULT '{}'::jsonb NOT NULL,
    subclass_ids jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_template_id uuid,
    CONSTRAINT characters_v3_character_type_check CHECK (((character_type)::text = ANY (ARRAY[('free'::character varying)::text, ('campaign'::character varying)::text, ('dungeon_crawl'::character varying)::text])))
);


--
-- Name: classes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.classes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    detailed_description text,
    image_url text,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    rarity character varying(50) DEFAULT 'common'::character varying NOT NULL,
    card_number character varying(50) NOT NULL,
    hit_die character varying(20),
    primary_abilities jsonb,
    saving_throws jsonb,
    armor_training jsonb,
    weapon_proficiencies jsonb,
    tool_proficiencies jsonb,
    skill_choices jsonb,
    starting_equipment jsonb,
    level_progression jsonb,
    resources jsonb,
    type character varying(50),
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255),
    legacy_tags jsonb,
    is_extended boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    recommended_abilities jsonb,
    is_subclass boolean DEFAULT false,
    parent_class_id uuid,
    subclass_level integer DEFAULT 3,
    related_effects jsonb,
    related_actions jsonb,
    equipment_options jsonb,
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb,
    multiclass_proficiencies jsonb
);


--
-- Name: combat_spell_repairs_293_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combat_spell_repairs_293_archive (
    entity_id uuid NOT NULL,
    card_number text NOT NULL,
    name text NOT NULL,
    before_row jsonb NOT NULL,
    before_mechanics jsonb,
    before_support jsonb,
    after_mechanics jsonb NOT NULL,
    expected_before text NOT NULL,
    expected_after text NOT NULL,
    changed boolean NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: combat_spell_repairs_293_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.combat_spell_repairs_293_transition (
    version text NOT NULL,
    manifest_hash text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: command_execution_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.command_execution_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    command_id uuid NOT NULL,
    status character varying(30) DEFAULT 'queued'::character varying NOT NULL,
    lease_owner character varying(255),
    lease_acquired_at timestamp with time zone,
    lease_until timestamp with time zone,
    heartbeat_at timestamp with time zone,
    fencing_token bigint DEFAULT 0 NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 5 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_error_code character varying(100),
    last_error_details jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT ck_command_execution_jobs_attempts CHECK (((attempt_count >= 0) AND (max_attempts > 0) AND (attempt_count <= max_attempts))),
    CONSTRAINT ck_command_execution_jobs_fencing CHECK ((fencing_token >= 0)),
    CONSTRAINT ck_command_execution_jobs_lease CHECK ((((status)::text <> 'leased'::text) OR ((lease_owner IS NOT NULL) AND (lease_acquired_at IS NOT NULL) AND (heartbeat_at IS NOT NULL) AND (lease_until IS NOT NULL) AND (fencing_token > 0) AND (lease_until > heartbeat_at)))),
    CONSTRAINT ck_command_execution_jobs_status CHECK (((status)::text = ANY (ARRAY[('queued'::character varying)::text, ('leased'::character varying)::text, ('retry_wait'::character varying)::text, ('succeeded'::character varying)::text, ('dead_letter'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: concepts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.concepts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    concept_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    image_url text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    name_en character varying(255),
    author character varying(255) DEFAULT 'Admin'::character varying NOT NULL,
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb
);


--
-- Name: content_certification_revocations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_certification_revocations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    card_number text NOT NULL,
    prior_support jsonb NOT NULL,
    prior_mechanics jsonb NOT NULL,
    reason text NOT NULL,
    migration_version text NOT NULL,
    revoked_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: content_choice_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_choice_recommendations (
    entity_type character varying(32) NOT NULL,
    entity_reference character varying(255) NOT NULL,
    choice_id character varying(255) NOT NULL,
    recommended_options jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_content_choice_recommendations_entity_type CHECK (((entity_type)::text = ANY (ARRAY[('class'::character varying)::text, ('effect'::character varying)::text]))),
    CONSTRAINT ck_content_choice_recommendations_options CHECK (((jsonb_typeof(recommended_options) = 'array'::text) AND (jsonb_array_length(recommended_options) > 0)))
);


--
-- Name: content_migration_create_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_migration_create_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bundle_id uuid NOT NULL,
    plan_hash character varying(71) NOT NULL,
    operation_id character varying(255) NOT NULL,
    entity_type character varying(20) NOT NULL,
    entity_id uuid NOT NULL,
    card_number character varying(255) NOT NULL,
    postimage_hash character varying(71) NOT NULL,
    postimage jsonb NOT NULL,
    created_by_user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    rolled_back_at timestamp with time zone,
    rolled_back_by_user_id uuid,
    CONSTRAINT ck_content_migration_receipts_card_number CHECK ((btrim((card_number)::text) <> ''::text)),
    CONSTRAINT ck_content_migration_receipts_entity_type CHECK (((entity_type)::text = 'effect'::text)),
    CONSTRAINT ck_content_migration_receipts_lifecycle CHECK (((((status)::text = 'active'::text) AND (rolled_back_at IS NULL) AND (rolled_back_by_user_id IS NULL)) OR (((status)::text = 'rolled_back'::text) AND (rolled_back_at IS NOT NULL) AND (rolled_back_by_user_id IS NOT NULL)))),
    CONSTRAINT ck_content_migration_receipts_operation_id CHECK ((btrim((operation_id)::text) <> ''::text)),
    CONSTRAINT ck_content_migration_receipts_plan_hash CHECK (((plan_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_content_migration_receipts_postimage CHECK ((jsonb_typeof(postimage) = 'object'::text)),
    CONSTRAINT ck_content_migration_receipts_postimage_hash CHECK (((postimage_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_content_migration_receipts_status CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('rolled_back'::character varying)::text])))
);


--
-- Name: content_review_support_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_review_support_archive (
    entity_table text NOT NULL,
    entity_id text NOT NULL,
    support jsonb,
    archived_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    migration_version text NOT NULL
);


--
-- Name: content_review_transitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.content_review_transitions (
    migration_version text NOT NULL,
    completed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


--
-- Name: decision_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.decision_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    request_id character varying(128) NOT NULL,
    resolution_id character varying(128) NOT NULL,
    source_command_id uuid NOT NULL,
    resolved_by_command_id uuid,
    ruleset_release_id uuid NOT NULL,
    rules_artifact_hash character varying(71) NOT NULL,
    deciding_actor_id uuid,
    assigned_controller_user_id uuid NOT NULL,
    status character varying(20) DEFAULT 'open'::character varying NOT NULL,
    opened_seq bigint NOT NULL,
    expected_revision bigint NOT NULL,
    projection_seq bigint NOT NULL,
    request_schema_version integer NOT NULL,
    serializer_version character varying(100) NOT NULL,
    request_body jsonb NOT NULL,
    canonical_bytes bytea NOT NULL,
    request_hash character varying(71) NOT NULL,
    deadline jsonb,
    default_decision jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    resolved_at timestamp with time zone,
    CONSTRAINT ck_decision_requests_body_object CHECK ((jsonb_typeof(request_body) = 'object'::text)),
    CONSTRAINT ck_decision_requests_bytes CHECK ((octet_length(canonical_bytes) > 0)),
    CONSTRAINT ck_decision_requests_distinct_ids CHECK (((request_id)::text <> (resolution_id)::text)),
    CONSTRAINT ck_decision_requests_expected_revision CHECK ((expected_revision >= 0)),
    CONSTRAINT ck_decision_requests_hash CHECK (((request_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_decision_requests_opened_seq CHECK ((opened_seq >= 0)),
    CONSTRAINT ck_decision_requests_projection_seq CHECK ((projection_seq >= opened_seq)),
    CONSTRAINT ck_decision_requests_request_id CHECK ((((request_id)::text = btrim((request_id)::text)) AND ((request_id)::text <> ''::text) AND (octet_length((request_id)::text) <= 128))),
    CONSTRAINT ck_decision_requests_resolution CHECK ((((status)::text = 'resolved'::text) = ((resolved_by_command_id IS NOT NULL) AND (resolved_at IS NOT NULL)))),
    CONSTRAINT ck_decision_requests_resolution_id CHECK ((((resolution_id)::text = btrim((resolution_id)::text)) AND ((resolution_id)::text <> ''::text) AND (octet_length((resolution_id)::text) <= 128))),
    CONSTRAINT ck_decision_requests_schema CHECK ((request_schema_version = 1)),
    CONSTRAINT ck_decision_requests_status CHECK (((status)::text = ANY (ARRAY[('open'::character varying)::text, ('resolved'::character varying)::text, ('expired'::character varying)::text, ('cancelled'::character varying)::text])))
);


--
-- Name: effect_classification_278_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.effect_classification_278_audit (
    effect_id uuid NOT NULL,
    card_number text NOT NULL,
    previous_type text NOT NULL,
    classified_type text NOT NULL,
    previous_support jsonb,
    protected_fingerprint text NOT NULL,
    decision_reason text NOT NULL,
    manifest_sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: effect_classification_278_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.effect_classification_278_runs (
    id integer NOT NULL,
    manifest_sha256 text NOT NULL,
    reviewed_count integer NOT NULL,
    matched_count integer NOT NULL,
    changed_count integer NOT NULL,
    skipped_count integer NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT effect_classification_278_runs_id_check CHECK ((id = 1))
);


--
-- Name: effect_classification_285_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.effect_classification_285_audit (
    effect_id uuid NOT NULL,
    card_number text NOT NULL,
    previous_type text NOT NULL,
    classified_type text NOT NULL,
    previous_support jsonb,
    protected_fingerprint text NOT NULL,
    decision_reason text NOT NULL,
    manifest_sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: effect_classification_285_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.effect_classification_285_runs (
    id integer NOT NULL,
    manifest_sha256 text NOT NULL,
    reviewed_count integer NOT NULL,
    matched_count integer NOT NULL,
    changed_count integer NOT NULL,
    skipped_count integer NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT effect_classification_285_runs_id_check CHECK ((id = 1))
);


--
-- Name: effects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.effects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    detailed_description text,
    image_url text,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    rarity character varying(50) DEFAULT 'common'::character varying NOT NULL,
    card_number character varying(50) NOT NULL,
    effect_type character varying(50) NOT NULL,
    condition_description text,
    script jsonb,
    type character varying(50),
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255),
    legacy_tags text[],
    price integer,
    weight numeric(5,2),
    properties text[],
    related_cards text[],
    related_actions text[],
    related_effects text[],
    is_extended boolean DEFAULT false,
    description_font_size integer,
    text_alignment character varying(20),
    text_font_size integer,
    show_detailed_description boolean DEFAULT false,
    detailed_description_alignment character varying(20),
    detailed_description_font_size integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    mechanics jsonb,
    repeatable boolean DEFAULT false,
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb,
    CONSTRAINT effects_effect_type_check CHECK (((effect_type)::text = ANY (ARRAY[('passive'::character varying)::text, ('conditional'::character varying)::text, ('triggered'::character varying)::text, ('species_ability'::character varying)::text, ('class_ability'::character varying)::text, ('feat_ability'::character varying)::text, ('item_effect'::character varying)::text, ('spell_effect'::character varying)::text, ('negative_effect'::character varying)::text, ('positive_effect'::character varying)::text, ('condition'::character varying)::text, ('eldritch_invocation'::character varying)::text, ('fighting_style'::character varying)::text, ('maneuver_variant'::character varying)::text, ('weapon_mastery'::character varying)::text, ('run_aura'::character varying)::text])))
);


--
-- Name: encounter_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encounter_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    encounter_id uuid NOT NULL,
    seq bigint NOT NULL,
    payload jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: encounters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.encounters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) DEFAULT 'Бой'::character varying NOT NULL,
    owner_user_id uuid NOT NULL,
    member_user_ids jsonb,
    state jsonb,
    seq bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: entity_animation_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_animation_bindings (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    profile_key text NOT NULL,
    CONSTRAINT entity_animation_bindings_entity_type_check CHECK ((entity_type = ANY (ARRAY['spell'::text, 'action'::text, 'card'::text, 'effect'::text])))
);


--
-- Name: entity_audio_bindings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_audio_bindings (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    event text NOT NULL,
    cue_key text NOT NULL,
    CONSTRAINT entity_audio_bindings_event_check CHECK ((event = ANY (ARRAY['cast'::text, 'charge'::text, 'launch'::text, 'hit'::text, 'miss'::text, 'healing'::text, 'activate'::text])))
);


--
-- Name: entity_reference_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_reference_edges (
    source_type text NOT NULL,
    source_id text NOT NULL,
    target_type text NOT NULL,
    target_key text NOT NULL,
    level integer DEFAULT 0 NOT NULL,
    path text NOT NULL
);


--
-- Name: entity_reference_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_reference_nodes (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    stable_aliases text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: entity_reference_resolved_edges; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.entity_reference_resolved_edges AS
 SELECT e.source_type,
    e.source_id,
    COALESCE(t.entity_type, e.target_type) AS target_type,
    COALESCE(t.entity_id, e.target_key) AS target_id,
    COALESCE(t.name, e.target_key) AS target_name,
    (t.entity_id IS NULL) AS missing,
    e.level,
    e.path
   FROM (public.entity_reference_edges e
     LEFT JOIN LATERAL public.entity_reference_targets(e.target_type, e.target_key) t(entity_type, entity_id, name) ON (true))
  WHERE ((t.entity_id IS NOT NULL) OR (("left"(e.target_type, 1) <> '$'::text) AND (e.target_type <> '*'::text)));


--
-- Name: entity_tag_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_tag_assignments (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    tag_id uuid NOT NULL
);


--
-- Name: entity_tag_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entity_tag_definitions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    CONSTRAINT entity_tag_definitions_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80)))
);


--
-- Name: feats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feats (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    detailed_description text,
    image_url text,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    rarity character varying(50) DEFAULT 'common'::character varying NOT NULL,
    card_number character varying(50) NOT NULL,
    category character varying(50) DEFAULT 'general'::character varying NOT NULL,
    prerequisite text,
    ability_increase jsonb,
    repeatable boolean DEFAULT false,
    type character varying(50),
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255),
    legacy_tags jsonb,
    is_extended boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    related_effects jsonb,
    related_actions jsonb,
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb
);


--
-- Name: game_commands; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_commands (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    command_id uuid NOT NULL,
    semantic_command_id character varying(128) NOT NULL,
    ruleset_release_id uuid NOT NULL,
    rules_artifact_hash character varying(71) NOT NULL,
    source_actor_id uuid,
    controller_user_id uuid NOT NULL,
    spatial_fact_set_id uuid,
    command_type character varying(100) NOT NULL,
    status character varying(30) DEFAULT 'admitted'::character varying NOT NULL,
    expected_revision bigint NOT NULL,
    base_snapshot_seq bigint NOT NULL,
    base_state_hash character varying(71) NOT NULL,
    command_schema_version integer NOT NULL,
    serializer_version character varying(100) NOT NULL,
    canonical_body jsonb NOT NULL,
    canonical_bytes bytea NOT NULL,
    request_hash character varying(71) NOT NULL,
    execution_input jsonb NOT NULL,
    execution_input_canonical_bytes bytea NOT NULL,
    execution_input_hash character varying(71) NOT NULL,
    result_body jsonb,
    result_canonical_bytes bytea,
    result_hash character varying(71),
    rejection_code character varying(100),
    committed_fencing_token bigint,
    admitted_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_game_commands_base_snapshot_seq CHECK ((base_snapshot_seq >= 0)),
    CONSTRAINT ck_game_commands_base_state_hash CHECK (((base_state_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_commands_body_object CHECK ((jsonb_typeof(canonical_body) = 'object'::text)),
    CONSTRAINT ck_game_commands_bytes CHECK ((octet_length(canonical_bytes) > 0)),
    CONSTRAINT ck_game_commands_committed_fencing CHECK ((((status)::text <> 'committed'::text) OR (committed_fencing_token IS NOT NULL))),
    CONSTRAINT ck_game_commands_execution_input_bytes CHECK ((octet_length(execution_input_canonical_bytes) > 0)),
    CONSTRAINT ck_game_commands_execution_input_hash CHECK (((execution_input_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_commands_execution_input_object CHECK ((jsonb_typeof(execution_input) = 'object'::text)),
    CONSTRAINT ck_game_commands_expected_revision CHECK ((expected_revision >= 0)),
    CONSTRAINT ck_game_commands_fencing_token CHECK (((committed_fencing_token IS NULL) OR (committed_fencing_token > 0))),
    CONSTRAINT ck_game_commands_request_hash CHECK (((request_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_commands_result_bytes CHECK (((result_canonical_bytes IS NULL) OR (octet_length(result_canonical_bytes) > 0))),
    CONSTRAINT ck_game_commands_result_hash CHECK (((result_hash IS NULL) OR ((result_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_game_commands_result_pair CHECK ((((result_body IS NULL) = (result_canonical_bytes IS NULL)) AND ((result_body IS NULL) = (result_hash IS NULL)))),
    CONSTRAINT ck_game_commands_schema CHECK ((command_schema_version > 0)),
    CONSTRAINT ck_game_commands_semantic_id CHECK ((((semantic_command_id)::text = btrim((semantic_command_id)::text)) AND ((semantic_command_id)::text <> ''::text) AND (octet_length((semantic_command_id)::text) <= 128))),
    CONSTRAINT ck_game_commands_status CHECK (((status)::text = ANY (ARRAY[('admitted'::character varying)::text, ('executing'::character varying)::text, ('awaiting_decision'::character varying)::text, ('committed'::character varying)::text, ('rejected'::character varying)::text, ('stale'::character varying)::text, ('failed'::character varying)::text, ('dead_letter'::character varying)::text])))
);


--
-- Name: game_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    seq bigint NOT NULL,
    command_id uuid NOT NULL,
    event_index integer NOT NULL,
    command_fencing_token bigint NOT NULL,
    ruleset_release_id uuid NOT NULL,
    rules_artifact_hash character varying(71) NOT NULL,
    source_actor_id uuid,
    target_actor_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    event_type character varying(100) NOT NULL,
    event_schema_version integer NOT NULL,
    serializer_version character varying(100) NOT NULL,
    logical_time bigint NOT NULL,
    payload jsonb NOT NULL,
    canonical_bytes bytea NOT NULL,
    event_hash character varying(71) NOT NULL,
    state_hash_before character varying(71) NOT NULL,
    state_hash_after character varying(71) NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_game_events_bytes CHECK ((octet_length(canonical_bytes) > 0)),
    CONSTRAINT ck_game_events_event_hash CHECK (((event_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_events_event_index CHECK ((event_index >= 0)),
    CONSTRAINT ck_game_events_fencing CHECK ((command_fencing_token > 0)),
    CONSTRAINT ck_game_events_logical_time CHECK ((logical_time >= 0)),
    CONSTRAINT ck_game_events_payload_object CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT ck_game_events_schema CHECK ((event_schema_version > 0)),
    CONSTRAINT ck_game_events_seq CHECK ((seq > 0)),
    CONSTRAINT ck_game_events_state_hash_after CHECK (((state_hash_after)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_events_state_hash_before CHECK (((state_hash_before)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_events_targets_array CHECK ((jsonb_typeof(target_actor_ids) = 'array'::text))
);


--
-- Name: game_session_actors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_session_actors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    ruleset_release_id uuid NOT NULL,
    rules_artifact_hash character varying(71) NOT NULL,
    character_id uuid,
    owner_user_id uuid,
    controller_user_id uuid,
    actor_kind character varying(30) NOT NULL,
    lifecycle_status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    build_snapshot jsonb NOT NULL,
    build_canonical_bytes bytea NOT NULL,
    build_hash character varying(71) NOT NULL,
    state_projection jsonb NOT NULL,
    state_hash character varying(71) NOT NULL,
    projection_schema_version integer NOT NULL,
    projection_seq bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_game_session_actors_build_bytes CHECK ((octet_length(build_canonical_bytes) > 0)),
    CONSTRAINT ck_game_session_actors_build_hash CHECK (((build_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_session_actors_build_object CHECK ((jsonb_typeof(build_snapshot) = 'object'::text)),
    CONSTRAINT ck_game_session_actors_kind CHECK (((actor_kind)::text = ANY (ARRAY[('player_character'::character varying)::text, ('npc'::character varying)::text, ('summoned_actor'::character varying)::text, ('external_actor'::character varying)::text, ('world_object'::character varying)::text]))),
    CONSTRAINT ck_game_session_actors_projection_schema CHECK ((projection_schema_version > 0)),
    CONSTRAINT ck_game_session_actors_projection_seq CHECK ((projection_seq >= 0)),
    CONSTRAINT ck_game_session_actors_state_hash CHECK (((state_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_session_actors_state_object CHECK ((jsonb_typeof(state_projection) = 'object'::text)),
    CONSTRAINT ck_game_session_actors_status CHECK (((lifecycle_status)::text = ANY (ARRAY[('active'::character varying)::text, ('inactive'::character varying)::text, ('removed'::character varying)::text])))
);


--
-- Name: game_session_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_session_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    can_control_unowned_actors boolean DEFAULT false NOT NULL,
    joined_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT ck_game_session_members_elevated_role CHECK (((NOT can_control_unowned_actors) OR ((role)::text = ANY (ARRAY[('owner'::character varying)::text, ('gm'::character varying)::text])))),
    CONSTRAINT ck_game_session_members_lifecycle CHECK ((((status)::text = 'active'::text) = (ended_at IS NULL))),
    CONSTRAINT ck_game_session_members_role CHECK (((role)::text = ANY (ARRAY[('owner'::character varying)::text, ('gm'::character varying)::text, ('player'::character varying)::text, ('observer'::character varying)::text]))),
    CONSTRAINT ck_game_session_members_status CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('left'::character varying)::text, ('revoked'::character varying)::text])))
);


--
-- Name: game_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.game_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ruleset_release_id uuid NOT NULL,
    rules_artifact_hash character varying(71) NOT NULL,
    created_by_user_id uuid NOT NULL,
    mode character varying(20) DEFAULT 'exploration'::character varying NOT NULL,
    authority_mode character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    current_snapshot jsonb NOT NULL,
    snapshot_canonical_bytes bytea NOT NULL,
    snapshot_schema_version integer NOT NULL,
    serializer_version character varying(100) NOT NULL,
    snapshot_seq bigint DEFAULT 0 NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    state_hash character varying(71) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    closed_at timestamp with time zone,
    CONSTRAINT ck_game_sessions_authority CHECK (((authority_mode)::text = ANY (ARRAY[('local'::character varying)::text, ('server'::character varying)::text, ('legacy_shadow'::character varying)::text]))),
    CONSTRAINT ck_game_sessions_closed_at CHECK ((((status)::text = 'closed'::text) = (closed_at IS NOT NULL))),
    CONSTRAINT ck_game_sessions_mode CHECK (((mode)::text = ANY (ARRAY[('exploration'::character varying)::text, ('encounter'::character varying)::text]))),
    CONSTRAINT ck_game_sessions_revision CHECK ((revision >= 0)),
    CONSTRAINT ck_game_sessions_serializer CHECK ((btrim((serializer_version)::text) <> ''::text)),
    CONSTRAINT ck_game_sessions_snapshot_bytes CHECK ((octet_length(snapshot_canonical_bytes) > 0)),
    CONSTRAINT ck_game_sessions_snapshot_object CHECK ((jsonb_typeof(current_snapshot) = 'object'::text)),
    CONSTRAINT ck_game_sessions_snapshot_schema CHECK ((snapshot_schema_version > 0)),
    CONSTRAINT ck_game_sessions_snapshot_seq CHECK ((snapshot_seq >= 0)),
    CONSTRAINT ck_game_sessions_state_hash CHECK (((state_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_game_sessions_status CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('frozen'::character varying)::text, ('closed'::character varying)::text])))
);


--
-- Name: generic_spell_freeuses_297_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generic_spell_freeuses_297_archive (
    entity_table text NOT NULL,
    entity_id uuid NOT NULL,
    before_row jsonb NOT NULL,
    after_mechanics jsonb NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: generic_spell_freeuses_297_resource_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generic_spell_freeuses_297_resource_archive (
    resource_id text NOT NULL,
    before_row jsonb NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: generic_spell_freeuses_297_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generic_spell_freeuses_297_transition (
    version text NOT NULL,
    manifest_hash text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: group_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.group_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT group_members_role_check CHECK (((role)::text = ANY (ARRAY[('dm'::character varying)::text, ('player'::character varying)::text])))
);


--
-- Name: groups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(100) NOT NULL,
    description text,
    dm_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone
);


--
-- Name: image_generation_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_generation_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    entity_type character varying(50) NOT NULL,
    entity_id uuid NOT NULL,
    cloudinary_id character varying(255) NOT NULL,
    cloudinary_url text NOT NULL,
    generation_prompt text,
    generation_model character varying(100),
    generation_time_ms integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: image_library; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.image_library (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cloudinary_id character varying(255) NOT NULL,
    cloudinary_url text NOT NULL,
    original_name character varying(255),
    file_size integer,
    card_name character varying(255),
    card_rarity character varying(50),
    generation_prompt text,
    generation_model character varying(100),
    generation_time_ms integer,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    item_type character varying(50),
    weapon_type character varying(50),
    armor_type character varying(50),
    slot character varying(20)
);


--
-- Name: inventories; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventories (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type character varying(20) NOT NULL,
    user_id uuid,
    group_id uuid,
    name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    character_id uuid,
    CONSTRAINT inventories_check CHECK (((((type)::text = 'personal'::text) AND (user_id IS NOT NULL) AND (group_id IS NULL)) OR (((type)::text = 'group'::text) AND (user_id IS NULL) AND (group_id IS NOT NULL)) OR (((type)::text = 'character'::text) AND (character_id IS NOT NULL)))),
    CONSTRAINT inventories_type_check CHECK (((type)::text = ANY (ARRAY[('personal'::character varying)::text, ('group'::character varying)::text, ('character'::character varying)::text])))
);


--
-- Name: inventory_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inventory_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inventory_id uuid NOT NULL,
    card_id uuid NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    is_equipped boolean DEFAULT false NOT NULL,
    equipped_slot character varying(50),
    CONSTRAINT inventory_items_quantity_check CHECK ((quantity >= 0))
);


--
-- Name: item_source_classification_262_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_source_classification_262_audit (
    card_id uuid NOT NULL,
    card_number text NOT NULL,
    previous_source text,
    classified_source text NOT NULL,
    rule_id text NOT NULL,
    canonical text NOT NULL,
    decision text NOT NULL,
    reason text NOT NULL,
    rules_fingerprint text NOT NULL,
    catalog_sha256 text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: item_source_classification_262_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.item_source_classification_262_runs (
    id integer NOT NULL,
    catalog_sha256 text NOT NULL,
    active_count integer NOT NULL,
    ph_count integer NOT NULL,
    review_count integer NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT item_source_classification_262_runs_id_check CHECK ((id = 1))
);


--
-- Name: legacy_entity_tags_258; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.legacy_entity_tags_258 (
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    tags jsonb NOT NULL
);


--
-- Name: merchant_copper_259_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.merchant_copper_259_archive (
    kind text NOT NULL,
    id text NOT NULL,
    data jsonb NOT NULL
);


--
-- Name: migration_252_portrait_preimages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.migration_252_portrait_preimages (
    kind text NOT NULL,
    id uuid NOT NULL,
    payload jsonb NOT NULL
);


--
-- Name: monsters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monsters (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    name_en character varying(255),
    description text DEFAULT ''::text NOT NULL,
    size character varying(30) DEFAULT 'medium'::character varying NOT NULL,
    creature_type character varying(100) DEFAULT 'humanoid'::character varying NOT NULL,
    alignment character varying(100) DEFAULT ''::character varying NOT NULL,
    challenge_rating character varying(20) DEFAULT '0'::character varying NOT NULL,
    armor_class integer DEFAULT 10 NOT NULL,
    max_hp integer DEFAULT 1 NOT NULL,
    speed integer DEFAULT 30 NOT NULL,
    initiative_bonus integer DEFAULT 0 NOT NULL,
    proficiency_bonus integer DEFAULT 2 NOT NULL,
    abilities jsonb DEFAULT '{}'::jsonb NOT NULL,
    action_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    effect_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
    ai jsonb DEFAULT '{"strategy": "melee_chase"}'::jsonb NOT NULL,
    token_url text DEFAULT ''::text NOT NULL,
    token_storage_id character varying(255) DEFAULT ''::character varying NOT NULL,
    source character varying(255) DEFAULT ''::character varying NOT NULL,
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at timestamp with time zone,
    author character varying(255) DEFAULT 'Admin'::character varying NOT NULL,
    CONSTRAINT monsters_armor_class_check CHECK ((armor_class > 0)),
    CONSTRAINT monsters_max_hp_check CHECK ((max_hp > 0)),
    CONSTRAINT monsters_proficiency_bonus_check CHECK ((proficiency_bonus > 0)),
    CONSTRAINT monsters_speed_check CHECK ((speed > 0))
);


--
-- Name: oauth_flows; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_flows (
    state_hash character varying(64) NOT NULL,
    provider character varying(16) NOT NULL,
    browser_hash character varying(64) NOT NULL,
    verifier character varying(128) NOT NULL,
    client_challenge character varying(43) NOT NULL,
    return_path text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT oauth_flows_provider_check CHECK (((provider)::text = ANY (ARRAY[('google'::character varying)::text, ('yandex'::character varying)::text])))
);


--
-- Name: oauth_handoffs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_handoffs (
    code_hash character varying(64) NOT NULL,
    user_id uuid NOT NULL,
    client_challenge character varying(43) NOT NULL,
    return_path text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);


--
-- Name: oauth_identities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.oauth_identities (
    provider character varying(16) NOT NULL,
    subject character varying(255) NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT oauth_identities_provider_check CHECK (((provider)::text = ANY (ARRAY[('google'::character varying)::text, ('yandex'::character varying)::text]))),
    CONSTRAINT oauth_identities_subject_check CHECK ((length((subject)::text) > 0))
);


--
-- Name: owned_item_grant_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owned_item_grant_snapshots (
    version integer NOT NULL,
    captured_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT owned_item_grant_snapshots_version_check CHECK ((version = 265))
);


--
-- Name: owned_item_grants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owned_item_grants (
    character_id uuid NOT NULL,
    user_id uuid NOT NULL,
    card_id uuid NOT NULL,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT owned_item_grants_reason_check CHECK ((reason = ANY (ARRAY['snapshot265'::text, 'library'::text, 'admin'::text])))
);


--
-- Name: paper_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.paper_documents (
    id uuid NOT NULL,
    owner_id uuid,
    document jsonb NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    CONSTRAINT paper_documents_document_check CHECK ((jsonb_typeof(document) = 'object'::text)),
    CONSTRAINT paper_documents_revision_check CHECK ((revision > 0))
);


--
-- Name: passive_presentations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.passive_presentations (
    key character varying(100) NOT NULL,
    name character varying(200) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    image_url text DEFAULT ''::text NOT NULL,
    enabled_description text DEFAULT ''::text NOT NULL,
    disabled_description text DEFAULT ''::text NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb,
    CONSTRAINT passive_presentations_version_check CHECK ((version > 0))
);


--
-- Name: races; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.races (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    detailed_description text,
    image_url text,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    rarity character varying(50) DEFAULT 'common'::character varying NOT NULL,
    card_number character varying(50) NOT NULL,
    creature_type character varying(100),
    size character varying(100),
    speed integer,
    extra_speeds text,
    darkvision integer,
    traits jsonb,
    lineages jsonb,
    type character varying(50),
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255),
    legacy_tags jsonb,
    is_extended boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    related_effects jsonb,
    related_actions jsonb,
    level_progression jsonb,
    is_subrace boolean DEFAULT false,
    parent_race_id uuid,
    subrace_level integer DEFAULT 1,
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb
);


--
-- Name: resource_declarations_294_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_declarations_294_archive (
    entity_table text NOT NULL,
    entity_id uuid NOT NULL,
    before_mechanics jsonb,
    after_mechanics jsonb NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resource_declarations_294_metadata_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resource_declarations_294_metadata_archive (
    resource_id text NOT NULL,
    before_row jsonb NOT NULL,
    after_category text NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.resources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    resource_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    category character varying(50) DEFAULT 'character'::character varying,
    image_url text,
    recharge character varying(50),
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    image_url_spent text,
    name_en character varying(255),
    author character varying(255) DEFAULT 'Admin'::character varying NOT NULL,
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb
);


--
-- Name: roguelike_combat_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roguelike_combat_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    command_id uuid NOT NULL,
    revision bigint NOT NULL,
    combat_key character(64) NOT NULL,
    attempt integer NOT NULL,
    encounter_number integer NOT NULL,
    record jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roguelike_command_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roguelike_command_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_id uuid NOT NULL,
    user_id uuid NOT NULL,
    command_id uuid NOT NULL,
    command_type character varying(40) NOT NULL,
    request_hash character(64) NOT NULL,
    response jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: roguelike_item_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roguelike_item_rules (
    card_id uuid NOT NULL,
    min_level integer DEFAULT 1 NOT NULL,
    weight integer DEFAULT 1 NOT NULL,
    kind text DEFAULT 'equipment'::text NOT NULL,
    quantity integer DEFAULT 1 NOT NULL,
    price integer,
    CONSTRAINT roguelike_item_rules_kind_check CHECK ((kind = ANY (ARRAY['equipment'::text, 'consumable'::text, 'magic'::text]))),
    CONSTRAINT roguelike_item_rules_min_level_check CHECK (((min_level >= 1) AND (min_level <= 5))),
    CONSTRAINT roguelike_item_rules_price_check CHECK ((price >= 0)),
    CONSTRAINT roguelike_item_rules_quantity_check CHECK (((quantity >= 1) AND (quantity <= 1000))),
    CONSTRAINT roguelike_item_rules_weight_check CHECK (((weight >= 1) AND (weight <= 1000)))
);


--
-- Name: roguelike_mode_definitions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roguelike_mode_definitions (
    id character varying(24) NOT NULL,
    definition jsonb NOT NULL
);


--
-- Name: roguelike_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roguelike_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    source_character_id uuid NOT NULL,
    character_id uuid NOT NULL,
    status character varying(24) DEFAULT 'active'::character varying NOT NULL,
    phase character varying(24) DEFAULT 'camp'::character varying NOT NULL,
    revision bigint DEFAULT 0 NOT NULL,
    experience integer DEFAULT 0 NOT NULL,
    gold integer DEFAULT 0 NOT NULL,
    supplies integer DEFAULT 1 NOT NULL,
    encounters_won integer DEFAULT 0 NOT NULL,
    attempt integer DEFAULT 1 NOT NULL,
    game_clock_hours integer DEFAULT 0 NOT NULL,
    last_long_rest_hour integer DEFAULT '-24'::integer NOT NULL,
    paid_refresh_count integer DEFAULT 0 NOT NULL,
    pending_level integer DEFAULT 0 NOT NULL,
    run_seed character varying(64) NOT NULL,
    encounter jsonb DEFAULT '{}'::jsonb NOT NULL,
    shop jsonb DEFAULT '{}'::jsonb NOT NULL,
    checkpoint jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_reward jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    combat_envelope jsonb DEFAULT '{}'::jsonb NOT NULL,
    combat_catalog jsonb DEFAULT '{}'::jsonb NOT NULL,
    game_clock_remainder_seconds integer DEFAULT 0 NOT NULL,
    last_long_rest_remainder_seconds integer DEFAULT 0 NOT NULL,
    party jsonb DEFAULT '{}'::jsonb NOT NULL,
    mode character varying(24) DEFAULT 'classic'::character varying NOT NULL,
    journey jsonb DEFAULT '{}'::jsonb NOT NULL,
    mode_rules jsonb DEFAULT '{}'::jsonb NOT NULL,
    journey_private jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT roguelike_runs_game_clock_remainder_seconds_check CHECK (((game_clock_remainder_seconds >= 0) AND (game_clock_remainder_seconds <= 3599))),
    CONSTRAINT roguelike_runs_last_long_rest_remainder_seconds_check CHECK (((last_long_rest_remainder_seconds >= 0) AND (last_long_rest_remainder_seconds <= 3599))),
    CONSTRAINT roguelike_runs_nonnegative_check CHECK (((revision >= 0) AND (experience >= 0) AND (gold >= 0) AND (supplies >= 0) AND (encounters_won >= 0) AND (attempt >= 1) AND (paid_refresh_count >= 0))),
    CONSTRAINT roguelike_runs_phase_check CHECK (((phase)::text = ANY (ARRAY[('camp'::character varying)::text, ('combat'::character varying)::text, ('ended'::character varying)::text]))),
    CONSTRAINT roguelike_runs_status_check CHECK (((status)::text = ANY (ARRAY[('active'::character varying)::text, ('victory'::character varying)::text, ('defeat'::character varying)::text, ('abandoned'::character varying)::text])))
);


--
-- Name: roguelike_shop_item_migration_249; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roguelike_shop_item_migration_249 (
    card_id uuid NOT NULL,
    copy_id uuid NOT NULL,
    before_mechanics jsonb,
    before_support jsonb,
    after_mechanics jsonb NOT NULL,
    copy_postimage jsonb NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roguelike_shop_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roguelike_shop_settings (
    id integer NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    config jsonb NOT NULL,
    CONSTRAINT roguelike_shop_settings_id_check CHECK ((id = 1))
);


--
-- Name: ruleset_releases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ruleset_releases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    system_id character varying(100) NOT NULL,
    ruleset_version character varying(100) NOT NULL,
    errata_version character varying(100) NOT NULL,
    manifest_schema_version integer NOT NULL,
    protocol_schema_version integer NOT NULL,
    artifact_version character varying(100) NOT NULL,
    serializer_version character varying(100) NOT NULL,
    rules_artifact_hash character varying(71) NOT NULL,
    content_hash character varying(71) NOT NULL,
    manifest_hash character varying(71) NOT NULL,
    manifest jsonb NOT NULL,
    manifest_canonical_bytes bytea NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    released_at timestamp with time zone,
    CONSTRAINT ck_ruleset_releases_artifact_hash CHECK (((rules_artifact_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_ruleset_releases_content_hash CHECK (((content_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_ruleset_releases_manifest_bytes CHECK ((octet_length(manifest_canonical_bytes) > 0)),
    CONSTRAINT ck_ruleset_releases_manifest_hash CHECK (((manifest_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_ruleset_releases_manifest_object CHECK ((jsonb_typeof(manifest) = 'object'::text)),
    CONSTRAINT ck_ruleset_releases_manifest_schema CHECK ((manifest_schema_version > 0)),
    CONSTRAINT ck_ruleset_releases_protocol_schema CHECK ((protocol_schema_version > 0)),
    CONSTRAINT ck_ruleset_releases_status CHECK (((status)::text = ANY (ARRAY[('draft'::character varying)::text, ('active'::character varying)::text, ('retired'::character varying)::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version character varying(255) NOT NULL,
    description text,
    executed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: session_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.session_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    seq bigint NOT NULL,
    revision bigint NOT NULL,
    ruleset_release_id uuid NOT NULL,
    rules_artifact_hash character varying(71) NOT NULL,
    snapshot_schema_version integer NOT NULL,
    serializer_version character varying(100) NOT NULL,
    snapshot jsonb NOT NULL,
    canonical_bytes bytea NOT NULL,
    state_hash character varying(71) NOT NULL,
    last_event_hash character varying(71),
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_session_snapshots_bytes CHECK ((octet_length(canonical_bytes) > 0)),
    CONSTRAINT ck_session_snapshots_event_hash CHECK (((last_event_hash IS NULL) OR ((last_event_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text))),
    CONSTRAINT ck_session_snapshots_genesis CHECK ((((seq = 0) AND (last_event_hash IS NULL)) OR ((seq > 0) AND (last_event_hash IS NOT NULL)))),
    CONSTRAINT ck_session_snapshots_revision CHECK ((revision >= 0)),
    CONSTRAINT ck_session_snapshots_schema CHECK ((snapshot_schema_version > 0)),
    CONSTRAINT ck_session_snapshots_seq CHECK ((seq >= 0)),
    CONSTRAINT ck_session_snapshots_snapshot_object CHECK ((jsonb_typeof(snapshot) = 'object'::text)),
    CONSTRAINT ck_session_snapshots_state_hash CHECK (((state_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text))
);


--
-- Name: shops; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.shops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(64) NOT NULL,
    data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: spatial_fact_sets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spatial_fact_sets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    provided_by_user_id uuid,
    facts_source character varying(40) NOT NULL,
    board_revision bigint,
    facts_schema_version integer NOT NULL,
    serializer_version character varying(100) NOT NULL,
    canonical_body jsonb NOT NULL,
    canonical_bytes bytea NOT NULL,
    facts_hash character varying(71) NOT NULL,
    signature_key_id character varying(255),
    signature bytea,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT ck_spatial_fact_sets_board_revision CHECK (((board_revision IS NULL) OR (board_revision >= 0))),
    CONSTRAINT ck_spatial_fact_sets_body_object CHECK ((jsonb_typeof(canonical_body) = 'object'::text)),
    CONSTRAINT ck_spatial_fact_sets_bytes CHECK ((octet_length(canonical_bytes) > 0)),
    CONSTRAINT ck_spatial_fact_sets_hash CHECK (((facts_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_spatial_fact_sets_schema CHECK ((facts_schema_version > 0)),
    CONSTRAINT ck_spatial_fact_sets_signature_pair CHECK (((signature_key_id IS NULL) = (signature IS NULL))),
    CONSTRAINT ck_spatial_fact_sets_source CHECK (((facts_source)::text = ANY (ARRAY[('server_board'::character varying)::text, ('signed_gm_adjudication'::character varying)::text, ('local_fixture'::character varying)::text])))
);


--
-- Name: spell_grant_abilities_296_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spell_grant_abilities_296_archive (
    entity_id uuid NOT NULL,
    card_number text NOT NULL,
    name text NOT NULL,
    before_row jsonb NOT NULL,
    before_mechanics jsonb,
    before_support jsonb,
    after_mechanics jsonb NOT NULL,
    expected_before text NOT NULL,
    expected_after text NOT NULL,
    changed boolean NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spell_grant_abilities_296_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spell_grant_abilities_296_transition (
    version text NOT NULL,
    manifest_hash text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spell_grant_refs_295_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spell_grant_refs_295_archive (
    entity_id uuid NOT NULL,
    card_number text NOT NULL,
    name text NOT NULL,
    before_row jsonb NOT NULL,
    before_mechanics jsonb,
    before_support jsonb,
    after_mechanics jsonb NOT NULL,
    expected_before text NOT NULL,
    expected_after text NOT NULL,
    changed boolean NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spell_grant_refs_295_transition; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spell_grant_refs_295_transition (
    version text NOT NULL,
    manifest_hash text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: spells; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.spells (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    description text NOT NULL,
    detailed_description text,
    image_url text,
    image_cloudinary_id character varying(255),
    image_cloudinary_url text,
    image_generated boolean DEFAULT false,
    image_generation_prompt text,
    rarity character varying(50) DEFAULT 'common'::character varying NOT NULL,
    card_number character varying(50) NOT NULL,
    level integer DEFAULT 0 NOT NULL,
    school character varying(100),
    casting_time text,
    range text,
    component_verbal boolean DEFAULT false,
    component_somatic boolean DEFAULT false,
    component_material boolean DEFAULT false,
    material_text text,
    duration text,
    classes jsonb,
    subclasses jsonb,
    concentration boolean DEFAULT false,
    ritual boolean DEFAULT false,
    damage jsonb,
    area text,
    is_healing boolean DEFAULT false,
    heal_dice character varying(50),
    save_outcome text,
    upcast_description text,
    type character varying(50),
    author character varying(255) DEFAULT 'Admin'::character varying,
    source character varying(255),
    legacy_tags jsonb,
    is_extended boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    resources jsonb,
    mechanics jsonb,
    name_en character varying(255),
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb
);


--
-- Name: transactional_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.transactional_outbox (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    event_id uuid,
    topic character varying(255) NOT NULL,
    aggregate_type character varying(100) NOT NULL,
    aggregate_id uuid NOT NULL,
    dedup_key character varying(255) NOT NULL,
    payload_schema_version integer NOT NULL,
    serializer_version character varying(100) NOT NULL,
    payload jsonb NOT NULL,
    canonical_bytes bytea NOT NULL,
    payload_hash character varying(71) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    lease_owner character varying(255),
    lease_until timestamp with time zone,
    heartbeat_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 10 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_error_code character varying(100),
    last_error_details jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    published_at timestamp with time zone,
    CONSTRAINT ck_transactional_outbox_attempts CHECK (((attempt_count >= 0) AND (max_attempts > 0) AND (attempt_count <= max_attempts))),
    CONSTRAINT ck_transactional_outbox_bytes CHECK ((octet_length(canonical_bytes) > 0)),
    CONSTRAINT ck_transactional_outbox_hash CHECK (((payload_hash)::text ~ '^sha256:[0-9a-f]{64}$'::text)),
    CONSTRAINT ck_transactional_outbox_lease CHECK ((((status)::text <> 'leased'::text) OR ((lease_owner IS NOT NULL) AND (heartbeat_at IS NOT NULL) AND (lease_until IS NOT NULL) AND (lease_until > heartbeat_at)))),
    CONSTRAINT ck_transactional_outbox_payload_object CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT ck_transactional_outbox_published CHECK ((((status)::text <> 'published'::text) OR (published_at IS NOT NULL))),
    CONSTRAINT ck_transactional_outbox_schema CHECK ((payload_schema_version > 0)),
    CONSTRAINT ck_transactional_outbox_status CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('leased'::character varying)::text, ('published'::character varying)::text, ('dead_letter'::character varying)::text])))
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(255),
    password_hash character varying(255) NOT NULL,
    display_name character varying(100) NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    is_admin boolean DEFAULT false NOT NULL
);


--
-- Name: variables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.variables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    variable_id character varying(100) NOT NULL,
    name character varying(255) NOT NULL,
    description text,
    var_type character varying(20) DEFAULT 'number'::character varying,
    default_value character varying(100),
    image_url text,
    sort_order integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    deleted_at timestamp with time zone,
    name_en character varying(255),
    author character varying(255) DEFAULT 'Admin'::character varying NOT NULL,
    support jsonb DEFAULT '{"status": "not_tested"}'::jsonb
);


--
-- Name: actions actions_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_card_number_key UNIQUE (card_number);


--
-- Name: actions actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.actions
    ADD CONSTRAINT actions_pkey PRIMARY KEY (id);


--
-- Name: animation_profiles animation_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.animation_profiles
    ADD CONSTRAINT animation_profiles_pkey PRIMARY KEY (key);


--
-- Name: audio_cues audio_cues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audio_cues
    ADD CONSTRAINT audio_cues_pkey PRIMARY KEY (key);


--
-- Name: backgrounds backgrounds_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backgrounds
    ADD CONSTRAINT backgrounds_card_number_key UNIQUE (card_number);


--
-- Name: backgrounds backgrounds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.backgrounds
    ADD CONSTRAINT backgrounds_pkey PRIMARY KEY (id);


--
-- Name: cards cards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cards
    ADD CONSTRAINT cards_pkey PRIMARY KEY (id);


--
-- Name: catalog_mechanics_278_archive catalog_mechanics_278_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_mechanics_278_archive
    ADD CONSTRAINT catalog_mechanics_278_archive_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: catalog_mechanics_278_transition catalog_mechanics_278_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_mechanics_278_transition
    ADD CONSTRAINT catalog_mechanics_278_transition_pkey PRIMARY KEY (version);


--
-- Name: catalog_mechanics_279_archive catalog_mechanics_279_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_mechanics_279_archive
    ADD CONSTRAINT catalog_mechanics_279_archive_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: catalog_mechanics_279_transition catalog_mechanics_279_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_mechanics_279_transition
    ADD CONSTRAINT catalog_mechanics_279_transition_pkey PRIMARY KEY (version);


--
-- Name: catalog_mechanics_280_archive catalog_mechanics_280_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_mechanics_280_archive
    ADD CONSTRAINT catalog_mechanics_280_archive_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: catalog_mechanics_280_transition catalog_mechanics_280_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catalog_mechanics_280_transition
    ADD CONSTRAINT catalog_mechanics_280_transition_pkey PRIMARY KEY (version);


--
-- Name: character_events character_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_events
    ADD CONSTRAINT character_events_pkey PRIMARY KEY (id);


--
-- Name: character_runtime_commands character_runtime_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_runtime_commands
    ADD CONSTRAINT character_runtime_commands_pkey PRIMARY KEY (user_id, command_id);


--
-- Name: character_templates character_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_templates
    ADD CONSTRAINT character_templates_pkey PRIMARY KEY (id);


--
-- Name: character_templates character_templates_preset_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_templates
    ADD CONSTRAINT character_templates_preset_key_key UNIQUE (preset_key);


--
-- Name: characters characters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_pkey PRIMARY KEY (id);


--
-- Name: characters_v2 characters_v2_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters_v2
    ADD CONSTRAINT characters_v2_pkey PRIMARY KEY (id);


--
-- Name: characters_v3 characters_v3_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters_v3
    ADD CONSTRAINT characters_v3_pkey PRIMARY KEY (id);


--
-- Name: game_sessions ck_game_sessions_attack_runtime_v4; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.game_sessions
    ADD CONSTRAINT ck_game_sessions_attack_runtime_v4 CHECK (((snapshot_schema_version < 4) OR (COALESCE((jsonb_typeof((current_snapshot -> 'attackActions'::text)) = 'object'::text), false) AND COALESCE((jsonb_typeof((current_snapshot -> 'grapples'::text)) = 'object'::text), false)))) NOT VALID;


--
-- Name: game_sessions ck_game_sessions_world_runtime_v5; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.game_sessions
    ADD CONSTRAINT ck_game_sessions_world_runtime_v5 CHECK ((public.canonical_snapshot_schema_matches(current_snapshot, snapshot_schema_version) AND ((snapshot_schema_version < 5) OR ((snapshot_schema_version = 5) AND COALESCE(public.canonical_world_state_v5_is_valid(current_snapshot, snapshot_schema_version, revision), false))))) NOT VALID;


--
-- Name: session_snapshots ck_session_snapshots_attack_runtime_v4; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.session_snapshots
    ADD CONSTRAINT ck_session_snapshots_attack_runtime_v4 CHECK (((snapshot_schema_version < 4) OR (COALESCE((jsonb_typeof((snapshot -> 'attackActions'::text)) = 'object'::text), false) AND COALESCE((jsonb_typeof((snapshot -> 'grapples'::text)) = 'object'::text), false)))) NOT VALID;


--
-- Name: session_snapshots ck_session_snapshots_world_runtime_v5; Type: CHECK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE public.session_snapshots
    ADD CONSTRAINT ck_session_snapshots_world_runtime_v5 CHECK ((public.canonical_snapshot_schema_matches(snapshot, snapshot_schema_version) AND ((snapshot_schema_version < 5) OR ((snapshot_schema_version = 5) AND COALESCE(public.canonical_world_state_v5_is_valid(snapshot, snapshot_schema_version, revision), false))))) NOT VALID;


--
-- Name: classes classes_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_card_number_key UNIQUE (card_number);


--
-- Name: classes classes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.classes
    ADD CONSTRAINT classes_pkey PRIMARY KEY (id);


--
-- Name: combat_spell_repairs_293_archive combat_spell_repairs_293_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combat_spell_repairs_293_archive
    ADD CONSTRAINT combat_spell_repairs_293_archive_pkey PRIMARY KEY (entity_id);


--
-- Name: combat_spell_repairs_293_transition combat_spell_repairs_293_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.combat_spell_repairs_293_transition
    ADD CONSTRAINT combat_spell_repairs_293_transition_pkey PRIMARY KEY (version);


--
-- Name: command_execution_jobs command_execution_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_execution_jobs
    ADD CONSTRAINT command_execution_jobs_pkey PRIMARY KEY (id);


--
-- Name: concepts concepts_concept_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_concept_id_key UNIQUE (concept_id);


--
-- Name: concepts concepts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.concepts
    ADD CONSTRAINT concepts_pkey PRIMARY KEY (id);


--
-- Name: content_certification_revocations content_certification_revocat_migration_version_entity_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_certification_revocations
    ADD CONSTRAINT content_certification_revocat_migration_version_entity_type_key UNIQUE (migration_version, entity_type, entity_id);


--
-- Name: content_certification_revocations content_certification_revocations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_certification_revocations
    ADD CONSTRAINT content_certification_revocations_pkey PRIMARY KEY (id);


--
-- Name: content_choice_recommendations content_choice_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_choice_recommendations
    ADD CONSTRAINT content_choice_recommendations_pkey PRIMARY KEY (entity_type, entity_reference, choice_id);


--
-- Name: content_migration_create_receipts content_migration_create_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_migration_create_receipts
    ADD CONSTRAINT content_migration_create_receipts_pkey PRIMARY KEY (id);


--
-- Name: content_review_support_archive content_review_support_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_review_support_archive
    ADD CONSTRAINT content_review_support_archive_pkey PRIMARY KEY (entity_table, entity_id);


--
-- Name: content_review_transitions content_review_transitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_review_transitions
    ADD CONSTRAINT content_review_transitions_pkey PRIMARY KEY (migration_version);


--
-- Name: decision_requests decision_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT decision_requests_pkey PRIMARY KEY (id);


--
-- Name: effect_classification_278_audit effect_classification_278_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.effect_classification_278_audit
    ADD CONSTRAINT effect_classification_278_audit_pkey PRIMARY KEY (effect_id);


--
-- Name: effect_classification_278_runs effect_classification_278_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.effect_classification_278_runs
    ADD CONSTRAINT effect_classification_278_runs_pkey PRIMARY KEY (id);


--
-- Name: effect_classification_285_audit effect_classification_285_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.effect_classification_285_audit
    ADD CONSTRAINT effect_classification_285_audit_pkey PRIMARY KEY (effect_id);


--
-- Name: effect_classification_285_runs effect_classification_285_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.effect_classification_285_runs
    ADD CONSTRAINT effect_classification_285_runs_pkey PRIMARY KEY (id);


--
-- Name: effects effects_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.effects
    ADD CONSTRAINT effects_card_number_key UNIQUE (card_number);


--
-- Name: effects effects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.effects
    ADD CONSTRAINT effects_pkey PRIMARY KEY (id);


--
-- Name: encounter_events encounter_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounter_events
    ADD CONSTRAINT encounter_events_pkey PRIMARY KEY (id);


--
-- Name: encounters encounters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.encounters
    ADD CONSTRAINT encounters_pkey PRIMARY KEY (id);


--
-- Name: entity_animation_bindings entity_animation_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_animation_bindings
    ADD CONSTRAINT entity_animation_bindings_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: entity_audio_bindings entity_audio_bindings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_audio_bindings
    ADD CONSTRAINT entity_audio_bindings_pkey PRIMARY KEY (entity_type, entity_id, event);


--
-- Name: entity_reference_edges entity_reference_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_reference_edges
    ADD CONSTRAINT entity_reference_edges_pkey PRIMARY KEY (source_type, source_id, target_type, target_key, level, path);


--
-- Name: entity_reference_nodes entity_reference_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_reference_nodes
    ADD CONSTRAINT entity_reference_nodes_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: entity_tag_assignments entity_tag_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_tag_assignments
    ADD CONSTRAINT entity_tag_assignments_pkey PRIMARY KEY (entity_type, entity_id, tag_id);


--
-- Name: entity_tag_definitions entity_tag_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_tag_definitions
    ADD CONSTRAINT entity_tag_definitions_pkey PRIMARY KEY (id);


--
-- Name: feats feats_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feats
    ADD CONSTRAINT feats_card_number_key UNIQUE (card_number);


--
-- Name: feats feats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feats
    ADD CONSTRAINT feats_pkey PRIMARY KEY (id);


--
-- Name: game_commands game_commands_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT game_commands_pkey PRIMARY KEY (id);


--
-- Name: game_events game_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT game_events_pkey PRIMARY KEY (id);


--
-- Name: game_session_actors game_session_actors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_actors
    ADD CONSTRAINT game_session_actors_pkey PRIMARY KEY (id);


--
-- Name: game_session_members game_session_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_members
    ADD CONSTRAINT game_session_members_pkey PRIMARY KEY (id);


--
-- Name: game_sessions game_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT game_sessions_pkey PRIMARY KEY (id);


--
-- Name: generic_spell_freeuses_297_archive generic_spell_freeuses_297_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generic_spell_freeuses_297_archive
    ADD CONSTRAINT generic_spell_freeuses_297_archive_pkey PRIMARY KEY (entity_table, entity_id);


--
-- Name: generic_spell_freeuses_297_resource_archive generic_spell_freeuses_297_resource_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generic_spell_freeuses_297_resource_archive
    ADD CONSTRAINT generic_spell_freeuses_297_resource_archive_pkey PRIMARY KEY (resource_id);


--
-- Name: generic_spell_freeuses_297_transition generic_spell_freeuses_297_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generic_spell_freeuses_297_transition
    ADD CONSTRAINT generic_spell_freeuses_297_transition_pkey PRIMARY KEY (version);


--
-- Name: group_members group_members_group_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_user_id_key UNIQUE (group_id, user_id);


--
-- Name: group_members group_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: image_generation_logs image_generation_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generation_logs
    ADD CONSTRAINT image_generation_logs_pkey PRIMARY KEY (id);


--
-- Name: image_library image_library_cloudinary_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_library
    ADD CONSTRAINT image_library_cloudinary_id_key UNIQUE (cloudinary_id);


--
-- Name: image_library image_library_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_library
    ADD CONSTRAINT image_library_pkey PRIMARY KEY (id);


--
-- Name: inventories inventories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_pkey PRIMARY KEY (id);


--
-- Name: inventory_items inventory_items_inventory_id_card_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_inventory_id_card_id_key UNIQUE (inventory_id, card_id);


--
-- Name: inventory_items inventory_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_pkey PRIMARY KEY (id);


--
-- Name: item_source_classification_262_audit item_source_classification_262_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_source_classification_262_audit
    ADD CONSTRAINT item_source_classification_262_audit_pkey PRIMARY KEY (card_id);


--
-- Name: item_source_classification_262_runs item_source_classification_262_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.item_source_classification_262_runs
    ADD CONSTRAINT item_source_classification_262_runs_pkey PRIMARY KEY (id);


--
-- Name: legacy_entity_tags_258 legacy_entity_tags_258_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.legacy_entity_tags_258
    ADD CONSTRAINT legacy_entity_tags_258_pkey PRIMARY KEY (entity_type, entity_id);


--
-- Name: merchant_copper_259_archive merchant_copper_259_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.merchant_copper_259_archive
    ADD CONSTRAINT merchant_copper_259_archive_pkey PRIMARY KEY (kind, id);


--
-- Name: migration_252_portrait_preimages migration_252_portrait_preimages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.migration_252_portrait_preimages
    ADD CONSTRAINT migration_252_portrait_preimages_pkey PRIMARY KEY (kind, id);


--
-- Name: monsters monsters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monsters
    ADD CONSTRAINT monsters_pkey PRIMARY KEY (id);


--
-- Name: monsters monsters_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monsters
    ADD CONSTRAINT monsters_slug_key UNIQUE (slug);


--
-- Name: oauth_flows oauth_flows_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_flows
    ADD CONSTRAINT oauth_flows_pkey PRIMARY KEY (state_hash);


--
-- Name: oauth_handoffs oauth_handoffs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_handoffs
    ADD CONSTRAINT oauth_handoffs_pkey PRIMARY KEY (code_hash);


--
-- Name: oauth_identities oauth_identities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_identities
    ADD CONSTRAINT oauth_identities_pkey PRIMARY KEY (provider, subject);


--
-- Name: oauth_identities oauth_identities_user_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_identities
    ADD CONSTRAINT oauth_identities_user_id_provider_key UNIQUE (user_id, provider);


--
-- Name: owned_item_grant_snapshots owned_item_grant_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_item_grant_snapshots
    ADD CONSTRAINT owned_item_grant_snapshots_pkey PRIMARY KEY (version);


--
-- Name: owned_item_grants owned_item_grants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_item_grants
    ADD CONSTRAINT owned_item_grants_pkey PRIMARY KEY (character_id, user_id, card_id);


--
-- Name: paper_documents paper_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_documents
    ADD CONSTRAINT paper_documents_pkey PRIMARY KEY (id);


--
-- Name: passive_presentations passive_presentations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.passive_presentations
    ADD CONSTRAINT passive_presentations_pkey PRIMARY KEY (key);


--
-- Name: races races_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.races
    ADD CONSTRAINT races_card_number_key UNIQUE (card_number);


--
-- Name: races races_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.races
    ADD CONSTRAINT races_pkey PRIMARY KEY (id);


--
-- Name: resource_declarations_294_archive resource_declarations_294_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_declarations_294_archive
    ADD CONSTRAINT resource_declarations_294_archive_pkey PRIMARY KEY (entity_table, entity_id);


--
-- Name: resource_declarations_294_metadata_archive resource_declarations_294_metadata_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resource_declarations_294_metadata_archive
    ADD CONSTRAINT resource_declarations_294_metadata_archive_pkey PRIMARY KEY (resource_id);


--
-- Name: resources resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_pkey PRIMARY KEY (id);


--
-- Name: resources resources_resource_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.resources
    ADD CONSTRAINT resources_resource_id_key UNIQUE (resource_id);


--
-- Name: roguelike_combat_events roguelike_combat_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_combat_events
    ADD CONSTRAINT roguelike_combat_events_pkey PRIMARY KEY (id);


--
-- Name: roguelike_combat_events roguelike_combat_events_run_id_command_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_combat_events
    ADD CONSTRAINT roguelike_combat_events_run_id_command_id_key UNIQUE (run_id, command_id);


--
-- Name: roguelike_combat_events roguelike_combat_events_run_id_revision_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_combat_events
    ADD CONSTRAINT roguelike_combat_events_run_id_revision_key UNIQUE (run_id, revision);


--
-- Name: roguelike_command_receipts roguelike_command_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_command_receipts
    ADD CONSTRAINT roguelike_command_receipts_pkey PRIMARY KEY (id);


--
-- Name: roguelike_command_receipts roguelike_command_receipts_run_id_command_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_command_receipts
    ADD CONSTRAINT roguelike_command_receipts_run_id_command_id_key UNIQUE (run_id, command_id);


--
-- Name: roguelike_item_rules roguelike_item_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_item_rules
    ADD CONSTRAINT roguelike_item_rules_pkey PRIMARY KEY (card_id);


--
-- Name: roguelike_mode_definitions roguelike_mode_definitions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_mode_definitions
    ADD CONSTRAINT roguelike_mode_definitions_pkey PRIMARY KEY (id);


--
-- Name: roguelike_runs roguelike_runs_character_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_runs
    ADD CONSTRAINT roguelike_runs_character_id_key UNIQUE (character_id);


--
-- Name: roguelike_runs roguelike_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_runs
    ADD CONSTRAINT roguelike_runs_pkey PRIMARY KEY (id);


--
-- Name: roguelike_shop_item_migration_249 roguelike_shop_item_migration_249_copy_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_shop_item_migration_249
    ADD CONSTRAINT roguelike_shop_item_migration_249_copy_id_key UNIQUE (copy_id);


--
-- Name: roguelike_shop_item_migration_249 roguelike_shop_item_migration_249_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_shop_item_migration_249
    ADD CONSTRAINT roguelike_shop_item_migration_249_pkey PRIMARY KEY (card_id);


--
-- Name: roguelike_shop_settings roguelike_shop_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_shop_settings
    ADD CONSTRAINT roguelike_shop_settings_pkey PRIMARY KEY (id);


--
-- Name: ruleset_releases ruleset_releases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ruleset_releases
    ADD CONSTRAINT ruleset_releases_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: session_snapshots session_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_snapshots
    ADD CONSTRAINT session_snapshots_pkey PRIMARY KEY (id);


--
-- Name: shops shops_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_pkey PRIMARY KEY (id);


--
-- Name: shops shops_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.shops
    ADD CONSTRAINT shops_slug_key UNIQUE (slug);


--
-- Name: spatial_fact_sets spatial_fact_sets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spatial_fact_sets
    ADD CONSTRAINT spatial_fact_sets_pkey PRIMARY KEY (id);


--
-- Name: spell_grant_abilities_296_archive spell_grant_abilities_296_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spell_grant_abilities_296_archive
    ADD CONSTRAINT spell_grant_abilities_296_archive_pkey PRIMARY KEY (entity_id);


--
-- Name: spell_grant_abilities_296_transition spell_grant_abilities_296_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spell_grant_abilities_296_transition
    ADD CONSTRAINT spell_grant_abilities_296_transition_pkey PRIMARY KEY (version);


--
-- Name: spell_grant_refs_295_archive spell_grant_refs_295_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spell_grant_refs_295_archive
    ADD CONSTRAINT spell_grant_refs_295_archive_pkey PRIMARY KEY (entity_id);


--
-- Name: spell_grant_refs_295_transition spell_grant_refs_295_transition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spell_grant_refs_295_transition
    ADD CONSTRAINT spell_grant_refs_295_transition_pkey PRIMARY KEY (version);


--
-- Name: spells spells_card_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spells
    ADD CONSTRAINT spells_card_number_key UNIQUE (card_number);


--
-- Name: spells spells_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spells
    ADD CONSTRAINT spells_pkey PRIMARY KEY (id);


--
-- Name: transactional_outbox transactional_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactional_outbox
    ADD CONSTRAINT transactional_outbox_pkey PRIMARY KEY (id);


--
-- Name: command_execution_jobs uq_command_execution_jobs_command; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_execution_jobs
    ADD CONSTRAINT uq_command_execution_jobs_command UNIQUE (session_id, command_id);


--
-- Name: command_execution_jobs uq_command_execution_jobs_fencing; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_execution_jobs
    ADD CONSTRAINT uq_command_execution_jobs_fencing UNIQUE (session_id, command_id, fencing_token);


--
-- Name: content_migration_create_receipts uq_content_migration_receipts_bundle_entity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_migration_create_receipts
    ADD CONSTRAINT uq_content_migration_receipts_bundle_entity UNIQUE (bundle_id, plan_hash, entity_type, card_number);


--
-- Name: content_migration_create_receipts uq_content_migration_receipts_bundle_operation; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_migration_create_receipts
    ADD CONSTRAINT uq_content_migration_receipts_bundle_operation UNIQUE (bundle_id, plan_hash, operation_id);


--
-- Name: content_migration_create_receipts uq_content_migration_receipts_entity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.content_migration_create_receipts
    ADD CONSTRAINT uq_content_migration_receipts_entity UNIQUE (entity_type, entity_id);


--
-- Name: decision_requests uq_decision_requests_session_request; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT uq_decision_requests_session_request UNIQUE (session_id, request_id);


--
-- Name: decision_requests uq_decision_requests_session_resolution; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT uq_decision_requests_session_resolution UNIQUE (session_id, resolution_id);


--
-- Name: game_commands uq_game_commands_session_command; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT uq_game_commands_session_command UNIQUE (session_id, command_id);


--
-- Name: game_commands uq_game_commands_session_semantic_command; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT uq_game_commands_session_semantic_command UNIQUE (session_id, semantic_command_id);


--
-- Name: game_events uq_game_events_command_index; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT uq_game_events_command_index UNIQUE (session_id, command_id, event_index);


--
-- Name: game_events uq_game_events_session_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT uq_game_events_session_hash UNIQUE (session_id, event_hash);


--
-- Name: game_events uq_game_events_session_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT uq_game_events_session_id UNIQUE (session_id, id);


--
-- Name: game_events uq_game_events_session_seq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT uq_game_events_session_seq UNIQUE (session_id, seq);


--
-- Name: game_session_actors uq_game_session_actors_session_actor; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_actors
    ADD CONSTRAINT uq_game_session_actors_session_actor UNIQUE (session_id, id);


--
-- Name: game_session_members uq_game_session_members_session_user; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_members
    ADD CONSTRAINT uq_game_session_members_session_user UNIQUE (session_id, user_id);


--
-- Name: game_sessions uq_game_sessions_release_artifact; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT uq_game_sessions_release_artifact UNIQUE (id, ruleset_release_id, rules_artifact_hash);


--
-- Name: game_sessions uq_game_sessions_release_artifact_serializer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT uq_game_sessions_release_artifact_serializer UNIQUE (id, ruleset_release_id, rules_artifact_hash, serializer_version);


--
-- Name: ruleset_releases uq_ruleset_releases_id_artifact; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ruleset_releases
    ADD CONSTRAINT uq_ruleset_releases_id_artifact UNIQUE (id, rules_artifact_hash);


--
-- Name: ruleset_releases uq_ruleset_releases_id_artifact_serializer; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ruleset_releases
    ADD CONSTRAINT uq_ruleset_releases_id_artifact_serializer UNIQUE (id, rules_artifact_hash, serializer_version);


--
-- Name: ruleset_releases uq_ruleset_releases_identity; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ruleset_releases
    ADD CONSTRAINT uq_ruleset_releases_identity UNIQUE (system_id, ruleset_version, errata_version, rules_artifact_hash, content_hash);


--
-- Name: ruleset_releases uq_ruleset_releases_manifest_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ruleset_releases
    ADD CONSTRAINT uq_ruleset_releases_manifest_hash UNIQUE (manifest_hash);


--
-- Name: session_snapshots uq_session_snapshots_session_seq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_snapshots
    ADD CONSTRAINT uq_session_snapshots_session_seq UNIQUE (session_id, seq);


--
-- Name: spatial_fact_sets uq_spatial_fact_sets_session_hash; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spatial_fact_sets
    ADD CONSTRAINT uq_spatial_fact_sets_session_hash UNIQUE (session_id, facts_hash);


--
-- Name: spatial_fact_sets uq_spatial_fact_sets_session_id; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spatial_fact_sets
    ADD CONSTRAINT uq_spatial_fact_sets_session_id UNIQUE (session_id, id);


--
-- Name: transactional_outbox uq_transactional_outbox_dedup_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactional_outbox
    ADD CONSTRAINT uq_transactional_outbox_dedup_key UNIQUE (dedup_key);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: variables variables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variables
    ADD CONSTRAINT variables_pkey PRIMARY KEY (id);


--
-- Name: variables variables_variable_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.variables
    ADD CONSTRAINT variables_variable_id_key UNIQUE (variable_id);


--
-- Name: cards_author_owner_267; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cards_author_owner_267 ON public.cards USING btree (author) WHERE (deleted_at IS NULL);


--
-- Name: characters_v2_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX characters_v2_id_idx ON public.characters_v2 USING btree (id);


--
-- Name: entity_reference_edges_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_reference_edges_target ON public.entity_reference_edges USING btree (target_type, target_key);


--
-- Name: entity_reference_nodes_aliases; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_reference_nodes_aliases ON public.entity_reference_nodes USING gin (aliases);


--
-- Name: entity_tag_name_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX entity_tag_name_unique ON public.entity_tag_definitions USING btree (lower(name));


--
-- Name: entity_tag_pool; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX entity_tag_pool ON public.entity_tag_assignments USING btree (tag_id, entity_type, entity_id);


--
-- Name: idx_actions_action_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_action_type ON public.actions USING btree (action_type);


--
-- Name: idx_actions_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_card_number ON public.actions USING btree (card_number);


--
-- Name: idx_actions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_created_at ON public.actions USING btree (created_at DESC);


--
-- Name: idx_actions_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_deleted_at ON public.actions USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_actions_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_name ON public.actions USING gin (to_tsvector('russian'::regconfig, (name)::text));


--
-- Name: idx_actions_rarity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_rarity ON public.actions USING btree (rarity);


--
-- Name: idx_actions_resource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_actions_resource ON public.actions USING btree (resource);


--
-- Name: idx_backgrounds_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backgrounds_card_number ON public.backgrounds USING btree (card_number);


--
-- Name: idx_backgrounds_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backgrounds_created_at ON public.backgrounds USING btree (created_at DESC);


--
-- Name: idx_backgrounds_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_backgrounds_deleted_at ON public.backgrounds USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_cards_author; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_author ON public.cards USING btree (author);


--
-- Name: idx_cards_battle_profile; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_battle_profile ON public.cards USING gin (battle_profile);


--
-- Name: idx_cards_card_number_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_card_number_active ON public.cards USING btree (card_number) WHERE (deleted_at IS NULL);


--
-- Name: idx_cards_card_number_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_cards_card_number_unique ON public.cards USING btree (card_number);


--
-- Name: idx_cards_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_created_at ON public.cards USING btree (created_at DESC);


--
-- Name: idx_cards_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_deleted_at ON public.cards USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_cards_effects; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_effects ON public.cards USING gin (effects);


--
-- Name: idx_cards_id_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_id_deleted ON public.cards USING btree (id) WHERE (deleted_at IS NULL);


--
-- Name: idx_cards_image_cloudinary_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_image_cloudinary_id ON public.cards USING btree (image_cloudinary_id);


--
-- Name: idx_cards_image_generated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_image_generated ON public.cards USING btree (image_generated);


--
-- Name: idx_cards_is_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_is_template ON public.cards USING btree (is_template);


--
-- Name: idx_cards_mastery; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_mastery ON public.cards USING btree (mastery);


--
-- Name: idx_cards_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_name ON public.cards USING gin (to_tsvector('russian'::regconfig, (name)::text));


--
-- Name: idx_cards_properties; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_properties ON public.cards USING btree (properties);


--
-- Name: idx_cards_rarity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_rarity ON public.cards USING btree (rarity);


--
-- Name: idx_cards_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_slot ON public.cards USING btree (slot);


--
-- Name: idx_cards_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_source ON public.cards USING btree (source);


--
-- Name: idx_cards_template_deleted; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_template_deleted ON public.cards USING btree (is_template, deleted_at);


--
-- Name: idx_cards_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_type ON public.cards USING btree (type);


--
-- Name: idx_cards_weapon_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cards_weapon_type ON public.cards USING btree (weapon_type);


--
-- Name: idx_character_events_character_client_id; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_character_events_character_client_id ON public.character_events USING btree (character_id, client_event_id) WHERE (client_event_id IS NOT NULL);


--
-- Name: idx_character_events_character_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_character_events_character_ts ON public.character_events USING btree (character_id, ts DESC);


--
-- Name: idx_character_runtime_commands_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_character_runtime_commands_created_at ON public.character_runtime_commands USING btree (created_at);


--
-- Name: idx_characters_armor_proficiencies; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_armor_proficiencies ON public.characters USING gin (armor_proficiencies);


--
-- Name: idx_characters_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_created_at ON public.characters USING btree (created_at DESC);


--
-- Name: idx_characters_damage_resistances; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_damage_resistances ON public.characters USING gin (damage_resistances);


--
-- Name: idx_characters_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_deleted_at ON public.characters USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_characters_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_group_id ON public.characters USING btree (group_id);


--
-- Name: idx_characters_language_proficiencies; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_language_proficiencies ON public.characters USING gin (language_proficiencies);


--
-- Name: idx_characters_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_name ON public.characters USING btree (name);


--
-- Name: idx_characters_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_user_id ON public.characters USING btree (user_id);


--
-- Name: idx_characters_v2_active_effects; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v2_active_effects ON public.characters_v2 USING gin (active_effects);


--
-- Name: idx_characters_v2_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v2_group_id ON public.characters_v2 USING btree (group_id);


--
-- Name: idx_characters_v2_id_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v2_id_user ON public.characters_v2 USING btree (id, user_id);


--
-- Name: idx_characters_v2_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v2_name ON public.characters_v2 USING btree (name);


--
-- Name: idx_characters_v2_resources; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v2_resources ON public.characters_v2 USING gin (resources);


--
-- Name: idx_characters_v2_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v2_user_id ON public.characters_v2 USING btree (user_id);


--
-- Name: idx_characters_v3_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v3_created_at ON public.characters_v3 USING btree (created_at DESC);


--
-- Name: idx_characters_v3_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_v3_user_id ON public.characters_v3 USING btree (user_id);


--
-- Name: idx_characters_weapon_proficiencies; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_characters_weapon_proficiencies ON public.characters USING gin (weapon_proficiencies);


--
-- Name: idx_classes_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_card_number ON public.classes USING btree (card_number);


--
-- Name: idx_classes_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_created_at ON public.classes USING btree (created_at DESC);


--
-- Name: idx_classes_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_deleted_at ON public.classes USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_classes_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_classes_parent ON public.classes USING btree (parent_class_id);


--
-- Name: idx_command_execution_jobs_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_execution_jobs_claim ON public.command_execution_jobs USING btree (status, next_attempt_at, lease_until);


--
-- Name: idx_command_execution_jobs_heartbeat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_command_execution_jobs_heartbeat ON public.command_execution_jobs USING btree (status, heartbeat_at) WHERE ((status)::text = 'leased'::text);


--
-- Name: idx_concepts_concept_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_concepts_concept_id ON public.concepts USING btree (concept_id);


--
-- Name: idx_content_migration_receipts_bundle_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_content_migration_receipts_bundle_status ON public.content_migration_create_receipts USING btree (bundle_id, plan_hash, status);


--
-- Name: idx_decision_requests_open_controller; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decision_requests_open_controller ON public.decision_requests USING btree (session_id, assigned_controller_user_id, opened_seq) WHERE ((status)::text = 'open'::text);


--
-- Name: idx_decision_requests_resolution; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_decision_requests_resolution ON public.decision_requests USING btree (session_id, resolution_id, status);


--
-- Name: idx_effects_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_effects_card_number ON public.effects USING btree (card_number);


--
-- Name: idx_effects_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_effects_created_at ON public.effects USING btree (created_at DESC);


--
-- Name: idx_effects_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_effects_deleted_at ON public.effects USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_effects_effect_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_effects_effect_type ON public.effects USING btree (effect_type);


--
-- Name: idx_effects_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_effects_name ON public.effects USING gin (to_tsvector('russian'::regconfig, (name)::text));


--
-- Name: idx_effects_rarity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_effects_rarity ON public.effects USING btree (rarity);


--
-- Name: idx_encounter_events_enc_seq; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encounter_events_enc_seq ON public.encounter_events USING btree (encounter_id, seq);


--
-- Name: idx_encounters_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_encounters_owner ON public.encounters USING btree (owner_user_id);


--
-- Name: idx_feats_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feats_card_number ON public.feats USING btree (card_number);


--
-- Name: idx_feats_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feats_category ON public.feats USING btree (category);


--
-- Name: idx_feats_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feats_created_at ON public.feats USING btree (created_at DESC);


--
-- Name: idx_feats_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_feats_deleted_at ON public.feats USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_game_commands_actor; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_commands_actor ON public.game_commands USING btree (session_id, source_actor_id, admitted_at);


--
-- Name: idx_game_commands_request_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_commands_request_hash ON public.game_commands USING btree (session_id, request_hash);


--
-- Name: idx_game_commands_session_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_commands_session_status ON public.game_commands USING btree (session_id, status, admitted_at);


--
-- Name: idx_game_events_command; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_events_command ON public.game_events USING btree (session_id, command_id, event_index);


--
-- Name: idx_game_events_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_events_type ON public.game_events USING btree (session_id, event_type, seq);


--
-- Name: idx_game_session_actors_controller_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_session_actors_controller_status ON public.game_session_actors USING btree (session_id, controller_user_id, lifecycle_status);


--
-- Name: idx_game_session_actors_projection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_session_actors_projection ON public.game_session_actors USING btree (session_id, projection_seq);


--
-- Name: idx_game_session_members_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_session_members_user_status ON public.game_session_members USING btree (user_id, status);


--
-- Name: idx_game_sessions_actors_v5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_actors_v5 ON public.game_sessions USING gin (((current_snapshot -> 'actors'::text))) WHERE (snapshot_schema_version = 5);


--
-- Name: idx_game_sessions_attack_actions_v4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_attack_actions_v4 ON public.game_sessions USING gin (((current_snapshot -> 'attackActions'::text))) WHERE (snapshot_schema_version >= 4);


--
-- Name: idx_game_sessions_creator_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_creator_status ON public.game_sessions USING btree (created_by_user_id, status);


--
-- Name: idx_game_sessions_grapples_v4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_grapples_v4 ON public.game_sessions USING gin (((current_snapshot -> 'grapples'::text))) WHERE (snapshot_schema_version >= 4);


--
-- Name: idx_game_sessions_objects_v5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_objects_v5 ON public.game_sessions USING gin (((current_snapshot -> 'objects'::text))) WHERE (snapshot_schema_version = 5);


--
-- Name: idx_game_sessions_pending_v5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_pending_v5 ON public.game_sessions USING gin (((current_snapshot -> 'pendingResolution'::text))) WHERE ((snapshot_schema_version = 5) AND ((current_snapshot -> 'pendingResolution'::text) <> 'null'::jsonb));


--
-- Name: idx_game_sessions_ruleset_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_game_sessions_ruleset_status ON public.game_sessions USING btree (ruleset_release_id, status);


--
-- Name: idx_group_members_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_group_id ON public.group_members USING btree (group_id);


--
-- Name: idx_group_members_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_role ON public.group_members USING btree (role);


--
-- Name: idx_group_members_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_group_members_user_id ON public.group_members USING btree (user_id);


--
-- Name: idx_groups_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_deleted_at ON public.groups USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_groups_dm_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_groups_dm_id ON public.groups USING btree (dm_id);


--
-- Name: idx_image_generation_logs_entity_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_generation_logs_entity_id ON public.image_generation_logs USING btree (entity_id);


--
-- Name: idx_image_library_armor_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_armor_type ON public.image_library USING btree (armor_type);


--
-- Name: idx_image_library_card_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_card_name ON public.image_library USING gin (to_tsvector('russian'::regconfig, (card_name)::text));


--
-- Name: idx_image_library_card_rarity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_card_rarity ON public.image_library USING btree (card_rarity);


--
-- Name: idx_image_library_cloudinary_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_cloudinary_id ON public.image_library USING btree (cloudinary_id);


--
-- Name: idx_image_library_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_created_at ON public.image_library USING btree (created_at DESC);


--
-- Name: idx_image_library_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_deleted_at ON public.image_library USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_image_library_item_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_item_type ON public.image_library USING btree (item_type);


--
-- Name: idx_image_library_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_slot ON public.image_library USING btree (slot);


--
-- Name: idx_image_library_weapon_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_image_library_weapon_type ON public.image_library USING btree (weapon_type);


--
-- Name: idx_inventories_character_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventories_character_id ON public.inventories USING btree (character_id);


--
-- Name: idx_inventories_character_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventories_character_type ON public.inventories USING btree (character_id, type);


--
-- Name: idx_inventories_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventories_deleted_at ON public.inventories USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_inventories_group_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventories_group_id ON public.inventories USING btree (group_id);


--
-- Name: idx_inventories_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventories_type ON public.inventories USING btree (type);


--
-- Name: idx_inventories_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventories_user_id ON public.inventories USING btree (user_id);


--
-- Name: idx_inventory_items_card_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_items_card_id ON public.inventory_items USING btree (card_id);


--
-- Name: idx_inventory_items_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_items_deleted_at ON public.inventory_items USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_inventory_items_equipped_slot; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_items_equipped_slot ON public.inventory_items USING btree (equipped_slot);


--
-- Name: idx_inventory_items_inventory_card; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_items_inventory_card ON public.inventory_items USING btree (inventory_id, card_id);


--
-- Name: idx_inventory_items_inventory_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_items_inventory_id ON public.inventory_items USING btree (inventory_id);


--
-- Name: idx_inventory_items_is_equipped; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_inventory_items_is_equipped ON public.inventory_items USING btree (is_equipped);


--
-- Name: idx_monsters_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monsters_deleted_at ON public.monsters USING btree (deleted_at);


--
-- Name: idx_monsters_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_monsters_name ON public.monsters USING gin (to_tsvector('russian'::regconfig, (name)::text));


--
-- Name: idx_races_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_races_card_number ON public.races USING btree (card_number);


--
-- Name: idx_races_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_races_created_at ON public.races USING btree (created_at DESC);


--
-- Name: idx_races_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_races_deleted_at ON public.races USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_races_parent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_races_parent ON public.races USING btree (parent_race_id);


--
-- Name: idx_resources_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_category ON public.resources USING btree (category);


--
-- Name: idx_resources_resource_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_resources_resource_id ON public.resources USING btree (resource_id);


--
-- Name: idx_roguelike_combat_replay; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roguelike_combat_replay ON public.roguelike_combat_events USING btree (run_id, combat_key, revision);


--
-- Name: idx_roguelike_party; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roguelike_party ON public.roguelike_runs USING gin (party);


--
-- Name: idx_roguelike_receipts_run_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roguelike_receipts_run_created ON public.roguelike_command_receipts USING btree (run_id, created_at);


--
-- Name: idx_roguelike_runs_user_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_roguelike_runs_user_updated ON public.roguelike_runs USING btree (user_id, updated_at DESC);


--
-- Name: idx_ruleset_releases_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ruleset_releases_lookup ON public.ruleset_releases USING btree (system_id, ruleset_version, errata_version, status);


--
-- Name: idx_session_snapshots_actors_v5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_snapshots_actors_v5 ON public.session_snapshots USING gin (((snapshot -> 'actors'::text))) WHERE (snapshot_schema_version = 5);


--
-- Name: idx_session_snapshots_attack_actions_v4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_snapshots_attack_actions_v4 ON public.session_snapshots USING gin (((snapshot -> 'attackActions'::text))) WHERE (snapshot_schema_version >= 4);


--
-- Name: idx_session_snapshots_grapples_v4; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_snapshots_grapples_v4 ON public.session_snapshots USING gin (((snapshot -> 'grapples'::text))) WHERE (snapshot_schema_version >= 4);


--
-- Name: idx_session_snapshots_latest; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_snapshots_latest ON public.session_snapshots USING btree (session_id, seq DESC);


--
-- Name: idx_session_snapshots_objects_v5; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_snapshots_objects_v5 ON public.session_snapshots USING gin (((snapshot -> 'objects'::text))) WHERE (snapshot_schema_version = 5);


--
-- Name: idx_session_snapshots_state_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_session_snapshots_state_hash ON public.session_snapshots USING btree (session_id, state_hash);


--
-- Name: idx_shops_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_shops_created_at ON public.shops USING btree (created_at DESC);


--
-- Name: idx_spatial_fact_sets_session_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spatial_fact_sets_session_created ON public.spatial_fact_sets USING btree (session_id, created_at DESC);


--
-- Name: idx_spells_card_number; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spells_card_number ON public.spells USING btree (card_number);


--
-- Name: idx_spells_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spells_created_at ON public.spells USING btree (created_at DESC);


--
-- Name: idx_spells_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spells_deleted_at ON public.spells USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_spells_level; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spells_level ON public.spells USING btree (level);


--
-- Name: idx_spells_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spells_name ON public.spells USING gin (to_tsvector('russian'::regconfig, (name)::text));


--
-- Name: idx_spells_rarity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spells_rarity ON public.spells USING btree (rarity);


--
-- Name: idx_spells_school; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_spells_school ON public.spells USING btree (school);


--
-- Name: idx_transactional_outbox_claim; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactional_outbox_claim ON public.transactional_outbox USING btree (status, next_attempt_at, lease_until);


--
-- Name: idx_transactional_outbox_session_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_transactional_outbox_session_created ON public.transactional_outbox USING btree (session_id, created_at);


--
-- Name: idx_users_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_deleted_at ON public.users USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: idx_variables_variable_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_variables_variable_id ON public.variables USING btree (variable_id);


--
-- Name: oauth_flows_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_flows_expiry ON public.oauth_flows USING btree (expires_at);


--
-- Name: oauth_handoffs_expiry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX oauth_handoffs_expiry ON public.oauth_handoffs USING btree (expires_at);


--
-- Name: owned_item_grants_user_card; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX owned_item_grants_user_card ON public.owned_item_grants USING btree (user_id, card_id);


--
-- Name: paper_documents_deleted_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX paper_documents_deleted_at ON public.paper_documents USING btree (deleted_at);


--
-- Name: paper_documents_owner_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX paper_documents_owner_updated ON public.paper_documents USING btree (owner_id, updated_at DESC) WHERE (owner_id IS NOT NULL);


--
-- Name: spells_author_owner_267; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX spells_author_owner_267 ON public.spells USING btree (author) WHERE (deleted_at IS NULL);


--
-- Name: uq_decision_requests_single_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_decision_requests_single_open ON public.decision_requests USING btree (session_id) WHERE ((status)::text = 'open'::text);


--
-- Name: uq_game_session_actors_active_character; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_game_session_actors_active_character ON public.game_session_actors USING btree (character_id) WHERE ((character_id IS NOT NULL) AND ((lifecycle_status)::text = 'active'::text));


--
-- Name: uq_session_snapshots_last_event; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_session_snapshots_last_event ON public.session_snapshots USING btree (session_id, last_event_hash) WHERE (last_event_hash IS NOT NULL);


--
-- Name: character_runtime_commands character_runtime_commands_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER character_runtime_commands_append_only BEFORE DELETE OR UPDATE ON public.character_runtime_commands FOR EACH ROW EXECUTE FUNCTION public.reject_character_runtime_command_mutation();


--
-- Name: game_commands game_commands_immutable_input; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_commands_immutable_input BEFORE UPDATE ON public.game_commands FOR EACH ROW EXECUTE FUNCTION public.reject_game_command_input_mutation();


--
-- Name: game_events game_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_events_append_only BEFORE DELETE OR UPDATE ON public.game_events FOR EACH ROW EXECUTE FUNCTION public.reject_canonical_runtime_append_only_mutation();


--
-- Name: game_sessions game_sessions_world_release_binding_v5; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER game_sessions_world_release_binding_v5 BEFORE INSERT OR UPDATE OF ruleset_release_id, rules_artifact_hash, current_snapshot, snapshot_schema_version ON public.game_sessions FOR EACH ROW EXECUTE FUNCTION public.enforce_canonical_world_state_release_binding();


--
-- Name: actions index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('action');


--
-- Name: backgrounds index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.backgrounds FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('background');


--
-- Name: cards index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.cards FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('card');


--
-- Name: classes index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('class');


--
-- Name: concepts index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.concepts FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('concept');


--
-- Name: effects index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.effects FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('effect');


--
-- Name: feats index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.feats FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('feat');


--
-- Name: monsters index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.monsters FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('monster');


--
-- Name: passive_presentations index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.passive_presentations FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('passive');


--
-- Name: races index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.races FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('race');


--
-- Name: resources index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('resource');


--
-- Name: spells index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.spells FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('spell');


--
-- Name: variables index_entity_references; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER index_entity_references AFTER INSERT OR DELETE OR UPDATE ON public.variables FOR EACH ROW EXECUTE FUNCTION public.entity_reference_changed('variable');


--
-- Name: actions invalidate_actions_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_actions_support BEFORE INSERT OR UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: backgrounds invalidate_backgrounds_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_backgrounds_support BEFORE INSERT OR UPDATE ON public.backgrounds FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: cards invalidate_cards_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_cards_support BEFORE INSERT OR UPDATE ON public.cards FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: classes invalidate_classes_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_classes_support BEFORE INSERT OR UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: concepts invalidate_concepts_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_concepts_support BEFORE INSERT OR UPDATE ON public.concepts FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: effects invalidate_effects_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_effects_support BEFORE INSERT OR UPDATE ON public.effects FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: feats invalidate_feats_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_feats_support BEFORE INSERT OR UPDATE ON public.feats FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: monsters invalidate_monsters_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_monsters_support BEFORE INSERT OR UPDATE ON public.monsters FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: passive_presentations invalidate_passive_presentations_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_passive_presentations_support BEFORE INSERT OR UPDATE ON public.passive_presentations FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: races invalidate_races_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_races_support BEFORE INSERT OR UPDATE ON public.races FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: resources invalidate_resources_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_resources_support BEFORE INSERT OR UPDATE ON public.resources FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: spells invalidate_spells_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_spells_support BEFORE INSERT OR UPDATE ON public.spells FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: variables invalidate_variables_support; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER invalidate_variables_support BEFORE INSERT OR UPDATE ON public.variables FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_support();


--
-- Name: characters_v3 prevent_characters_v3_system_change; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER prevent_characters_v3_system_change BEFORE UPDATE OF system_id ON public.characters_v3 FOR EACH ROW EXECUTE FUNCTION public.prevent_character_system_change();


--
-- Name: ruleset_releases ruleset_releases_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ruleset_releases_append_only BEFORE DELETE OR UPDATE ON public.ruleset_releases FOR EACH ROW EXECUTE FUNCTION public.protect_ruleset_release_artifact();


--
-- Name: session_snapshots session_snapshots_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER session_snapshots_append_only BEFORE DELETE OR UPDATE ON public.session_snapshots FOR EACH ROW EXECUTE FUNCTION public.reject_canonical_runtime_append_only_mutation();


--
-- Name: session_snapshots session_snapshots_world_release_binding_v5; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER session_snapshots_world_release_binding_v5 BEFORE INSERT OR UPDATE OF ruleset_release_id, rules_artifact_hash, snapshot, snapshot_schema_version ON public.session_snapshots FOR EACH ROW EXECUTE FUNCTION public.enforce_canonical_world_state_release_binding();


--
-- Name: spatial_fact_sets spatial_fact_sets_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER spatial_fact_sets_append_only BEFORE DELETE OR UPDATE ON public.spatial_fact_sets FOR EACH ROW EXECUTE FUNCTION public.reject_canonical_runtime_append_only_mutation();


--
-- Name: actions update_actions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_actions_updated_at BEFORE UPDATE ON public.actions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: backgrounds update_backgrounds_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_backgrounds_updated_at BEFORE UPDATE ON public.backgrounds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: cards update_cards_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_cards_updated_at BEFORE UPDATE ON public.cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: characters update_characters_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_characters_updated_at BEFORE UPDATE ON public.characters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: effects update_effects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_effects_updated_at BEFORE UPDATE ON public.effects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: feats update_feats_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_feats_updated_at BEFORE UPDATE ON public.feats FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: group_members update_group_members_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_group_members_updated_at BEFORE UPDATE ON public.group_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: groups update_groups_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_groups_updated_at BEFORE UPDATE ON public.groups FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: image_library update_image_library_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_image_library_updated_at BEFORE UPDATE ON public.image_library FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inventories update_inventories_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inventories_updated_at BEFORE UPDATE ON public.inventories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: inventory_items update_inventory_items_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_inventory_items_updated_at BEFORE UPDATE ON public.inventory_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: monsters update_monsters_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_monsters_updated_at BEFORE UPDATE ON public.monsters FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: spells update_spells_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_spells_updated_at BEFORE UPDATE ON public.spells FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: users update_users_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


--
-- Name: character_events character_events_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.character_events
    ADD CONSTRAINT character_events_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters_v3(id) ON DELETE CASCADE;


--
-- Name: characters characters_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: characters characters_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters
    ADD CONSTRAINT characters_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: characters_v2 characters_v2_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters_v2
    ADD CONSTRAINT characters_v2_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE SET NULL;


--
-- Name: characters_v2 characters_v2_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.characters_v2
    ADD CONSTRAINT characters_v2_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: entity_animation_bindings entity_animation_bindings_profile_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_animation_bindings
    ADD CONSTRAINT entity_animation_bindings_profile_key_fkey FOREIGN KEY (profile_key) REFERENCES public.animation_profiles(key);


--
-- Name: entity_audio_bindings entity_audio_bindings_cue_key_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_audio_bindings
    ADD CONSTRAINT entity_audio_bindings_cue_key_fkey FOREIGN KEY (cue_key) REFERENCES public.audio_cues(key);


--
-- Name: entity_reference_edges entity_reference_edges_source_type_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_reference_edges
    ADD CONSTRAINT entity_reference_edges_source_type_source_id_fkey FOREIGN KEY (source_type, source_id) REFERENCES public.entity_reference_nodes(entity_type, entity_id) ON DELETE CASCADE;


--
-- Name: entity_tag_assignments entity_tag_assignments_tag_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entity_tag_assignments
    ADD CONSTRAINT entity_tag_assignments_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES public.entity_tag_definitions(id);


--
-- Name: command_execution_jobs fk_command_execution_jobs_command; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.command_execution_jobs
    ADD CONSTRAINT fk_command_execution_jobs_command FOREIGN KEY (session_id, command_id) REFERENCES public.game_commands(session_id, command_id) ON DELETE RESTRICT;


--
-- Name: decision_requests fk_decision_requests_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT fk_decision_requests_actor FOREIGN KEY (session_id, deciding_actor_id) REFERENCES public.game_session_actors(session_id, id) ON DELETE RESTRICT;


--
-- Name: decision_requests fk_decision_requests_controller_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT fk_decision_requests_controller_member FOREIGN KEY (session_id, assigned_controller_user_id) REFERENCES public.game_session_members(session_id, user_id) ON DELETE RESTRICT;


--
-- Name: decision_requests fk_decision_requests_resolved_command; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT fk_decision_requests_resolved_command FOREIGN KEY (session_id, resolved_by_command_id) REFERENCES public.game_commands(session_id, command_id) ON DELETE RESTRICT;


--
-- Name: decision_requests fk_decision_requests_session_release; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT fk_decision_requests_session_release FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT;


--
-- Name: decision_requests fk_decision_requests_session_release_serializer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT fk_decision_requests_session_release_serializer FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT;


--
-- Name: decision_requests fk_decision_requests_source_command; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.decision_requests
    ADD CONSTRAINT fk_decision_requests_source_command FOREIGN KEY (session_id, source_command_id) REFERENCES public.game_commands(session_id, command_id) ON DELETE RESTRICT;


--
-- Name: game_commands fk_game_commands_controller_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT fk_game_commands_controller_member FOREIGN KEY (session_id, controller_user_id) REFERENCES public.game_session_members(session_id, user_id) ON DELETE RESTRICT;


--
-- Name: game_commands fk_game_commands_session_release; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT fk_game_commands_session_release FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT;


--
-- Name: game_commands fk_game_commands_session_release_serializer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT fk_game_commands_session_release_serializer FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT;


--
-- Name: game_commands fk_game_commands_source_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT fk_game_commands_source_actor FOREIGN KEY (session_id, source_actor_id) REFERENCES public.game_session_actors(session_id, id) ON DELETE RESTRICT;


--
-- Name: game_commands fk_game_commands_spatial_facts; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_commands
    ADD CONSTRAINT fk_game_commands_spatial_facts FOREIGN KEY (session_id, spatial_fact_set_id) REFERENCES public.spatial_fact_sets(session_id, id) ON DELETE RESTRICT;


--
-- Name: game_events fk_game_events_command; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT fk_game_events_command FOREIGN KEY (session_id, command_id) REFERENCES public.game_commands(session_id, command_id) ON DELETE RESTRICT;


--
-- Name: game_events fk_game_events_job_fencing; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT fk_game_events_job_fencing FOREIGN KEY (session_id, command_id, command_fencing_token) REFERENCES public.command_execution_jobs(session_id, command_id, fencing_token) ON DELETE RESTRICT;


--
-- Name: game_events fk_game_events_session_release; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT fk_game_events_session_release FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT;


--
-- Name: game_events fk_game_events_session_release_serializer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT fk_game_events_session_release_serializer FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT;


--
-- Name: game_events fk_game_events_source_actor; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_events
    ADD CONSTRAINT fk_game_events_source_actor FOREIGN KEY (session_id, source_actor_id) REFERENCES public.game_session_actors(session_id, id) ON DELETE RESTRICT;


--
-- Name: game_session_actors fk_game_session_actors_character; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_actors
    ADD CONSTRAINT fk_game_session_actors_character FOREIGN KEY (character_id) REFERENCES public.characters_v3(id) ON DELETE RESTRICT;


--
-- Name: game_session_actors fk_game_session_actors_controller_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_actors
    ADD CONSTRAINT fk_game_session_actors_controller_member FOREIGN KEY (session_id, controller_user_id) REFERENCES public.game_session_members(session_id, user_id) ON DELETE RESTRICT;


--
-- Name: game_session_actors fk_game_session_actors_owner_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_actors
    ADD CONSTRAINT fk_game_session_actors_owner_member FOREIGN KEY (session_id, owner_user_id) REFERENCES public.game_session_members(session_id, user_id) ON DELETE RESTRICT;


--
-- Name: game_session_actors fk_game_session_actors_session_release; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_actors
    ADD CONSTRAINT fk_game_session_actors_session_release FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT;


--
-- Name: game_session_members fk_game_session_members_session; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_members
    ADD CONSTRAINT fk_game_session_members_session FOREIGN KEY (session_id) REFERENCES public.game_sessions(id) ON DELETE RESTRICT;


--
-- Name: game_session_members fk_game_session_members_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_session_members
    ADD CONSTRAINT fk_game_session_members_user FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: game_sessions fk_game_sessions_creator; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT fk_game_sessions_creator FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: game_sessions fk_game_sessions_release_artifact; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT fk_game_sessions_release_artifact FOREIGN KEY (ruleset_release_id, rules_artifact_hash) REFERENCES public.ruleset_releases(id, rules_artifact_hash) ON DELETE RESTRICT;


--
-- Name: game_sessions fk_game_sessions_release_artifact_serializer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.game_sessions
    ADD CONSTRAINT fk_game_sessions_release_artifact_serializer FOREIGN KEY (ruleset_release_id, rules_artifact_hash, serializer_version) REFERENCES public.ruleset_releases(id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT;


--
-- Name: session_snapshots fk_session_snapshots_last_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_snapshots
    ADD CONSTRAINT fk_session_snapshots_last_event FOREIGN KEY (session_id, last_event_hash) REFERENCES public.game_events(session_id, event_hash) ON DELETE RESTRICT;


--
-- Name: session_snapshots fk_session_snapshots_session_release; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_snapshots
    ADD CONSTRAINT fk_session_snapshots_session_release FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash) ON DELETE RESTRICT;


--
-- Name: session_snapshots fk_session_snapshots_session_release_serializer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.session_snapshots
    ADD CONSTRAINT fk_session_snapshots_session_release_serializer FOREIGN KEY (session_id, ruleset_release_id, rules_artifact_hash, serializer_version) REFERENCES public.game_sessions(id, ruleset_release_id, rules_artifact_hash, serializer_version) ON DELETE RESTRICT;


--
-- Name: spatial_fact_sets fk_spatial_fact_sets_provider_member; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spatial_fact_sets
    ADD CONSTRAINT fk_spatial_fact_sets_provider_member FOREIGN KEY (session_id, provided_by_user_id) REFERENCES public.game_session_members(session_id, user_id) ON DELETE RESTRICT;


--
-- Name: spatial_fact_sets fk_spatial_fact_sets_session; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.spatial_fact_sets
    ADD CONSTRAINT fk_spatial_fact_sets_session FOREIGN KEY (session_id) REFERENCES public.game_sessions(id) ON DELETE RESTRICT;


--
-- Name: transactional_outbox fk_transactional_outbox_event; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactional_outbox
    ADD CONSTRAINT fk_transactional_outbox_event FOREIGN KEY (session_id, event_id) REFERENCES public.game_events(session_id, id) ON DELETE RESTRICT;


--
-- Name: transactional_outbox fk_transactional_outbox_session; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.transactional_outbox
    ADD CONSTRAINT fk_transactional_outbox_session FOREIGN KEY (session_id) REFERENCES public.game_sessions(id) ON DELETE RESTRICT;


--
-- Name: group_members group_members_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: group_members group_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.group_members
    ADD CONSTRAINT group_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: groups groups_dm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.groups
    ADD CONSTRAINT groups_dm_id_fkey FOREIGN KEY (dm_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: inventories inventories_group_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id) ON DELETE CASCADE;


--
-- Name: inventories inventories_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventories
    ADD CONSTRAINT inventories_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: inventory_items inventory_items_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;


--
-- Name: inventory_items inventory_items_inventory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inventory_items
    ADD CONSTRAINT inventory_items_inventory_id_fkey FOREIGN KEY (inventory_id) REFERENCES public.inventories(id) ON DELETE CASCADE;


--
-- Name: oauth_handoffs oauth_handoffs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_handoffs
    ADD CONSTRAINT oauth_handoffs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: oauth_identities oauth_identities_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_identities
    ADD CONSTRAINT oauth_identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: owned_item_grants owned_item_grants_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_item_grants
    ADD CONSTRAINT owned_item_grants_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id) ON DELETE CASCADE;


--
-- Name: owned_item_grants owned_item_grants_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_item_grants
    ADD CONSTRAINT owned_item_grants_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters_v3(id) ON DELETE CASCADE;


--
-- Name: owned_item_grants owned_item_grants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owned_item_grants
    ADD CONSTRAINT owned_item_grants_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: paper_documents paper_documents_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.paper_documents
    ADD CONSTRAINT paper_documents_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: roguelike_combat_events roguelike_combat_events_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_combat_events
    ADD CONSTRAINT roguelike_combat_events_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.roguelike_runs(id) ON DELETE CASCADE;


--
-- Name: roguelike_command_receipts roguelike_command_receipts_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_command_receipts
    ADD CONSTRAINT roguelike_command_receipts_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.roguelike_runs(id) ON DELETE CASCADE;


--
-- Name: roguelike_command_receipts roguelike_command_receipts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_command_receipts
    ADD CONSTRAINT roguelike_command_receipts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: roguelike_item_rules roguelike_item_rules_card_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_item_rules
    ADD CONSTRAINT roguelike_item_rules_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.cards(id);


--
-- Name: roguelike_runs roguelike_runs_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_runs
    ADD CONSTRAINT roguelike_runs_character_id_fkey FOREIGN KEY (character_id) REFERENCES public.characters_v3(id) ON DELETE RESTRICT;


--
-- Name: roguelike_runs roguelike_runs_source_character_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_runs
    ADD CONSTRAINT roguelike_runs_source_character_id_fkey FOREIGN KEY (source_character_id) REFERENCES public.characters_v3(id) ON DELETE RESTRICT;


--
-- Name: roguelike_runs roguelike_runs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roguelike_runs
    ADD CONSTRAINT roguelike_runs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


