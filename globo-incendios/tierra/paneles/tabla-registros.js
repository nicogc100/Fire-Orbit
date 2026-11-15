// Tabla de detecciones con orden, páginas y descarga CSV.
// La usan la ventana «Datos guardados» y la pestaña «Datos» del panel del país.
import { convertirCSV } from '../datos/datos.js?v=20261115orb2';
import { ordenarTabla, etiquetaConfianza, etiquetaSatelite } from '../datos/datos-pais.js?v=20261115orb2';

const numero = new Intl.NumberFormat('es-CL');
const decimal = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const coordenada = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const fechaCorta = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const POR_PAGINA = 50;
const COLUMNAS = [
  ['fecha', 'Fecha'],
  [null, 'Hora UTC'],
  ['sensor', 'Sensor'],
  [null, 'Satélite'],
  ['lat', 'Latitud'],
  ['lon', 'Longitud'],
  ['frp', 'FRP (MW)'],
  [null, 'Confianza'],
  [null, 'Periodo'],
];

export class TablaRegistros {
  // tabla: contenedor de la tabla; rango: texto «1–50 de N»; anterior/siguiente/csv: botones.
  constructor({ tabla, rango, anterior, siguiente, csv, etiquetaCSV }) {
    Object.assign(this, { tabla, rango, anterior, siguiente, csv, etiquetaCSV });
    this.orden = 'fecha';
    this.direccion = 'asc';
    this.pagina = 0;
    this.lista = [];
    tabla.addEventListener('click', e => {
      const campo = e.target.closest('[data-orden]')?.dataset.orden;
      if (!campo) return;
      if (this.orden === campo) this.direccion = this.direccion === 'asc' ? 'desc' : 'asc';
      else {
        this.orden = campo;
        this.direccion = campo === 'frp' ? 'desc' : 'asc';
      }
      this.pagina = 0;
      this.pintar();
      this.tabla.querySelector(`[data-orden="${campo}"]`)?.focus();
    });
    anterior.addEventListener('click', () => this.paginar(-1));
    siguiente.addEventListener('click', () => this.paginar(1));
    csv.addEventListener('click', () => this.descargar());
  }
  reiniciarOrden() {
    this.orden = 'fecha';
    this.direccion = 'asc';
    this.pagina = 0;
  }
  // registros: ya filtrados. nombre: archivo CSV sin extensión. titulo: leyenda para lectores.
  poner(registros, { nombre, titulo, vacio = 'Ningún registro cumple estos filtros.' } = {}) {
    this.registros = registros;
    this.nombre = nombre;
    this.titulo = titulo;
    this.vacio = vacio;
    this.pintar();
  }
  cargando() {
    this.tabla.innerHTML =
      '<div class="tabla-cargando"><div class="esqueleto"></div><div class="esqueleto"></div><div class="esqueleto"></div></div>';
    this.rango.textContent = '';
    this.csv.disabled = this.anterior.disabled = this.siguiente.disabled = true;
  }
  paginar(paso) {
    this.pagina += paso;
    this.pintar();
    this.tabla.scrollTop = 0;
  }
  pintar() {
    if (!this.registros) return;
    const lista = ordenarTabla(this.registros, this.orden, this.direccion);
    this.lista = lista;
    if (this.etiquetaCSV) this.etiquetaCSV.textContent = `Descargar CSV (${numero.format(lista.length)})`;
    const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
    this.pagina = Math.max(0, Math.min(this.pagina, paginas - 1));
    const inicio = this.pagina * POR_PAGINA;
    const visibles = lista.slice(inicio, inicio + POR_PAGINA);
    const cabeza = COLUMNAS.map(([campo, nombre]) => {
      const numerica = ['lat', 'lon', 'frp'].includes(campo) ? ' class="num"' : '';
      if (!campo) return `<th scope="col"${numerica}>${nombre}</th>`;
      const activo = this.orden === campo;
      const sort = activo ? (this.direccion === 'asc' ? 'ascending' : 'descending') : 'none';
      return `<th scope="col"${numerica} aria-sort="${sort}"><button type="button" data-orden="${campo}">${nombre}<span aria-hidden="true">${activo ? (this.direccion === 'asc' ? ' ↑' : ' ↓') : ''}</span></button></th>`;
    }).join('');
    const cuerpo = visibles
      .map(
        r => `<tr>
      <td>${fechaCorta.format(new Date(`${r.fecha}T00:00:00Z`))}</td>
      <td>${r.hora.slice(0, 2)}:${r.hora.slice(2)}</td>
      <td><i class="marca-sensor ${r.sensor}" aria-hidden="true"></i>${r.sensor}</td>
      <td>${etiquetaSatelite(r.satelite)}</td>
      <td class="num">${coordenada.format(r.lat)}</td>
      <td class="num">${coordenada.format(r.lon)}</td>
      <td class="num">${decimal.format(r.frp)}</td>
      <td>${etiquetaConfianza(r.confianza)}</td>
      <td>${r.periodo === 'D' ? 'Día' : 'Noche'}</td></tr>`,
      )
      .join('');
    if (lista.length) {
      this.tabla.innerHTML = `<table class="tabla-registros"><caption class="solo-lectores"></caption><thead><tr>${cabeza}</tr></thead><tbody>${cuerpo}</tbody></table>`;
      this.tabla.querySelector('caption').textContent = this.titulo || 'Detecciones';
    } else {
      this.tabla.innerHTML = '<div class="tabla-error"><p></p></div>';
      this.tabla.querySelector('p').textContent = this.vacio;
    }
    this.rango.textContent = lista.length
      ? `${numero.format(inicio + 1)}–${numero.format(inicio + visibles.length)} de ${numero.format(lista.length)}`
      : 'Sin registros';
    this.anterior.disabled = this.pagina === 0;
    this.siguiente.disabled = this.pagina >= paginas - 1;
    this.csv.disabled = !lista.length;
  }
  descargar() {
    if (!this.lista.length) return;
    const url = URL.createObjectURL(
      new Blob([`﻿${convertirCSV(this.lista)}`], { type: 'text/csv;charset=utf-8' }),
    );
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `${this.nombre || 'fire-orbit'}.csv`;
    enlace.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

// Nombre de archivo sin tildes ni espacios: «fire-orbit-chile-valparaiso-2023-febrero-viirs».
export function nombreArchivo(...partes) {
  return ['fire-orbit', ...partes]
    .filter(Boolean)
    .map(p =>
      String(p)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    )
    .join('-');
}
