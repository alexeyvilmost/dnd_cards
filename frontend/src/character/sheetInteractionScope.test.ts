import { expect, it } from 'vitest';
import { runCampTargetIssue, sheetTargetBelongsToScope } from './sheetInteractionScope';

it('isolates a run from other characters in both directions', () => {
  const run = { id: 'run-hero', character_type: 'dungeon_crawl' as const };
  const ordinary = { id: 'ordinary', character_type: 'free' as const };
  expect(sheetTargetBelongsToScope(run, run)).toBe(true);
  expect(sheetTargetBelongsToScope(run, ordinary)).toBe(false);
  expect(sheetTargetBelongsToScope(ordinary, run)).toBe(false);
  expect(sheetTargetBelongsToScope(run, { ...run, id: 'other-run' })).toBe(false);
  expect(sheetTargetBelongsToScope(ordinary, { ...ordinary, id: 'friend' })).toBe(true);
});
it('requires the combat board for other-target run actions while retaining self-use', () => {
  expect(runCampTargetIssue('dungeon_crawl', true, false)).toContain('поле боя');
  expect(runCampTargetIssue('dungeon_crawl', true, true)).toBeNull();
  expect(runCampTargetIssue('dungeon_crawl', false, false)).toBeNull();
  expect(runCampTargetIssue('free', true, false)).toBeNull();
});
