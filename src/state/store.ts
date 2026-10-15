import { clone, defaultProject, normaliseProject, type Project } from './project';

export type Topic = 'fx' | 'palette' | 'audio' | 'beat' | 'clip' | 'canvas' | 'all';
type Listener = (topic: Topic) => void;

const STORAGE_KEY = 'klangbild.project.v1';

/**
 * Single mutable project + change notifications + undo history.
 * Mutate via `update(topic, fn)`, which notifies listeners and records history.
 */
class Store {
  project: Project;
  private listeners = new Set<Listener>();
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private lastSnapshot: string;
  private commitTimer = 0;
  private saveTimer = 0;

  constructor() {
    let p = defaultProject();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) p = normaliseProject(JSON.parse(raw));
    } catch {
      /* storage unavailable */
    }
    this.project = p;
    this.lastSnapshot = JSON.stringify(p);
  }

  get p(): Project {
    return this.project;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(topic: Topic): void {
    for (const l of this.listeners) l(topic);
  }

  update(topic: Topic, fn: (p: Project) => void, opts: { history?: boolean } = {}): void {
    fn(this.project);
    this.emit(topic);
    if (opts.history !== false) this.scheduleCommit();
    this.scheduleSave();
  }

  replace(p: Project): void {
    this.project = normaliseProject(clone(p));
    this.emit('all');
    this.scheduleCommit();
    this.scheduleSave();
  }

  private scheduleCommit(): void {
    clearTimeout(this.commitTimer);
    this.commitTimer = window.setTimeout(() => this.commit(), 350);
  }

  private commit(): void {
    const snap = JSON.stringify(this.project);
    if (snap === this.lastSnapshot) return;
    this.undoStack.push(this.lastSnapshot);
    if (this.undoStack.length > 120) this.undoStack.shift();
    this.redoStack.length = 0;
    this.lastSnapshot = snap;
  }

  private scheduleSave(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.project));
      } catch {
        /* ignore quota / private mode */
      }
    }, 500);
  }

  undo(): void {
    this.commit();
    const prev = this.undoStack.pop();
    if (!prev) return;
    this.redoStack.push(this.lastSnapshot);
    this.lastSnapshot = prev;
    this.project = normaliseProject(JSON.parse(prev));
    this.emit('all');
    this.scheduleSave();
  }

  redo(): void {
    const next = this.redoStack.pop();
    if (!next) return;
    this.undoStack.push(this.lastSnapshot);
    this.lastSnapshot = next;
    this.project = normaliseProject(JSON.parse(next));
    this.emit('all');
    this.scheduleSave();
  }
}

export const store = new Store();
