import * as THREE from 'three';

var System = {

  'particle': null,
  'particleGeo': null,
  'particleColor': [],
  'particleInfos': [],
  'points': [],
  'nameIndex': {},
  'positions': null,
  'colorValues': null,
  'count': 0,
  'scaleSize': 64,

  /**
   * Add a system in galaxy
   *
   * @param  {object} val        System properties (x, y, z, name are mandatory)
   * @param  {string} withSolid  Add a solid sphere (default: false)
   */

  'create': function (val, withSolid) {

    if (withSolid == undefined) withSolid = false;

    if (val.coords == undefined) return false;

    var x = parseFloat(val.coords.x);
    var y = parseFloat(val.coords.y);
    var z = -parseFloat(val.coords.z); //-- Revert Z coord

    //--------------------------------------------------------------------------
    //-- Particle for near and far view

    var colors = [];
    if (this.positions !== null) {

      //-- If system with info already registered, concat datas
      var idSys = x + '_' + y + '_' + z;
      if (val.infos != undefined && this.particleInfos[idSys]) {
        var indexParticle = this.particleInfos[idSys];
        if (this.points[indexParticle] !== undefined) {
          this.points[indexParticle].infos = (this.points[indexParticle].infos || '') + val.infos;
        }
        if (val.cat != undefined) Ed3d.addObjToCategories(indexParticle, val.cat);
        return;
      }

      //-- Get point color

      if (val.cat != undefined && val.cat[0] != undefined && Ed3d.colors[val.cat[0]] != undefined) {
        this.particleColor[this.count] = Ed3d.colors[val.cat[0]];
      } else {
        this.particleColor[this.count] = new THREE.Color(Ed3d.systemColor);
      }

      //-- If system got some categories, add it to cat list and save his main color

      if (val.cat != undefined) {
        Ed3d.addObjToCategories(this.count, val.cat);
      }

      if (val.infos != undefined) {
        this.particleInfos[idSys] = this.count;
      }

      this.positions.push(x, y, z);
      var c = this.particleColor[this.count];
      this.colorValues.push(c.r, c.g, c.b);
      this.count++;

      //-- Index-aligned metadata. The GPU only needs position and colour; every
      //   other per-system property lives here so the geometry can become a
      //   BufferGeometry without losing it.
      this.points.push({
        x: x, y: y, z: z,
        name: val.name,
        infos: val.infos,
        url: val.url,
        cat: val.cat,
        visible: true,
        clickable: true,
        color: this.particleColor[this.count - 1]
      });
      if (val.name !== undefined) this.nameIndex[val.name] = this.points.length - 1;
    }

    //--------------------------------------------------------------------------
    //-- Check if we have to add coords for a route

    if (Route.active == true) {

      if (Route.systems[val.name] != undefined) {
        Route.systems[val.name] = [x, y, z]
      }

    }

    //--------------------------------------------------------------------------
    //-- Build a sphere if needed

    if (withSolid) {

      //-- Add glow sprite from first cat color if defined, else take white glow

      var mat = Ed3d.material.glow_1;

      var sprite = new THREE.Sprite(mat);
      sprite.position.set(x, y, z);
      sprite.scale.set(50, 50, 1.0);
      scene.add(sprite); // this centers the glow at the mesh

      //-- Sphere

      var geometry = new THREE.SphereGeometry(2, 10, 10);

      var sphere = new THREE.Mesh(geometry, Ed3d.material.white);

      sphere.position.set(x, y, z);

      sphere.name = val.name;

      sphere.clickable = true;
      sphere.idsprite = sprite.id;
      scene.add(sphere);

      return sphere;
    }

  },


  /**
   * Init the galaxy particle geometry
   */

  'initParticleSystem': function () {
    this.positions = [];
    this.colorValues = [];
    this.points = [];
    this.nameIndex = {};
    this.count = 0;
    this.particleGeo = null;
  },

  /**
   * Create (or rebuild) the particle system.
   * Safe to call after every streaming batch: the previous Points object is
   * removed from the scene before a new one is constructed from the
   * accumulated geometry, so incoming systems appear incrementally.
   */

  'endParticleSystem': function () {

    if (this.positions === null || this.positions.length === 0) return;

    //-- Remove the previous particle cloud before replacing it. Three.js r75
    //   keys its internal GPU buffer size to the geometry object's id, so a
    //   fresh BufferGeometry (and fresh typed arrays sized to the current
    //   accumulator) is built on every flush rather than resizing in place.
    if (this.particle !== null) {
      scene.remove(this.particle);
      if (this.particle.geometry) this.particle.geometry.dispose();
    }

    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.positions), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colorValues), 3));

    var particleMaterial = new THREE.PointsMaterial({
      map: Ed3d.textures.flare_yellow,
      vertexColors: true,
      size: this.scaleSize,
      fog: false,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthTest: true,
      depthWrite: false
    });

    this.particle = new THREE.Points(geo, particleMaterial);
    this.particle.clickable = true;
    this.particleGeo = geo;

    scene.add(this.particle);
  },


  /**
   * Remove systems list
   */

  'remove': function () {

    if (this.particle !== null && this.particle.geometry) this.particle.geometry.dispose();

    this.positions = null;
    this.colorValues = null;
    this.particleColor = [];
    this.particleGeo = null;
    this.points = [];
    this.nameIndex = {};
    this.count = 0;
    scene.remove(this.particle);

  },

  /**
   * Load Spectral system color
   */

  'loadSpectral': function (val) {

  },

  /**
   * Index of a system by name, or -1. Replaces the linear scans over
   * particleGeo.vertices that BufferGeometry makes impossible.
   */
  'findByName': function (name) {
    var i = this.nameIndex[name];
    return (i === undefined) ? -1 : i;
  },

  'getPoint': function (index) {
    return this.points[index];
  },

  /**
   * Set one point's colour: updates the metadata, the flat accumulator (so a
   * later flush doesn't lose the change) and, if a Points object already
   * exists, the live GPU-bound attribute.
   */
  'setColor': function (index, color) {
    this.particleColor[index] = color;
    if (this.points[index] !== undefined) this.points[index].color = color;
    if (this.colorValues !== null) {
      this.colorValues[index * 3] = color.r;
      this.colorValues[index * 3 + 1] = color.g;
      this.colorValues[index * 3 + 2] = color.b;
    }
    if (this.particleGeo !== null && this.particleGeo.attributes.color) {
      var attr = this.particleGeo.attributes.color;
      attr.array[index * 3] = color.r;
      attr.array[index * 3 + 1] = color.g;
      attr.array[index * 3 + 2] = color.b;
      attr.needsUpdate = true;
    }
  }

}

export { System };
