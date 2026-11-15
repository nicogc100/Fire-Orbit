// Panel «Armonización»: gráficos de cómo se unen MODIS y VIIRS en una sola serie para Chile.
// Lee data/chile-metodo.json (resultados del modelo, armonizacion-chile-ia/salida).
// Se abre con cualquier botón que tenga data-abrir-metodo. Sin dependencias: SVG a mano.

const VERSION = '20261115orb4';
const numero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const dec1 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec2 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signo = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${dec1.format(Math.abs(v))} %`;
const ANIOS_EJE = [2003, 2006, 2009, 2012, 2015, 2018, 2021, 2025];
const hora = h => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

// Colores validados para fondo oscuro (daltonismo y contraste ≥ 3:1).
const C = {
  modis: '#d9761c',
  viirs: '#1597b0',
  terra: '#d55181',
  metodo_A: '#d55181',
  red: '#9085e9',
  rf: '#199e70',
  combinado: '#3987e5',
  eje: '#9fb0c8',
  rejilla: '#ffffff17',
  texto: '#e6edf7',
};

let dialogo = null;
let datos = null;

document.addEventListener('click', e => {
  const boton = e.target.closest('[data-abrir-metodo]');
  if (!boton) return;
  e.preventDefault();
  abrirArmonizacion(boton);
});

export async function abrirArmonizacion(origen = null) {
  if (!dialogo) crearDialogo();
  dialogo.origen = origen;
  if (!dialogo.open) dialogo.showModal();
  dialogo.querySelector('.como-marco').scrollTop = 0;
  if (datos) return;
  try {
    const r = await fetch(`../data/chile-metodo.json?v=${VERSION}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    datos = await r.json();
    pintar();
  } catch (error) {
    console.error('chile-metodo.json:', error);
    dialogo.querySelector('.como-cuerpo').innerHTML =
      '<p class="como-error">No se pudieron cargar los resultados del modelo. Revisa que exista data/chile-metodo.json.</p>';
  }
}

function crearDialogo() {
  dialogo = document.createElement('dialog');
  dialogo.className = 'como';
  dialogo.setAttribute('aria-labelledby', 'como-titulo');
  dialogo.innerHTML = `
    <div class="como-marco">
      <header class="como-cabeza">
        <div class="como-cabeza-fila">
          <p class="como-antetitulo">Chile · MODIS + VIIRS · 2003–2025</p>
          <button type="button" class="como-cerrar" data-cerrar aria-label="Cerrar armonización">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </div>
        <h2 id="como-titulo">Armonización</h2>
        <nav class="como-indice" aria-label="Secciones">
          <a href="#como-problema">Serie</a>
          <a href="#como-fisica">Detección</a>
          <a href="#como-desfase">Órbitas</a>
          <a href="#como-prueba">Precisión</a>
        </nav>
      </header>
      <div class="como-cuerpo"><div class="panel-cargando" role="status"><div class="esqueleto alto"></div><div class="esqueleto calendario"></div></div></div>
    </div>
    <div class="como-tip" role="tooltip" hidden></div>`;
  document.querySelector('#escena')?.append(dialogo) ?? document.body.append(dialogo);
  dialogo.addEventListener('click', e => {
    if (e.target.closest('[data-cerrar]') || e.target === dialogo) dialogo.close();
    const a = e.target.closest('.como-indice a');
    if (a) {
      e.preventDefault();
      dialogo.querySelector(a.getAttribute('href'))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
  dialogo.addEventListener('close', () => {
    ocultarTip();
    dialogo.origen?.focus?.();
  });
  dialogo.querySelector('.como-marco').addEventListener('scroll', ocultarTip, { passive: true });
}

// ---------- Tooltip compartido ----------
// Dentro del diálogo se usa su propio tooltip (capa superior); fuera, uno en el documento.
let tipSuelto = null;
function tipNodo() {
  if (dialogo?.open) return dialogo.querySelector('.como-tip');
  if (!tipSuelto) {
    tipSuelto = document.createElement('div');
    tipSuelto.className = 'como-tip como-tip-suelto';
    tipSuelto.setAttribute('role', 'tooltip');
    tipSuelto.hidden = true;
    document.body.append(tipSuelto);
  }
  return tipSuelto;
}
function mostrarTip(html, x, y) {
  const tip = tipNodo();
  tip.innerHTML = html;
  tip.hidden = false;
  const t = tip.getBoundingClientRect();
  let left = x + 14,
    top = y - t.height - 12;
  if (left + t.width > innerWidth - 8) left = x - t.width - 14;
  if (top < 8) top = y + 16;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${top}px`;
}
function ocultarTip() {
  for (const tip of [dialogo?.querySelector('.como-tip'), tipSuelto]) if (tip) tip.hidden = true;
}
// Registra el hover sobre elementos con data-tip-i dentro de un nodo.
function conTip(nodo, html, alSalir = null) {
  const mover = e => {
    const el = e.target.closest('[data-tip-i]');
    if (!el || !nodo.contains(el)) return;
    const i = el.dataset.tipI;
    const r = el.getBoundingClientRect();
    const x = e.clientX ?? r.left + r.width / 2,
      y = e.clientY ?? r.top;
    mostrarTip(html(i, el), x || r.left + r.width / 2, y || r.top);
  };
  nodo.addEventListener('pointermove', mover);
  nodo.addEventListener('focusin', e => {
    const el = e.target.closest('[data-tip-i]');
    if (!el) return;
    const r = el.getBoundingClientRect();
    mostrarTip(html(el.dataset.tipI, el), r.left + r.width / 2, r.top);
  });
  const salir = () => {
    ocultarTip();
    alSalir?.();
  };
  nodo.addEventListener('pointerleave', salir);
  nodo.addEventListener('focusout', salir);
}

// ---------- Utilidades de SVG ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ruta = pts =>
  pts
    .filter(p => p && Number.isFinite(p[1]))
    .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
    .join('');
function escalaLineal(d0, d1, r0, r1) {
  const f = v => r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
  return f;
}
function tabla(cabeza, filas) {
  return `<details class="como-tabla"><summary>Ver los números</summary><div class="como-tabla-marco"><table>
    <thead><tr>${cabeza.map((c, i) => `<th scope="col"${i ? ' class="num"' : ''}>${c}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(f => `<tr>${f.map((c, i) => (i ? `<td class="num">${c}</td>` : `<th scope="row">${c}</th>`)).join('')}</tr>`).join('')}</tbody>
  </table></div></details>`;
}
const leyenda = items =>
  `<div class="como-leyenda">${items
    .map(
      ([nombre, color, guion]) =>
        `<span><svg width="22" height="10" aria-hidden="true"><line x1="1" y1="5" x2="21" y2="5" stroke="${color}" stroke-width="${guion === 'barra' ? 8 : 2.5}" ${guion === true ? 'stroke-dasharray="4 3"' : ''} stroke-linecap="${guion === 'barra' ? 'butt' : 'round'}"/></svg>${nombre}</span>`,
    )
    .join('')}</div>`;

// ---------- Pintado ----------
function pintar() {
  const d = datos;
  const a = d.anual;
  const iA = a.anios.indexOf(2011),
    iV = a.anios.indexOf(2012);
  const salto = a.viirs[iV] / a.modis[iA];
  const E = d.modelos.error_anual;
  const iComb = d.modelos.orden.indexOf('combinado'),
    iFac = d.modelos.orden.indexOf('metodo_A');
  const cuerpo = dialogo.querySelector('.como-cuerpo');
  cuerpo.innerHTML = `
    <p class="como-entrada"><b style="color:${C.modis}">MODIS</b> (píxel de 1&nbsp;km) y <b style="color:${C.viirs}">VIIRS</b> (375&nbsp;m) cuentan el fuego de forma distinta. La armonización expresa todo 2003–2025 en la escala de VIIRS para poder comparar años.</p>
    <ul class="como-cifras">
      <li><strong>×${dec1.format(d.razon_viirs_modis)}</strong><span>focos ve VIIRS por cada foco de MODIS</span></li>
      <li><strong>±${dec1.format(E.E2[iComb])} %</strong><span>error anual de la serie armonizada</span></li>
      <li><strong>${a.anios.length} años</strong><span>de serie continua ${a.anios[0]}–${a.anios.at(-1)}</span></li>
    </ul>

    <section class="como-sec" id="como-problema" aria-labelledby="t-problema">
      <h3 id="t-problema">Serie anual</h3>
      <div class="como-control" role="group" aria-label="Serie" data-grupo="serie">
        <button type="button" data-modo="sin" aria-pressed="false">Sin armonizar</button>
        <button type="button" data-modo="factor" aria-pressed="false">Factor simple</button>
        <button type="button" data-modo="ia" aria-pressed="true">Armonizada (IA)</button>
      </div>
      <figure class="como-fig" data-grafico="serie"></figure>
      <p class="como-explica" data-explica="serie" aria-live="polite"></p>
      ${tabla(
        ['Año', 'MODIS crudo', 'VIIRS medido', 'Factor simple', 'Armonizada (IA)'],
        a.anios.map((y, i) => [y, numero.format(a.modis[i]), a.viirs[i] != null ? numero.format(a.viirs[i]) : '—', a.factor[i] != null ? numero.format(a.factor[i]) : '—', a.ia[i] != null ? numero.format(a.ia[i]) : '—']),
      )}
    </section>

    <section class="como-sec" id="como-fisica" aria-labelledby="t-fisica">
      <h3 id="t-fisica">Probabilidad de que MODIS Aqua detecte un fuego</h3>
      <div class="como-controles">
        <div class="como-control" role="group" aria-label="Momento del día" data-grupo="curva">
          <button type="button" data-noche="0" aria-pressed="true">Día</button>
          <button type="button" data-noche="1" aria-pressed="false">Noche</button>
        </div>
        <label class="como-deslizador">Tamaño del píxel: <output data-area>1,0 km² (centro)</output>
          <input type="range" min="1" max="9" step="0.5" value="1" data-area-in>
        </label>
      </div>
      <figure class="como-fig" data-grafico="curva"></figure>
      <p class="como-explica" data-explica="curva" aria-live="polite"></p>
    </section>

    <section class="como-sec" id="como-desfase" aria-labelledby="t-desfase">
      <h3 id="t-desfase">Hora de paso de los satélites</h3>
      <p class="como-nota">Desde 2022 Aqua pasa más tarde y Terra más temprano; la armonización usa la hora real de cada pasada.</p>
      <figure class="como-fig" data-grafico="horas"></figure>
    </section>

    <section class="como-sec" id="como-prueba" aria-labelledby="t-prueba">
      <h3 id="t-prueba">Precisión</h3>
      <p class="como-nota">Error anual al estimar años que no se usaron para entrenar (menos es mejor).</p>
      <figure class="como-fig" data-grafico="errores"></figure>
      ${leyenda(d.modelos.orden.map(m => [d.modelos.nombres[m], C[m], 'barra']))}
      ${tabla(
        ['Método', 'Año por año', 'Años desfasados', 'Futuro (2022–2025)'],
        d.modelos.orden.map((m, i) => [d.modelos.nombres[m], `±${dec1.format(E.E2[i])} %`, `±${dec1.format(E.E2b[i])} %`, `±${dec1.format(E.E1[i])} %`]),
      )}
    </section>

    <p class="como-fuentes">Validado con los registros de incendios de CONAF: los gráficos están en la pestaña «Validación» del panel de Chile.
      Las detecciones miden actividad de quema (incluye quemas agrícolas), no incendios. Fuentes: NASA FIRMS (MODIS C6.1, VIIRS 375&nbsp;m), CONAF, INE. Otros países usan armonización simple (factor por mes).</p>`;

  graficoSerie('ia');
  graficoCurva();
  graficoHoras();
  graficoErrores('anual');

  cuerpo.querySelector('[data-grupo="serie"]').addEventListener('click', e => {
    const b = e.target.closest('[data-modo]');
    if (!b) return;
    marcar(b);
    graficoSerie(b.dataset.modo);
  });
  cuerpo.querySelector('[data-grupo="curva"]').addEventListener('click', e => {
    const b = e.target.closest('[data-noche]');
    if (!b) return;
    marcar(b);
    graficoCurva();
  });
  cuerpo.querySelector('[data-area-in]').addEventListener('input', () => graficoCurva());
}
function marcar(boton) {
  for (const b of boton.parentElement.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b === boton));
}
let raizGraficos = null;
const fig = nombre => (raizGraficos ?? dialogo).querySelector(`[data-grafico="${nombre}"]`);

// ---------- 1. Serie anual ----------
function graficoSerie(modo) {
  const a = datos.anual;
  const W = 720,
    H = 300,
    m = { l: 52, r: 118, t: 18, b: 30 };
  const n = a.anios.length;
  const x = i => m.l + (i / (n - 1)) * (W - m.l - m.r);
  const yMax = 22000;
  const y = escalaLineal(0, yMax, H - m.b, m.t);
  const i12 = a.anios.indexOf(2012),
    i22 = a.anios.indexOf(2022);
  const recon = modo === 'factor' ? a.factor : modo === 'ia' ? a.ia : null;
  const colorRecon = modo === 'factor' ? C.metodo_A : C.viirs;
  const rejilla = [0, 5000, 10000, 15000, 20000]
    .map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${C.rejilla}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="eje">${numero.format(v)}</text>`)
    .join('');
  const ejeX = a.anios
    .map((anio, i) => (ANIOS_EJE.includes(anio) ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" class="eje">${anio}</text>` : ''))
    .join('');
  const pts = arr => arr.map((v, i) => (v == null ? null : [x(i), y(v)]));
  // La reconstrucción se une con el primer año medido por VIIRS.
  const reconPts = recon ? pts(recon.map((v, i) => (i === i12 ? a.viirs[i] : v))) : null;
  const ultimo = n - 1;
  const etiquetas = [
    [a.modis[ultimo], 'MODIS crudo', C.modis],
    [a.viirs[ultimo], 'VIIRS medido', C.viirs],
  ];
  // Salto en 2012 (solo sin armonizar)
  const saltoSvg =
    modo === 'sin'
      ? `<line x1="${x(i12) + 6}" x2="${x(i12) + 6}" y1="${y(a.modis[i12 - 1])}" y2="${y(a.viirs[i12])}" stroke="${C.texto}" stroke-width="1.2" marker-end="url(#flecha)"/>
         <text x="${x(i12) + 12}" y="${(y(a.modis[i12 - 1]) + y(a.viirs[i12])) / 2 + 4}" class="anota">×${dec1.format(a.viirs[i12] / a.modis[i12 - 1])} falso</text>`
      : '';
  const reconSvg = recon
    ? `<path d="${ruta(reconPts.slice(0, i12 + 1))}" fill="none" stroke="${colorRecon}" stroke-width="2.5" stroke-dasharray="6 4" stroke-linecap="round"/>
       ${reconPts
         .slice(0, i12)
         .map(p => (p ? `<circle cx="${p[0]}" cy="${p[1]}" r="3" fill="${colorRecon}" stroke="#0b1220" stroke-width="1.5"/>` : ''))
         .join('')}
       <text x="${x(1)}" y="${y(Math.max(...recon.filter(v => v != null))) - 12}" class="anota" fill="${colorRecon}">${modo === 'factor' ? 'MODIS × factor por mes' : 'Armonizada con IA'}</text>`
    : '';
  fig('serie').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Focos de fuego por año en Chile 2003–2025. ${modo === 'sin' ? 'Sin armonizar: salto en 2012.' : modo === 'factor' ? 'Con factor simple.' : 'Con el modelo IA.'}">
    <defs><marker id="flecha" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="${C.texto}"/></marker></defs>
    <rect x="${x(i22) - 8}" y="${m.t}" width="${x(ultimo) - x(i22) + 16}" height="${H - m.t - m.b}" fill="#ffffff08"/>
    <text x="${x(i22) - 4}" y="${m.t + 12}" class="eje">Aqua y Terra desfasados</text>
    ${rejilla}${ejeX}
    <line x1="${x(i12)}" x2="${x(i12)}" y1="${m.t}" y2="${H - m.b}" stroke="${C.eje}" stroke-dasharray="2 3"/>
    <text x="${x(i12) - 4}" y="${m.t + 12}" text-anchor="end" class="eje">llega VIIRS →</text>
    <path d="${ruta(pts(a.modis))}" fill="none" stroke="${C.modis}" stroke-width="${modo === 'sin' ? 2.5 : 2}" opacity="${modo === 'sin' ? 1 : 0.4}" stroke-linejoin="round"/>
    <path d="${ruta(pts(a.viirs))}" fill="none" stroke="${C.viirs}" stroke-width="2.5" stroke-linejoin="round"/>
    ${reconSvg}${saltoSvg}
    ${etiquetas.map(([v, t, c]) => `<text x="${x(ultimo) + 8}" y="${y(v) + 4}" class="etiqueta" fill="${c}">${t}</text>`).join('')}
    <line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="${C.texto}" stroke-opacity=".5" visibility="hidden"/>
    ${a.anios.map((_, i) => `<rect data-tip-i="${i}" x="${x(i) - (W - m.l - m.r) / (n - 1) / 2}" y="${m.t}" width="${(W - m.l - m.r) / (n - 1)}" height="${H - m.t - m.b}" fill="transparent"/>`).join('')}
  </svg>`;
  fig('serie').dataset.modo = modo;
  if (!fig('serie').dataset.tip) {
    fig('serie').dataset.tip = '1';
    conTip(fig('serie'), i => tipSerie(+i), () => fig('serie').querySelector('.cruz')?.setAttribute('visibility', 'hidden'));
  }
  function tipSerie(i) {
    const modo = fig('serie').dataset.modo;
    const cruz = fig('serie').querySelector('.cruz');
      cruz.setAttribute('x1', x(i));
      cruz.setAttribute('x2', x(i));
      cruz.setAttribute('visibility', 'visible');
      const fila = (c, t, v) => (v == null ? '' : `<div><i style="background:${c}"></i>${t}<b>${numero.format(v)}</b></div>`);
      return `<strong>${a.anios[i]}</strong>${fila(C.modis, 'MODIS crudo', a.modis[i])}${fila(C.viirs, a.anios[i] === 2012 ? 'VIIRS (ene. estimado)' : 'VIIRS medido', a.viirs[i])}${modo === 'factor' ? fila(C.metodo_A, 'Factor simple', a.factor[i]) : ''}${modo === 'ia' ? fila(C.viirs, 'Armonizada (IA)', a.ia[i]) : ''}<small>celdas de ~1 km con fuego en el año</small>`;
  }
  const E = datos.modelos.por_anio_E2;
  const textos = {
    sin: `MODIS hasta 2011 y VIIRS desde 2012: el cambio de sensor crea un salto falso de ×${dec1.format(a.viirs[i12] / a.modis[i12 - 1])}.`,
    factor: `MODIS × un factor por mes: quita el salto, pero falla en años extremos (2017: ${signo(E.metodo_A['2017'])}) y con satélites desfasados (2025: ${signo(E.metodo_A['2025'])}).`,
    ia: `Antes de 2012 la serie se estima desde MODIS con red neuronal + Random Forest y la curva de detección. Error en 2017: ${signo(E.combinado['2017'])}; 2025: ${signo(E.combinado['2025'])}.`,
  };
  dialogo.querySelector('[data-explica="serie"]').textContent = textos[modo];
}

// ---------- 2. Píxeles y Maule ----------
function graficoMaule(W = 720) {
  const d = datos.maule;
  const angosto = W < 600,
    H = 250,
    m = { l: 44, r: 10, t: 22, b: 44 };
  const n = d.clases.length;
  const banda = (W - m.l - m.r) / n;
  const bw = Math.min(34, banda * 0.32);
  const y = escalaLineal(0, 100, H - m.b, m.t);
  const barra = (v, cx, c, i, s) => {
    const h = Math.max(1, H - m.b - y(v));
    return `<path data-tip-i="${i}" tabindex="0" d="M${cx},${H - m.b}V${y(v) + Math.min(4, h)}q0,-4 4,-4h${bw - 8}q4,0 4,4V${H - m.b}z" fill="${c}"/>
      <text x="${cx + bw / 2}" y="${y(v) - 6}" text-anchor="middle" class="valor">${dec1.format(v).replace(',0', '')}%</text>`;
  };
  fig('maule').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Porcentaje de incendios CONAF del Maule 2018–2019 detectados por MODIS y VIIRS según su tamaño">
    ${[0, 25, 50, 75, 100].map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${C.rejilla}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="eje">${v}%</text>`).join('')}
    ${d.clases
      .map((c, i) => {
        const cx = m.l + banda * i + banda / 2;
        return `${barra(d.modis[i], cx - bw - 1, C.modis, i)}${barra(d.viirs[i], cx + 1, C.viirs, i)}
          <text x="${cx}" y="${H - m.b + 18}" text-anchor="middle" class="eje-fuerte">${esc(angosto ? c.replace(' ha', '') : c)}</text>
          <text x="${cx}" y="${H - m.b + 34}" text-anchor="middle" class="eje">${angosto ? `n=${d.n_por_clase[i]}` : `${d.n_por_clase[i]} incendios`}</text>`;
      })
      .join('')}
  </svg>`;
  conTip(
    fig('maule'),
    i =>
      `<strong>Incendios de ${esc(d.clases[i])}</strong><div><i style="background:${C.modis}"></i>MODIS<b>${dec1.format(d.modis[i])} %</b></div><div><i style="background:${C.viirs}"></i>VIIRS<b>${dec1.format(d.viirs[i])} %</b></div><small>${d.n_por_clase[i]} incendios CONAF en esa clase</small>`,
  );
}

// ---------- 3. Curva de detección ----------
function probabilidad(frp, noche, area) {
  const b = datos.curva.coeficientes;
  const L = Math.log10(frp);
  const z = b.b0 + b.b1 * L + b.b2 * noche + b.b3 * Math.log(area) + b.b4 * L * noche;
  return 1 / (1 + Math.exp(-z));
}
function frp50(noche, area) {
  const b = datos.curva.coeficientes;
  return 10 ** (-(b.b0 + b.b2 * noche + b.b3 * Math.log(area)) / (b.b1 + b.b4 * noche));
}
function graficoCurva() {
  const noche = +(dialogo.querySelector('[data-grupo="curva"] [aria-pressed="true"]')?.dataset.noche ?? 0);
  const area = +dialogo.querySelector('[data-area-in]').value;
  dialogo.querySelector('[data-area]').textContent = `${dec1.format(area)} km² ${area <= 1.5 ? '(centro)' : area >= 7 ? '(borde de la franja)' : ''}`;
  const W = 720,
    H = 280,
    m = { l: 52, r: 20, t: 16, b: 40 };
  const lx = escalaLineal(0, 3, m.l, W - m.r); // log10 FRP: 1 a 1000 MW
  const y = escalaLineal(0, 1, H - m.b, m.t);
  const curva = (nn, aa) => {
    const pts = [];
    for (let L = 0; L <= 3.0001; L += 0.02) pts.push([lx(L), y(probabilidad(10 ** L, nn, aa))]);
    return ruta(pts);
  };
  const f50 = frp50(noche, area);
  const c = noche ? '#9085e9' : '#f0a830';
  fig('curva').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Probabilidad de que Aqua detecte un fuego según su potencia. FRP50 = ${dec1.format(f50)} MW">
    ${[0, 0.25, 0.5, 0.75, 1].map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${C.rejilla}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="eje">${v * 100}%</text>`).join('')}
    ${[1, 3, 10, 30, 100, 300, 1000].map(v => `<text x="${lx(Math.log10(v))}" y="${H - m.b + 18}" text-anchor="middle" class="eje">${numero.format(v)}</text>`).join('')}
    <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle" class="eje">Potencia del fuego, FRP (MW, escala logarítmica)</text>
    ${
      noche || area > 1
        ? `<path d="${curva(0, 1)}" fill="none" stroke="${C.eje}" stroke-width="1.5" stroke-dasharray="3 4" opacity=".7"/>
           <text x="${lx(1.9)}" y="${y(probabilidad(10 ** 1.9, 0, 1)) - 10}" text-anchor="end" class="eje">referencia: día, centro</text>`
        : ''
    }
    <path d="${curva(noche, area)}" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>
    ${
      f50 >= 1 && f50 <= 1000
        ? `<line x1="${lx(Math.log10(f50))}" x2="${lx(Math.log10(f50))}" y1="${y(0.5)}" y2="${H - m.b}" stroke="${c}" stroke-dasharray="2 3"/>
           <circle cx="${lx(Math.log10(f50))}" cy="${y(0.5)}" r="5" fill="${c}" stroke="#0b1220" stroke-width="2"/>
           <text x="${lx(Math.log10(f50)) + 10}" y="${y(0.5) + 18}" class="anota" fill="${c}">FRP50 = ${dec1.format(f50)} MW</text>`
        : ''
    }
    <line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="${C.texto}" stroke-opacity=".5" visibility="hidden"/>
    <circle class="punto" r="5" fill="${C.texto}" visibility="hidden"/>
    ${Array.from({ length: 60 }, (_, i) => `<rect data-tip-i="${i}" x="${lx((i / 60) * 3)}" y="${m.t}" width="${(W - m.l - m.r) / 60 + 0.5}" height="${H - m.t - m.b}" fill="transparent"/>`).join('')}
  </svg>`;
  if (!fig('curva').dataset.tip) {
    fig('curva').dataset.tip = '1';
    conTip(
      fig('curva'),
      i => {
        const nn = +(dialogo.querySelector('[data-grupo="curva"] [aria-pressed="true"]')?.dataset.noche ?? 0);
        const aa = +dialogo.querySelector('[data-area-in]').value;
        const L = ((+i + 0.5) / 60) * 3,
          frp = 10 ** L,
          p = probabilidad(frp, nn, aa);
        const cr = fig('curva').querySelector('.cruz'),
          pt = fig('curva').querySelector('.punto');
        cr.setAttribute('x1', lx(L));
        cr.setAttribute('x2', lx(L));
        cr.setAttribute('visibility', 'visible');
        pt.setAttribute('cx', lx(L));
        pt.setAttribute('cy', y(p));
        pt.setAttribute('visibility', 'visible');
        return `<strong>Fuego de ${frp < 10 ? dec1.format(frp) : numero.format(frp)} MW</strong><div>Aqua lo detecta<b>${numero.format(p * 100)} %</b></div><div>Peso 1/P<b>${dec1.format(1 / p)}</b></div><small>${nn ? 'noche' : 'día'}, píxel de ${dec1.format(aa)} km²</small>`;
      },
      () => {
        fig('curva').querySelector('.cruz')?.setAttribute('visibility', 'hidden');
        fig('curva').querySelector('.punto')?.setAttribute('visibility', 'hidden');
      },
    );
  }
  const p10 = probabilidad(10, noche, area);
  dialogo.querySelector('[data-explica="curva"]').innerHTML =
    `Fuego de 10 MW: detectado <b>${numero.format(p10 * 100)} %</b> de las veces · 50 % de detección desde <b>${dec1.format(f50)} MW</b>. Cada foco MODIS se pondera por 1/P en la armonización.`;
}

// ---------- 4. Desfase ----------
function graficoHoras() {
  const h = datos.horas;
  const W = 720,
    H = 260,
    m = { l: 52, r: 70, t: 16, b: 30 };
  const n = h.anios.length;
  const x = i => m.l + (i / (n - 1)) * (W - m.l - m.r);
  const y = escalaLineal(8.75, 15.5, H - m.b, m.t);
  const series = [
    ['aqua', 'Aqua', C.modis],
    ['viirs', 'VIIRS', C.viirs],
    ['terra', 'Terra', C.terra],
  ];
  const i22 = h.anios.indexOf(2022);
  fig('horas').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Hora solar media de paso sobre Chile por año: Aqua se atrasa hasta las ${hora(h.aqua.at(-1))} y Terra se adelanta hasta las ${hora(h.terra.at(-1))}">
    <rect x="${x(i22) - 8}" y="${m.t}" width="${x(n - 1) - x(i22) + 16}" height="${H - m.t - m.b}" fill="#ffffff08"/>
    ${[9, 10, 11, 12, 13, 14, 15].map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}" stroke="${C.rejilla}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end" class="eje">${v}:00</text>`).join('')}
    ${h.anios.map((a, i) => (ANIOS_EJE.includes(a) ? `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" class="eje">${a}</text>` : '')).join('')}
    ${series.map(([k, t, c]) => `<path d="${ruta(h[k].map((v, i) => (v == null ? null : [x(i), y(v)])))}" fill="none" stroke="${c}" stroke-width="2.5" stroke-linejoin="round"/><text x="${x(n - 1) + 8}" y="${y(h[k].at(-1)) + 4}" class="etiqueta" fill="${c}">${t}</text>`).join('')}
    <text x="${x(i22) - 2}" y="${y(15.35)}" class="eje">órbitas a la deriva</text>
    <line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" stroke="${C.texto}" stroke-opacity=".5" visibility="hidden"/>
    ${h.anios.map((_, i) => `<rect data-tip-i="${i}" x="${x(i) - (W - m.l - m.r) / (n - 1) / 2}" y="${m.t}" width="${(W - m.l - m.r) / (n - 1)}" height="${H - m.t - m.b}" fill="transparent"/>`).join('')}
  </svg>`;
  const cruz = fig('horas').querySelector('.cruz');
  conTip(
    fig('horas'),
    i => {
      cruz.setAttribute('x1', x(+i));
      cruz.setAttribute('x2', x(+i));
      cruz.setAttribute('visibility', 'visible');
      return `<strong>${h.anios[i]}</strong>${series.map(([k, t, c]) => (h[k][i] == null ? '' : `<div><i style="background:${c}"></i>${t}<b>${hora(h[k][i])}</b></div>`)).join('')}<small>hora solar local media de paso</small>`;
    },
    () => cruz.setAttribute('visibility', 'hidden'),
  );
}
function barrasH(nombre, filas, { maximo, formato, color, ref = null, aria, ancho = 720, izquierda = 250 }) {
  // filas: [{etiqueta, valor, color?, nota?}]
  const W = ancho,
    fh = 34,
    m = { l: izquierda, r: 70, t: 6, b: ref ? 22 : 6 };
  const H = m.t + m.b + filas.length * fh;
  const x = escalaLineal(0, maximo, m.l, W - m.r);
  fig(nombre).innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
    ${filas
      .map((f, i) => {
        const yy = m.t + i * fh + 6,
          h = fh - 14,
          w = Math.max(2, x(f.valor) - m.l);
        return `<text x="${m.l - 10}" y="${yy + h / 2 + 4}" text-anchor="end" class="eje-fuerte">${esc(f.etiqueta)}</text>
          <path data-tip-i="${i}" tabindex="0" d="M${m.l},${yy}h${Math.max(0, w - 4)}q4,0 4,4v${h - 8}q0,4 -4,4h-${Math.max(0, w - 4)}z" fill="${f.color || color}"/>
          <text x="${m.l + w + 8}" y="${yy + h / 2 + 4}" class="valor">${formato(f.valor)}${f.nota ? ` <tspan class="eje">${esc(f.nota)}</tspan>` : ''}</text>`;
      })
      .join('')}
    ${
      ref
        ? `<line x1="${x(ref.valor)}" x2="${x(ref.valor)}" y1="${m.t}" y2="${H - m.b + 4}" stroke="${C.texto}" stroke-width="1.5" stroke-dasharray="4 3"/>
           <text x="${x(ref.valor)}" y="${H - 4}" text-anchor="middle" class="eje-fuerte">${esc(ref.texto)}</text>`
        : ''
    }
  </svg>`;
  conTip(fig(nombre), i => `<strong>${esc(filas[i].etiqueta)}</strong><div>${formato(filas[i].valor)}</div>${filas[i].detalle || filas[i].nota ? `<small>${esc(filas[i].detalle || filas[i].nota)}</small>` : ''}`);
}

// ---------- 6. Prueba ciega ----------
function graficoErrores(tipo) {
  const mm = datos.modelos;
  const fuente = tipo === 'mensual' ? mm.error_mensual : mm.error_anual;
  const grupos = [
    ['E2', 'Año por año', 'se esconde cada año 2012–2025, uno a la vez'],
    ['E2b', 'Años desfasados', '2022–2025, con Aqua y Terra corridos'],
    ['E1', 'Futuro', 'entrenado 2012–2021, probado 2022–2025'],
  ];
  const W = 720,
    gh = 4 * 22 + 30,
    m = { l: 215, r: 60, t: 6, b: 6 };
  const H = m.t + m.b + grupos.length * gh;
  const maximo = Math.max(25, ...Object.values(fuente).flat()) * 1.05;
  const x = escalaLineal(0, maximo, m.l, W - m.r);
  fig('errores').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Error ${tipo} mediano de cada modelo en las tres pruebas">
    ${[0, 5, 10, 15, 20, 25].filter(v => v <= maximo).map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t}" y2="${H - m.b}" stroke="${C.rejilla}"/>`).join('')}
    ${grupos
      .map(([k, t, sub], g) => {
        const y0 = m.t + g * gh;
        return `<text x="${m.l - 12}" y="${y0 + 36}" text-anchor="end" class="eje-fuerte">${t}</text>
          <text x="${m.l - 12}" y="${y0 + 54}" text-anchor="end" class="eje">${sub.split(', ')[0]}</text>
          <text x="${m.l - 12}" y="${y0 + 70}" text-anchor="end" class="eje">${sub.split(', ')[1] ?? ''}</text>
          ${mm.orden
            .map((mod, i) => {
              const v = fuente[k][i],
                yy = y0 + 8 + i * 22,
                w = x(v) - m.l;
              const mejor = v === Math.min(...fuente[k]);
              return `<path data-tip-i="${k}|${i}" tabindex="0" d="M${m.l},${yy}h${Math.max(0, w - 3)}q3,0 3,3v10q0,3 -3,3h-${Math.max(0, w - 3)}z" fill="${C[mod]}"/>
                <text x="${m.l + w + 6}" y="${yy + 12}" class="valor${mejor ? ' mejor' : ''}">±${dec1.format(v)} %${mejor ? ' ★' : ''}</text>`;
            })
            .join('')}`;
      })
      .join('')}
  </svg>`;
  if (!fig('errores').dataset.tip) {
    fig('errores').dataset.tip = '1';
    conTip(fig('errores'), clave => {
      const [k, i] = clave.split('|');
      return `<strong>${mm.nombres[mm.orden[i]]}</strong><div>Error anual mediano<b>±${dec1.format(mm.error_anual[k][i])} %</b></div><small>${grupos.find(g => g[0] === k)[1]}</small>`;
    });
  }
}

// ---------- 7. CONAF ----------
function graficoConaf(W = 720) {
  const f = datos.conaf.focos_por_incendio;
  const filas = [
    ['sin_armonizar', 'Sin armonizar', C.modis],
    ['metodo_A_serie', 'Factor simple', C.metodo_A],
    ['armonizada', 'Armonizada', C.combinado],
  ];
  const fh = 52,
    m = { l: W < 600 ? 118 : 150, r: W < 600 ? 64 : 90, t: 30, b: 10 };
  const H = m.t + m.b + filas.length * fh;
  const x = escalaLineal(0, 2.5, m.l, W - m.r);
  fig('conaf').innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Focos satelitales por cada incendio CONAF antes y después de 2012">
    <text x="${m.l}" y="14" class="eje">○ 2003–2010</text><text x="${m.l + 110}" y="14" class="eje">● 2012–2023</text>
    ${[0, 0.5, 1, 1.5, 2, 2.5].map(v => `<line x1="${x(v)}" x2="${x(v)}" y1="${m.t - 6}" y2="${H - m.b}" stroke="${C.rejilla}"/><text x="${x(v)}" y="${H}" text-anchor="middle" class="eje">${dec1.format(v)}</text>`).join('')}
    ${filas
      .map(([k, t, c], i) => {
        const [a, b] = f[k],
          yy = m.t + i * fh + fh / 2 - 6;
        const cambio = (b / a - 1) * 100;
        return `<text x="${m.l - 14}" y="${yy + 4}" text-anchor="end" class="eje-fuerte">${t}</text>
          <line x1="${x(a)}" x2="${x(b)}" y1="${yy}" y2="${yy}" stroke="${c}" stroke-width="3" opacity=".55"/>
          <circle data-tip-i="${i}" tabindex="0" cx="${x(a)}" cy="${yy}" r="8" fill="#0b1220" stroke="${c}" stroke-width="3"/>
          <circle data-tip-i="${i}" cx="${x(b)}" cy="${yy}" r="8" fill="${c}"/>
          <text x="${Math.max(x(a), x(b)) + 16}" y="${yy + 5}" class="valor${Math.abs(cambio) < 30 ? ' mejor' : ''}">${signo(cambio)}</text>`;
      })
      .join('')}
  </svg>`;
  conTip(fig('conaf'), i => {
    const [k, t] = filas[i],
      [a, b] = f[k];
    return `<strong>${t}</strong><div>2003–2010<b>${dec2.format(a)}</b></div><div>2012–2023<b>${dec2.format(b)}</b></div><small>focos satelitales por cada incendio registrado por CONAF</small>`;
  });
}

// ---------- Validación con CONAF (pestaña «Validación» del panel de Chile) ----------
export async function pintarValidacion(nodo) {
  nodo.innerHTML = '<div class="panel-cargando" role="status"><div class="esqueleto alto"></div><div class="esqueleto calendario"></div></div>';
  try {
    if (!datos) {
      const r = await fetch(`../data/chile-metodo.json?v=${VERSION}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      datos = await r.json();
    }
  } catch (error) {
    console.error('chile-metodo.json:', error);
    nodo.innerHTML = '<p class="vacio-nota">No se pudo cargar la validación.</p>';
    return;
  }
  const d = datos,
    f = d.conaf.focos_por_incendio,
    c = d.conaf.correlacion_n_incendios_2003_2010;
  const cambio = k => signo((f[k][1] / f[k][0] - 1) * 100);
  nodo.innerHTML = `
    <div class="validacion">
      <p class="validacion-intro">Los registros de incendios de <b>CONAF</b> sirvieron para validar el modelo de armonización: son conteos en terreno, independientes de los satélites.</p>
      <section class="bloque">
        <h3>Focos por cada incendio CONAF</h3>
        <p class="validacion-nota">Si la serie es consistente, no debería saltar al cambiar de satélite en 2012.</p>
        <figure class="como-fig" data-grafico="conaf"></figure>
        <p class="validacion-nota">Sin armonizar: <b>${cambio('sin_armonizar')}</b> · Armonizada: <b>${cambio('armonizada')}</b></p>
      </section>
      <section class="bloque">
        <h3>¿Sube y baja con CONAF?</h3>
        <p class="validacion-nota">Correlación con el número de incendios por temporada, 2003–2010.</p>
        <figure class="como-fig como-fig-baja" data-grafico="correlacion"></figure>
      </section>
      <section class="bloque">
        <h3>Incendios detectados según su tamaño</h3>
        <p class="validacion-nota">${numero.format(d.maule.incendios)} incendios CONAF, Región del Maule, temporada 2018–2019.</p>
        <figure class="como-fig" data-grafico="maule"></figure>
        ${leyenda([
          ['MODIS', C.modis, 'barra'],
          ['VIIRS', C.viirs, 'barra'],
        ])}
      </section>
      <p class="panel-nota">Fuente: CONAF (ocurrencia y daño por comuna 1985–2024; base de incendios Maule 2018–2019). <button type="button" class="enlace" data-abrir-metodo>Ver armonización</button></p>
    </div>`;
  raizGraficos = nodo;
  try {
    graficoConaf(430);
    barrasH(
      'correlacion',
      [
        { etiqueta: 'Sin armonizar', valor: c.sin_armonizar, color: C.modis },
        { etiqueta: 'Factor simple', valor: c.metodo_A_serie, color: C.metodo_A },
        { etiqueta: 'Armonizada (IA)', valor: c.armonizada, color: C.combinado },
      ],
      { maximo: 1, formato: v => dec2.format(v), ancho: 430, izquierda: 130, aria: 'Correlación entre la serie satelital y los incendios CONAF por temporada, 2003–2010' },
    );
    graficoMaule(430);
  } finally {
    raizGraficos = null;
  }
}
