// Calendario histórico harmonizado: años × meses, de 2000 a hoy.
// Lee la serie de data/<pais>-mensual.json (procesamiento/2_armonizar.py y 3_actualizar.py).
// Sin dependencias de WebGL: solo DOM.

const numero = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const INICIALES = ['E', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

// Anomalía = valor ÷ mediana del mismo mes. Cortes simétricos en escala multiplicativa.
const TRAMOS_ANOMALIA = [
  { nivel: -2, hasta: 0.5, texto: 'menos de la mitad' },
  { nivel: -1, hasta: 0.8, texto: 'bajo lo normal' },
  { nivel: 0, hasta: 1.25, texto: 'normal' },
  { nivel: 1, hasta: 2, texto: 'sobre lo normal' },
  { nivel: 2, hasta: 4, texto: '2 a 4 veces lo normal' },
  { nivel: 3, hasta: Infinity, texto: 'más de 4 veces lo normal' },
];
const nivelAnomalia = r => TRAMOS_ANOMALIA.find(t => r < t.hasta).nivel;

// Ordena la serie por año y mes y calcula lo que necesita el calendario.
export function prepararSerie(serie) {
  const mediana = serie.por_mes_calendario.mediana;
  const porAnio = new Map();
  serie.meses.forEach((clave, i) => {
    const anio = +clave.slice(0, 4),
      mes = +clave.slice(5, 7) - 1;
    if (!porAnio.has(anio)) porAnio.set(anio, Array(12).fill(null));
    const valor = serie.armonizado[i];
    const normal = mediana[mes];
    porAnio.get(anio)[mes] = {
      clave,
      anio,
      mes,
      valor,
      origen: serie.origen?.[i] ?? '',
      incompleto: Boolean(serie.incompleto?.[i]),
      normal,
      razon: valor != null && normal > 0 ? valor / normal : null,
      modis: serie.modis?.[i],
      viirs: serie.viirs?.[i],
    };
  });
  const anios = [...porAnio.keys()].sort((a, b) => b - a); // el más reciente arriba
  const todas = [...porAnio.values()].flat().filter(Boolean);
  const ultima = todas.at(-1);
  const enCurso = ultima?.incompleto && ultima.anio >= 2003 ? ultima : null;

  // Escala de conteo: cuantiles de los meses completos (la actividad es muy asimétrica).
  const valores = todas
    .filter(c => !c.incompleto && c.valor > 0)
    .map(c => c.valor)
    .sort((a, b) => a - b);
  const q = p => valores[Math.min(valores.length - 1, Math.floor(valores.length * p))];
  const cortes = [q(0.2), q(0.4), q(0.6), q(0.8)];
  const nivelConteo = v => (v == null ? null : v <= 0 ? 0 : 1 + cortes.filter(c => v > c).length);

  // Indicadores
  const completos = anios.filter(a => porAnio.get(a).every(c => c && !c.incompleto));
  const totalAnio = a => porAnio.get(a).reduce((s, c) => s + (c?.valor || 0), 0);
  const peorAnio = completos.reduce((m, a) => (m === null || totalAnio(a) > totalAnio(m) ? a : m), null);
  const ultimoCompleto = [...todas].reverse().find(c => !c.incompleto && c.valor != null);
  const mesTipico = mediana.indexOf(Math.max(...mediana));

  return {
    serie,
    porAnio,
    anios,
    cortes,
    nivelConteo,
    enCurso,
    indicadores: { peorAnio, totalPeor: peorAnio && totalAnio(peorAnio), ultimoCompleto, mesTipico },
  };
}

function textoCelda(c) {
  if (!c || c.valor == null) return 'Sin datos';
  const partes = [`${MESES[c.mes]} ${c.anio}: ${numero.format(c.valor)} celdas con fuego`];
  const enCurso = c.incompleto && c.anio >= 2003;
  if (c.razon != null && !enCurso) partes.push(`${decimal.format(c.razon)} × lo normal (${numero.format(c.normal)})`);
  if (enCurso) partes.push(`un ${MESES[c.mes]} normal completo tiene ${numero.format(c.normal)}`);
  partes.push(
    c.origen === 'MODIS×f'
      ? 'reconstruido desde MODIS'
      : c.origen.startsWith('VIIRS')
        ? `medido por ${c.origen}`
        : c.origen,
  );
  if (c.incompleto) partes.push(c.anio < 2003 ? 'datos incompletos (solo MODIS Terra)' : 'mes en curso, incompleto');
  return partes.join(' · ');
}

export class CalendarioHistorico {
  // nodo: contenedor; tip: elemento del tooltip compartido; onAnio(anio): abrir ese año en detalle.
  // detalle: si al tocar un año se abre su detalle diario (solo países con detecciones guardadas).
  // onSeleccion({anio, mes}): países sin detalle diario; el mapa muestra el año o mes elegido.
  // onMes(anio, mes): con detalle diario, tocar un mes abre ese año filtrado en ese mes.
  // territorio: nombre de la región mostrada (null: el país completo).
  constructor({ nodo, tip, onAnio, onSeleccion, onMes, detalle = true, territorio = null }) {
    Object.assign(this, { nodo, tip, onAnio, onSeleccion, onMes, detalle, territorio });
    this.seleccion = null;
    this.modo = 'anomalia';
    nodo.addEventListener('click', e => {
      const modo = e.target.closest('[data-modo-cal]')?.dataset.modoCal;
      if (modo) {
        this.modo = modo;
        this.pintar();
        if (this.seleccion) this.seleccionar(this.seleccion.anio, this.seleccion.mes, false);
        return;
      }
      const celda = e.target.closest('.hc-celda:not(.vacia)');
      if (celda && this.onMes) {
        this.onMes(+celda.dataset.anioCelda, +celda.dataset.mes);
        return;
      }
      if (celda && this.onSeleccion) {
        this.seleccionar(+celda.dataset.anioCelda, +celda.dataset.mes);
        return;
      }
      const anio = e.target.closest('[data-anio]')?.dataset.anio;
      if (anio && this.onSeleccion) {
        this.seleccionar(+anio, null);
        return;
      }
      if (anio) this.onAnio?.(+anio);
    });
    const mostrar = celda => {
      const c = this.datos?.porAnio.get(+celda.dataset.anioCelda)?.[+celda.dataset.mes];
      this.tip.textContent = textoCelda(c);
      this.tip.hidden = false;
      const r = celda.getBoundingClientRect(),
        t = this.tip.getBoundingClientRect();
      this.tip.style.left = `${Math.max(8, Math.min(innerWidth - t.width - 8, r.left + r.width / 2 - t.width / 2))}px`;
      this.tip.style.top = `${Math.max(8, r.top - t.height - 8)}px`;
    };
    nodo.addEventListener('pointerover', e => {
      const c = e.target.closest('.hc-celda');
      if (c) mostrar(c);
    });
    nodo.addEventListener('pointerleave', () => {
      this.tip.hidden = true;
    });
    nodo.addEventListener('focusin', e => {
      const c = e.target.closest('.hc-celda');
      if (c) mostrar(c);
    });
    nodo.addEventListener('focusout', () => {
      this.tip.hidden = true;
    });
  }

  poner(serie, anioActivo) {
    this.datos = prepararSerie(serie);
    this.anioActivo = anioActivo;
    this.pintar();
  }
  seleccionar(anio, mes, avisar = true) {
    this.seleccion = { anio, mes };
    this.anioActivo = anio;
    for (const f of this.nodo.querySelectorAll('.hc-fila'))
      f.classList.toggle('activa', +f.dataset.fila === anio && mes === null);
    for (const c of this.nodo.querySelectorAll('.hc-celda.elegida')) c.classList.remove('elegida');
    if (mes !== null)
      this.nodo.querySelector(`.hc-celda[data-anio-celda="${anio}"][data-mes="${mes}"]`)?.classList.add('elegida');
    if (avisar) this.onSeleccion?.(this.seleccion);
  }
  // Último año con los 12 meses completos (lo que muestra el mapa al abrir el país).
  ultimoAnioCompleto() {
    return (
      this.datos?.anios.find(a => this.datos.porAnio.get(a).every(c => c && !c.incompleto)) ?? this.datos?.anios[0]
    );
  }
  marcarAnio(anio) {
    this.anioActivo = anio;
    for (const f of this.nodo.querySelectorAll('.hc-fila')) f.classList.toggle('activa', +f.dataset.fila === anio);
  }

  pintar() {
    const d = this.datos;
    if (!d) return;
    const { serie, indicadores: ind, enCurso } = d;
    const metodo = serie.metodo || {};
    const anomalia = this.modo === 'anomalia';
    const primero = d.anios.at(-1),
      ultimo = d.anios[0];

    const filas = d.anios
      .map(anio => {
        const celdas = d.porAnio
          .get(anio)
          .map((c, mes) => {
            if (!c || c.valor == null) return `<span class="hc-celda vacia" aria-hidden="true"></span>`;
            // El mes en curso no se colorea por anomalía: con pocos días siempre parecería "bajo lo normal".
            const nivel =
              c === enCurso && anomalia
                ? 'curso'
                : anomalia
                  ? c.razon == null
                    ? 0
                    : nivelAnomalia(c.razon)
                  : d.nivelConteo(c.valor);
            const clases = ['hc-celda', c.incompleto ? 'incompleta' : '', c === enCurso ? 'en-curso' : ''].join(' ');
            return `<button type="button" class="${clases}${this.detalle || this.onSeleccion ? '' : ' sin-detalle'}" data-${anomalia ? 'anom' : 'nivel'}="${nivel}" data-anio-celda="${anio}" data-mes="${mes}" data-anio="${anio}" aria-label="${textoCelda(c)}"></button>`;
          })
          .join('');
        return `<div class="hc-fila${anio === this.anioActivo ? ' activa' : ''}" data-fila="${anio}">
        ${this.detalle ? `<button type="button" class="hc-anio" data-anio="${anio}" aria-label="Ver el detalle de ${anio}">${anio}</button>` : `${this.onSeleccion ? `<button type="button" class="hc-anio" data-anio="${anio}" aria-label="Ver ${anio} en el mapa">${anio}</button>` : `<span class="hc-anio">${anio}</span>`}`}${celdas}</div>`;
      })
      .join('');

    const leyenda = anomalia
      ? `<span>Menos</span>${TRAMOS_ANOMALIA.map(t => `<i data-anom="${t.nivel}" title="${t.texto}"></i>`).join('')}<span>Más que lo normal</span>`
      : `<span>Menos</span>${[1, 2, 3, 4, 5].map((n, i) => `<i data-nivel="${n}" title="${i === 0 ? `hasta ${numero.format(d.cortes[0])}` : i === 4 ? `más de ${numero.format(d.cortes[3])}` : `${numero.format(d.cortes[i - 1])}–${numero.format(d.cortes[i])}`}"></i>`).join('')}<span>Más</span>`;

    const u = ind.ultimoCompleto;
    // Mes en curso: se compara con lo esperado a esta fecha (la mediana del mes, proporcional a los días con datos).
    let curso = '';
    if (enCurso) {
      const hasta = serie.actualizado_hasta ? new Date(`${serie.actualizado_hasta}T12:00:00Z`) : null;
      const delMes = hasta && hasta.getUTCFullYear() === enCurso.anio && hasta.getUTCMonth() === enCurso.mes;
      const dias = delMes ? hasta.getUTCDate() : null;
      const total = new Date(Date.UTC(enCurso.anio, enCurso.mes + 1, 0)).getUTCDate();
      const esperado = dias ? (enCurso.normal * dias) / total : null;
      curso = `<li><span>Mes en curso${dias ? ` (${dias} de ${total} días)` : ''}</span>
        <strong>${MESES[enCurso.mes]}: ${esperado ? `${decimal.format(enCurso.valor / esperado)} × lo esperado` : numero.format(enCurso.valor)}</strong>
        <small>${numero.format(enCurso.valor)}${esperado ? ` frente a ${numero.format(esperado)} esperados a esta fecha` : '; aún incompleto'}</small></li>`;
    }
    const calidad = metodo.calidad_reconstruccion;
    const avisoCalidad =
      calidad === 'baja'
        ? `<p class="hc-calidad baja"><strong>Reconstrucción 2000–2011 poco confiable.</strong> Hay pocos datos o muchas detecciones podrían no ser incendios de vegetación (antorchas de gas, volcanes). Desde 2012 los datos son medidos por VIIRS.</p>`
        : calidad === 'media'
          ? `<p class="hc-calidad"><strong>Reconstrucción 2000–2011 aproximada</strong> (error anual típico ±${decimal.format(metodo.error_anual_mediano_pct)} %).</p>`
          : '';

    this.nodo.innerHTML = `
      <div class="bloque-cabeza">
        <h3 id="titulo-historico">Historial ${primero}–${ultimo}${this.territorio ? ' · <span class="hc-territorio"></span>' : ''}</h3>
        <div class="hc-modos" role="group" aria-label="Color del calendario">
          <button type="button" data-modo-cal="anomalia" aria-pressed="${anomalia}">Anomalía</button>
          <button type="button" data-modo-cal="conteo" aria-pressed="${!anomalia}">Conteo</button>
        </div>
      </div>
      <p class="hc-explica">${
        anomalia
          ? 'Cada mes comparado con la mediana del mismo mes (2003 en adelante). Rojo: más fuego que lo normal.'
          : 'Celdas de ~1 km con fuego por mes, MODIS y VIIRS harmonizados en una sola serie.'
      }</p>
      <ul class="hc-indicadores">
        ${u ? `<li><span>Último mes completo</span><strong>${MESES[u.mes]} ${u.anio}: ${u.razon != null ? `${decimal.format(u.razon)} × lo normal` : `${numero.format(u.valor)} celdas`}</strong><small>${numero.format(u.valor)} frente a ${numero.format(u.normal)} habituales</small></li>` : ''}
        ${curso}
        ${ind.peorAnio ? `<li><span>Año con más actividad</span><strong>${ind.peorAnio}</strong><small>${numero.format(ind.totalPeor)} celdas con fuego</small></li>` : ''}
        <li><span>Mes más activo habitualmente</span><strong>${MESES[ind.mesTipico]}</strong><small>mediana ${numero.format(serie.por_mes_calendario.mediana[ind.mesTipico])}</small></li>
      </ul>
      ${avisoCalidad}
      <div class="hc-rejilla" role="group" aria-labelledby="titulo-historico">
        <div class="hc-fila hc-cabeza" aria-hidden="true"><span></span>${INICIALES.map(m => `<span>${m}</span>`).join('')}</div>
        ${filas}
      </div>
      <div class="leyenda hc-leyenda">${leyenda}</div>
      <p class="hc-nota">${serie.region ? `Región calculada con zonas de ${String(serie.metodo?.zonas_grados ?? 0.25).replace('.', ',')}° (unos ${Math.round((serie.metodo?.zonas_grados ?? 0.25) * 111)} km): cada zona cuenta entera en la región donde está su centro. ` : ''}${this.onMes ? 'Toca un mes para verlo en el mapa, o un año para su detalle día a día. ' : this.detalle ? 'Toca un año para ver sus detecciones día a día. ' : this.onSeleccion ? 'Toca un año o un mes para verlo en el mapa. ' : ''}Las casillas rayadas tienen datos incompletos.
        ${metodo.error_anual_mediano_pct != null ? `${metodo.anios_traslape ? `Antes de ${metodo.anios_traslape[0]}` : 'Los años sin VIIRS'} se reconstruyen desde MODIS (error anual típico ±${decimal.format(metodo.error_anual_mediano_pct)} %).` : ''}</p>`;
    const t = this.nodo.querySelector('.hc-territorio');
    if (t) t.textContent = this.territorio;
  }
}
