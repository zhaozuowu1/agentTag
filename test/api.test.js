import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { TagStore } from '../src/store.js';

let server;
let baseUrl;
let store;

before(async () => {
  store = new TagStore(null); // in-memory only, no file persistence
  const app = createApp({ store });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server?.close();
});

beforeEach(() => {
  store.tags = [];
});

async function req(path, options) {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('health endpoint responds ok', async () => {
  const { status, body } = await req('/api/health');
  assert.equal(status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.service, 'agentTag');
});

test('creates and lists a tag', async () => {
  const created = await req('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: 'production', description: 'live agents' }),
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'production');
  assert.ok(created.body.id);
  assert.ok(created.body.color);

  const list = await req('/api/tags');
  assert.equal(list.status, 200);
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].name, 'production');
});

test('rejects an empty tag name', async () => {
  const { status, body } = await req('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: '   ' }),
  });
  assert.equal(status, 400);
  assert.match(body.error, /required/i);
});

test('rejects duplicate tag names (case-insensitive)', async () => {
  await req('/api/tags', { method: 'POST', body: JSON.stringify({ name: 'Staging' }) });
  const dup = await req('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: 'staging' }),
  });
  assert.equal(dup.status, 409);
});

test('searches tags by name and description', async () => {
  await req('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: 'production', description: 'critical path' }),
  });
  await req('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: 'sandbox', description: 'experiments' }),
  });

  const byName = await req('/api/tags?search=prod');
  assert.equal(byName.body.length, 1);
  assert.equal(byName.body[0].name, 'production');

  const byDesc = await req('/api/tags?search=experiment');
  assert.equal(byDesc.body.length, 1);
  assert.equal(byDesc.body[0].name, 'sandbox');
});

test('updates a tag', async () => {
  const created = await req('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: 'temp' }),
  });
  const updated = await req(`/api/tags/${created.body.id}`, {
    method: 'PUT',
    body: JSON.stringify({ name: 'permanent', description: 'renamed' }),
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.name, 'permanent');
  assert.equal(updated.body.description, 'renamed');
});

test('deletes a tag', async () => {
  const created = await req('/api/tags', {
    method: 'POST',
    body: JSON.stringify({ name: 'to-delete' }),
  });
  const del = await req(`/api/tags/${created.body.id}`, { method: 'DELETE' });
  assert.equal(del.status, 204);

  const list = await req('/api/tags');
  assert.equal(list.body.length, 0);
});

test('returns 404 for a missing tag', async () => {
  const { status } = await req('/api/tags/does-not-exist');
  assert.equal(status, 404);
});
