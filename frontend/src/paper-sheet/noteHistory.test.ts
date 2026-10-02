import { describe, expect, it } from 'vitest';
import { PaperNoteHistory, paperNoteHistory, resetPaperNoteHistory } from './noteHistory';

describe('section text history', () => {
  it('groups adjacent typing but separates newlines, formatting and cursor movement', () => {
    const history = new PaperNoteHistory('');
    history.record('a', { start: 1, end: 1 }, { start: 0, end: 0 }, 'insertText', 100);
    history.record('ab', { start: 2, end: 2 }, { start: 1, end: 1 }, 'insertText', 200);
    history.record('ab\n', { start: 3, end: 3 }, { start: 2, end: 2 }, 'insertLineBreak', 300);
    expect(history.undo()).toMatchObject({ text: 'ab', start: 2, end: 2 });
    expect(history.undo()).toMatchObject({ text: '', start: 0, end: 0 });
    expect(history.redo()).toMatchObject({ text: 'ab', start: 2, end: 2 });
    history.record('**ab**', { start: 6, end: 6 }, { start: 0, end: 2, direction: 'backward' });
    expect(history.redo()).toBeUndefined();
    expect(history.undo()).toMatchObject({ text: 'ab', start: 0, end: 2, direction: 'backward' });
  });

  it('keeps each section independent across editor remounts and resets for a new document with identical text', () => {
    const owner = {};
    const first = paperNoteHistory(owner, 'first', 'Первый');
    first.record('Первый!', { start: 7, end: 7 });
    const second = paperNoteHistory(owner, 'second', 'Второй');
    second.record('Второй!', { start: 7, end: 7 });
    expect(paperNoteHistory(owner, 'first', 'Первый!')).toBe(first);
    expect(first.undo()?.text).toBe('Первый');
    expect(second.undo()?.text).toBe('Второй');
    resetPaperNoteHistory(owner);
    expect(paperNoteHistory(owner, 'first', 'Первый').undo()).toBeUndefined();
  });

  it('discards history when the section text is externally replaced and retains it for unchanged text', () => {
    const history = new PaperNoteHistory('Before');
    history.record('After', { start: 5, end: 5 });
    history.sync('After');
    expect(history.undo()?.text).toBe('Before');
    history.sync('Imported');
    expect(history.undo()).toBeUndefined();
    expect(history.redo()).toBeUndefined();
  });
});
