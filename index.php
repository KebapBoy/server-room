<?php
// Start page for a SWAG domain: shows every service the logged-in Authelia user may access
// according to Authelia, drawn as a server rack grouped by Dockhand stacks.
// Services come from the active SWAG proxy confs, stacks from data/stacks.json
// (written by a separate host job, see README). GET /?data=1 returns the filtered model as JSON.

const BASE_DOMAIN = 'example.com';
const PROXY_CONFS = '/config/nginx/proxy-confs/*.subdomain.conf';
const AUTHELIA_AUTHZ = 'http://authelia:9091/api/authz/auth-request';
const SNAPSHOT = __DIR__ . '/data/stacks.json';
const SNAPSHOT_MAX_AGE = 180;
const SKIPPED = ['auth'];
const ADMIN_GROUP = 'admins';

// Services without Authelia (own login): Authelia decides nothing there, so only
// these groups see them. Can be overridden per service (file name without .subdomain.conf).
const GROUPS_WITHOUT_AUTHELIA = ['admins'];
const GROUPS_WITHOUT_AUTHELIA_PER_SERVICE = [
    // 'plex' => ['admins', 'friends'],
];

// Services whose proxy conf has no usable upstream: conf name => compose service (also the label)
const SERVICE_CONTAINERS = [
    'dashboard' => 'swag',
];

// Docker networks that do not mean two containers talk to each other
const IGNORED_NETWORKS = ['host', 'none', 'bridge'];

function read_services(): array
{
    $services = [];
    foreach (glob(PROXY_CONFS) as $file) {
        $name = basename($file, '.subdomain.conf');
        $active = implode("\n", array_filter(
            file($file, FILE_IGNORE_NEW_LINES),
            fn($line) => !preg_match('/^\s*#/', $line)
        ));
        if (!preg_match_all('/^\s*server_name\s+([a-z0-9-]+)\.\*\s*;/mi', $active, $matches)) {
            continue;
        }
        $hasAuthelia = (bool) preg_match('#^\s*include\s+/config/nginx/authelia-location\.conf\s*;#m', $active);
        preg_match('/^\s*set\s+\$upstream_app\s+([^\s;]+)\s*;/m', $active, $app);
        preg_match('/^\s*set\s+\$upstream_port\s+(\d+)\s*;/m', $active, $port);
        foreach (array_unique($matches[1]) as $sub) {
            if (in_array($sub, SKIPPED, true)) {
                continue;
            }
            $services[] = [
                'name' => $name,
                'host' => $sub . '.' . BASE_DOMAIN,
                'authelia' => $hasAuthelia,
                'app' => $app[1] ?? null,
                'port' => isset($port[1]) ? (int) $port[1] : null,
            ];
        }
    }
    usort($services, fn($a, $b) => strcmp($a['name'], $b['name']));
    return $services;
}

// Take only the Authelia cookie from the Cookie header; allow only RFC 6265 cookie-octets
// (no whitespace, control characters, quotes, comma, semicolon or backslash), which covers
// Authelia's session ID alphabet, so nothing else ends up in the request to Authelia
function session_cookie(): ?string
{
    foreach (explode(';', $_SERVER['HTTP_COOKIE'] ?? '') as $part) {
        if (preg_match('/^\s*authelia_session=([\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]{1,256})\s*$/', $part, $match)) {
            return 'authelia_session=' . $match[1];
        }
    }
    return null;
}

// Queries Authelia per host in parallel; returns host => HTTP status (0 on error)
function query_authelia(array $hosts, string $cookie): array
{
    $multi = curl_multi_init();
    $handles = [];
    foreach ($hosts as $host) {
        $c = curl_init(AUTHELIA_AUTHZ);
        curl_setopt_array($c, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT_MS => 1000,
            CURLOPT_TIMEOUT_MS => 3000,
            CURLOPT_HTTPHEADER => [
                'X-Original-URL: https://' . $host . '/',
                'X-Original-Method: GET',
                'Cookie: ' . $cookie,
            ],
        ]);
        curl_multi_add_handle($multi, $c);
        $handles[$host] = $c;
    }
    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) {
            curl_multi_select($multi, 0.5);
        }
    } while ($running && $status === CURLM_OK);

    $result = [];
    foreach ($handles as $host => $c) {
        $result[$host] = curl_errno($c) ? 0 : curl_getinfo($c, CURLINFO_RESPONSE_CODE);
        curl_multi_remove_handle($multi, $c);
    }
    curl_multi_close($multi);
    return $result;
}

function load_snapshot(): array
{
    $data = is_readable(SNAPSHOT) ? json_decode((string) file_get_contents(SNAPSHOT), true) : null;
    if (!is_array($data) || !is_array($data['environments'] ?? null)) {
        return ['generated' => 0, 'environments' => []];
    }
    return $data;
}

// Finds a container by compose service or container name; returns [env, stack, container] indexes
function find_container(array $environments, string $name, ?int $onlyEnv = null): ?array
{
    foreach ($environments as $e => $env) {
        if ($onlyEnv !== null && $e !== $onlyEnv) {
            continue;
        }
        foreach ($env['stacks'] as $s => $stack) {
            foreach ($stack['containers'] as $c => $container) {
                if ($container['service'] === $name || $container['name'] === $name) {
                    return [$e, $s, $c];
                }
            }
        }
    }
    return null;
}

// Where a service lives: ['container', env, stack, container], ['host', env] or ['device']
function locate_service(array $service, array $environments): array
{
    if (isset(SERVICE_CONTAINERS[$service['name']])) {
        $found = find_container($environments, SERVICE_CONTAINERS[$service['name']]);
        return $found ? ['container', ...$found] : ['device'];
    }
    $app = $service['app'];
    if ($app !== null && !filter_var($app, FILTER_VALIDATE_IP)) {
        $found = find_container($environments, $app);
        if ($found) {
            return ['container', ...$found];
        }
    }
    if ($app !== null && filter_var($app, FILTER_VALIDATE_IP)) {
        foreach ($environments as $e => $env) {
            if (($env['ip'] ?? null) !== $app) {
                continue;
            }
            foreach ($env['stacks'] as $s => $stack) {
                foreach ($stack['containers'] as $c => $container) {
                    if (in_array($service['port'], $container['ports'], true)) {
                        return ['container', $e, $s, $c];
                    }
                }
            }
            // Host network or stopped container: no published port, fall back to the name
            $found = find_container($environments, $service['name'], $e);
            return $found ? ['container', ...$found] : ['host', $e];
        }
    }
    $found = find_container($environments, $service['name']);
    return $found ? ['container', ...$found] : ['device'];
}

// Builds the rack model; non-admins only get the containers of their visible services
function build_model(array $visible, array $snapshot, bool $isAdmin): array
{
    $environments = $snapshot['environments'];
    $linked = [];
    $hostLinks = [];
    $devices = [];
    foreach ($visible as $service) {
        $link = [
            'label' => SERVICE_CONTAINERS[$service['name']] ?? $service['name'],
            'href' => 'https://' . $service['host'] . '/',
        ];
        $place = locate_service($service, $environments);
        if ($place[0] === 'container') {
            $linked[$place[1]][$place[2]][$place[3]] ??= $link;
        } elseif ($place[0] === 'host') {
            $hostLinks[$place[1]][] = $link;
        } else {
            $devices[] = $link;
        }
    }

    $racks = [];
    foreach ($environments as $e => $env) {
        $stacks = [];
        foreach ($env['stacks'] as $s => $stack) {
            $modules = [];
            $networks = [];
            foreach ($stack['containers'] as $c => $container) {
                $link = $linked[$e][$s][$c] ?? null;
                if (!$isAdmin && $link === null) {
                    continue;
                }
                $modules[] = [
                    'label' => $link['label'] ?? $container['service'],
                    'title' => $isAdmin ? $container['name'] : $link['label'],
                    'state' => $container['state'],
                    'health' => $container['health'],
                    'href' => $link['href'] ?? null,
                    'proxy' => in_array('proxy', $container['networks'], true),
                ];
                $networks[] = array_values(array_diff($container['networks'], IGNORED_NETWORKS));
            }
            if (!$modules) {
                continue;
            }
            // Pseudo traffic runs between modules that share a Docker network
            $pairs = [];
            for ($i = 0; $i < count($modules); $i++) {
                for ($j = $i + 1; $j < count($modules); $j++) {
                    if (array_intersect($networks[$i], $networks[$j])) {
                        $pairs[] = [$i, $j];
                    }
                }
            }
            $stacks[] = ['name' => $stack['name'], 'modules' => $modules, 'links' => $pairs];
        }
        if (!$isAdmin && !$stacks && empty($hostLinks[$e])) {
            continue;
        }
        $racks[] = [
            'name' => $env['name'],
            'online' => (bool) ($env['online'] ?? false),
            'links' => $hostLinks[$e] ?? [],
            'stacks' => $stacks,
        ];
    }

    return [
        'generated' => (int) $snapshot['generated'],
        'stale' => time() - (int) $snapshot['generated'] > SNAPSHOT_MAX_AGE,
        'racks' => $racks,
        'devices' => $devices,
    ];
}

$groups = array_filter(array_map('trim', explode(',', $_SERVER['REMOTE_GROUPS'] ?? '')));
$displayName = ($_SERVER['REMOTE_NAME'] ?? '') ?: ($_SERVER['REMOTE_USER'] ?? '');
$services = read_services();
$cookie = session_cookie();

$checked = $cookie === null ? [] : query_authelia(
    array_column(array_filter($services, fn($s) => $s['authelia']), 'host'),
    $cookie
);

$visible = array_filter($services, function ($s) use ($checked, $groups) {
    if ($s['authelia']) {
        // 200 allowed, 401 allowed after another factor, hide everything else
        return in_array($checked[$s['host']] ?? 0, [200, 401], true);
    }
    $allowed = GROUPS_WITHOUT_AUTHELIA_PER_SERVICE[$s['name']] ?? GROUPS_WITHOUT_AUTHELIA;
    return (bool) array_intersect($groups, $allowed);
});

$model = build_model($visible, load_snapshot(), in_array(ADMIN_GROUP, $groups, true));
$modelJson = json_encode($model, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_SLASHES);

header('Cache-Control: no-store');
if (($_GET['data'] ?? null) === '1') {
    header('Content-Type: application/json; charset=utf-8');
    echo $modelJson;
    return;
}

function h(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

require __DIR__ . '/page.html.php';
