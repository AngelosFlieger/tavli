import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import './style.css';
import './responsive.css';
import { preferences } from './ui/interface';
import { createDice } from './scene/dice';
import { createGameplay } from './scene/checkers';
import { createStartScatter } from './scene/start-scatter';
import { initStartScreen } from './ui/start-screen';
import { boardLayout, applyBoardViewport } from './scene/layout';

const host = document.querySelector<HTMLElement>('#scene')!;
const boardFrame = document.querySelector<HTMLElement>('#board-frame')!;
const status = document.querySelector<HTMLElement>('#status')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

async function start() {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute(
    'aria-label',
    'Plakoto board with 15 red checkers on the top-left inner point and 15 ivory checkers on the bottom-left inner point',
  );
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-7, 7, 5, -5, 0.1, 100);
  camera.position.set(0, 12, 8.3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const background = new THREE.Scene();
  const backgroundCamera = new THREE.Camera();
  const bg = new THREE.ShaderMaterial({
    depthWrite: false,
    depthTest: false,
    uniforms: { time: { value: 0 }, aspect: { value: 1 }, title: { value: 1 } },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `varying vec2 vUv; uniform float time; uniform float aspect; uniform float title;
    void main(){
      vec2 p=(vUv-.5)*vec2(aspect,1.); float t=time*.065;
      vec2 q=p;
      for(int i=1;i<4;i++){float f=float(i);q+=.12/f*vec2(sin(q.y*5.*f+t*f),cos(q.x*4.*f-t));}
      float wave=sin(q.x*6.+q.y*8.+sin(q.y*5.-t)*2.+t);
      float stripe=smoothstep(.18,.65,wave);
      float blue=smoothstep(-.7,-.25,wave)*(1.-stripe);
      vec3 c=vec3(.013,.024,.052);
      c=mix(c,vec3(.038,.105,.22),blue*.86);
      c=mix(c,vec3(.33,.018,.048),stripe*.9);
      gl_FragColor=vec4(c,1.-title);
    }`,
  });
  background.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bg));
  scene.add(new THREE.HemisphereLight(0xffefd2, 0x242139, 2.2));
  const key = new THREE.DirectionalLight(0xffedce, 3.2);
  key.position.set(-3, 9, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x789ffe, 1.1);
  rim.position.set(4, 4, -4);
  scene.add(rim);
  const red = new THREE.PointLight(0xff334b, 14, 20, 2);
  red.position.set(-5, 2, 2);
  scene.add(red);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(background, backgroundCamera));
  const boardPass = new RenderPass(scene, camera);
  boardPass.clear = false;
  composer.addPass(boardPass);
  composer.addPass(new OutputPass());
  const retro = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      time: { value: 0 },
      resolution: { value: new THREE.Vector2() },
    },
    vertexShader: `varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform vec2 resolution; varying vec2 vUv;
    void main(){
      vec3 c=texture2D(tDiffuse,vUv).rgb;
      float grain=fract(sin(dot(floor(vUv*resolution),vec2(12.9898,78.233))+floor(time*12.))*43758.5453)-.5;
      c+=grain*.027;
      c*=1.-.022*(.5+.5*sin(vUv.y*resolution.y*3.14159));
      vec2 p=(vUv-.5)*1.25; c*=1.-.24*dot(p,p);
      gl_FragColor=vec4(c,texture2D(tDiffuse,vUv).a);
    }`,
  });
  composer.addPass(retro);
  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}models/Board.glb`);
  const board = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(board);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  // The original GLB is Y-up; preserve its geometry and all embedded materials.
  board.position.sub(center);
  const root = new THREE.Group();
  root.add(board);
  root.scale.setScalar(10 / Math.max(size.x, size.z));
  scene.add(root);

  const layout = { depth: 1, stackSlots: 5 };
  const gameplay = await createGameplay(
    root,
    center,
    camera,
    renderer.domElement,
    reducedMotion,
    layout,
  );
  const scatter = createStartScatter(gameplay.checkerArtwork);
  composer.insertPass(scatter.pass, 2);
  let dice: Awaited<ReturnType<typeof createDice>> | undefined;

  // Soft painted contact shadow, generated locally rather than a substitute board image.
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const ctx = shadowCanvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 12, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,.65)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(13, 10),
    new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = (-size.y * root.scale.x) / 2 - 0.18;
  scene.add(shadow);
  root.updateMatrixWorld(true);
  function resize() {
    const frame = boardFrame.getBoundingClientRect();
    const w = frame.width,
      h = frame.height,
      aspect = w / h;
    const title = document.body.classList.contains('on-title');
    const portrait = matchMedia('(max-aspect-ratio: 1/1)').matches;
    Object.assign(layout, boardLayout(portrait, title, aspect));
    board.visible = !(title && portrait);
    shadow.visible = !(title && portrait);
    board.scale.z = layout.depth;
    shadow.scale.y = layout.depth;
    gameplay.resize();
    dice?.resize();
    root.updateMatrixWorld(true);
    const worldBounds = new THREE.Box3().setFromObject(board),
      projected = new THREE.Box3();
    for (const x of [worldBounds.min.x, worldBounds.max.x])
      for (const y of [worldBounds.min.y, worldBounds.max.y])
        for (const z of [worldBounds.min.z, worldBounds.max.z])
          projected.expandByPoint(
            new THREE.Vector3(x, y, z).applyMatrix4(camera.matrixWorldInverse),
          );
    const halfHeight = title
      ? (projected.max.x - projected.min.x) / 2 / aspect / 0.9
      : Math.max(
          (projected.max.y - projected.min.y) / 2 / (portrait ? 0.96 : 0.82),
          (projected.max.x - projected.min.x) / 2 / aspect / 0.94,
        ) + 0.08;
    camera.left = -halfHeight * aspect;
    camera.right = halfHeight * aspect;
    camera.top = title
      ? projected.max.y + 0.25
      : portrait
        ? (projected.max.y + projected.min.y) / 2 + halfHeight
        : halfHeight - 0.6;
    camera.bottom = title || portrait ? camera.top - 2 * halfHeight : -halfHeight - 0.6;
    camera.updateProjectionMatrix();
    const screenWidth = host.clientWidth,
      screenHeight = host.clientHeight;
    scatter.resize(screenWidth, screenHeight, title && portrait);
    if (title && portrait)
      renderer.domElement.setAttribute('aria-label', 'Scattered original Plakoto checkers');
    applyBoardViewport(camera, frame, screenWidth, screenHeight);
    renderer.setSize(screenWidth, screenHeight);
    composer.setSize(screenWidth, screenHeight);
    bg.uniforms.aspect.value = screenWidth / screenHeight;
    bg.uniforms.title.value = title ? 1 : 0;
    retro.uniforms.resolution.value.set(
      screenWidth * renderer.getPixelRatio(),
      screenHeight * renderer.getPixelRatio(),
    );
  }
  window.addEventListener('resize', resize);
  new ResizeObserver(resize).observe(boardFrame);
  resize();
  dice = await createDice(root, center, reducedMotion, layout, {
    canRoll: () => gameplay.beginRoll(),
    settled: (values) => gameplay.receiveRoll(values),
  });
  initStartScreen();
  gameplay.refresh();
  status.hidden = true;
  let elapsed = 0,
    last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (document.hidden) return;
    if (!reducedMotion.matches && preferences.motion) elapsed += dt;
    bg.uniforms.time.value = elapsed;
    retro.uniforms.time.value = elapsed;
    root.position.y =
      reducedMotion.matches || !preferences.motion ? 0 : Math.sin(elapsed * 0.65) * 0.035;
    retro.enabled = preferences.texture;
    dice!.update(dt);
    gameplay.update(dt);
    composer.render();
  });
  renderer.domElement.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    status.textContent = 'Graphics connection lost. Reload the page to restore the board.';
    status.hidden = false;
  });
}
start().catch((error: unknown) => {
  console.error(error);
  status.hidden = false;
  status.textContent =
    'The 3D board could not load. Check WebGL support and that public/models/Board.glb is present, then reload.';
});
