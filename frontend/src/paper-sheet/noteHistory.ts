export interface NoteSelection {
  start: number;
  end: number;
  direction?: 'forward' | 'backward' | 'none';
}

export interface NoteSnapshot extends NoteSelection { text: string }
interface NoteEdit { before: NoteSnapshot; after: NoteSnapshot; kind: string; time: number }
const MAX_EDITS = 100;
const GROUP_DELAY = 1000;

function snapshot(text: string, selection: NoteSelection): NoteSnapshot {
  const start = Math.max(0, Math.min(selection.start, text.length));
  return { text, start, end: Math.max(start, Math.min(selection.end, text.length)), direction: selection.direction ?? 'none' };
}

/** Beforeinput is authoritative; this fallback also covers accessibility/programmatic input. */
export function changedTextSelection(before: string, after: string): NoteSelection {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = before.length;
  let afterEnd = after.length;
  while (end > start && afterEnd > start && before[end - 1] === after[afterEnd - 1]) { end--; afterEnd--; }
  return { start, end };
}

/** Stores only one section's text and caret, never a document/equipment snapshot. */
export class PaperNoteHistory {
  private past: NoteEdit[] = [];
  private future: NoteEdit[] = [];
  private grouped = false;
  private present: NoteSnapshot;

  constructor(text: string) { this.present = snapshot(text, { start: text.length, end: text.length }); }

  sync(text: string): void {
    if (text === this.present.text) return;
    this.present = snapshot(text, this.present);
    this.past = [];
    this.future = [];
    this.breakGroup();
  }

  remember(selection: NoteSelection): void {
    const next = snapshot(this.present.text, selection);
    if (next.start !== this.present.start || next.end !== this.present.end) this.breakGroup();
    this.present = next;
  }

  breakGroup(): void { this.grouped = false; }

  record(text: string, selection: NoteSelection, beforeSelection?: NoteSelection, kind = 'edit', time = Date.now()): void {
    const before = snapshot(this.present.text, beforeSelection ?? changedTextSelection(this.present.text, text));
    const after = snapshot(text, selection);
    if (text === before.text) { this.present = after; return; }
    const previous = this.past.at(-1);
    const simpleInput = ['insertText', 'deleteContentBackward', 'deleteContentForward'].includes(kind);
    const canGroup = this.grouped && simpleInput && previous?.kind === kind && time - previous.time < GROUP_DELAY
      && before.start === before.end && previous.after.start === before.start && previous.after.end === before.end
      && !text.slice(changedTextSelection(before.text, text).start, after.start).includes('\n');
    if (canGroup && previous) { previous.after = after; previous.time = time; }
    else { this.past.push({ before, after, kind, time }); if (this.past.length > MAX_EDITS) this.past.shift(); }
    this.future = [];
    this.present = after;
    this.grouped = simpleInput;
  }

  undo(): NoteSnapshot | undefined {
    const edit = this.past.pop();
    if (!edit) return undefined;
    this.future.push(edit);
    this.present = edit.before;
    this.breakGroup();
    return { ...this.present };
  }

  redo(): NoteSnapshot | undefined {
    const edit = this.future.pop();
    if (!edit) return undefined;
    this.past.push(edit);
    this.present = edit.after;
    this.breakGroup();
    return { ...this.present };
  }
}

const sessions = new WeakMap<object, Map<string, PaperNoteHistory>>();

/** The stable React state setter identifies the live sheet session. */
export function paperNoteHistory(owner: object, section: string, text: string): PaperNoteHistory {
  let sections = sessions.get(owner);
  if (!sections) { sections = new Map(); sessions.set(owner, sections); }
  let history = sections.get(section);
  if (!history) { history = new PaperNoteHistory(text); sections.set(section, history); }
  history.sync(text);
  return history;
}

/** Call before replacing the complete sheet, including import/new with identical text. */
export function resetPaperNoteHistory(owner: object): void { sessions.delete(owner); }
