import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/**
 * Optional HDR pipeline.
 *
 * The scene is built almost entirely from additive blending: ~26,000 galaxy
 * sprites at size 500, another 1,800 at size 2,000, the system flares and the
 * region labels. Rendered straight to the default 8-bit buffer every one of
 * those clamps at 1.0, so in the galactic plane the overlaps blow past white
 * and clip flat. That — not the textures or the palette — is why the map reads
 * as a haze rather than as stars.
 *
 * Rendering into a half-float target lets the additive sum accumulate past 1.0,
 * and tone mapping compresses it on the way out instead of clipping. Bright
 * cores keep their colour, and bloom finally has real headroom to threshold
 * against: on the LDR pipeline bloom either blew the whole frame out or, above
 * 1.0, did nothing at all, because once everything has clipped nothing is
 * brighter than anything else.
 *
 * Off by default. Ed3d's colours were authored against the old non-managed
 * path (ColorManagement is deliberately disabled), so this shifts every hue and
 * wants tuning against the galaxy brightness rather than being imposed.
 */
var PostFX = {

  'enabled': false,
  'composer': null,
  'bloom': null,
  'origRender': null,
  'origToneMapping': null,
  'origExposure': null,
  'inside': false,

  //-- Tunables. exposure and bloom threshold trade against each other and
  //   against how present the Milky Way should be; expected to be adjusted.
  'exposure': 0.75,
  'strength': 0.7,
  'radius': 0.5,
  'threshold': 0.85,

  'available': function () {
    return typeof renderer !== 'undefined' && renderer != null &&
           typeof scene !== 'undefined' && scene != null &&
           typeof camera !== 'undefined' && camera != null;
  },

  'build': function () {
    var size = new THREE.Vector2();
    renderer.getSize(size);

    var target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: 0
    });

    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(size, this.strength, this.radius, this.threshold);
    this.composer.addPass(this.bloom);
    //-- OutputPass applies the tone mapping and the sRGB conversion.
    this.composer.addPass(new OutputPass());
  },

  'enable': function () {
    if (this.enabled || !this.available()) return false;

    if (this.composer === null) this.build();

    this.origToneMapping = renderer.toneMapping;
    this.origExposure = renderer.toneMappingExposure;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = this.exposure;

    //-- Ed3d's animate() calls renderer.render() directly, so route it through
    //   the composer rather than reaching into the loop. The guard matters:
    //   the composer's own RenderPass calls renderer.render() again.
    //-- Keep the original by reference, not bound: a bound copy is a new
    //   function object, so disable() would never restore what was there and
    //   repeated toggles would stack wrappers.
    var self = this;
    this.origRender = renderer.render;
    var passthrough = this.origRender.bind(renderer);
    renderer.render = function (s, c) {
      if (self.inside) return passthrough(s, c);
      self.inside = true;
      try { self.composer.render(); } finally { self.inside = false; }
    };

    this.enabled = true;
    return true;
  },

  'disable': function () {
    if (!this.enabled) return false;
    renderer.render = this.origRender;
    renderer.toneMapping = this.origToneMapping;
    renderer.toneMappingExposure = this.origExposure;
    this.origRender = null;
    this.enabled = false;
    return true;
  },

  'toggle': function (on) {
    return (on === undefined ? !this.enabled : on) ? this.enable() : this.disable();
  },

  'setExposure': function (v) {
    this.exposure = v;
    if (this.enabled) renderer.toneMappingExposure = v;
  },

  'setBloom': function (strength, threshold, radius) {
    if (strength !== undefined) this.strength = strength;
    if (threshold !== undefined) this.threshold = threshold;
    if (radius !== undefined) this.radius = radius;
    if (this.bloom !== null) {
      this.bloom.strength = this.strength;
      this.bloom.threshold = this.threshold;
      this.bloom.radius = this.radius;
    }
  },

  'resize': function () {
    if (this.composer === null) return;
    var size = new THREE.Vector2();
    renderer.getSize(size);
    this.composer.setSize(size.x, size.y);
    if (this.bloom !== null) this.bloom.setSize(size.x, size.y);
  }

};

export { PostFX };
