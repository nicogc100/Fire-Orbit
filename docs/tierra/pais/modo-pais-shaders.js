// Shaders (GLSL) de la pieza 3D del país: terreno, líneas, focos y cuadrados del detalle satelital.
// Solo texto: los usa modo-pais.js al crear sus materiales.

export const verticePieza = /* glsl */ `
  attribute vec3 aEsfera;
  attribute float aLado;
  uniform float uMorph;
  varying vec3 vEsfera;
  varying float vLado;
  varying vec3 vNormal;
  void main() {
    vEsfera = aEsfera;
    vLado = aLado;
    vec3 n = aLado < .5 ? mix(normalize(aEsfera), normal, uMorph) : normal;
    vNormal = normalize(normalMatrix * n);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(aEsfera, position, uMorph), 1.0);
  }`;
export const fragmentoPieza = /* glsl */ `
  uniform sampler2D uMapa, uRelieve, uSatGrueso, uSatFino;
  uniform mat3 uBase;
  uniform float uMorph, uOpacidad, uAltoMapa, uMostrarRelieve, uSat, uDetalle;
  uniform vec4 uCaja, uCajaRelieve, uCajaGrueso, uCajaFino;
  varying vec3 vEsfera;
  varying float vLado;
  varying vec3 vNormal;
  const float PI = 3.14159265;
  // Mosaico satelital en Web Mercator. Alfa 0 donde falta la tesela: ahí sigue el mapa base.
  vec4 satelite(sampler2D t, vec4 caja, float u, float mercator) {
    vec2 l = vec2(fract(u - caja.x), mercator - caja.y) / caja.zw;
    vec4 c = texture2D(t, clamp(l, 0.0, 1.0));
    float dentro = step(0.0, l.x) * step(l.x, 1.0) * step(0.0, l.y) * step(l.y, 1.0);
    return vec4(c.rgb, smoothstep(.96, 1.0, c.a) * dentro);
  }
  void main() {
    vec3 color;
    float luz = clamp(dot(normalize(vNormal), normalize(vec3(-.35, .55, .75))), 0.0, 1.0);
    if (vLado < .5) {
      // En detalle, punto exacto de la esfera a partir del plano. Interpolar la posición
      // esférica entre vértices la desplaza cientos de metros: invisible con el mapa
      // mundial, pero no con imágenes de 10 m ni junto a focos en coordenadas exactas.
      vec3 d = uDetalle > 0.0
        ? uBase * vec3(vEsfera.xy, sqrt(max(0.0, 1.0 - dot(vEsfera.xy, vEsfera.xy))))
        : normalize(uBase * vEsfera);
      float lat = asin(clamp(d.y, -1.0, 1.0));
      float u = atan(-d.z, d.x) / (2.0 * PI) + .5;
      float v = lat / PI + .5;
      vec2 uv = vec2(fract(u - uCaja.x) / uCaja.z, (v - uCaja.y) / uCaja.w);
      // El nivel de detalle sale de la latitud, continua incluso en el antimeridiano.
      float nivel = max(0.0, log2(max(fwidth(v), 1e-6) * uAltoMapa));
      vec3 mapa = textureLod(uMapa, uv, nivel).rgb;
      float gris = dot(mapa, vec3(.299, .587, .114));
      // Terreno contenido: el color intenso queda reservado para los focos.
      vec3 sobrio = mix(vec3(gris), mapa, .62) * vec3(.6, .7, .78) + vec3(.012, .03, .05);
      color = mix(mapa, sobrio, uMorph) * (.8 + .24 * luz);
      float pesoSat = 0.0;
      if (uSat > 0.0) {
        float mercator = .5 - log(tan(PI * .25 + clamp(lat, -1.4844, 1.4844) * .5)) / (2.0 * PI);
        vec4 grueso = satelite(uSatGrueso, uCajaGrueso, u, mercator);
        vec4 fino = satelite(uSatFino, uCajaFino, u, mercator);
        // Color natural de Sentinel-2: costa, ciudades, valles y cumbres se leen como son.
        vec3 imagen = mix(grueso.rgb, fino.rgb, fino.a);
        // Web Mercator no llega más allá de ±85,05°: ahí (Antártida, norte de Groenlandia) sigue el mapa base.
        pesoSat = max(grueso.a, fino.a) * uSat * (1.0 - smoothstep(1.482, 1.4844, abs(lat)));
        color = mix(color, imagen * (.9 + .14 * luz), pesoSat);
      }
      if (uMostrarRelieve > 0.0 && abs(lat) < 1.4844) {
        float mercator = .5 - log(tan(PI * .25 + lat * .5)) / (2.0 * PI);
        vec2 local = vec2(fract(u - uCajaRelieve.x), mercator - uCajaRelieve.y) / uCajaRelieve.zw;
        vec2 borde = min(local, 1.0 - local);
        float fundido = smoothstep(0.0, .035, min(borde.x, borde.y));
        float sombra = texture2D(uRelieve, clamp(local, 0.0, 1.0)).r - (128.0 / 255.0);
        // Sobre la imagen satelital el sombreado solo acompaña: la foto ya trae sus sombras.
        color *= 1.0 + sombra * fundido * uMostrarRelieve * (1.0 - .5 * pesoSat);
      }
    } else if (vLado < 2.5) {
      color = mix(vec3(.16, .3, .42), vec3(.03, .085, .14), vLado - 1.0) * (.6 + .55 * luz);
    } else color = vec3(.02, .055, .09);
    gl_FragColor = vec4(color, uOpacidad);
  }`;
// Líneas de grosor fijo en píxeles: a cualquier zoom la costa sigue nítida.
export const verticeLinea = /* glsl */ `
  attribute vec3 iPlanoA, iPlanoB, iEsferaA, iEsferaB;
  uniform float uMorph, uAncho;
  uniform vec2 uPantalla;
  varying float vBorde;
  void main() {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(mix(iEsferaA, iPlanoA, uMorph), 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(mix(iEsferaB, iPlanoB, uMorph), 1.0);
    vec2 pa = a.xy / a.w * uPantalla, pb = b.xy / b.w * uPantalla;
    vec2 tramo = pb - pa;
    float largo = max(length(tramo), 1e-4);
    vec2 normal = vec2(-tramo.y, tramo.x) / largo;
    vec4 base = position.x < .5 ? a : b;
    vBorde = position.y;
    base.xy += normal * position.y * (uAncho + 1.0) / uPantalla * base.w;
    base.z -= .0004 * base.w;
    gl_Position = base;
  }`;
export const fragmentoLinea = /* glsl */ `
  uniform vec3 uColor;
  uniform float uAlfa, uAncho, uOpacidad;
  varying float vBorde;
  void main() {
    float d = abs(vBorde) * (uAncho + 1.0);
    gl_FragColor = vec4(uColor, uAlfa * uOpacidad * (1.0 - smoothstep(uAncho - .5, uAncho + .5, d)));
  }`;
export const verticePuntos = /* glsl */ `
  attribute vec3 aEsfera;
  attribute float aDia, aFrp, aSensor, aRegion;
  uniform float uMorph, uDiaIni, uDiaFin, uCola, uTamano, uAparicion, uRegion;
  uniform vec2 uSensores;
  varying float vFrp, vFuerza;
  void main() {
    // Con una región elegida, solo sus focos (uRegion < 0: todo el país).
    float activo = (aSensor < .5 ? uSensores.x : uSensores.y) * (uRegion < -.5 || abs(aRegion - uRegion) < .5 ? 1.0 : 0.0);
    float dentro = step(uDiaIni - uCola, aDia) * step(aDia, uDiaFin) * activo;
    float cola = uCola > 0.0 && aDia < uDiaIni ? 1.0 - (uDiaIni - aDia) / (uCola + 1.0) : 1.0;
    vFrp = aFrp;
    vFuerza = cola * uAparicion;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(aEsfera, position, uMorph), 1.0);
    gl_PointSize = dentro * uTamano * (1.8 + 7.0 * aFrp) * (.55 + .45 * cola) * (.6 + .4 * uAparicion);
    // Tamaño 0 no basta: muchas GPU dibujan igual un punto de 1 píxel. Se saca de la vista.
    if (dentro < .5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;
export const fragmentoPuntos = /* glsl */ `
  uniform float uIntensidad;
  varying float vFrp, vFuerza;
  void main() {
    float d = length(gl_PointCoord - .5) * 2.0;
    if (d > 1.0 || vFuerza <= 0.0) discard;
    float halo = exp(-d * d * 3.6);
    float nucleo = smoothstep(.42, 0.0, d);
    vec3 calor = mix(vec3(1.0, .28, .07), vec3(1.0, .66, .2), smoothstep(.15, .55, vFrp));
    calor = mix(calor, vec3(1.0, .92, .68), smoothstep(.55, .95, vFrp));
    gl_FragColor = vec4(calor + nucleo * .35, halo * uIntensidad * vFuerza);
  }`;
// Detalle satelital: cada detección es un cuadrado con la huella real del píxel del
// sensor (MODIS 1 km, VIIRS 375 m), nunca menor que un símbolo legible. Pequeño, es
// sólido y con contorno oscuro; grande, solo contorno y relleno tenue: deja ver el terreno.
export const verticeCuadros = /* glsl */ `
  attribute vec3 aEsfera;
  attribute float aDia, aFrp, aSensor, aRegion;
  uniform float uMorph, uDiaIni, uDiaFin, uCola, uAparicion, uPxPorMetro, uTamMin, uTamMax, uRegion;
  uniform vec2 uSensores;
  varying float vFrp, vFuerza, vTam;
  void main() {
    float activo = (aSensor < .5 ? uSensores.x : uSensores.y) * (uRegion < -.5 || abs(aRegion - uRegion) < .5 ? 1.0 : 0.0);
    float dentro = step(uDiaIni - uCola, aDia) * step(aDia, uDiaFin) * activo;
    float cola = uCola > 0.0 && aDia < uDiaIni ? 1.0 - (uDiaIni - aDia) / (uCola + 1.0) : 1.0;
    vFrp = aFrp;
    vFuerza = cola * uAparicion;
    vTam = clamp((aSensor < .5 ? 1000.0 : 375.0) * uPxPorMetro, uTamMin, uTamMax);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(mix(aEsfera, position, uMorph), 1.0);
    gl_PointSize = dentro * vTam;
    if (dentro < .5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  }`;
export const fragmentoCuadros = /* glsl */ `
  uniform float uPR;
  varying float vFrp, vFuerza, vTam;
  void main() {
    if (vFuerza <= 0.0) discard;
    vec2 q = abs(gl_PointCoord - .5) * vTam;
    float borde = vTam * .5 - max(q.x, q.y);
    // Muy pequeños, sin contorno: sería todo borde.
    float contorno = (1.0 - smoothstep(uPR * .55, uPR * 1.15, borde)) * smoothstep(3.5, 5.5, vTam / uPR);
    vec3 calor = mix(vec3(1.0, .24, .06), vec3(1.0, .56, .1), smoothstep(.15, .55, vFrp));
    calor = mix(calor, vec3(1.0, .86, .34), smoothstep(.55, .95, vFrp));
    float grande = smoothstep(16.0, 36.0, vTam / uPR);
    vec3 color = mix(calor, mix(vec3(.18, .03, 0.0), calor, grande), contorno);
    float alfa = mix(mix(.96, .26, grande), 1.0, contorno) * clamp(vFuerza, 0.0, 1.0);
    gl_FragColor = vec4(color, alfa);
  }`;
