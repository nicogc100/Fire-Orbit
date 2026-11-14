import * as THREE from 'three';
import { cloudField, cloudShader, cloudVertexShader } from './cloud-shader.js?v=20261109d';

const quadVertex = /* glsl */ `
  varying vec2 vUv;
  void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}
`;
const solarFragment = /* glsl */ `
  ${cloudField}
  uniform vec3 localSunDirection;
  uniform float lightSlice;
  varying vec2 vUv;
  void main(){
    float lon=(vUv.x-.5)*2.0*CLOUD_PI,lat=(vUv.y-.5)*CLOUD_PI;
    vec3 n=vec3(cos(lat)*cos(lon),sin(lat),-cos(lat)*sin(lon));
    vec3 p=n*mix(CLOUD_BASE,CLOUD_TOP,lightSlice);
    float depth=cloudDensity(p+localSunDirection*(.00045*CLOUD_LIGHT_SCALE))*.0009
               +cloudDensity(p+localSunDirection*(.00155*CLOUD_LIGHT_SCALE))*.0013
               +cloudDensity(p+localSunDirection*(.0035*CLOUD_LIGHT_SCALE))*.0026
               +cloudDensity(p+localSunDirection*(.0070*CLOUD_LIGHT_SCALE))*.0044
               +cloudDensity(p+localSunDirection*(.0130*CLOUD_LIGHT_SCALE))*.0076;
    gl_FragColor=vec4(vec3(depth*CLOUD_LIGHT_SCALE*64.0),1.0);
  }
`;
const shadowFragment = /* glsl */ `
  ${cloudField}
  uniform vec3 localSunDirection;
  varying vec2 vUv;
  void main(){
    float lon=(vUv.x-.5)*2.0*CLOUD_PI,lat=(vUv.y-.5)*CLOUD_PI;
    vec3 p=vec3(cos(lat)*cos(lon),sin(lat),-cos(lat)*sin(lon));
    float solar=dot(p,localSunDirection),depth=0.0;
    if(solar>0.0){
      float end=-solar+sqrt(solar*solar+CLOUD_TOP*CLOUD_TOP-1.0);
      float stepLength=end/4.0;
      for(int i=0;i<4;i++)depth+=cloudDensity(p+localSunDirection*((float(i)+.5)*stepLength))*stepLength;
    }
    float shadow=1.0-(1.0-exp(-depth*150.0))*.68*smoothstep(0.0,.16,solar);
    gl_FragColor=vec4(vec3(shadow),1.0);
  }
`;
const compositeFragment = /* glsl */ `
  uniform sampler2D cloudColor;
  uniform sampler2D surfaceColor;
  uniform mat4 inverseProjection;
  uniform mat4 cameraWorld;
  uniform vec3 worldCameraPosition;
  uniform vec3 sunDirection;
  varying vec2 vUv;
  vec2 sphereHit(vec3 ro,vec3 rd,float radius){
    float b=dot(ro,rd),d=b*b-dot(ro,ro)+radius*radius;
    if(d<0.0)return vec2(-1.0);
    return -b+vec2(-1.0,1.0)*sqrt(d);
  }
  void main(){
    vec4 cloud=texture2D(cloudColor,vUv),surface=texture2D(surfaceColor,vUv);
    vec3 ro=worldCameraPosition;
    vec4 view=inverseProjection*vec4(vUv*2.0-1.0,1.0,1.0);
    vec3 rd=normalize((cameraWorld*vec4(view.xyz,0.0)).xyz);
    vec2 airHit=sphereHit(ro,rd,1.06),ground=sphereHit(ro,rd,1.0);
    vec3 color=cloud.rgb+(1.0-cloud.a)*surface.rgb;
    float alpha=cloud.a+(1.0-cloud.a)*surface.a;
    if(airHit.y>0.0){
      float start=max(airHit.x,0.0),finish=airHit.y;
      if(ground.x>0.0)finish=min(finish,ground.x);
      vec2 cloudHit=sphereHit(ro,rd,1.007);
      float cloudStop=cloudHit.x>0.0?cloudHit.x:(airHit.x+airHit.y)*.5;
      float ds=max(finish-start,0.0)/16.0;
      vec2 depth=vec2(0.0),nearDepth=vec2(0.0);
      float illumination=0.0,weight=0.0;
      for(int i=0;i<16;i++){
        float t=start+(float(i)+.5)*ds;
        vec3 p=ro+rd*t;
        float altitude=max(length(p)-1.0,0.0);
        // One spherical atmosphere for both terrain and clouds. The short Mie
        // profile gives a pale horizon; Rayleigh carries the longer blue haze.
        vec2 density=exp(-altitude/vec2(.0125,.0024))*ds;
        depth+=density;
        nearDepth+=density*clamp((cloudStop-(t-ds*.5))/max(ds,.00001),0.0,1.0);
        float light=smoothstep(-.16,.32,dot(normalize(p),sunDirection));
        illumination+=density.x*light;weight+=density.x;
      }
      float daylight=illumination/max(weight,.00001);
      vec3 beta=vec3(2.5,3.7,5.3);
      vec3 transmission=exp(-depth.x*beta-depth.y*2.0);
      vec3 cloudTransmission=exp(-nearDepth.x*beta-nearDepth.y*2.0);
      vec3 airColor=mix(vec3(.012,.035,.075),vec3(.62,.76,.9),daylight);
      vec3 background=surface.rgb*transmission+airColor*(1.0-transmission);
      float airAlpha=dot(1.0-transmission,vec3(.2126,.7152,.0722));
      float backgroundAlpha=surface.a+(1.0-surface.a)*airAlpha;
      color=cloud.rgb*cloudTransmission+cloud.a*airColor*(1.0-cloudTransmission)
            +(1.0-cloud.a)*background;
      alpha=cloud.a+(1.0-cloud.a)*backgroundAlpha;
    }
    if(alpha<.0001)discard;
    // All passes and atmospheric extinction are composed in linear light.
    // Display conversion happens exactly once, after unpremultiplication.
    gl_FragColor=vec4(color/max(alpha,.0001),alpha);
    #include <colorspace_fragment>
  }
`;

export class CloudLayer {
  constructor(renderer, camera, globe, geometry, uniforms) {
    this.renderer = renderer;
    this.camera = camera;
    this.globe = globe;
    const colorType = renderer.extensions.has('EXT_color_buffer_float') ? THREE.HalfFloatType : THREE.UnsignedByteType;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: colorType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.surfaceTarget = new THREE.WebGLRenderTarget(1, 1, { type: colorType, depthBuffer: true });
    this.solarTarget = new THREE.WebGL3DRenderTarget(512, 256, 16, {
      type: colorType,
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.solarTarget.texture.wrapS = THREE.RepeatWrapping;
    uniforms.solarDepth = { value: this.solarTarget.texture };
    this.lightUniforms = { ...uniforms, lightSlice: { value: 0 } };
    this.lightSlice = 0;
    this.lightReady = false;
    this.shadowTarget = new THREE.WebGLRenderTarget(1024, 512, {
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    this.shadowTarget.texture.wrapS = THREE.RepeatWrapping;
    this.shadowTexture = this.shadowTarget.texture;
    this.cloudScene = new THREE.Scene();
    this.cloudGroup = new THREE.Group();
    this.cloudScene.add(this.cloudGroup);
    this.cloudGroup.add(
      new THREE.Mesh(
        geometry,
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: cloudVertexShader,
          fragmentShader: cloudShader,
          transparent: true,
          depthWrite: false,
          depthTest: false,
        }),
      ),
    );
    this.screenCamera = new THREE.Camera();
    const quad = new THREE.PlaneGeometry(2, 2);
    this.solarScene = new THREE.Scene();
    this.solarScene.add(
      new THREE.Mesh(
        quad,
        new THREE.ShaderMaterial({
          uniforms: this.lightUniforms,
          vertexShader: quadVertex,
          fragmentShader: solarFragment,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
    this.shadowScene = new THREE.Scene();
    this.shadowScene.add(
      new THREE.Mesh(
        quad,
        new THREE.ShaderMaterial({
          uniforms,
          vertexShader: quadVertex,
          fragmentShader: shadowFragment,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
    this.compositeScene = new THREE.Scene();
    this.compositeScene.add(
      new THREE.Mesh(
        quad,
        new THREE.ShaderMaterial({
          uniforms: {
            cloudColor: { value: this.target.texture },
            surfaceColor: { value: this.surfaceTarget.texture },
            inverseProjection: { value: camera.projectionMatrixInverse },
            cameraWorld: { value: camera.matrixWorld },
            worldCameraPosition: { value: camera.position },
            sunDirection: uniforms.sunDirection,
          },
          vertexShader: quadVertex,
          fragmentShader: compositeFragment,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        }),
      ),
    );
  }
  resize(width, height) {
    // Keep the terrain at the native canvas resolution. Only the costly volume
    // pass has a bounded pixel count; the full 2048×1024×32 density stays intact.
    const scale = Math.min(this.renderer.getPixelRatio(), Math.sqrt(700000 / (width * height)));
    this.target.setSize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const ratio = this.renderer.getPixelRatio();
    this.surfaceTarget.setSize(Math.max(1, Math.round(width * ratio)), Math.max(1, Math.round(height * ratio)));
  }
  async compile() {
    await this.renderer.compileAsync(this.cloudScene, this.camera);
    await this.renderer.compileAsync(this.solarScene, this.screenCamera);
    await this.renderer.compileAsync(this.shadowScene, this.screenCamera);
    await this.renderer.compileAsync(this.compositeScene, this.screenCamera);
  }
  prepare() {
    this.cloudGroup.quaternion.copy(this.globe.quaternion);
    // Fill once, then refresh two radial slices per frame. No temporal image
    // accumulation: camera motion cannot leave colour trails or stale geometry.
    const slices = this.lightReady ? 2 : 16;
    for (let i = 0; i < slices; i++) {
      this.lightUniforms.lightSlice.value = this.lightSlice / 15;
      this.renderer.setRenderTarget(this.solarTarget, this.lightSlice);
      this.renderer.render(this.solarScene, this.screenCamera);
      this.lightSlice = (this.lightSlice + 1) % 16;
    }
    this.lightReady = true;
    this.renderer.setRenderTarget(this.shadowTarget);
    this.renderer.render(this.shadowScene, this.screenCamera);
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.cloudScene, this.camera);
    this.renderer.setRenderTarget(null);
  }
  compose(scene) {
    this.renderer.setRenderTarget(this.surfaceTarget);
    this.renderer.render(scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.compositeScene, this.screenCamera);
  }
}
