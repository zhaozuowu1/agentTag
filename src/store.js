import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_COLORS = [
  '#6366f1', '#ec4899', '#f59e0b', '#10b981',
  '#06b6d4', '#8b5cf6', '#ef4444', '#14b8a6',
];

/**
 * A tiny file-backed store for tags. Persistence is a single JSON file so the
 * app runs with zero external services (no database needed for local dev).
 */
export class TagStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.tags = [];
    this.#load();
  }

  #load() {
    if (this.filePath && existsSync(this.filePath)) {
      try {
        const raw = readFileSync(this.filePath, 'utf8');
        this.tags = JSON.parse(raw);
      } catch {
        this.tags = [];
      }
    }
  }

  #persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.tags, null, 2));
  }

  list({ search } = {}) {
    let result = [...this.tags];
    if (search) {
      const needle = search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(needle) ||
          (t.description ?? '').toLowerCase().includes(needle),
      );
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id) {
    return this.tags.find((t) => t.id === id) ?? null;
  }

  create({ name, color, description }) {
    const trimmed = (name ?? '').trim();
    if (!trimmed) {
      const err = new Error('Tag name is required');
      err.status = 400;
      throw err;
    }
    if (this.tags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      const err = new Error(`Tag "${trimmed}" already exists`);
      err.status = 409;
      throw err;
    }
    const tag = {
      id: randomUUID(),
      name: trimmed,
      color: color || DEFAULT_COLORS[this.tags.length % DEFAULT_COLORS.length],
      description: (description ?? '').trim(),
      createdAt: new Date().toISOString(),
    };
    this.tags.push(tag);
    this.#persist();
    return tag;
  }

  update(id, { name, color, description }) {
    const tag = this.get(id);
    if (!tag) return null;
    if (name !== undefined) {
      const trimmed = name.trim();
      if (!trimmed) {
        const err = new Error('Tag name cannot be empty');
        err.status = 400;
        throw err;
      }
      if (
        this.tags.some(
          (t) => t.id !== id && t.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        const err = new Error(`Tag "${trimmed}" already exists`);
        err.status = 409;
        throw err;
      }
      tag.name = trimmed;
    }
    if (color !== undefined) tag.color = color;
    if (description !== undefined) tag.description = description.trim();
    this.#persist();
    return tag;
  }

  remove(id) {
    const index = this.tags.findIndex((t) => t.id === id);
    if (index === -1) return false;
    this.tags.splice(index, 1);
    this.#persist();
    return true;
  }
}
