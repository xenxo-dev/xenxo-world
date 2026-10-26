// Modificado para xenxo.io: espera a xenxo (récord de cada jugador) y deja la partida en window.gameManager.
(window.xenxoReady || Promise.resolve()).then(function () {
  // Wait till the browser is ready to render the game (avoids glitches)
  window.requestAnimationFrame(function () {
    window.gameManager = new GameManager(4, KeyboardInputManager, HTMLActuator, LocalStorageManager);
  });
});
