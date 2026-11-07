<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h(BASE_DOMAIN) ?></title>
<link rel="icon" href="/favicon.ico">
<style>
<?= file_get_contents(__DIR__ . '/style.css') ?></style>
</head>
<body>
<main>
  <header class="top">
    <h1><?= h(BASE_DOMAIN) ?></h1>
    <p>Angemeldet als <?= h($displayName) ?> · <a id="logout" href="https://auth.<?= h(BASE_DOMAIN) ?>/logout">Abmelden</a></p>
  </header>
  <div id="rack" class="rack"></div>
  <noscript>
    <ul class="fallback">
<?php foreach ($visible as $s): ?>
      <li><a href="https://<?= h($s['host']) ?>/"><?= h($s['name']) ?></a></li>
<?php endforeach; ?>
    </ul>
  </noscript>
  <p id="status" class="status"></p>
</main>
<script type="application/json" id="model"><?= $modelJson ?></script>
<script>
<?= file_get_contents(__DIR__ . '/rack.js') ?></script>
</body>
</html>
