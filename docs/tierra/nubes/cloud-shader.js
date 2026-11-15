import { CLOUD_SETTINGS } from './cloud-settings.js?v=20261115chl3';
const glslFloat = value => (Number.isInteger(value) ? `${value}.0` : String(value));
// One density field drives volumetric clouds, their transparency and shadows.
export const cloudField = /* glsl */ `
  precision highp sampler3D;
  uniform sampler3D cloudVolume;
  uniform sampler3D cloudNoise;
  uniform sampler2D cloudDisturbance;
  uniform float cloudOffset;
  const float CLOUD_PI=3.14159265359;
  const float CLOUD_BASE=${CLOUD_SETTINGS.base};
  const float CLOUD_TOP=${CLOUD_SETTINGS.top};
  const float CLOUD_LIGHT_SCALE=${glslFloat((CLOUD_SETTINGS.top - CLOUD_SETTINGS.base) / 0.0075)};
  vec2 cloudUv(vec3 p){
    p=normalize(p);
    return vec2(atan(-p.z,p.x)/(2.0*CLOUD_PI)+.5+cloudOffset,
                asin(clamp(p.y,-1.0,1.0))/CLOUD_PI+.5);
  }
  vec2 cloudData(vec3 p){
    float h=(length(p)-CLOUD_BASE)/(CLOUD_TOP-CLOUD_BASE);
    if(h<=0.0||h>=1.0)return vec2(0.0);
    return texture(cloudVolume,vec3(cloudUv(p),(h*31.0+.5)/32.0)).rg;
  }
  float cloudDensity(vec3 p){
    float h=(length(p)-CLOUD_BASE)/(CLOUD_TOP-CLOUD_BASE);
    if(h<=0.0||h>=1.0)return 0.0;
    vec2 uv=cloudUv(p);
    float d=texture(cloudVolume,vec3(uv,(h*31.0+.5)/32.0)).r*${glslFloat(CLOUD_SETTINGS.densityScale)};
    if(d<.001)return 0.0;
    // Solo la franja de borde se deshace con ruido 3D: bordes vaporosos sobre un
    // cuerpo intacto. El interior no recibe grano, para no volver a la escarcha.
    if(d<1.5){
      float vapor=texture(cloudNoise,normalize(p)*11.0+vec3(cloudOffset*11.0,h*.2,0.0)).r;
      d=max(0.0,d-(1.0-vapor)*.3*(1.0-smoothstep(.1,1.5,d)));
      if(d<.001)return 0.0;
    }
    float damage=texture2D(cloudDisturbance,uv).r;
    if(damage>.003){
      // Erode clumps and expose internal gaps instead of stamping an alpha disk.
      float breakup=texture(cloudNoise,normalize(p)*37.0+length(p)*13.0).g;
      d=max(0.0,d-damage*(.35+breakup*.65)*${CLOUD_SETTINGS.handErosion});
      d*=1.0-smoothstep(.60,.84,damage);
    }
    return d;
  }
`;
export const cloudVertexShader = /* glsl */ `
  varying vec3 vCloudPosition;
  void main(){
    vCloudPosition=position*${CLOUD_SETTINGS.top};
    gl_Position=projectionMatrix*modelViewMatrix*vec4(vCloudPosition,1.0);
  }
`;
export const cloudShader = /* glsl */ `
  ${cloudField}
  uniform vec3 localSunDirection;
  uniform vec3 localCameraPosition;
  uniform sampler3D solarDepth;
  uniform sampler2D cloudSurfaceNormals;
  varying vec3 vCloudPosition;
  float cloudSlopeLight(vec3 p){
    // One auxiliary normal, extracted from the actual 3D density, per view ray.
    // Optical self-shadowing still comes from the volume and the current Sun.
    vec4 guide=texture2D(cloudSurfaceNormals,cloudUv(p));
    vec3 normal=normalize(guide.xyz*2.0-1.0);
    float angle=cloudOffset*2.0*CLOUD_PI,c=cos(angle),s=sin(angle);
    normal=vec3(c*normal.x-s*normal.z,normal.y,s*normal.x+c*normal.z);
    normal=normalize(mix(normalize(p),normal,guide.a));
    return .30+.95*smoothstep(-.12,.92,dot(normal,localSunDirection));
  }
  vec3 cloudLight(vec3 p,vec3 ray,float slopeLight){
    float solar=dot(normalize(p),localSunDirection);
    // A small, refreshed spherical cache integrates toward the SAME sun used
    // by the terrain, rather than repeating a light march at every view sample.
    float h=clamp((length(p)-CLOUD_BASE)/(CLOUD_TOP-CLOUD_BASE),0.0,1.0);
    vec2 lightUv=cloudUv(p)-vec2(cloudOffset,0.0);
    float depth=texture(solarDepth,vec3(lightUv,(h*15.0+.5)/16.0)).r/64.0;
    float skyDepth=cloudData(p).g/100.0;
    // Con exp(-depth*420) la luz directa moría en el primer tramo y el interior
    // quedaba plano. Tres órdenes de dispersión cada vez más profundos conservan
    // el relieve dentro de la nube: cima clara, interior gris azulado.
    float direct=exp(-depth*190.0);
    float multiple=exp(-depth*62.0)*.3+exp(-depth*20.0)*.17;
    float mu=dot(ray,localSunDirection);
    float phase=.84+.16*(1.0-.42*.42)/pow(1.0+.42*.42-2.0*.42*mu,1.5);
    // El cielo ilumina según cuánta nube queda encima; esto modela las depresiones.
    float cielo=exp(-skyDepth*95.0);
    vec3 ambient=mix(vec3(.105,.165,.265),vec3(.36,.45,.56),cielo);
    vec3 light=ambient+vec3(1.0,.975,.94)*(direct*.68*phase*slopeLight+multiple*.72*slopeLight);
    // Hombro suave: las cimas no se queman y conservan su relieve.
    light=vec3(1.0)-exp(-light*1.36);
    return mix(vec3(.005,.010,.021),light,smoothstep(-.12,.18,solar));
  }
  float hash(vec2 p){return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715))));}
  void main(){
    vec3 ro=localCameraPosition,ray=normalize(vCloudPosition-ro);
    float b=dot(ro,ray),d=b*b-dot(ro,ro)+CLOUD_TOP*CLOUD_TOP;
    if(d<=0.0)discard;
    float root=sqrt(d),start=max(0.0,-b-root),end=-b+root;
    float ground=b*b-dot(ro,ro)+1.0;
    if(ground>0.0)end=min(end,-b-sqrt(ground));
    float facing=abs(dot(normalize(vCloudPosition),-ray));
    float sampleCount=mix(96.0,48.0,smoothstep(.06,.5,facing));
    float stepLength=(end-start)/sampleCount;
    float travel=start+stepLength*(.35+hash(gl_FragCoord.xy)*.3);
    vec3 accumulated=vec3(0.0),light=vec3(.8);
    float transmission=1.0,slopeLight=1.0;bool needsLight=true,hasNormal=false;
    for(int i=0;i<96;i++){
      if(travel>end)break;
      vec3 p=ro+ray*travel;float density=cloudDensity(p);
      if(density>.001){
        if(!hasNormal){slopeLight=cloudSlopeLight(p);hasNormal=true;}
        if(needsLight||i%3==0){light=cloudLight(p,ray,slopeLight);needsLight=false;}
        float alpha=1.0-exp(-density*stepLength*310.0);
        accumulated+=transmission*alpha*light;
        transmission*=1.0-alpha;
        if(transmission<.008)break;
      }else needsLight=true;
      // Fixed sampling intervals preserve the opacity of small formations at
      // moving silhouettes. Empty-space jumps used to miss their first samples.
      travel+=stepLength;
    }
    float alpha=1.0-transmission;
    if(alpha<.002)discard;
    gl_FragColor=vec4(accumulated/max(alpha,.0001),alpha);
  }
`;
