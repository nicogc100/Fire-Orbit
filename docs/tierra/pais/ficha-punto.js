import { etiquetaConfianza, etiquetaSatelite } from '../datos/datos-pais.js?v=20261115orb1';

// Ficha flotante de un foco del mapa: fecha, hora, sensor, potencia y confianza, o el
// resumen de una zona cuando el país solo tiene la serie harmonizada por celdas.
const numeroTip = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
const fechaTip = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// tip: el elemento #tip-punto. regionDe(indice): nombre de la región del registro.
// cercana(lon, lat): población más cercana { nombre, km, habitantes } o null (solo Chile).
export function crearFichaPunto({ tip, regionDe, cercana = () => null }) {
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
      const pueblo = registro.chile ? cercana(registro.lonCelda, registro.latCelda) : null;
      const lineas = [
        registro.sel.mes === null ? `Todo ${registro.sel.anio}` : `${meses[registro.sel.mes]} de ${registro.sel.anio}`,
        `Zona de ~${km} km (${registro.tam}°)`,
        registro.chile ? 'Armonizado con IA (escala VIIRS)' : 'Serie harmonizada MODIS / VIIRS',
        ...(pueblo ? [`Cerca de ${pueblo.nombre}`] : []),
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
    const pueblo = cercana(registro.lon, registro.lat);
    if (pueblo)
      lineas.push(
        `A ${pueblo.km < 10 ? numeroTip.format(pueblo.km) : Math.round(pueblo.km)} km de ${pueblo.nombre} (${pueblo.habitantes.toLocaleString('es-CL')} hab.)`,
      );
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
