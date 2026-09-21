# Ghar

Home automation for dadi. Owns the Matter fabric, device registry, rooms/tags, live state, and command/event APIs. Agents reach Ghar through Dimaag tools. Unauthenticated; private mesh only.

## Dependencies

- Postgres (`DATABASE_URL`)
- Matter fabric storage (`MATTER_STORAGE_PATH`) — persists credentials and commissioned peers
- Nas for mesh DNS, compose/prod networking, host-network Matter on the appliance, and the shared logging contract

## Layout

```
ghar/
  src/
    app.ts, config.ts, logging.ts, errors.ts, constants.ts
    db/           Drizzle client, schema, migrate, seed
    matter/       fabric controller, commissioning, subscriptions, commands
    routers/      HTTP routes + schemas
    types/        domain types
  test/
  drizzle/
  config.toml
```

## Config vs env

`config.toml` (checked in): page `default_size` / `max_size`.

Default bind is `0.0.0.0:8080` in `src/constants.ts`. Prod host-networked Ghar sets `HOST=127.0.0.1` and `PORT=8084` so the listener (not a bridge network) is the boundary around the fabric.

`DATABASE_URL` and `MATTER_STORAGE_PATH` are required at process startup (no empty defaults). Migrate oneshots only need `DATABASE_URL` (`loadDatabaseConfig`). Nas injects both in compose and on the appliance. There is no Ghar `.env` — Postgres and Matter storage are not Preferences-editable.

## Local run

```sh
cd ../nas
docker compose up ghar ghar-postgres
docker compose run --rm ghar-migrate
docker compose run --rm ghar npm test
```

Source is bind-mounted; edits restart in place. Matter discovery does not work on Mac Docker — HTTP and DB paths still run; commands/commissioning fail loudly until a real fabric is available.

## CI / CD

| Workflow | When | What |
| --- | --- | --- |
| `ci.yml` → `ci` | PR + push to `main` | Postgres service, migrate, `npm test`, build images |
| `ci.yml` → `publish` | `main` after `ci` | Push `ghcr.io/<owner>/ghar:{latest,sha}` |

## Logging / error codes

Logs follow the nas JSON contract (`service=ghar`, request summary with `request_id` / `duration_ms`, errors with `code`). Default Fastify access logging is off. Process-level Matter/boot lines use the same JSON shape via `createLogger()`.

HTTP errors: `{ "error": { "type": "<code>", "message": "..." } }`. Shared codes include `invalid_request`, `not_found`, `conflict`, `internal_error`. Domain codes include `commissioning_failed`, `device_unreachable`, `radio_unavailable`. See nas README for the shared catalog.

## Matter / fabric

The HTTP server listens before the Matter controller finishes starting. Until the controller is ready, command and commission routes return `503 internal_error`. On the appliance, Ghar uses `Network=host` with loopback HTTP bind; fabric storage lives on the `ghar_matter` volume and must survive image updates.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | `{ "status": "ok" }` |
| `GET` | `/devices` | filter by `room`, `tag`, `capability` |
| `GET` | `/devices/:id` | device detail |
| `PATCH` | `/devices/:id` | name, room, tags |
| `DELETE` | `/devices/:id` | remove registry row / peer |
| `POST` | `/devices/:id/command` | capability + params; optional `cause` / `cause_ref` |
| `POST` | `/devices/:id/identify` | blink the device for a few seconds |
| `GET` | `/rooms` | list rooms |
| `POST` | `/rooms` | create room |
| `PATCH` | `/rooms/:id` | rename (not `unassigned`) |
| `DELETE` | `/rooms/:id` | delete room |
| `GET` | `/tags` | distinct tag names |
| `GET` | `/state` | live attribute cache snapshot |
| `GET` | `/events` | `event_logs` query (`since`, `until`, filters, page) |
| `POST` | `/commission` | `202` + `job_id`. Optional `room_id`. `radio` is `network` (default) or `nearby`. Nearby requires `wifi` and an attached Hath radio, otherwise `422 radio_unavailable`. Wi-Fi credentials are not stored. |
| `GET` | `/commission/:jobId` | poll job (failed jobs still `200` with reason in payload) |
| `POST` | `/radio/attach` | `201` + `session_id`. One Hath Bluetooth radio at a time (`409` if taken) |
| `POST` | `/radio/detach` | release the radio session |
| `GET` | `/radio/commands` | long-poll the next GATT or scan command (`wait_ms`, max 25000) |
| `POST` | `/radio/reply` | complete a command |
| `POST` | `/radio/event` | advertisement, notification, or disconnect |

Unknown request fields are a 422.
