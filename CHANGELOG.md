# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.1] - 2026-11-08

### Added

- Screenshots and GIFs in the README: light and dark mode, admin and restricted view, phones, sign-out, "more contrast" and the fallback without JavaScript.
- `docs/screenshots/capture/capture.sh` regenerates them with only Docker from a made-up installation at `example.com` in `docs/screenshots/capture/sample/`.
- `docs/perf/perf.sh` measures frame rate and main-thread cost of the animated rack on desktop, tablet and a throttled phone, with only Docker. `--check` fails on CSS animations inside the SVG, which the browser has to repaint on every frame.

### Changed

- Smoother rack animation, above all on phones: blinking LEDs are pre-rendered into a dozen banks that blink as a whole on the compositor, and each fan turns as a small layer of its own, so the browser no longer restyles and repaints every LED and fan on every frame. LEDs in the same bank blink in step.
- Phones (stacked racks) send fewer packets: at most 16 at once on copper and half as many light pulses on fibre.

## [1.0.0] - 2026-11-08

### Added

- Configuration in `.env` next to `index.php` (template `.env.example`), including `LOGOUT_URL` and `AUTHELIA_URL`.

### Changed

- **Breaking:** domain, groups, service overrides and paths are no longer set in `index.php`; without `.env` and `BASE_DOMAIN` the page answers with an error.
- The fallback rack name is the page's host name.

## [0.22.2] - 2026-11-08

### Changed

- The greeting terminal sits centred above the racks at every width.
- The countdown stays on one line that scrolls left; at 0 the terminal says `Connection to <host> closed.` and text wraps mid-word like a real terminal.

## [0.22.1] - 2026-11-08

### Changed

- Faster animation: packet positions are precomputed per route, moving parts live in an overlay SVG and packets glow by a gradient instead of a filter (about 9 to 35 fps with 4x CPU throttling).

## [0.22.0] - 2026-11-07

### Changed

- Every chassis is connected to the switch; stacks without containers in the `proxy` network or without a link carry a third of the traffic.
- Cable colours follow the chassis slot from the top: yellow, red, green, blue, then again.

## [0.21.0] - 2026-11-07

### Added

- Streams of light pulses run through the fibre in both directions at once (`FIBER_GAP_MS`).

### Changed

- Copper traffic is denser and faster, capped at 40 packets.

## [0.20.0] - 2026-11-07

### Changed

- The patch panel is replaced by a 2U switch with up to 24 numbered ports (odd on top, even below), two SFP cages and link and activity LEDs per port.

## [0.19.0] - 2026-11-07

### Added

- Network links are coloured patch cables with RJ45 plugs, each in its own switch port with a lit link LED, bundled without crossings; the racks are linked by an aqua LC duplex fibre between SFP ports.

## [0.18.0] - 2026-11-07

### Added

- Greeting and countdown appear in a terminal window with title bar (`user@domain: ~`), window buttons, prompt and faint scanlines.

## [0.17.1] - 2026-11-07

### Changed

- Larger power strip and plug; the sign-out label is a yellow marker tag on the cord that moves with the plug.

## [0.17.0] - 2026-11-07

### Added

- Plugging back in before the battery reaches 0 % cancels the shutdown: LEDs boot one by one, fans spin up, batteries recharge, the text shows "Power restored... rebooting..." and the greeting is typed again.

## [0.16.0] - 2026-11-07

### Changed

- The countdown runs until the UPS battery reaches 20 % (`LOW_BATTERY`); then the UPS powers everything down while the battery drains to 0 %, the rack stays dark for 2 s and the page fades out.

### Fixed

- The power-down runs on timers, so a tab in the background keeps in step.

## [0.15.0] - 2026-11-07

### Added

- Materials: brushed aluminium faceplates, light grey steel rack (RAL 7035, anthracite in dark mode), black plastic and LCD displays. With "more contrast" the drawing keeps plain outlines.

## [0.14.1] - 2026-11-07

### Fixed

- With stacked racks, power strip and plug stay below the racks (floor socket), so the drawing is no wider than a rack; the countdown is typed next to the plug.

## [0.14.0] - 2026-11-07

### Added

- A typed countdown "Shutting down 10... 9... … 0" in real seconds.

### Changed

- `SHUTDOWN_MS` is the time until everything is off; at 0 the rack greys out and the page fades out before the logout.

## [0.13.0] - 2026-11-07

### Changed

- All texts of the user interface are English.

## [0.12.0] - 2026-11-07

### Added

- A typed "Hello World" greeting with the user's first name (`intro.js`).

### Removed

- The header with the sign-out link; signing out works through the plug only (the `<noscript>` view keeps a link).

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
