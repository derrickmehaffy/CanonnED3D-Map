/**
 * The sky, as a function rather than as a picture.
 *
 * The nebula used to be baked once into a 4096-wide equirect and stretched
 * over the view. Over a 50° field that is three texels per screen pixel at
 * best, and at the poles far worse — however much detail the shader computed,
 * the image threw most of it away. Going to eight thousand across would have
 * been 128 MB for a result still short of the screen.
 *
 * So the backdrop is drawn live: a quad behind everything, and every screen
 * pixel evaluates the same nebula function for its own direction. There is no
 * texel. On a desktop GPU it is a couple of milliseconds a frame and only
 * while a frame is being drawn at all; a phone keeps the baked image.
 *
 * One function, exported as source, feeds all three places a sky is made —
 * the live backdrop, the equirect the black-hole lens bends, and the flat
 * picture the 2D view stands against — so the lens can never show a sky the
 * reader is not looking at, which was the rule before and still is.
 */
import * as THREE from 'three';

/* ── the nebula, in GLSL, for anything that wants a sky ──────────────────
   Takes a unit direction in scene space and gives linear light. Amplitudes
   are the ones the baked sky was calibrated to, so the lens and the backdrop
   agree; what is new is the depth of it — warped rather than plain fBm, a
   third colour family, star clouds with grain along the band, and dust with
   real structure rather than a soft mask. */
export const NEBULA_GLSL = [
  'float skyHash(vec3 p) {',
  '  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);',
  '}',
  'float skyNoise(vec3 p) {',
  '  vec3 i = floor(p), f = fract(p);',
  '  f = f * f * (3.0 - 2.0 * f);',
  '  return mix(mix(mix(skyHash(i), skyHash(i + vec3(1,0,0)), f.x),',
  '                 mix(skyHash(i + vec3(0,1,0)), skyHash(i + vec3(1,1,0)), f.x), f.y),',
  '             mix(mix(skyHash(i + vec3(0,0,1)), skyHash(i + vec3(1,0,1)), f.x),',
  '                 mix(skyHash(i + vec3(0,1,1)), skyHash(i + vec3(1,1,1)), f.x), f.y), f.z);',
  '}',
  'float skyFbm5(vec3 p) {',
  '  float v = 0.0, a = 0.5;',
  '  for (int i = 0; i < 5; i++) { v += a * skyNoise(p); p = p * 2.07 + 1.3; a *= 0.5; }',
  '  return v;',
  '}',
  'float skyFbm3(vec3 p) {',
  '  float v = 0.0, a = 0.5;',
  '  for (int i = 0; i < 3; i++) { v += a * skyNoise(p); p = p * 2.07 + 1.3; a *= 0.5; }',
  '  return v;',
  '}',
  'float skyRidged(vec3 p) {',
  '  float v = 0.0, a = 0.5;',
  '  for (int i = 0; i < 4; i++) { v += a * (1.0 - abs(skyNoise(p) * 2.0 - 1.0)); p = p * 2.11 + 2.3; a *= 0.5; }',
  '  return v;',
  '}',

  /* dir: where the pixel looks. seed: the system's own. core: the direction
     of Sagittarius A*. band: 1 pins material to the galactic plane, 0 lets
     the noise decide. glow: how bright the core sits.

     Budgeted. This runs once per screen pixel per frame the camera turns, so
     it is about forty noise evaluations, not ninety: one warp field shared by
     all three cloud families rather than one each — which is also right, one
     gas cloud is distorted one way — and five octaves where the first draft
     had six. The bake uses exactly this, so the lens agrees with the view. */
  'vec3 nebula(vec3 dir, vec3 seed, vec3 core, float band, float glow) {',
  '  vec3 p = dir * 2.3 + seed;',
  /* Domain warping: the coordinate is pushed around by a coarser field
     first. Plain fBm makes round clouds; this makes the drawn-out filaments
     and hollows a nebula actually has. */
  '  vec3 q = vec3(skyFbm3(p + vec3(1.7, 9.2, 4.1)), skyFbm3(p + vec3(8.3, 2.8, 7.5)), skyFbm3(p + vec3(3.1, 5.9, 1.2)));',
  '  vec3 w = (q - 0.5) * 2.2;',
  '  float cold = skyFbm5(p + w);',
  '  float warm = skyFbm5(p * 1.7 + w * 1.4 + vec3(31.4, 7.2, 19.8));',
  '  float rose = skyFbm5(p * 1.3 + w * 1.8 + vec3(12.1, 44.8, 9.6));',
  '  float fine = skyFbm5(p * 4.3 - vec3(5.1, 2.7, 8.3));',
  '  float dust = skyRidged(p * 3.1 + vec3(17.0, 41.0, 3.0));',

  '  float plane = mix(1.0, exp(-dir.y * dir.y * 14.0), band);',

  /* High thresholds and a power on top: a sky with nebulosity in it, not a
     sky made of nebula. */
  '  float c  = pow(smoothstep(0.53, 0.84, cold) * plane, 1.5);',
  '  float wv = pow(smoothstep(0.60, 0.88, warm) * plane, 1.7);',
  '  float rs = pow(smoothstep(0.64, 0.90, rose) * plane, 1.8);',

  /* Folded noise turns a cloud into a nebula: every crossing of the midpoint
     becomes a bright edge, and a field of those reads as filaments. */
  '  float ridge = 1.0 - abs(fine * 2.0 - 1.0);',
  '  float wisp = 0.22 + pow(ridge, 2.6) * 2.1;',

  '  vec3 col = vec3(0.0012, 0.0016, 0.0030);',                 // deep space is not black
  '  col += vec3(0.006, 0.013, 0.030) * c * wisp;',
  '  col += vec3(0.020, 0.008, 0.004) * wv * wisp;',
  '  col += vec3(0.016, 0.005, 0.011) * rs * wisp;',           // hydrogen's own colour, faint

  /* The bulge, where it actually is, broken up by the same noise the clouds
     are made of and laid down before the dust so the lanes cut through it. */
  '  float toCore = max(dot(dir, core), 0.0);',
  '  float clumps = 0.45 + 0.9 * skyFbm3(dir * 5.2 - seed);',
  '  float grain = 0.8 + 0.4 * skyNoise(dir * 90.0 + seed * 3.0);',   // star clouds, close up
  '  col += vec3(0.030, 0.022, 0.013) * glow * pow(toCore, 9.0) * clumps * grain;',
  '  col += vec3(0.005, 0.0038, 0.0026) * glow * pow(toCore, 5.0) * plane * clumps;',

  /* Dust in front of all of it. Ridged, so the lanes have edges and the
     occasional dark globule rather than a soft mask. */
  '  float lane = smoothstep(0.50, 0.86, dust) * plane;',
  '  col *= mix(1.0, 0.22, lane);',
  '  return col;',
  '}'
].join('\n');

/* ── the live backdrop ───────────────────────────────────────────────────── */

const SKY_VERT = [
  'varying vec2 vUv;',
  'void main() { vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }'
].join('\n');

const SKY_FRAG = [
  'uniform mat4 uInvProj;',      // the camera's inverse projection
  'uniform mat3 uCamRot;',       // the camera's rotation into the scene
  'uniform vec3 uSeed;',
  'uniform vec3 uCore;',
  'uniform float uBand;',
  'uniform float uGlow;',
  'varying vec2 vUv;',
  NEBULA_GLSL,
  'void main() {',
  /* Which way this pixel looks: the point on the far plane it projects to,
     unprojected, then turned by the camera. */
  '  vec4 far = uInvProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);',
  '  vec3 dir = normalize(uCamRot * normalize(far.xyz / far.w));',
  '  gl_FragColor = vec4(nebula(dir, uSeed, uCore, uBand, uGlow), 1.0);',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

const BLIT_FRAG = [
  'uniform sampler2D uSky;',
  'varying vec2 vUv;',
  'void main() {',
  '  gl_FragColor = vec4(texture2D(uSky, vUv).rgb, 1.0);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}'
].join('\n');

/**
 * A quad that draws the sky behind everything, for a perspective camera.
 *
 * The nebula is evaluated into a target at half the screen's resolution — the
 * clouds are soft and half is indistinguishable, while the stars are drawn
 * as points at full resolution over the top — and only when the camera has
 * turned or the window has changed shape. A still camera watching the orbits
 * run costs nothing; a drag costs one half-size pass a frame.
 *
 * Call `update(renderer, camera)` each frame before rendering the scene,
 * `resize(w, h)` when the canvas does, and `set(...)` when the system or the
 * sky mode changes.
 */
export class SkyBackdrop {
  constructor() {
    this.sky = new THREE.ShaderMaterial({
      uniforms: {
        uInvProj: { value: new THREE.Matrix4() },
        uCamRot: { value: new THREE.Matrix3() },
        uSeed: { value: new THREE.Vector3() },
        uCore: { value: new THREE.Vector3(0, 0, -1) },
        uBand: { value: 0 },
        uGlow: { value: 0 }
      },
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      depthTest: false, depthWrite: false
    });
    this.target = null;
    this.bench = new THREE.Scene();
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.sky);
    this.quad.frustumCulled = false;
    this.bench.add(this.quad);
    this.flat = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);

    this.blit = new THREE.ShaderMaterial({
      uniforms: { uSky: { value: null } },
      vertexShader: SKY_VERT, fragmentShader: BLIT_FRAG,
      depthTest: false, depthWrite: false
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blit);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;          // first, under the point stars and everything else
    this.mesh.raycast = () => {};

    this.lastRot = new THREE.Matrix3();
    this.lastProj = new THREE.Matrix4();
    this.dirty = true;
    this.passes = 0;                      // how many times the sky was actually evaluated
  }

  set(seed, core, band, glow) {
    const u = this.sky.uniforms;
    u.uSeed.value.copy(seed);
    u.uCore.value.copy(core);
    u.uBand.value = band;
    u.uGlow.value = glow;
    this.dirty = true;
  }

  resize(w, h) {
    const tw = Math.max(1, Math.round(w / 2)), th = Math.max(1, Math.round(h / 2));
    if (this.target && this.target.width === tw && this.target.height === th) return;
    if (this.target) this.target.dispose();
    this.target = new THREE.WebGLRenderTarget(tw, th, { depthBuffer: false });
    /* Written encoded, because the nebula lives at a few hundredths of white
       and eight linear bits would band it into steps; read back decoded. */
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.target.texture.minFilter = this.target.texture.magFilter = THREE.LinearFilter;
    this.target.texture.generateMipmaps = false;
    this.blit.uniforms.uSky.value = this.target.texture;
    this.dirty = true;
  }

  /** True if the sky was re-evaluated this frame. */
  update(renderer, camera) {
    if (!this.target || !this.mesh.visible) return false;
    const rot = new THREE.Matrix3().setFromMatrix4(camera.matrixWorld);
    const same = !this.dirty
      && rot.elements.every((v, i) => Math.abs(v - this.lastRot.elements[i]) < 1e-6)
      && camera.projectionMatrix.elements.every((v, i) => Math.abs(v - this.lastProj.elements[i]) < 1e-6);
    if (same) return false;
    this.lastRot.copy(rot);
    this.lastProj.copy(camera.projectionMatrix);
    this.dirty = false;
    const u = this.sky.uniforms;
    u.uInvProj.value.copy(camera.projectionMatrixInverse);
    u.uCamRot.value.copy(rot);
    const was = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.bench, this.flat);
    renderer.setRenderTarget(was);
    this.passes++;
    return true;
  }

  dispose() {
    if (this.target) this.target.dispose();
    this.quad.geometry.dispose(); this.sky.dispose();
    this.mesh.geometry.dispose(); this.blit.dispose();
  }
}
