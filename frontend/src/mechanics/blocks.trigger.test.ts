import { describe, it, expect } from 'vitest';
import { buildMechanics, deserializeMechanics } from './blocks';

// S2: продвинутый триггер trg_custom (event/timing/subject/circumstances + reaction) и
// сохранение обратной совместимости с простыми trigger-блоками.

describe('trg_custom — build', () => {
  it('реакция с событием, условиями и uses', () => {
    const m = buildMechanics('trg_custom', {
      mode: 'reaction', event: 'damage_taken', timing: 'after', subject: '',
      uses_count: '2', uses_per: 'short_rest',
      circumstances: [{ kind: 'you_have_condition', value: 'raging' }],
    }, []);
    const act = m?.activation as Record<string, unknown>;
    expect(act.mode).toBe('reaction');
    const tr = act.trigger as Record<string, unknown>;
    expect(tr.event).toBe('damage_taken');
    expect(tr.circumstances).toEqual([{ kind: 'you_have_condition', value: 'raging' }]);
    expect(m?.uses).toEqual({ count: 2, per: 'short_rest' });
  });

  it('без subject/условий/uses пишет минимальный триггер', () => {
    const m = buildMechanics('trg_custom', { mode: 'triggered', event: 'spell_cast', timing: 'after', subject: '', uses_count: '' }, []);
    const tr = (m?.activation as Record<string, unknown>).trigger as Record<string, unknown>;
    expect(tr).toEqual({ event: 'spell_cast', timing: 'after' });
    expect(m?.uses).toBeUndefined();
  });

  it('subject пишется только если задан', () => {
    const withSubj = buildMechanics('trg_custom', { mode: 'triggered', event: 'hit', timing: 'after', subject: 'target', uses_count: '' }, []);
    const tr = (withSubj?.activation as Record<string, unknown>).trigger as Record<string, unknown>;
    expect(tr.subject).toBe('target');
  });
});

describe('trg_custom — deserialize', () => {
  it('реакция → trg_custom с mode=reaction', () => {
    const d = deserializeMechanics({
      activation: { mode: 'reaction', trigger: { event: 'hit', timing: 'after', circumstances: [{ kind: 'target_has_condition', value: 'prone' }] } },
      effects: [],
    });
    expect(d?.triggerId).toBe('trg_custom');
    expect(d?.triggerValues.mode).toBe('reaction');
    expect(d?.triggerValues.event).toBe('hit');
    expect(d?.triggerValues.circumstances).toEqual([{ kind: 'target_has_condition', value: 'prone' }]);
  });

  it('обычное событие hit → trg_custom', () => {
    const d = deserializeMechanics({ activation: { mode: 'triggered', trigger: { event: 'hit', timing: 'after' } }, effects: [] });
    expect(d?.triggerId).toBe('trg_custom');
    expect(d?.triggerValues.event).toBe('hit');
  });

  it('long_rest с условиями → trg_custom (простой блок потерял бы условия)', () => {
    const d = deserializeMechanics({
      activation: { mode: 'triggered', trigger: { event: 'long_rest', timing: 'after', circumstances: [{ kind: 'has_advantage' }] } },
      effects: [],
    });
    expect(d?.triggerId).toBe('trg_custom');
  });
});

describe('обратная совместимость простых триггеров', () => {
  it('простой long_rest остаётся trg_long_rest', () => {
    const d = deserializeMechanics({ activation: { mode: 'triggered', trigger: { event: 'long_rest', timing: 'after' } }, effects: [] });
    expect(d?.triggerId).toBe('trg_long_rest');
  });

  it('reduced_to_0_hp остаётся trg_zero_hp с uses', () => {
    const d = deserializeMechanics({
      activation: { mode: 'triggered', trigger: { event: 'reduced_to_0_hp', timing: 'replaces' } },
      uses: { count: 1, per: 'long_rest' }, effects: [],
    });
    expect(d?.triggerId).toBe('trg_zero_hp');
  });

  it('d20=1 паттерн остаётся trg_d20_one', () => {
    const d = deserializeMechanics({
      activation: { mode: 'triggered', trigger: { event: 'attack_roll_made', timing: 'replaces', circumstances: [{ kind: 'd20_equals', value: 1 }] } },
      effects: [],
    });
    expect(d?.triggerId).toBe('trg_d20_one');
    expect(d?.triggerValues.event).toBe('attack_roll_made');
  });

  it('active режим остаётся trg_active', () => {
    const d = deserializeMechanics({
      activation: { mode: 'active', cost: [{ resource: 'bonus_action' }] },
      uses: { count: 'prof_bonus', per: 'long_rest' }, effects: [],
    });
    expect(d?.triggerId).toBe('trg_active');
  });
});
