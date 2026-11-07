# Server Room

A start page for self-hosted services behind [SWAG](https://github.com/linuxserver/docker-swag) and [Authelia](https://www.authelia.com/). It shows every signed-in user exactly the services Authelia lets them open. New proxy confs show up by themselves; access rights are maintained in Authelia only.

## Features

- Lists every active SWAG subdomain proxy conf the user may access, checked live against Authelia.
- Follows light and dark mode.

## Requirements

- [SWAG](https://github.com/linuxserver/docker-swag) by linuxserver.io, which serves the page with its bundled PHP-FPM (PHP 8 with the curl extension).
- Services published through SWAG subdomain proxy confs (`/config/nginx/proxy-confs/<name>.subdomain.conf` with `server_name <name>.*;`).
- Authelia 4.38 or newer, reachable from SWAG as `http://authelia:9091`, and SWAG's `authelia-server.conf` and `authelia-location.conf` in use. A service counts as protected when its proxy conf includes `authelia-location.conf`.
- A current browser.

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

   `$user`, `$name` and `$groups` are set by `authelia-location.conf`.
4. Let every signed-in user open the page in Authelia's `configuration.yml`:

   ```yaml
   access_control:
     rules:
       - domain: example.com
         policy: one_factor
   ```
5. Reload nginx: `docker exec swag nginx -s reload`.

## Configuration

The settings are constants at the top of `index.php`. Service names are proxy conf file names without `.subdomain.conf`.

| Constant | Default | Meaning |
|---|---|---|
| `BASE_DOMAIN` | `example.com` | Domain whose subdomains SWAG serves |
| `PROXY_CONFS` | `/config/nginx/proxy-confs/*.subdomain.conf` | Proxy confs to read |
| `AUTHELIA_AUTHZ` | `http://authelia:9091/api/authz/auth-request` | Authelia's authz endpoint |
| `SKIPPED` | `auth` | Services that are never shown |
| `GROUPS_WITHOUT_AUTHELIA` | `admins` | Groups that see services without Authelia |
| `GROUPS_WITHOUT_AUTHELIA_PER_SERVICE` |  | The same per service |

## How it works

### Who sees what

1. For every service whose proxy conf includes `authelia-location.conf`, `index.php` asks Authelia's `/api/authz/auth-request` with `X-Original-URL` and the user's `authelia_session` cookie, all hosts in parallel. `200` shows the service, `401` too (only a second factor is missing), anything else hides it.
2. Services without Authelia are shown to the groups in `GROUPS_WITHOUT_AUTHELIA` (or `GROUPS_WITHOUT_AUTHELIA_PER_SERVICE`).

## Development

- No build step and no dependencies. Changes are live on the next request; nginx only needs a reload when its conf changes.
- Syntax check: `docker exec swag php -l /config/www/start/index.php`

List the detected services without a browser:

```sh
docker exec swag php -r '$_SERVER["REMOTE_GROUPS"]="admins";
  ob_start(); include "/config/www/start/index.php"; ob_end_clean();
  foreach ($services as $s) echo $s["name"], " ", $s["host"], " ", $s["authelia"] ? "authelia" : "own login", PHP_EOL;'
```

### Files

| File | Purpose |
|---|---|
| `index.php` | Logic: read proxy confs, ask Authelia, filter |
| `page.html.php` | HTML template |
| `style.css` | Styles, inlined into the page |

See [CHANGELOG.md](CHANGELOG.md) for the history and [AGENTS.md](AGENTS.md) for contribution guidelines.

## License

[MIT](LICENSE)
