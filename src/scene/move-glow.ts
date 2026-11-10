import * as THREE from 'three';

const vertexShader = `varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/** Analytic edges keep the point-shaped glow crisp at every screen size. */
export function destinationGlow() {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0x29e1cd) } },
    vertexShader,
    fragmentShader: `varying vec2 vUv; uniform vec3 color;
    float segment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.,1.));}
    void main(){
      vec2 p=(vUv-.5)*vec2(.047,.190);
      vec2 a=vec2(-.0165,-.0785),b=vec2(.0165,-.0785),c=vec2(0.,.0785);
      float edge=min(segment(p,a,b),min(segment(p,b,c),segment(p,c,a)));
      float inside=step(-.0785,p.y)*step(p.y,.0785)*step(abs(p.x),.0165*(.0785-p.y)/.157);
      float base=1.-smoothstep(-.0785,.065,p.y);
      float halo=exp(-edge*650.)*.48;
      float line=1.-smoothstep(.00025,.0008,edge);
      float fill=inside*(.28+.52*base*base);
      float spark=exp(-length(p-c)*1500.);
      vec3 ink=mix(color,vec3(1.,.98,.85),line*.35+spark*.2);
      gl_FragColor=vec4(ink,clamp(fill+halo+line*.9+spark,0.,1.));
    }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

export function selectedGlow() {
  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader: `varying vec2 vUv;
    void main(){
      vec2 p=(vUv-.5)*2.; float r=length(p); float d=abs(r-.66);
      float halo=exp(-d*14.)*.7;
      float core=1.-smoothstep(.012,.045,d);
      float rays=pow(abs(cos(atan(p.y,p.x)*4.)),36.)*exp(-d*10.)*.35;
      gl_FragColor=vec4(mix(vec3(1.,.53,.025),vec3(1.,1.,.72),core),clamp(halo+core+rays,0.,1.));
    }`,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.058, 0.058), material);
  glow.position.z = 0.0001;
  return glow;
}
