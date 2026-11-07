# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-07

### Added

- Start page that lists every active SWAG subdomain proxy conf the signed-in user may open, checked against Authelia's authz endpoint (all hosts in parallel).
- Services without Authelia (own login only) are shown to configured groups only (`GROUPS_WITHOUT_AUTHELIA`, overridable per service).
- MIT license, README, changelog and instructions for AI coding agents (`AGENTS.md`).
