// Shaders (GLSL) de la superficie del globo: día, noche, océano, batimetría,
// sombra de las nubes y resaltado del país elegido. Solo texto: los usa tierra.js.

// All lighting is calculated in linear color, then converted to the display color space.
export const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;
  void main() {
    vUv = uv;
    vLocalNormal = normalize(normal);
    vWorldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vWorldPosition, 1.0);
  }
`;

export const surfaceShader = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform sampler2D normalMap;
  uniform sampler2D oceanMap;
  uniform sampler2D bathymetryMap;
  uniform sampler2D cloudShadowMap;
  uniform sampler2D countryMap;
  uniform vec3 countryColor;
  uniform float countryActive;
  uniform float countryOpacity;
  uniform vec3 sunDirection;
  uniform vec3 localSunDirection;
  varying vec2 vUv;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vLocalNormal;
  const float PI = 3.14159265359;

  vec2 sphereUv(vec3 p) {
    p = normalize(p);
    return vec2(atan(-p.z, p.x) / (2.0 * PI) + 0.5,
                asin(clamp(p.y, -1.0, 1.0)) / PI + 0.5);
  }

  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
    vec3 tangent = normalize(vec3(-normal.z, 0.00001, normal.x));
    vec3 bitangent = normalize(cross(normal, tangent));
    vec3 terrain = texture2D(normalMap, vUv).xyz * 2.0 - 1.0;
    vec3 reliefNormal = normalize(normal + tangent * terrain.x * 0.08 + bitangent * terrain.y * 0.08);
    float sun = dot(normal, sunDirection);
    float diffuse = max(dot(reliefNormal, sunDirection), 0.0);
    float daylight = smoothstep(-0.16, 0.24, sun);
    float ocean = texture2D(oceanMap, vUv).r;
    vec3 albedo = texture2D(dayMap, vUv, 0.6).rgb;
    // NASA's geographic bathymetry supplies the shelves, ridges and deep water.
    // Apply it only inside the existing water mask, preserving the land map.
    vec3 seafloor = texture2D(bathymetryMap, vUv, 0.5).rgb;
    albedo = mix(albedo, seafloor, smoothstep(0.20, 0.95, ocean) * 0.92);

    // Shadows are prepared from the same volume and hand field on a global map.
    vec3 p = normalize(vLocalNormal);
    float shadow=texture2D(cloudShadowMap,sphereUv(p)).r;
    vec3 color = albedo * (0.028 + 1.38 * pow(diffuse, 0.82) * shadow);
    color += vec3(0.002, 0.009, 0.024) * ocean * daylight;

    vec3 halfDirection = normalize(sunDirection + viewDirection);
    float glint = pow(max(dot(normal, halfDirection), 0.0), 95.0);
    color += vec3(0.54, 0.68, 0.75) * glint * ocean * daylight * 0.20 * shadow;

    vec3 lights = texture2D(nightMap, vUv).rgb;
    color += lights * vec3(1.0, 0.72, 0.38) * (1.0 - smoothstep(-0.18, 0.15, sun)) * 1.3;

    if(countryActive>.5){
      vec2 uv=sphereUv(p),pixel=vec2(1.0/4096.0,1.0/2048.0);
      vec3 identity=texture2D(countryMap,uv).rgb;
      float inside=1.0-step(.003,length(identity-countryColor));
      if(inside>.5){
      float edge=0.0;
      edge=max(edge,step(.003,length(texture2D(countryMap,uv+vec2(pixel.x,0.0)).rgb-countryColor)));
      edge=max(edge,step(.003,length(texture2D(countryMap,uv-vec2(pixel.x,0.0)).rgb-countryColor)));
      edge=max(edge,step(.003,length(texture2D(countryMap,uv+vec2(0.0,pixel.y)).rgb-countryColor)));
      edge=max(edge,step(.003,length(texture2D(countryMap,uv-vec2(0.0,pixel.y)).rgb-countryColor)));
      vec3 tint=vec3(.94,.34,.13)*(.48+.52*daylight);
      color=mix(color,tint,inside*countryOpacity*(.31+edge*.35));
      color+=vec3(.65,.36,.14)*edge*inside*countryOpacity*.35;
      }
    }

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;
