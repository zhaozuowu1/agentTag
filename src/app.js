import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { TagStore } from './store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build the Express application. A store can be injected for tests; otherwise a
 * file-backed store is created at the given (or default) data path.
 */
export function createApp({ store, dataFile } = {}) {
  const app = express();
  app.use(express.json());

  const tagStore =
    store ??
    new TagStore(dataFile ?? join(__dirname, '..', 'data', 'tags.json'));

  const api = express.Router();

  api.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'agentTag', time: new Date().toISOString() });
  });

  api.get('/tags', (req, res) => {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    res.json(tagStore.list({ search }));
  });

  api.get('/tags/:id', (req, res) => {
    const tag = tagStore.get(req.params.id);
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    res.json(tag);
  });

  api.post('/tags', (req, res, next) => {
    try {
      const tag = tagStore.create(req.body ?? {});
      res.status(201).json(tag);
    } catch (err) {
      next(err);
    }
  });

  api.put('/tags/:id', (req, res, next) => {
    try {
      const tag = tagStore.update(req.params.id, req.body ?? {});
      if (!tag) return res.status(404).json({ error: 'Tag not found' });
      res.json(tag);
    } catch (err) {
      next(err);
    }
  });

  api.delete('/tags/:id', (req, res) => {
    const removed = tagStore.remove(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Tag not found' });
    res.status(204).end();
  });

  app.use('/api', api);
  app.use(express.static(join(__dirname, '..', 'public')));

  app.use((err, _req, res, _next) => {
    const status = err.status ?? 500;
    res.status(status).json({ error: err.message ?? 'Internal server error' });
  });

  return app;
}
