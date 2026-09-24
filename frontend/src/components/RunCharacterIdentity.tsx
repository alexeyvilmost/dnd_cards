import {useEffect, useState} from 'react';
import {classesApi, racesApi} from '../api/client';
import type {ForgeCharacter} from '../character/types';

/** Catalog names, never inferred from preset IDs or personal character names. */
export default function RunCharacterIdentity({character, name = character.name}: {
  character: Pick<ForgeCharacter, 'name' | 'avatar_url' | 'race_id' | 'class_id' | 'level' | 'class_levels'>;
  name?: string;
}) {
  const [race, setRace] = useState('Вид не указан');
  const [classes, setClasses] = useState('Класс не указан');
  const classKey = JSON.stringify(character.class_levels && Object.keys(character.class_levels).length
    ? Object.entries(character.class_levels) : character.class_id ? [[character.class_id, character.level]] : []);
  useEffect(() => {
    let active = true;
    setRace(character.race_id ? '…' : 'Вид не указан');
    if (character.race_id) void racesApi.getRace(character.race_id)
      .then(value => {if (active) setRace(value.name);})
      .catch(() => {if (active) setRace('Вид недоступен');});
    return () => {active = false;};
  }, [character.race_id]);
  useEffect(() => {
    let active = true;
    const levels = JSON.parse(classKey) as [string, number][];
    setClasses(levels.length ? '…' : 'Класс не указан');
    void Promise.all(levels.map(async ([id, level]) => `${(await classesApi.getClass(id)).name} — ${level}`))
      .then(names => {if (active && names.length) setClasses(names.join(', '));})
      .catch(() => {if (active) setClasses(`Уровень ${character.level}`);});
    return () => {active = false;};
  }, [classKey, character.level]);
  return <span className="run-character-identity">
    {character.avatar_url && <img src={character.avatar_url} alt="" loading="lazy" />}
    <span className="run-character-description"><strong>{name}</strong><span aria-hidden="true"> | </span><span>{race}</span><span aria-hidden="true"> | </span><span>{classes}</span></span>
  </span>;
}
