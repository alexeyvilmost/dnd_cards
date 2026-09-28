import {useEffect, useState} from 'react';
import {createPortal} from 'react-dom';
import {useNavigate} from 'react-router-dom';
import {roguelikeApi, type RoguelikeRun, type UrvinDefinition} from '../roguelike/api';
import {isRunEligible} from '../roguelike/eligibility';
import type {ForgeCharacter} from '../character/types';
import DialogShell from './DialogShell';
import SheetActionLine from './SheetActionLine';
import {useSiteSettings} from '../settings';
import './UrvinJourney.css';
import './StartRunFromSheet.css';

function runBelongsToSource(run: RoguelikeRun, sourceId: string): boolean {
  if (run.source_character_id === sourceId) return true;
  return (run.party?.members ?? []).some((member) => member.source_character_id === sourceId);
}

function statusLabel(status: RoguelikeRun['status']): string {
  return ({active: 'Активный', victory: 'Победа', defeat: 'Поражение', abandoned: 'Завершён'} as const)[status] ?? status;
}

export default function StartRunFromSheet({character}: {character: ForgeCharacter}) {
  const navigate = useNavigate();
  const eligible = isRunEligible(character);
  const {entityDisplay} = useSiteSettings();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runs, setRuns] = useState<RoguelikeRun[]>([]);
  const [mode, setMode] = useState<'classic' | 'urvin'>('classic');
  const [definition, setDefinition] = useState<UrvinDefinition>();
  const [aura, setAura] = useState('');
  const [modeError, setModeError] = useState('');
  const [modeAttempt, setModeAttempt] = useState(0);

  useEffect(() => {
    if (!open || !eligible) return;
    let active = true;
    setError('');
    setModeError('');
    void roguelikeApi.list().then((listed) => {
      if (!active) return;
      setRuns(listed.filter((run) => runBelongsToSource(run, character.id)));
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Не удалось загрузить забеги');
    });
    void roguelikeApi.modes().then((modes) => {
      if (active) setDefinition(modes);
    }).catch(() => {
      if (active) setModeError('Не удалось загрузить ауры.');
    });
    return () => { active = false; };
  }, [open, eligible, character.id, modeAttempt]);

  if (!eligible) return null;

  const start = async () => {
    if (busy) return;
    if (mode === 'urvin' && !aura) {
      setError('Выберите стартовую ауру');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const run = mode === 'urvin'
        ? await roguelikeApi.create(character.id, {mode: 'urvin', aura_id: aura})
        : await roguelikeApi.create(character.id);
      navigate(`/roguelike/${run.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось начать забег');
      setBusy(false);
    }
  };

  return <>
    <button type="button" className="sheet-header-btn" onClick={() => setOpen(true)}
      aria-description="Выбрать существующий забег или начать новый на основе этого листа.">
      Начать забег
    </button>
    {open && createPortal(<DialogShell label="Забег персонажа" onCancel={() => !busy && setOpen(false)} wrap>
      <div className="start-run-dialog" tabIndex={-1}>
        <h2>Забег · {character.name}</h2>
        <p className="start-run-dialog__lead">
          Каждый забег создаёт отдельную копию листа. Исходный персонаж можно использовать для нескольких забегов одновременно.
        </p>
        {error && <div className="start-run-dialog__error" role="alert">{error}</div>}

        <section className="start-run-dialog__section" aria-label="Существующие забеги">
          <h3>Забеги этого персонажа</h3>
          {runs.length === 0 ? (
            <p className="start-run-dialog__empty">Пока нет забегов на основе этого листа.</p>
          ) : (
            <ul className="start-run-dialog__runs">
              {runs.map((run) => (
                <li key={run.id}>
                  <button type="button" className="start-run-dialog__run" disabled={busy}
                    onClick={() => navigate(`/roguelike/${run.id}`)}>
                    <strong>{run.mode === 'urvin' ? 'Урвинский' : 'Классический'}</strong>
                    <span>{statusLabel(run.status)} · попытка {run.attempt} · побед {run.encounters_won}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="start-run-dialog__section" aria-label="Новый забег">
          <h3>Начать новый</h3>
          <>
              <div className="urvin-mode-switch" role="group" aria-label="Вариант забега">
                <button type="button" aria-pressed={mode === 'classic'} onClick={() => setMode('classic')}>Классический</button>
                <button type="button" aria-pressed={mode === 'urvin'} onClick={() => setMode('urvin')}>Урвинский</button>
              </div>
              {mode === 'urvin' && (
                <div className="start-run-dialog__auras">
                  <h4>Стартовая аура</h4>
                  {!definition ? <p>{modeError || 'Загружаем ауры…'}{modeError && <button type="button" onClick={() => setModeAttempt(value => value + 1)}>Повторить</button>}</p> : (
                    <div className={entityDisplay.effects === 'icon' ? 'cs-action-tiles' : undefined}>
                      {definition.auras.map((effect) => (
                        <SheetActionLine key={effect.id} effectRef={effect} name={effect.name}
                          imageUrl={effect.image_url} variant={entityDisplay.effects}
                          selected={aura === effect.id} disabled={busy} onActivate={() => setAura(effect.id)} />
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="start-run-dialog__actions">
                <button type="button" className="roguelike-primary" disabled={busy || (mode === 'urvin' && !aura)}
                  onClick={() => void start()}>
                  {busy ? 'Создаём…' : mode === 'urvin' ? 'Начать Урвинский забег' : 'Начать классический забег'}
                </button>
                <button type="button" className="sheet-header-btn" disabled={busy} onClick={() => setOpen(false)}>Отмена</button>
              </div>
          </>
        </section>
      </div>
    </DialogShell>, document.body)}
  </>;
}
