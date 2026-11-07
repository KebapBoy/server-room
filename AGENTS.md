# AGENTS.md

Instructions for AI coding agents (and humans) working on this repository. What the page does and how it is installed is in [README.md](README.md).

## Project

A start page that runs inside the PHP-FPM of a SWAG container. `index.php` reads the active proxy confs, asks Authelia which of them the signed-in user may open, maps them to containers from `data/stacks.json` and hands a filtered model to the browser, where `rack.js` draws it as an SVG server rack.

## Layout

| File | Purpose |
|---|---|
| `index.php` | Logic: read proxy confs, ask Authelia, map services to containers, build the model, JSON endpoint |
| `page.html.php` | HTML template; inlines CSS, JS and the initial model, `<noscript>` fallback |
| `style.css` | Styles and animations, inlined into the page |
| `favicon.svg` | Favicon, inlined as a data URI (there is deliberately no `favicon.ico`) |
| `intro.js` | Types the greeting |
| `rack.js` | Draws the rack as SVG, polls `/?data=1`, animates traffic and the power plug |
| `data/stacks.json` | Stack snapshot, written by your own job, not in Git |
| `README.md` | What it does, requirements, installation, configuration |
| `CHANGELOG.md` | Release notes, one section per version |
| `AGENTS.md` | This file |

## Conventions

- No build step and no dependencies: plain PHP 8, vanilla JavaScript, one stylesheet. Keep it that way.
- Identifiers and comments in English. UI texts in English.
- Nothing in this folder is served by URL; `page.html.php` inlines CSS, JS and the favicon. New assets must be inlined the same way.
- Access is decided on the server only. Never send the browser anything the user may not see, neither in the page nor in `/?data=1`.
- Keep the fallbacks working: no JavaScript, `prefers-reduced-motion`, `prefers-color-scheme`.
- This repository is public. Use `example.com`, `192.0.2.x` and generic names in code, docs, tests and commit messages. Never commit real domains, IP addresses, user names, tokens, `data/`.

## With every change

1. Add a section to `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)) with the next version under [Semantic Versioning](https://semver.org/spec/v2.0.0.html): MAJOR for changes that need action from people running it (configuration, nginx, Authelia, snapshot format), MINOR for new features, PATCH for fixes, small visual tweaks and performance. Tag the commit `v<version>`.
2. Update `README.md` when features, requirements, installation or configuration change. Keep it about using the project, not about one installation.
3. Update this file when the layout or the conventions change.
4. Check: `php -l index.php`, and look at the page in light and dark mode, narrow and wide, and play the sign-out with `/?dry`.
5. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), matching the version bump: `feat` (MINOR), `fix` (PATCH, also small visual tweaks), `perf` (PATCH), `docs`, `refactor` or `chore` (no release); `!` after the type plus a `BREAKING CHANGE:` footer for MAJOR. Use a scope where it helps, e.g. `rack`, `signout`, `intro`, `noscript`, `config`. Imperative, lower-case subject up to 72 characters; the body says what changes for the user and why.
