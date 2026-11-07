# Server Room

A start page for self-hosted services behind [SWAG](https://github.com/linuxserver/docker-swag) and [Authelia](https://www.authelia.com/). It shows every signed-in user exactly the services Authelia lets them open, drawn as a server rack: one rack per Docker host, one chassis per compose stack, one module per container. New proxy confs and changes to your stacks show up by themselves; access rights are maintained in Authelia only.

## Features

- Status LEDs per container (green running, yellow unhealthy, created or paused, red stopped), filler units for shorter racks and animated pseudo traffic between containers that share a Docker network.
- Updates every 15 s without reloading.
- Admins see every stack and container; everyone else only the containers of their own services. The filter runs on the server.
- Sign out by pulling the power plug of the rack, with a little shutdown animation (see below).
- Works without JavaScript as a list of tiles.
- Follows light and dark mode and "reduce motion".

## Requirements

- [SWAG](https://github.com/linuxserver/docker-swag) by linuxserver.io, which serves the page with its bundled PHP-FPM (PHP 8 with the curl extension).
- Services published through SWAG subdomain proxy confs (`/config/nginx/proxy-confs/<name>.subdomain.conf` with `server_name <name>.*;`, `$upstream_app` and `$upstream_port`).
- Authelia 4.38 or newer, reachable from SWAG as `http://authelia:9091`, and SWAG's `authelia-server.conf` and `authelia-location.conf` in use. A service counts as protected when its proxy conf includes `authelia-location.conf`.
- A JSON snapshot of your compose stacks in `data/stacks.json`, refreshed by a job of your own (see [Stack snapshot](#stack-snapshot)).
- A current browser. JavaScript is optional.

## Installation

1. Put this folder at `/config/www/start` inside the SWAG config, next to (not inside) your site's web root. Nothing here is meant to be reachable by URL; nginx runs `index.php` directly.

   ```sh
   git clone <this repository> <swag-config>/www/start
   ```
2. Set `BASE_DOMAIN` and the other constants at the top of `index.php` (see [Configuration](#configuration)).
3. Add the page to the server block of your main domain, e.g. `/config/nginx/site-confs/example.com.conf`:

   ```nginx
   include /config/nginx/authelia-server.conf;

   location = / {
       limit_except GET {
           deny all;
       }
       include /config/nginx/authelia-location.conf;
       fastcgi_hide_header X-Powered-By;
       include /etc/nginx/fastcgi_params;
       fastcgi_param SCRIPT_FILENAME /config/www/start/index.php;
       fastcgi_param REMOTE_USER $user;
       fastcgi_param REMOTE_NAME $name;
       fastcgi_param REMOTE_GROUPS $groups;
       fastcgi_pass 127.0.0.1:9000;
   }
   ```

   `$user`, `$name` and `$groups` are set by `authelia-location.conf`. `/?data=1` goes through the same location.
4. Let every signed-in user open the page in Authelia's `configuration.yml`:

   ```yaml
   access_control:
     rules:
       - domain: example.com
         policy: one_factor
   ```
5. Set up a job that writes `data/stacks.json` (see [Stack snapshot](#stack-snapshot)).
6. Reload nginx: `docker exec swag nginx -s reload`.

## Configuration

The settings are constants at the top of `index.php`. Service names are proxy conf file names without `.subdomain.conf`.

| Constant | Default | Meaning |
|---|---|---|
| `BASE_DOMAIN` | `example.com` | Domain whose subdomains SWAG serves |
| `PROXY_CONFS` | `/config/nginx/proxy-confs/*.subdomain.conf` | Proxy confs to read |
| `AUTHELIA_AUTHZ` | `http://authelia:9091/api/authz/auth-request` | Authelia's authz endpoint |
| `SKIPPED` | `auth` | Services that are never shown |
| `ADMIN_GROUP` | `admins` | Group that sees all stacks and containers |
| `GROUPS_WITHOUT_AUTHELIA` | `admins` | Groups that see services without Authelia |
| `GROUPS_WITHOUT_AUTHELIA_PER_SERVICE` |  | The same per service |
| `SERVICE_CONTAINERS` |  | Container for services whose proxy conf has no usable upstream |
| `SERVICE_PATHS` |  | Start path for services whose UI does not live at `/` |
| `SNAPSHOT_MAX_AGE` | `180` | Seconds after which the stack snapshot counts as stale |

Timings of the animation are constants at the top of `rack.js` (`SHUTDOWN_MS`, `PHASES`).

## Stack snapshot

The page never talks to Docker itself. A job of yours writes `data/stacks.json`, for example every 30 s from cron on the Docker host. This keeps any Docker or API credentials out of the internet-facing SWAG container. Write the file atomically (temp file plus rename).

```json
{
  "generated": 1767225600,
  "environments": [
    {
      "id": 1,
      "name": "server",
      "ip": "192.0.2.10",
      "online": true,
      "stacks": [
        {
          "name": "media",
          "containers": [
            {
              "name": "media-jellyfin-1",
              "service": "jellyfin",
              "state": "running",
              "health": "healthy",
              "ports": [8096],
              "networks": ["proxy"]
            }
          ]
        }
      ]
    }
  ]
}
```

- `generated`: Unix time of the snapshot. Older than `SNAPSHOT_MAX_AGE` means stale, which the page shows.
- One environment per Docker host. `ip` is the address proxy confs use for it, `online: false` marks a host that could not be read (keep its last stacks).
- `state` and `health` as reported by Docker, `ports` the published host ports, `networks` the Docker network names.
- The format follows what Dockhand returns from `GET /api/environments` and `GET /api/stacks?env=<id>`, but any source works, e.g. `docker ps` and `docker inspect` per host.

## How it works

### Who sees what

1. For every service whose proxy conf includes `authelia-location.conf`, `index.php` asks Authelia's `/api/authz/auth-request` with `X-Original-URL` and the user's `authelia_session` cookie, all hosts in parallel. `200` shows the service, `401` too (only a second factor is missing), anything else hides it.
2. Services without Authelia are shown to the groups in `GROUPS_WITHOUT_AUTHELIA` (or `GROUPS_WITHOUT_AUTHELIA_PER_SERVICE`).
3. Members of `ADMIN_GROUP` see all stacks and containers, also those without a domain. Everyone else only sees the containers of their own services; the rest of a chassis is blank and gives away no count. The same filter applies to `/?data=1`.

### From service to container

The first matching rule wins:

1. An entry in `SERVICE_CONTAINERS`.
2. `$upstream_app` is a name: the container with that compose service or container name.
3. `$upstream_app` is an IP: the environment with that `ip`, then the container publishing `$upstream_port`, else the compose service named like the proxy conf (host network, stopped containers). Without a match the service becomes a button in the rack head.
4. The compose service named like the proxy conf; without a match the service goes into a "devices" bay.

### The rack

- Each rack has a head unit with a name plate, a status LED and the number of active modules.
- Service links open in a new tab.

### Signing out

All UPS units hang on a power strip whose plug sits in a wall socket. Clicking the plug pulls it (so does the sign-out link in the header). The UPS units switch from mains to battery and keep everything running until the battery is empty; then traffic stops, LEDs go out, fans coast down and the rack greys out before the page goes to Authelia's logout. All of this takes `SHUTDOWN_MS`.

Without JavaScript or with "reduce motion" the plug is a plain link to the logout.

## Development

- No build step and no dependencies. Changes are live on the next request; nginx only needs a reload when its conf changes.
- Syntax check: `docker exec swag php -l /config/www/start/index.php`
- `/?dry` plays the sign-out animation and reloads the page instead of signing out.

Show the mapping without a browser, as an admin:

```sh
docker exec swag php -r '$_SERVER["REMOTE_GROUPS"]="admins";
  ob_start(); include "/config/www/start/index.php"; ob_end_clean();
  foreach (build_model($services, load_snapshot(), true)["racks"] as $r)
    foreach ($r["stacks"] as $s) echo $r["name"], "/", $s["name"], ": ", implode(", ", array_column($s["modules"], "label")), PHP_EOL;'
```

### Files

| File | Purpose |
|---|---|
| `index.php` | Logic: read proxy confs, ask Authelia, map services to containers, build the model, JSON endpoint |
| `page.html.php` | HTML template; inlines CSS, JS and the initial model, `<noscript>` fallback |
| `style.css` | Styles and animations, inlined into the page |
| `favicon.svg` | Favicon, inlined as a data URI (there is deliberately no `favicon.ico`) |
| `rack.js` | Draws the rack as SVG, polls `/?data=1`, animates traffic and the power plug |
| `data/stacks.json` | Stack snapshot, written by your own job, not in Git |

See [CHANGELOG.md](CHANGELOG.md) for the history and [AGENTS.md](AGENTS.md) for contribution guidelines.

## License

[MIT](LICENSE)
