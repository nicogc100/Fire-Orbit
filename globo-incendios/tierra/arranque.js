// Si falla la descarga de un módulo, el navegador no ejecuta la aplicación:
// sin este aviso, la página se quedaría en «Preparando la Tierra…» para siempre.
(() => {
  const script = document.createElement('script');
  script.type = 'module';
  script.src = 'tierra.js?v=46';
  script.onerror = () => {
    document.querySelector('#carga').hidden = true;
    document.querySelector('#portada').hidden = true;
    document.querySelector('#error-datos').hidden = true;
    document.querySelector('#mensaje-error').textContent = 'La descarga se interrumpió. Comprueba que el servidor local sigue abierto y vuelve a intentarlo.';
    document.querySelector('#error').hidden = false;
    document.querySelector('#escena').dataset.state = 'error';
    document.querySelector('#reintentar').addEventListener('click', () => location.reload());
  };
  document.head.append(script);
})();
