# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.0] - 2026-11-07

### Changed

- The racks are sized to the window: centred, at least 75 % of the page wide and at most 1500 px, with 3 to 5 modules per row so the drawing fits the window height.

## [0.10.0] - 2026-11-07

### Added

- A two-line display in each rack head shows counts and status: data age, stale data, an expired session (click to reload) and the shutdown messages. The status line below the rack remains for screen readers only.

## [0.9.1] - 2026-11-07

### Changed

- Stack chassis are one unit shorter; a single-row stack takes 3U instead of 4U.

## [0.9.0] - 2026-11-07

### Added

- `SERVICE_PATHS` for services whose web UI does not live at `/`.

### Changed

- Service links open in a new tab.

## [0.8.0] - 2026-11-07

### Changed

- The rack head is a 2U unit with a larger name plate for the environment name, its status LED and the active count.

## [0.7.1] - 2026-11-07

### Fixed

- The blue activity LED glows like the others.

## [0.7.0] - 2026-11-07

### Changed

- The `<noscript>` link list is drawn as tiles that look like the rack's server modules.
- The LED colour is computed once in PHP and sent in the model.

## [0.6.0] - 2026-11-07

### Added

- Rack favicon, embedded as an SVG data URI.

### Changed

- The page title names the server room.

## [0.5.0] - 2026-11-07

### Added

- `/?dry` plays the sign-out animation and reloads the page instead of signing out.

## [0.4.0] - 2026-11-07

### Added

- UPS units with mains and battery LEDs and a battery gauge; after the plug is pulled the racks keep running on battery until it is empty.

### Changed

- The shutdown takes `SHUTDOWN_MS` (10 s) in `rack.js`; every phase scales with it.

## [0.3.0] - 2026-11-07

### Added

- Sign out by pulling the rack's power plug: the UPS drains, LEDs die, fans coast down and the rack dims before the redirect to Authelia's logout. Without JavaScript or with reduced motion the link leads straight to the logout.

## [0.2.1] - 2026-11-07

### Fixed

- The module of a service mapped by `SERVICE_CONTAINERS` is labelled with the container's service name again.

## [0.2.0] - 2026-11-07

### Added

- Server rack view drawn as SVG by `rack.js`: one rack per environment, one chassis per compose stack, one module per container, with status LEDs and filler units.
- Services are mapped to containers via their proxy upstreams and a stack snapshot in `data/stacks.json`.
- JSON endpoint `/?data=1`; the page polls it every 15 s and updates without reloading.
- Admins see all stacks and containers; everyone else only the containers of their own services, filtered on the server.
- Pseudo traffic between containers that share a Docker network.
- Warning when the snapshot is older than 3 minutes.

### Changed

- Without JavaScript the page falls back to a plain link list.

## [0.1.0] - 2026-11-07

### Added

- Start page that lists every active SWAG subdomain proxy conf the signed-in user may open, checked against Authelia's authz endpoint (all hosts in parallel).
- Services without Authelia (own login only) are shown to configured groups only (`GROUPS_WITHOUT_AUTHELIA`, overridable per service).
- MIT license, README, changelog and instructions for AI coding agents (`AGENTS.md`).
