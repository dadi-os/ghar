# Ghar

Home automation for dadi. Owns the Matter fabric, device registry, rooms/tags, live state, and command/event APIs. Agents reach Ghar through Hath tools. Unauthenticated; private mesh only.

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
    matter/       fabric controller, commissioning, registry, subscriptions
      capabilities.ts  device kind + capabilities from an endpoint's Descriptor and features
      attributes.ts    attributes cached and cluster events logged, with their Ghar units
      commands/        command table by capability (lighting, covers, climate, appliances, media)
    routers/      HTTP routes + schemas
    types/        domain types
  test/
  drizzle/
  config.toml
```

## Config vs env

`config.toml` (checked in): page `default_size` / `max_size`.

Default bind is `0.0.0.0:8080` in `src/constants.ts`. Prod host-networked Ghar sets `HOST=127.0.0.1` and `PORT=8084` so the listener (not a bridge network) is the boundary around the fabric.

`DATABASE_URL` and `MATTER_STORAGE_PATH` are required at process startup (no empty defaults). Migrate oneshots only need `DATABASE_URL` (`loadDatabaseConfig`). Nas injects both in compose and on the appliance. There is no Ghar `.env` — Postgres and Matter storage are not Preferences-editable; `.env.example` documents both.

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

HTTP errors: `{ "error": { "type": "<code>", "message": "..." } }`. Shared codes include `invalid_request`, `not_found`, `conflict`, `internal_error`. Domain codes include `commissioning_failed`, `capability_unsupported`, `command_rejected` (the device refused a command it received), `device_unreachable`, `radio_unavailable`, `matter_unavailable`, `peer_delete_failed`. See nas README for the shared catalog.

## Matter / fabric

The HTTP server listens before the Matter controller finishes starting. Until the controller is ready, command and commission routes return `503 internal_error`. If the controller fails to start, `/health` returns `503 matter_unavailable` with the real reason, so Nas status shows Ghar unhealthy. On the appliance, Ghar uses `Network=host` with loopback HTTP bind; fabric storage lives on the `ghar_matter` volume and must survive image updates.

## Routes

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | `{ "status": "ok" }`; `503 matter_unavailable` when the Matter controller failed to start |
| `GET` | `/devices` | filter by `room`, `tag`, `capability`, `kind` |
| `GET` | `/devices/:id` | device detail |
| `PATCH` | `/devices/:id` | name, room, tags |
| `DELETE` | `/devices/:id` | remove registry row / peer; `500 peer_delete_failed` when the peer cannot be removed from the fabric |
| `POST` | `/devices/:id/command` | `capability`, `command`, `params`; optional `cause` / `cause_ref` (see Devices) |
| `POST` | `/devices/:id/identify` | blink the device for a few seconds |
| `GET` | `/rooms` | list rooms |
| `POST` | `/rooms` | create room |
| `PATCH` | `/rooms/:id` | rename (not `unassigned`) |
| `DELETE` | `/rooms/:id` | delete room |
| `GET` | `/tags` | distinct tag names |
| `GET` | `/state` | live attribute cache snapshot |
| `GET` | `/events` | `event_logs` query (`since`, `until`, filters, page) |
| `POST` | `/commission` | `202` + `job_id`. Optional `room_id`. `radio` is `network` (default) or `nearby`. Nearby requires `wifi` and an attached device radio, otherwise `422 radio_unavailable`. Wi-Fi credentials are not stored. |
| `GET` | `/commission/:jobId` | poll job (failed jobs still `200` with reason in payload) |
| `POST` | `/radio/attach` | `201` + `session_id`. One device Bluetooth radio at a time (`409` if taken) |
| `POST` | `/radio/detach` | release the radio session |
| `GET` | `/radio/commands` | long-poll the next GATT or scan command (`wait_ms`, max 25000) |
| `POST` | `/radio/reply` | complete a command |
| `POST` | `/radio/event` | advertisement, notification, or disconnect |

Unknown request fields are a 422.

## Devices

Each controllable endpoint is one device. Its `kind` comes from the first application device type in its Descriptor (`light`, `plug`, `switch`, `cover`, `fan`, `thermostat`, `lock`, `contact`, `leak`, `air_quality`, `smoke_alarm`, `energy_meter`, `valve`, `robot_vacuum`, `washer`, `dishwasher`, `refrigerator`, `oven`, `speaker`, `tv`, `camera`, `bridge`, … see `DEVICE_KINDS`). A bridge's aggregator is listed with no capabilities; devices behind it carry `bridge_name`. Capabilities and their config are re-derived on every reconnect.

| Capability | State keys | Commands (`params`) |
| --- | --- | --- |
| `on_off` | `on` | `on`, `off`, `toggle` |
| `level` | `brightness` (0–100), `volume` on speakers and TVs | `move_to` (`level` 0–100) |
| `color` | `color_temp` (mireds), `hue`, `saturation` (0–254), `color_mode` | `temperature` (`mireds`), `hue_saturation` (`hue`, `saturation`) |
| `cover` | `open_percent`, `tilt_percent`, `moving` | `open`, `close`, `stop`, `go_to_lift` (`percent_open`), `go_to_tilt` (`percent`) |
| `fan` | `fan_mode`, `fan_percent` | `set_mode` (`mode`), `set_percent` (`percent`) |
| `thermostat` | `temperature`, `heat_setpoint`, `cool_setpoint` (°C), `system_mode`, `running` | `set_mode` (`mode`), `set_setpoint` (`heat_c` and/or `cool_c`) |
| `lock` | `locked`, `door_state`; event `lock_operation` | none yet |
| `sensor` | one key per `config.measurements` (`occupancy`, `temperature`, `humidity`, `contact`, `leak`, `illuminance` lux, `pressure` kPa, `flow` m³/h, `air_quality`, `pm25`, `co2`, …; units in `config.units`) | none |
| `button` | `position`; event `button` (`action`, `position`, `count`) | none |
| `alarm` | `smoke_state`, `co_state`, `testing` | `self_test` |
| `power_source` | `battery` (%) | none |
| `energy` | `power_w`, `voltage_v`, `current_a`, `energy_kwh` | none |
| `valve` | `valve`, `open_remaining_s`, `valve_level` | `open` (optional `duration_s`, `level` when `config.level`), `close` |
| `pump` | `pump_mode` | `set_mode` (`mode` normal, minimum, maximum, local); run speed through `on_off` and `level` |
| `rvc` | `run_mode`, `clean_mode`, `operational_state`, `phase`, `countdown_s`, `area` | `pause`, `go_home`, `set_clean_mode` (`mode` from `config.clean_modes`), `select_areas` (`areas` from `config.areas`) |
| `appliance` | `operational_state`, `phase`, `countdown_s` | `pause`, `stop` |
| `mode` | `mode` | `change_to` (`mode` from `config.modes`) |
| `temperature_control` | `target_temperature` (°C), `temperature_level` | `set` (`celsius`, or `level` from `config.levels`) |
| `media` | `playback`, `input`, `app` | `play`, `pause`, `stop`, `next`, `previous`, `select_input` (`index`), `send_key` (`key`), `launch_app` (`application_id`, `catalog_vendor_id`) |
| `camera` | `privacy`, `hard_privacy` | `set_privacy` (`enabled`) |

Bridged devices also report `reachable`. Cluster events (`button`, `lock_operation`) write an event row on every occurrence.
