<?php
// Start page for a SWAG domain: lists every service the logged-in Authelia user
// may access according to Authelia, based on the active SWAG proxy confs.

const BASE_DOMAIN = 'example.com';
const PROXY_CONFS = '/config/nginx/proxy-confs/*.subdomain.conf';
const AUTHELIA_AUTHZ = 'http://authelia:9091/api/authz/auth-request';
const SKIPPED = ['auth'];

// Services without Authelia (own login): Authelia decides nothing there, so only
// these groups see them. Can be overridden per service (file name without .subdomain.conf).
const GROUPS_WITHOUT_AUTHELIA = ['admins'];
const GROUPS_WITHOUT_AUTHELIA_PER_SERVICE = [
    // 'plex' => ['admins', 'friends'],
];

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
        foreach (array_unique($matches[1]) as $sub) {
            if (in_array($sub, SKIPPED, true)) {
                continue;
            }
            $services[] = ['name' => $name, 'host' => $sub . '.' . BASE_DOMAIN, 'authelia' => $hasAuthelia];
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

function h(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
}

header('Cache-Control: no-store');
require __DIR__ . '/page.html.php';
