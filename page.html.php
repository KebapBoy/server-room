<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Server Room · <?= h(BASE_DOMAIN) ?></title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml;base64,<?= base64_encode(file_get_contents(__DIR__ . '/favicon.svg')) ?>">
<style>
<?= file_get_contents(__DIR__ . '/style.css') ?></style>
</head>
<body>
<main>
<?php $welcome = 'Welcome to ' . BASE_DOMAIN . ($firstName !== '' ? ', ' . $firstName : '') . '!'; ?>
  <header class="intro">
    <h1 id="intro" aria-label="Hello World! <?= h($welcome) ?>"><span class="line">Hello World! </span><span class="line">Welcome to <b><?= h(BASE_DOMAIN) ?></b><?= $firstName !== '' ? ', </span><span class="line">' . h($firstName) : '' ?>!</span></h1>
  </header>
  <div id="rack" class="rack" data-logout="https://auth.<?= h(BASE_DOMAIN) ?>/logout"></div>
  <noscript>
    <ul class="fallback">
<?php foreach (link_tiles($model) as $tile): ?>
      <li><a class="tile" href="<?= h($tile['href']) ?>" target="_blank" rel="noopener">
        <span class="led <?= $tile['led'] ?>"></span><span class="led <?= $tile['state'] === 'running' ? 'act blink' : 'off' ?>"></span><span class="vents"></span>
        <span class="tile-label"><?= h($tile['label']) ?></span>
        <svg class="tile-arrow" viewBox="0 0 8 8" aria-hidden="true"><path d="M1 7l6 -6m-4 0h4v4"/></svg>
      </a></li>
<?php endforeach; ?>
    </ul>
    <p class="logout"><a href="https://auth.<?= h(BASE_DOMAIN) ?>/logout">Sign out</a></p>
  </noscript>
  <p id="status" class="status"></p>
</main>
<script type="application/json" id="model"><?= $modelJson ?></script>
<script>
<?= file_get_contents(__DIR__ . '/intro.js') ?></script>
<script>
<?= file_get_contents(__DIR__ . '/rack.js') ?></script>
</body>
</html>
