import { convertirCSV, MESES } from '../datos.js';
import {
  CATALOGO, cargarDatos, cargarProcedencia, cargarSerie, entradaAnio, filtrarTabla, ordenarTabla, etiquetaConfianza, etiquetaSatelite, fechaDeDia,
} from './datos-pais.js?v=4';

const numero = new Intl.NumberFormat('es-CL');
const decimal = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const coordenada = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fechaLarga = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const POR_PAGINA = 50;
const COLUMNAS = [
  ['fecha', 'Fecha'], [null, 'Hora UTC'], ['sensor', 'Sensor'], [null, 'Satélite'], ['lat', 'Latitud'], ['lon', 'Longitud'],
  ['frp', 'FRP (MW)'], [null, 'Confianza'], [null, 'Periodo'],
];

export class PanelDatos {
  constructor({ dialogo, onVerPais, onCambio }) {
    Object.assign(this, { dialogo, onVerPais, onCambio });
    this.estado = { id: '152', anio: null, mes: 0, dia: null, sensor: 'todos', orden: 'fecha', direccion: 'asc', pagina: 0 };
    dialogo.innerHTML = `
      <div class="datos-marco">
        <header class="datos-cabeza">
          <h2 id="datos-titulo">Datos guardados</h2>
          <button type="button" class="datos-cerrar" data-accion="cerrar" aria-label="Cerrar datos guardados"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
        </header>
        <div class="datos-cuerpo">
          <nav class="conjuntos" aria-label="Conjuntos guardados" data-parte="conjuntos"></nav>
          <section class="datos-detalle" aria-labelledby="detalle-titulo">
            <div class="detalle-cabeza">
              <div>
                <h3 id="detalle-titulo" data-parte="titulo"></h3>
                <p data-parte="resumen" role="status"></p>
              </div>
              <div class="detalle-acciones">
                <button type="button" class="boton-secundario" data-accion="csv"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg><span data-parte="csv">Descargar CSV</span></button>
                <button type="button" class="boton-primario" data-accion="globo">Ver en el globo</button>
              </div>
            </div>
            <form class="datos-filtros" aria-label="Filtrar registros">
              <label>Año<select name="anio"></select></label>
              <label>Mes<select name="mes"><option value="0">Todo el año</option>${MESES.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></label>
              <label>Sensor<select name="sensor"><option value="todos">Ambos</option><option value="MODIS">MODIS</option><option value="VIIRS">VIIRS</option></select></label>
              <button type="button" class="filtro-dia" data-accion="quitar-dia" hidden></button>
            </form>
            <div class="tabla-marco" tabindex="0" role="region" aria-label="Registros de detecciones" data-parte="tabla"></div>
            <div class="paginacion">
              <span data-parte="rango" aria-live="polite"></span>
              <div>
                <button type="button" class="boton-secundario" data-accion="anterior">Anterior</button>
                <button type="button" class="boton-secundario" data-accion="siguiente">Siguiente</button>
              </div>
            </div>
            <details class="procedencia">
              <summary>Procedencia de los datos</summary>
              <div data-parte="procedencia"></div>
            </details>
          </section>
        </div>
      </div>`;
    this.parte = nombre => dialogo.querySelector(`[data-parte="${nombre}"]`);
    this.form = dialogo.querySelector('form');
    dialogo.addEventListener('click', e => this.alHacerClic(e));
    dialogo.addEventListener('close', () => this.onCambio?.(null));
    this.form.addEventListener('change', e => {
      const { name, value } = e.target;
      this.estado[name] = name === 'mes' || name === 'anio' ? +value : value;
      if (name === 'mes' || name === 'anio') this.estado.dia = null;
      if (name === 'anio') { this.estado.mes = 0; this.estado.pagina = 0; this.cargar(); return; }
      this.estado.pagina = 0;
      this.pintarTabla();
    });
    this.form.addEventListener('submit', e => e.preventDefault());
  }

  async abrir({ id, dia = null, sensor = 'todos', anio = null } = {}) {
    Object.assign(this.estado, { id: id && CATALOGO[id] ? id : this.estado.id, dia, sensor, anio, mes: 0, pagina: 0, orden: 'fecha', direccion: 'asc' });
    if (!this.dialogo.open) this.dialogo.showModal();
    await this.cargar();
  }
  async cargar() {
    const { id } = this.estado;
    const entrada = entradaAnio(CATALOGO[id], this.estado.anio);
    this.estado.anio = entrada.anio;
    this.onCambio?.(id);
    this.form.anio.innerHTML = entrada.anios.slice().reverse().map(a => `<option value="${a}">${a}</option>`).join('');
    this.form.anio.value = entrada.anio;
    this.parte('titulo').textContent = CATALOGO[id].nombre;
    this.parte('resumen').textContent = 'Cargando registros…';
    this.parte('tabla').innerHTML = '<div class="tabla-cargando"><div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto"></div></div>';
    this.pintarConjuntos();
    try {
      const [datos, procedencia, serie] = await Promise.all([
        cargarDatos(entrada), cargarProcedencia().catch(() => null), cargarSerie(entrada).catch(() => null)]);
      if (this.estado.id !== id || this.estado.anio !== entrada.anio) return;
      this.datos = datos; this.procedencia = procedencia; this.serie = serie;
      this.pintarConjuntos(); this.pintarProcedencia(); this.pintarTabla();
    } catch (error) {
      console.error('Datos guardados:', error);
      if (this.estado.id !== id) return;
      this.datos = null;
      this.parte('resumen').textContent = 'No se pudieron leer los registros.';
      this.parte('tabla').innerHTML = '<div class="tabla-error"><p>La descarga se interrumpió. Comprueba que el servidor local sigue abierto.</p><button type="button" class="boton-secundario" data-accion="reintentar">Volver a intentar</button></div>';
    }
  }
  // Archivos de FIRMS que dieron origen al año abierto.
  filas(paisNombre, anio = this.estado.anio) {
    const id = Object.values(CATALOGO).find(c => c.nombre === paisNombre)?.id;
    const serie = id === this.estado.id ? this.serie : null;
    if (serie?.procedencia) {
      return serie.procedencia.filter(a => a.archivo.includes(`_${anio}_`)).map(a => {
        const producto = a.archivo.split('_')[0];
        return { ...a, original: a.archivo, filas_excluidas: a.filas_originales - a.filas_incluidas,
          url: `https://firms.modaps.eosdis.nasa.gov/data/country/${producto}/${anio}/${a.archivo}` };
      });
    }
    return (this.procedencia?.archivos || []).filter(a => a.pais === paisNombre && (!anio || a.original.includes(`_${anio}_`)));
  }
  pintarConjuntos() {
    this.parte('conjuntos').innerHTML = Object.values(CATALOGO).map(c => {
      const actual = c.id === this.estado.id;
      const periodo = c.anios.length > 1 ? `${c.anios[0]}–${c.anios.at(-1)}` : c.anios[0];
      const resumen = actual && this.datos ? `${numero.format(this.datos.registros.length)} detecciones en ${this.datos.anio}` : 'Conjunto guardado';
      return `<button type="button" class="conjunto" data-conjunto="${c.id}" ${actual ? 'aria-current="true"' : ''}>
        <strong>${c.nombre}</strong>
        <span>${resumen}</span>
        <small>${periodo} · MODIS y VIIRS</small></button>`;
    }).join('');
  }
  pintarProcedencia() {
    const p = this.procedencia, nombre = CATALOGO[this.estado.id].nombre;
    const nodo = this.parte('procedencia');
    nodo.innerHTML = `<p class="procedencia-nota"></p>
      <table class="tabla-procedencia"><thead><tr><th scope="col">Archivo</th><th scope="col">Sensor</th><th scope="col" class="num">Incluidas</th><th scope="col" class="num">Excluidas</th></tr></thead>
      <tbody>${this.filas(nombre).map(a => `<tr><td><a href="${a.url}" target="_blank" rel="noopener">${a.original.split('/').pop()}</a></td><td>${a.sensor}</td><td class="num">${numero.format(a.filas_incluidas)}</td><td class="num">${numero.format(a.filas_excluidas)}</td></tr>`).join('')}</tbody></table>
      <p class="procedencia-filtros"></p>`;
    nodo.querySelector('.procedencia-nota').textContent = 'NASA FIRMS, archivos anuales por país. Detecciones originales, sin harmonizar: no equivalen a incendios independientes ni a área quemada.';
    nodo.querySelector('.procedencia-filtros').textContent = this.datos?.anio >= new Date().getFullYear()
      ? 'Año en curso: VIIRS S-NPP desde la API de FIRMS (filtrado al territorio y sin fuentes industriales). Filtros: solo vegetación.'
      : `Filtros: ${p?.filtros?.[0] ?? 'type == 0 (vegetación)'}.`;
  }
  seleccion() {
    const { mes, dia, sensor, orden, direccion } = this.estado;
    return ordenarTabla(filtrarTabla(this.datos, { mes, dia, sensor }), orden, direccion);
  }
  pintarTabla() {
    if (!this.datos) return;
    const e = this.estado;
    const lista = this.seleccion();
    this.lista = lista;
    this.form.mes.value = e.mes; this.form.sensor.value = e.sensor;
    const quitar = this.dialogo.querySelector('[data-accion="quitar-dia"]');
    quitar.hidden = e.dia === null;
    if (e.dia !== null) quitar.textContent = `${fechaLarga.format(new Date(`${fechaDeDia(e.dia, this.datos.anio)}T00:00:00Z`))} ×`;
    if (e.dia !== null) quitar.setAttribute('aria-label', 'Quitar filtro de día');
    this.parte('resumen').textContent = `${numero.format(lista.length)} de ${numero.format(this.datos.registros.length)} detecciones. Cada fila es un punto de calor, no un incendio único.`;
    this.parte('csv').textContent = `Descargar CSV (${numero.format(lista.length)})`;
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    e.pagina = Math.min(e.pagina, paginas - 1);
    const inicio = e.pagina * POR_PAGINA;
    const visibles = lista.slice(inicio, inicio + POR_PAGINA);
    const cabeza = COLUMNAS.map(([campo, nombre]) => {
      const numerica = ['lat', 'lon', 'frp'].includes(campo) ? ' class="num"' : '';
      if (!campo) return `<th scope="col"${numerica}>${nombre}</th>`;
      const activo = e.orden === campo;
      const sort = activo ? (e.direccion === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col"${numerica} aria-sort="${sort}"><button type="button" data-orden="${campo}">${nombre}<span aria-hidden="true">${activo ? (e.direccion === 'asc' ? ' ↑' : ' ↓') : ''}</span></button></th>`;
    }).join('');
    const cuerpo = visibles.map(r => `<tr>
      <td>${fechaLarga.format(new Date(`${r.fecha}T00:00:00Z`))}</td>
      <td>${r.hora.slice(0, 2)}:${r.hora.slice(2)}</td>
      <td><i class="marca-sensor ${r.sensor}" aria-hidden="true"></i>${r.sensor}</td>
      <td>${etiquetaSatelite(r.satelite)}</td>
      <td class="num">${coordenada.format(r.lat)}</td>
      <td class="num">${coordenada.format(r.lon)}</td>
      <td class="num">${decimal.format(r.frp)}</td>
      <td>${etiquetaConfianza(r.confianza)}</td>
      <td>${r.periodo === 'D' ? 'Día' : 'Noche'}</td></tr>`).join('');
    this.parte('tabla').innerHTML = lista.length
      ? `<table class="tabla-registros"><caption class="solo-lectores">Detecciones de ${CATALOGO[e.id].nombre}</caption><thead><tr>${cabeza}</tr></thead><tbody>${cuerpo}</tbody></table>`
      : '<div class="tabla-error"><p>Ningún registro cumple estos filtros. Prueba con otro mes o con ambos sensores.</p></div>';
    this.parte('rango').textContent = lista.length ? `${numero.format(inicio + 1)}–${numero.format(inicio + visibles.length)} de ${numero.format(lista.length)}` : 'Sin registros';
    this.dialogo.querySelector('[data-accion="anterior"]').disabled = e.pagina === 0;
    this.dialogo.querySelector('[data-accion="siguiente"]').disabled = e.pagina >= paginas - 1;
    this.dialogo.querySelector('[data-accion="csv"]').disabled = !lista.length;
  }
  descargar() {
    const e = this.estado;
    const contenido = convertirCSV(this.lista);
    const url = URL.createObjectURL(new Blob([`﻿${contenido}`], { type: 'text/csv;charset=utf-8' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    const sufijo = [e.dia !== null ? fechaDeDia(e.dia, this.datos.anio) : e.mes ? MESES[e.mes - 1].toLowerCase() : null, e.sensor !== 'todos' ? e.sensor.toLowerCase() : null].filter(Boolean).join('-');
    enlace.download = `fire-sat-${CATALOGO[e.id].nombre.toLowerCase()}-${this.datos.anio}${sufijo ? `-${sufijo}` : ''}.csv`;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  alHacerClic(e) {
    if (e.target === this.dialogo) return this.dialogo.close();
    const accion = e.target.closest('[data-accion]')?.dataset.accion;
    const s = this.estado;
    if (accion === 'cerrar') return this.dialogo.close();
    if (accion === 'csv') return this.descargar();
    if (accion === 'reintentar') return this.cargar();
    if (accion === 'globo') { const { id, dia, sensor, anio } = s; this.dialogo.close(); return this.onVerPais?.(id, { dia, sensor: sensor === 'todos' ? null : sensor, anio }); }
    if (accion === 'quitar-dia') { s.dia = null; s.pagina = 0; return this.pintarTabla(); }
    if (accion === 'anterior' || accion === 'siguiente') {
      s.pagina += accion === 'anterior' ? -1 : 1;
      this.pintarTabla();
      this.parte('tabla').scrollTop = 0;
      return;
    }
    const conjunto = e.target.closest('[data-conjunto]')?.dataset.conjunto;
    if (conjunto && conjunto !== s.id) { Object.assign(s, { id: conjunto, anio: null, dia: null, mes: 0, sensor: 'todos', pagina: 0 }); this.cargar(); return; }
    const orden = e.target.closest('[data-orden]')?.dataset.orden;
    if (orden) {
      if (s.orden === orden) s.direccion = s.direccion === 'asc' ? 'desc' : 'asc';
      else { s.orden = orden; s.direccion = orden === 'frp' ? 'desc' : 'asc'; }
      s.pagina = 0;
      this.pintarTabla();
      this.dialogo.querySelector(`[data-orden="${orden}"]`)?.focus();
    }
  }
}
