# agentTag

A small full-stack web app for creating, searching, and managing **tags** (labels)
for your AI agents. It ships with a JSON REST API and a modern single-page UI, and
runs with zero external services — tags are persisted to a local JSON file.

## Tech stack

- **Backend:** Node.js + [Express](https://expressjs.com/) (ES modules)
- **Frontend:** Vanilla HTML/CSS/JS single-page app served statically
- **Storage:** File-backed JSON store (`data/tags.json`), no database required
- **Tests:** Node's built-in `node:test` runner

## Requirements

- Node.js >= 20 (developed against Node 22)

## Getting started

```bash
npm install       # install dependencies
npm run dev       # start with auto-reload at http://localhost:3000
# or
npm start         # start without watch mode
```

Then open http://localhost:3000 in your browser.

## Scripts

| Command       | Description                                   |
| ------------- | --------------------------------------------- |
| `npm start`   | Start the server                              |
| `npm run dev` | Start the server with file watching/reload    |
| `npm test`    | Run the automated test suite                  |

## Configuration

| Variable | Default   | Description              |
| -------- | --------- | ------------------------ |
| `PORT`   | `3000`    | Port the server binds to |
| `HOST`   | `0.0.0.0` | Host the server binds to |

## API

| Method   | Path             | Description                          |
| -------- | ---------------- | ------------------------------------ |
| `GET`    | `/api/health`    | Health check                         |
| `GET`    | `/api/tags`      | List tags (`?search=` to filter)     |
| `POST`   | `/api/tags`      | Create a tag                         |
| `GET`    | `/api/tags/:id`  | Fetch a single tag                   |
| `PUT`    | `/api/tags/:id`  | Update a tag                         |
| `DELETE` | `/api/tags/:id`  | Delete a tag                         |

### Example

```bash
curl -X POST localhost:3000/api/tags \
  -H 'Content-Type: application/json' \
  -d '{"name":"production","description":"Live customer-facing agents"}'
```

## Project layout

```
src/
  index.js   # server entry point
  app.js     # Express app factory + routes
  store.js   # file-backed tag store
public/      # static single-page UI (index.html, styles.css, app.js)
test/        # API integration tests
```

## Cloud Agent environment

This repository includes a [`.cursor/environment.json`](.cursor/environment.json)
that installs dependencies with `npm install` and runs the dev server as a
`dev-server` terminal on port `3000`.
