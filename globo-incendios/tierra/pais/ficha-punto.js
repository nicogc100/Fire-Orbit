import { etiquetaConfianza, etiquetaSatelite } from '../datos/datos-pais.js?v=20261109';

// Ficha flotante de un foco del mapa: fecha, hora, sensor, potencia y confianza, o el
// resumen de una zona cuando el país solo tiene la serie harmonizada por celdas.
const numeroTip = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const fechaTip = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// tip: el elemento #tip-punto. regionDe(indice): nombre de la región del registro.
export function crearFichaPunto({ tip, regionDe }) {
  return function mostrarPunto(registro, x, y, indice) {
    if (!registro) {
      tip.hidden = true;
      return;
    }
    tip.replaceChildren();
    if (registro.celda) {
      const meses = [
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
      const t = document.createElement('strong');
      t.textContent = `${numeroTip.format(Math.round(registro.valor))} celdas-día con fuego`;
      const km = Math.round(registro.tam * 111);
      const lineas = [
        registro.sel.mes === null ? `Todo ${registro.sel.anio}` : `${meses[registro.sel.mes]} de ${registro.sel.anio}`,
        `Zona de ~${km} km (${registro.tam}°)`,
        'Serie harmonizada MODIS / VIIRS',
      ];
      tip.append(
        t,
        ...lineas.map(texto => {
          const s = document.createElement('span');
          s.textContent = texto;
          return s;
        }),
      );
      tip.hidden = false;
      const r = tip.getBoundingClientRect();
      tip.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x + 14))}px`;
      tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
      return;
    }
    const region = regionDe(indice);
    const titulo = document.createElement('strong');
    titulo.textContent = region || `${numeroTip.format(registro.frp)} MW`;
    const lineas = [
      ...(region ? [`${numeroTip.format(registro.frp)} MW`] : []),
      `${fechaTip.format(new Date(`${registro.fecha}T00:00:00Z`))} · ${registro.hora.slice(0, 2)}:${registro.hora.slice(2)} UTC`,
      `${registro.sensor} · ${etiquetaSatelite(registro.satelite)} · ${registro.periodo === 'D' ? 'Día' : 'Noche'}`,
      `Confianza: ${etiquetaConfianza(registro.confianza)}`,
    ];
    tip.append(
      titulo,
      ...lineas.map(texto => {
        const s = document.createElement('span');
        s.textContent = texto;
        return s;
      }),
    );
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(innerWidth - r.width - 8, x + 14))}px`;
    tip.style.top = `${Math.max(8, y - r.height - 12)}px`;
  };
}
