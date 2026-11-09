// Versiones de caché automáticas.
//
// La app se sirve sin compilar: cada archivo se pide con «?v=…» para que el navegador
// descargue la versión nueva cuando cambia. Esta herramienta calcula esa versión a
// partir del contenido (SHA-256, 8 caracteres) y la propaga: si cambia un módulo,
// cambian también los que lo importan, hasta index.html.
//
//   node globo-incendios/herramientas/versionar.mjs              actualiza las versiones
//   node globo-incendios/herramientas/versionar.mjs --comprobar  falla si alguna está desactualizada
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TIERRA = path.join(APP, 'tierra');
const TEXTO = /\.(js|mjs|css|html)$/;
// Referencias del tipo './modulo.js?v=abc', "tierra.css?v=12" o fetch('./assets/x.gz?v=3').
const REFERENCIA = /(['"])((?:\.{1,2}\/)?[\w./-]+?)\?v=([\w-]+)\1/g;

const huella = contenido => createHash('sha256').update(contenido).digest('hex').slice(0, 8);
const normalizar = texto => texto.replace(/\r\n/g, '\n');

const versiones = new Map();
const textos = new Map();
const enCurso = new Set();

// Versión de un archivo: la de su contenido con las referencias ya actualizadas.
function version(archivo) {
  if (versiones.has(archivo)) return versiones.get(archivo);
  if (!existsSync(archivo)) throw new Error(`No existe ${path.relative(APP, archivo)}`);
  if (!TEXTO.test(archivo)) {
    const v = huella(readFileSync(archivo));
    versiones.set(archivo, v);
    return v;
  }
  if (enCurso.has(archivo)) throw new Error(`Referencia circular en ${path.relative(APP, archivo)}`);
  enCurso.add(archivo);
  const original = normalizar(readFileSync(archivo, 'utf8'));
  const actualizado = original.replace(REFERENCIA, (_, comilla, ruta) => {
    const destino = path.resolve(path.dirname(archivo), ruta);
    return `${comilla}${ruta}?v=${version(destino)}${comilla}`;
  });
  enCurso.delete(archivo);
  const v = huella(actualizado);
  versiones.set(archivo, v);
  textos.set(archivo, { original, actualizado });
  return v;
}

const entradas = [
  path.join(APP, 'index.html'),
  ...readdirSync(TIERRA)
    .filter(f => TEXTO.test(f))
    .map(f => path.join(TIERRA, f)),
];
for (const archivo of entradas) version(archivo);

const comprobar = process.argv.includes('--comprobar');
const cambiados = [...textos].filter(([, t]) => t.original !== t.actualizado).map(([archivo]) => archivo);
for (const archivo of cambiados) {
  if (!comprobar) writeFileSync(archivo, textos.get(archivo).actualizado);
  console.log(`${comprobar ? 'Desactualizado' : 'Actualizado'}: ${path.relative(APP, archivo)}`);
}
if (comprobar && cambiados.length) {
  console.error('\nVersiones de caché desactualizadas. Ejecuta: npm run versionar');
  process.exit(1);
}
if (!cambiados.length) console.log('Versiones de caché al día.');
