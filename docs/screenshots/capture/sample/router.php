<?php
// Router for PHP's built-in server: sets the headers Authelia would pass, per port
// 8081 an admin, 8082 a regular user, then runs the page
if ($_SERVER['SERVER_PORT'] == 8081) {
    $_SERVER += ['REMOTE_USER' => 'alex', 'REMOTE_NAME' => 'Alex Example', 'REMOTE_GROUPS' => 'admins'];
} else {
    $_SERVER += ['REMOTE_USER' => 'sam', 'REMOTE_NAME' => 'Sam Example', 'REMOTE_GROUPS' => 'family'];
}
require '/work/site/index.php';
