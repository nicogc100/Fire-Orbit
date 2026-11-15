import { MESES } from '../datos/datos.js?v=20261115orb2';
import {
  CATALOGO,
  cargarDatos,
  cargarProcedencia,
  cargarSerie,
  entradaAnio,
  filtrarTabla,
  fechaDeDia,
} from '../datos/datos-pais.js?v=20261115orb2';
import { TablaRegistros, nombreArchivo } from './tabla-registros.js?v=20261115orb2';

const numero = new Intl.NumberFormat('es-CL');
const fechaLarga = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export class PanelDatos {
  constructor({ dialogo, onVerPais, onCambio }) {
    Object.assign(this, { dialogo, onVerPais, onCambio });
    this.estado = {
      id: '152',
      anio: null,
      mes: 0,
      dia: null,
      sensor: 'todos',
    };
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
                <button type="button" class="boton-secundario" data-parte="boton-csv"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14"/></svg><span data-parte="csv">Descargar CSV</span></button>
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
                <button type="button" class="boton-secundario" data-parte="anterior">Anterior</button>
                <button type="button" class="boton-secundario" data-parte="siguiente">Siguiente</button>
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
    this.tablaUI = new TablaRegistros({
      tabla: this.parte('tabla'),
      rango: this.parte('rango'),
      anterior: this.parte('anterior'),
      siguiente: this.parte('siguiente'),
      csv: this.parte('boton-csv'),
      etiquetaCSV: this.parte('csv'),
    });
    dialogo.addEventListener('click', e => this.alHacerClic(e));
    dialogo.addEventListener('close', () => this.onCambio?.(null));
    this.form.addEventListener('change', e => {
      const { name, value } = e.target;
      this.estado[name] = name === 'mes' || name === 'anio' ? +value : value;
      if (name === 'mes' || name === 'anio') this.estado.dia = null;
      this.tablaUI.pagina = 0;
      if (name === 'anio') {
        this.estado.mes = 0;
        this.cargar();
        return;
      }
      this.pintarTabla();
    });
    this.form.addEventListener('submit', e => e.preventDefault());
  }

  async abrir({ id, dia = null, sensor = 'todos', anio = null } = {}) {
    Object.assign(this.estado, {
      id: id && CATALOGO[id] ? id : this.estado.id,
      dia,
      sensor,
      anio,
      mes: 0,
    });
    this.tablaUI.reiniciarOrden();
    if (!this.dialogo.open) this.dialogo.showModal();
    await this.cargar();
  }
  async cargar() {
    const { id } = this.estado;
    const entrada = entradaAnio(CATALOGO[id], this.estado.anio);
    this.estado.anio = entrada.anio;
    this.onCambio?.(id);
    this.form.anio.innerHTML = entrada.anios
      .slice()
      .reverse()
      .map(a => `<option value="${a}">${a}</option>`)
      .join('');
    this.form.anio.value = entrada.anio;
    this.parte('titulo').textContent = CATALOGO[id].nombre;
    this.parte('resumen').textContent = 'Cargando registros…';
    this.tablaUI.cargando();
    this.pintarConjuntos();
    try {
      const [datos, procedencia, serie] = await Promise.all([
        cargarDatos(entrada),
        cargarProcedencia().catch(() => null),
        cargarSerie(entrada).catch(() => null),
      ]);
      if (this.estado.id !== id || this.estado.anio !== entrada.anio) return;
      this.datos = datos;
      this.procedencia = procedencia;
      this.serie = serie;
      this.pintarConjuntos();
      this.pintarProcedencia();
      this.pintarTabla();
    } catch (error) {
      console.error('Datos guardados:', error);
      if (this.estado.id !== id) return;
      this.datos = null;
      this.parte('resumen').textContent = 'No se pudieron leer los registros.';
      this.parte('tabla').innerHTML =
        '<div class="tabla-error"><p>La descarga se interrumpió. Comprueba que el servidor local sigue abierto.</p><button type="button" class="boton-secundario" data-accion="reintentar">Volver a intentar</button></div>';
    }
  }
  // Archivos de FIRMS que dieron origen al año abierto.
  filas(paisNombre, anio = this.estado.anio) {
    const id = Object.values(CATALOGO).find(c => c.nombre === paisNombre)?.id;
    const serie = id === this.estado.id ? this.serie : null;
    if (serie?.procedencia) {
      return serie.procedencia
        .filter(a => a.archivo.includes(`_${anio}_`))
        .map(a => {
          const producto = a.archivo.split('_')[0];
          return {
            ...a,
            original: a.archivo,
            filas_excluidas: a.filas_originales - a.filas_incluidas,
            url: `https://firms.modaps.eosdis.nasa.gov/data/country/${producto}/${anio}/${a.archivo}`,
          };
        });
    }
    return (this.procedencia?.archivos || []).filter(
      a => a.pais === paisNombre && (!anio || a.original.includes(`_${anio}_`)),
    );
  }
  pintarConjuntos() {
    this.parte('conjuntos').innerHTML = Object.values(CATALOGO)
      .map(c => {
        const actual = c.id === this.estado.id;
        const periodo = c.anios.length > 1 ? `${c.anios[0]}–${c.anios.at(-1)}` : c.anios[0];
        const resumen =
          actual && this.datos
            ? `${numero.format(this.datos.registros.length)} detecciones en ${this.datos.anio}`
            : 'Conjunto guardado';
        return `<button type="button" class="conjunto" data-conjunto="${c.id}" ${actual ? 'aria-current="true"' : ''}>
        <strong>${c.nombre}</strong>
        <span>${resumen}</span>
        <small>${periodo} · MODIS y VIIRS</small></button>`;
      })
      .join('');
  }
  pintarProcedencia() {
    const p = this.procedencia,
      nombre = CATALOGO[this.estado.id].nombre;
    const nodo = this.parte('procedencia');
    nodo.innerHTML = `<p class="procedencia-nota"></p>
      <table class="tabla-procedencia"><thead><tr><th scope="col">Archivo</th><th scope="col">Sensor</th><th scope="col" class="num">Incluidas</th><th scope="col" class="num">Excluidas</th></tr></thead>
      <tbody>${this.filas(nombre)
        .map(
          a =>
            `<tr><td><a href="${a.url}" target="_blank" rel="noopener">${a.original.split('/').pop()}</a></td><td>${a.sensor}</td><td class="num">${numero.format(a.filas_incluidas)}</td><td class="num">${numero.format(a.filas_excluidas)}</td></tr>`,
        )
        .join('')}</tbody></table>
      <p class="procedencia-filtros"></p>`;
    nodo.querySelector('.procedencia-nota').textContent =
      'NASA FIRMS, archivos anuales por país. Detecciones originales, sin harmonizar: no equivalen a incendios independientes ni a área quemada.';
    nodo.querySelector('.procedencia-filtros').textContent =
      this.datos?.anio >= new Date().getFullYear()
        ? 'Año en curso: VIIRS S-NPP desde la API de FIRMS (filtrado al territorio y sin fuentes industriales). Filtros: solo vegetación.'
        : `Filtros: ${p?.filtros?.[0] ?? 'type == 0 (vegetación)'}.`;
  }
  pintarTabla() {
    if (!this.datos) return;
    const e = this.estado;
    const lista = filtrarTabla(this.datos, e);
    this.form.mes.value = e.mes;
    this.form.sensor.value = e.sensor;
    const quitar = this.dialogo.querySelector('[data-accion="quitar-dia"]');
    quitar.hidden = e.dia === null;
    if (e.dia !== null) {
      quitar.textContent = `${fechaLarga.format(new Date(`${fechaDeDia(e.dia, this.datos.anio)}T00:00:00Z`))} ×`;
      quitar.setAttribute('aria-label', 'Quitar filtro de día');
    }
    this.parte('resumen').textContent =
      `${numero.format(lista.length)} de ${numero.format(this.datos.registros.length)} detecciones. Cada fila es un punto de calor, no un incendio único.`;
    const sufijo = [
      e.dia !== null ? fechaDeDia(e.dia, this.datos.anio) : e.mes ? MESES[e.mes - 1] : null,
      e.sensor !== 'todos' ? e.sensor : null,
    ];
    this.tablaUI.poner(lista, {
      nombre: nombreArchivo(CATALOGO[e.id].nombre, this.datos.anio, ...sufijo),
      titulo: `Detecciones de ${CATALOGO[e.id].nombre}`,
      vacio: 'Ningún registro cumple estos filtros. Prueba con otro mes o con ambos sensores.',
    });
  }
  alHacerClic(e) {
    if (e.target === this.dialogo) return this.dialogo.close();
    const accion = e.target.closest('[data-accion]')?.dataset.accion;
    const s = this.estado;
    if (accion === 'cerrar') return this.dialogo.close();
    if (accion === 'reintentar') return this.cargar();
    if (accion === 'globo') {
      const { id, dia, sensor, anio } = s;
      this.dialogo.close();
      return this.onVerPais?.(id, { dia, sensor: sensor === 'todos' ? null : sensor, anio });
    }
    if (accion === 'quitar-dia') {
      s.dia = null;
      this.tablaUI.pagina = 0;
      return this.pintarTabla();
    }
    const conjunto = e.target.closest('[data-conjunto]')?.dataset.conjunto;
    if (conjunto && conjunto !== s.id) {
      Object.assign(s, { id: conjunto, anio: null, dia: null, mes: 0, sensor: 'todos' });
      this.tablaUI.reiniciarOrden();
      this.cargar();
    }
  }
}
