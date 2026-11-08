# AGENTS.md

Instructions for AI coding agents (and humans) working on this repository. What the page does and how it is installed is in [README.md](README.md).

## Project

A start page that runs inside the PHP-FPM of a SWAG container, or as a container of its own behind SWAG (`Dockerfile`). `index.php` reads the active proxy confs, asks Authelia which of them the signed-in user may open, maps them to containers from `data/stacks.json` and hands a filtered model to the browser, where `rack.js` draws it as an SVG server rack.

## Layout

| File | Purpose |
|---|---|
| `index.php` | Logic: read proxy confs, ask Authelia, map services to containers, build the model, JSON endpoint |
| `.env.example` | Template for `.env`, the installation-specific settings (`.env` itself is not in Git) |
| `page.html.php` | HTML template; inlines CSS, JS and the initial model, `<noscript>` fallback |
| `style.css` | Styles and animations, inlined into the page |
| `favicon.svg` | Favicon, inlined as a data URI (there is deliberately no `favicon.ico`) |
| `intro.js` | Types the greeting into the terminal window and the shutdown countdown |
| `rack.js` | Draws the rack as SVG, polls `/?data=1`, animates traffic and the power plug |
| `data/stacks.json` | Stack snapshot, written by your own job, not in Git |
| `docs/screenshots/` | Screenshots and GIFs for the README, taken with made-up sample data |
| `docs/screenshots/capture/` | Regenerates them: `capture.sh`, the capture script, its Docker image and the sample installation in `sample/` (`snapshot.sh` keeps its `stacks.json` current for the demo) |
| `Dockerfile`, `.dockerignore` | The container image: Alpine with nginx and PHP-FPM, only the page files, user `nobody`, port 8080 |
| `docker/` | `nginx.conf`, `php-fpm.conf` and `entrypoint.sh` of the image; `demo-proxy.conf` plays SWAG and Authelia in the demo |
| `compose.yaml` | Demo: the image with the sample installation behind `demo-proxy.conf`, ports 8081 (admin) and 8082 (regular user) |
| `docs/perf/` | Performance harness for the animated rack: `perf.sh` and `perf.mjs`, reusing the capture image and sample installation |
| `README.md` | What it does, requirements, installation, configuration |
| `CHANGELOG.md` | Release notes, one section per version |
| `AGENTS.md` | This file |

## Conventions

- No build step and no dependencies: plain PHP 8, vanilla JavaScript, one stylesheet. Keep it that way. The container image and the demo only package the page; it must keep working inside SWAG as it is.
- The page files are listed in four places: `Dockerfile` (`COPY`), `.dockerignore`, `capture.sh` and `perf.sh`. A new page file goes into all four.
- Settings are read with `getenv() + load_env(ENV_FILE)`: environment variables win over `.env`. SWAG's PHP-FPM clears the environment, the image's keeps it (`clear_env = no`).
- Identifiers and comments in English. UI texts in English.
- Nothing in this folder is served by URL; `page.html.php` inlines CSS, JS and the favicon. New assets must be inlined the same way.
- Access is decided on the server only. Never send the browser anything the user may not see, neither in the page nor in `/?data=1`.
- Keep the fallbacks working: no JavaScript, `prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast: more`.
- Installation-specific values (domain, groups, service names, URLs) belong in `.env`, read by `load_env()` in `index.php`. Add every new key with a comment to `.env.example` and to the configuration table in the README.
- This repository is public. Use `example.com`, `192.0.2.x` and generic names in code, docs, tests and commit messages. Never commit real domains, IP addresses, user names, tokens, `data/` or `.env`.

## With every change

1. Add a section to `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)) with the next version under [Semantic Versioning](https://semver.org/spec/v2.0.0.html): MAJOR for changes that need action from people running it (configuration, nginx, Authelia, snapshot format), MINOR for new features, PATCH for fixes, small visual tweaks and performance. Tag the commit `v<version>`. Changes without a release (`docs`, `refactor`, `chore`) go under `## [Unreleased]` at the top; the next release turns that section into its own.
2. Update `README.md` when features, requirements, installation or configuration change. Keep it about using the project, not about one installation.
3. Update this file when the layout or the conventions change.
4. Check: `php -l index.php`, and look at the page in light and dark mode, narrow and wide, and play the sign-out with `/?dry`, e.g. in the demo (`docker compose up --build`, which also builds the image).
5. When the look changes, regenerate the screenshots (see below) and commit them with the change.
   When anything that moves changes (animations, the layers in `liftAnimated()`, traffic), run `docs/perf/perf.sh --check` (see "Performance").
6. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), matching the version bump: `feat` (MINOR), `fix` (PATCH, also small visual tweaks), `perf` (PATCH), `docs`, `refactor` or `chore` (no release); `!` after the type plus a `BREAKING CHANGE:` footer for MAJOR. Use a scope where it helps, e.g. `rack`, `signout`, `intro`, `noscript`, `config`. Imperative, lower-case subject up to 72 characters; the body says what changes for the user and why.

## Screenshots

The images in `docs/screenshots/` show a made-up installation, never a real one. Regenerate all of them with

```sh
docs/screenshots/capture/capture.sh          # or: capture.sh shots | capture.sh gif
```

It needs only Docker and takes about two minutes. It builds the image `server-room-capture` (Node, PHP, Chromium, ffmpeg), copies the page from the working tree with `sample/env` as `.env` into a temp dir, serves it with PHP's built-in server and records it with headless Chromium. The results overwrite the files in `docs/screenshots/`.

- `sample/env`, `sample/proxy-confs/` and `sample/stacks.json` are the installation: `example.com`, a server and a NAS at `192.0.2.x`. The proxy confs go without Authelia, so `GROUPS_WITHOUT_AUTHELIA_PER_SERVICE` decides what the regular user sees.
- `sample/router.php` stands in for Authelia: port 8081 is the admin Alex (`admins`), port 8082 the regular user Sam (`family`). Chromium maps `example.com` to localhost, so the host name in the page is `example.com` too.
- `capture.mjs` lists the screenshots (file, user, viewport, colour scheme, contrast, JavaScript on or off) and scripts the two GIFs: `intro.gif` records the first 10 s after loading, `signout.gif` clicks the plug on `/?dry` and records the shutdown. Static shots wait 8 s so the greeting is typed out.
- Desktop shots are 1440×900 and full page; phone shots are 390×844 at 2× and only the first screen. GIFs are 960 px wide at 10 fps; keep `signout.gif` around 2 MB.
- Look at every image before committing: traffic and blinking LEDs are random, so the images differ on every run. Only commit them when the look changed.
- When a feature, the snapshot format or the configuration changes, update the sample so the screenshots show it. Add a screenshot to `capture.mjs` and the README's Screenshots section for a new view. Keep everything fictional: `example.com`, `192.0.2.x`, generic names.

## Performance

Measure the animation with

```sh
docs/perf/perf.sh [--check] [repo-dir]       # PERF_OUT=result.json docs/perf/perf.sh
```

It needs only Docker and takes about two minutes. It reuses the image and the sample installation from the screenshot capture, copies the page from the working tree (or from `repo-dir`, e.g. a git worktree of another revision) into a temp dir and serves it with PHP's built-in server. For each scenario (desktop light and dark, tablet, phone with 4× and 6× CPU throttling, and the idle sign-out page `/?dry` on the phone) headless Chromium opens the page as the admin, waits 4 s until the traffic runs and measures 8 s: `requestAnimationFrame` intervals (median, P95, share of late and dropped frames, fps) and the main-thread time from `Performance.getMetrics` (script, style, layout, task). A Markdown table goes to stdout, JSON to `PERF_OUT`. The column "SVG anim." counts the CSS animations running on elements inside an SVG.

`--check` exits non-zero when that count is above 0 in any scenario, or when desktop or tablet drop more than 5 % of their frames. The count is exact and the same on every machine; the frame limit only catches gross regressions, because the frame times are noisy. The phone target is reported, not enforced.

- Target: on the phone with 4× throttling P95 frame interval ≤ 16.7 ms and < 5 % dropped frames; on desktop and tablet no dropped frames.
- Frames are capped at 60 fps like a real display; `PERF_UNCAPPED=1` lifts the cap to show headroom, but then the main thread runs flat out and the task times are not comparable.
- Headless Chromium renders in software, so the absolute numbers are pessimistic and noisy. Compare runs of the same machine with each other, before and after a change, and run twice when a difference is small.
- Put the table into the commit message of a `perf` change.

### Rendering rules

What keeps the rack smooth, learnt by measuring (details in the `perf(rack)` commits):

- Never animate an element inside an SVG with CSS. Chromium cannot hand such animations to the compositor, so each one restyles and repaints its whole SVG on every frame, filters included. `--check` fails on them.
- What moves or blinks gets a layer of its own (an outer `<svg>` or an HTML element) and animates only `opacity` or `transform` of that layer, with `will-change`. The compositor then fades or turns a picture rasterised once. `liftAnimated()` builds these layers: blinking LEDs in banks of the same blink timing (LEDs in one bank blink in step), the other LEDs in a still layer, the packets in a layer of their own, each fan as a small SVG.
- Filters such as `drop-shadow()` are fine in a layer that is not repainted; in a layer that changes every frame they are paid for every frame.
- Keep per-frame work small: the packets move by `setAttribute` in their own layer; narrow layouts (phones) send fewer of them.
- Tried and dropped, both slower on the phone: packets on a `<canvas>` (drawing in software costs the main thread more than moving a few SVG circles) and LED halos selected with `:has()` (style recalculation doubled).
- Still open: on a phone with 4× CPU throttling the page reaches about 44 fps, not 60; style recalculation is still the largest cost there.
