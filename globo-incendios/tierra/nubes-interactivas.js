import * as THREE from 'three';

const W=384,H=192,N=W*H;
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const wrap=x=>((x%W)+W)%W;

// A small surface flow: momentum transports the disturbance, while an energy
// field keeps eroding the cloud for about one second after the hand passes.
// This deliberately has no disk-shaped alpha stamp or stationary hover eraser.
export class HandFlow {
  constructor(canvas,camera){
    this.canvas=canvas;this.camera=camera;
    this.damage=new Float32Array(N);this.energy=new Float32Array(N);
    this.u=new Float32Array(N);this.v=new Float32Array(N);
    this.age=new Float32Array(N).fill(20);
    this.next=Array.from({length:5},()=>new Float32Array(N));
    this.pixels=new Uint8Array(N);
    this.texture=new THREE.DataTexture(this.pixels,W,H,THREE.RedFormat);
    this.texture.wrapS=THREE.RepeatWrapping;
    this.texture.minFilter=this.texture.magFilter=THREE.LinearFilter;
    this.texture.generateMipmaps=false;this.texture.needsUpdate=true;
    this.pointer=new THREE.Vector2();this.raycaster=new THREE.Raycaster();
    this.sphere=new THREE.Sphere(new THREE.Vector3(),1.008);
    this.hit=new THREE.Vector3();this.inverse=new THREE.Quaternion();
    this.previous=null;this.previousTime=0;this.pending=[];this.active=false;
    this.accumulator=0;this.hasFlow=false;
    canvas.addEventListener('pointermove',event=>{
      if(event.buttons||event.pointerType==='touch'){this.previous=null;return;}
      const rect=canvas.getBoundingClientRect();
      this.pending.push({x:(event.clientX-rect.left)/rect.width*2-1,
        y:1-(event.clientY-rect.top)/rect.height*2,t:event.timeStamp/1000});
      if(this.pending.length>24)this.pending.shift();
    });
    for(const name of ['pointerleave','pointerdown'])canvas.addEventListener(name,()=>{this.previous=null;this.pending=[];});
    window.addEventListener('blur',()=>{this.previous=null;this.pending=[];});
  }
  reset(){
    for(const field of [this.damage,this.energy,this.u,this.v])field.fill(0);
    this.age.fill(20);this.pixels.fill(0);this.texture.needsUpdate=true;
    this.pending=[];this.previous=null;this.hasFlow=false;
  }
  sample(field,x,y){
    // Reflection at the poles includes the half-turn in longitude.
    if(y<0){y=-y;x+=W/2;}else if(y>H-1){y=2*(H-1)-y;x+=W/2;}
    y=clamp(y,0,H-1);x=wrap(x);
    const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
    const j=Math.min(iy+1,H-1)*W,i=iy*W,k=(ix+1)%W;
    return (field[i+ix]*(1-fx)+field[i+k]*fx)*(1-fy)
      +(field[j+ix]*(1-fx)+field[j+k]*fx)*fy;
  }
  inject(u,v,du,dv,radius,speed){
    const lat=(v-.5)*Math.PI,cos=Math.max(.16,Math.cos(lat));
    const rx=radius/(2*Math.PI*cos)*W,ry=radius/Math.PI*H;
    const cx=u*W-.5,cy=v*H-.5;
    for(let y=Math.max(0,Math.floor(cy-ry*1.6));y<=Math.min(H-1,Math.ceil(cy+ry*1.6));y++){
      for(let x=Math.floor(cx-rx*1.6);x<=Math.ceil(cx+rx*1.6);x++){
        const dx=(x-cx)/rx,dy=(y-cy)/ry;
        // A ragged three-lobed palm, rather than one large circular cut-out.
        const edge=1+.15*Math.sin(x*.63+y*.27)+.10*Math.sin(y*.91-x*.31);
        const d=Math.sqrt(dx*dx*.8+dy*dy*1.35)/edge;
        if(d>1.3)continue;
        const weight=Math.exp(-d*d*3.3)*(.86+.14*Math.sin(x*.8+y*.45));
        const i=y*W+wrap(x);
        this.energy[i]=Math.min(3,this.energy[i]+weight*(1.60+speed));
        this.damage[i]=Math.min(1,this.damage[i]+weight*.22);
        this.u[i]+=du*weight*1.12;this.v[i]+=dv*weight*1.12;
        this.age[i]=0;
      }
    }
    this.hasFlow=true;
  }
  input(inverseRotation,cloudOffset,enabled){
    if(!enabled){this.previous=null;this.pending=[];return;}
    this.inverse.copy(inverseRotation);this.camera.updateMatrixWorld();
    for(const point of this.pending){
      this.pointer.set(point.x,point.y);this.raycaster.setFromCamera(this.pointer,this.camera);
      if(!this.raycaster.ray.intersectSphere(this.sphere,this.hit)){this.previous=null;continue;}
      const distanceToHand=this.camera.position.distanceTo(this.hit);
      this.hit.applyQuaternion(this.inverse).normalize().applyAxisAngle(new THREE.Vector3(0,1,0),cloudOffset*Math.PI*2);
      const u=((Math.atan2(-this.hit.z,this.hit.x)/(2*Math.PI)+.5)%1+1)%1;
      const v=Math.asin(clamp(this.hit.y,-1,1))/Math.PI+.5;
      if(this.previous){
        let du=u-this.previous.u;if(du>.5)du-=1;if(du<-.5)du+=1;
        const dv=v-this.previous.v;
        const dt=clamp(point.t-this.previous.t,.008,.12);
        const distance=Math.hypot(du*2*Math.PI*Math.cos((v-.5)*Math.PI),dv*Math.PI);
        // Broader than the accepted study; actual hit distance also handles
        // the low-horizon introduction camera correctly.
        const pixels=clamp(Math.min(this.canvas.clientWidth,this.canvas.clientHeight)*.056,26,45);
        const radius=clamp(distanceToHand*Math.tan(this.camera.fov*Math.PI/360)*2*pixels/this.canvas.clientHeight,.025,.165);
        const count=Math.min(20,Math.max(1,Math.ceil(distance/(radius*.45))));
        const speed=clamp(distance/dt,0,2);
        const velocityU=clamp(du/dt*W,-38,38),velocityV=clamp(dv/dt*H,-22,22);
        if(distance>.0005)for(let j=1;j<=count;j++)this.inject(
          this.previous.u+du*j/count,this.previous.v+dv*j/count,
          velocityU,velocityV,radius,speed);
      }
      this.previous={u,v,t:point.t};
    }
    this.pending=[];
  }
  step(dt){
    const fields=[this.damage,this.energy,this.u,this.v,this.age];
    const [q,e,u,v,age]=fields,[nq,ne,nu,nv,na]=this.next;
    let peak=0;
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const i=y*W+x,bx=x-u[i]*dt,by=y-v[i]*dt;
      const a=this.sample(age,bx,by)+dt;
      const energy=this.sample(e,bx,by)*Math.exp(-2.8*dt);
      let damage=this.sample(q,bx,by)+energy*dt*3.1;
      if(a>2.8)damage*=Math.exp(-.7*dt);
      nq[i]=clamp(damage,0,1);ne[i]=energy;
      nu[i]=this.sample(u,bx,by)*Math.exp(-1.8*dt);
      nv[i]=this.sample(v,bx,by)*Math.exp(-1.8*dt);
      na[i]=a;peak=Math.max(peak,nq[i]);
    }
    [this.damage,this.energy,this.u,this.v,this.age]=this.next;this.next=fields;
    if(peak<.002){this.reset();return;}
    for(let i=0;i<N;i++)this.pixels[i]=Math.round(this.damage[i]*255);
    this.texture.needsUpdate=true;
  }
  update(delta,inverseRotation,cloudOffset,enabled){
    this.input(inverseRotation,cloudOffset,enabled);if(!this.hasFlow)return;
    this.accumulator+=Math.min(delta,.12);
    // Fixed simulation steps keep the wake consistent as render rate changes.
    while(this.accumulator>=1/30){this.step(1/30);this.accumulator-=1/30;}
  }
}
