import * as THREE from 'three';

var Grid = {

  'obj' : null,
  'size' : null,

  'textShapes' : null,
  'textGeo'    : null,

  'coordTxt'   : null,

  'minDistView' : null,

  'visible' : true,

  'fixed' : false,

  /**
   * Create 2 base grid scaled on Elite: Dangerous grid
   */

  'init' : function(size, color, minDistView) {

    this.size = size;

    // Drawn in a fragment shader on a single quad rather than as line geometry.
    //
    // GridHelper builds real lines: at the 100 ly spacing that is 20,000
    // divisions, ~80,000 vertices, and the two grids together were 40% of the
    // frame. Worse, line geometry has no anti-aliasing — once the lines fall
    // below a pixel apart they alias into the moiré that shows up when the grid
    // is toggled or the camera moves.
    //
    // A shader solves both. Line coverage is computed analytically from the
    // world position, using screen-space derivatives (fwidth) so a line is
    // always exactly one pixel wide however far away it is, and fades out
    // smoothly instead of aliasing once the spacing gets tight. Two triangles
    // instead of 80,000 line segments.
    var extent = 1000000 * 2;

    var material = new THREE.ShaderMaterial({
      uniforms: {
        uSize:  { value: size },
        uColor: { value: new THREE.Color(color) },
        // Distance over which lines fade to nothing. Scaled off the spacing so
        // the fine grid disappears before it can turn into a haze, while the
        // coarse one stays visible much further out.
        uFade:  { value: size * 900 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: [
        'varying vec3 vWorld;',
        'void main() {',
        '  vec4 wp = modelMatrix * vec4(position, 1.0);',
        '  vWorld = wp.xyz;',
        '  gl_Position = projectionMatrix * viewMatrix * wp;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform float uSize;',
        'uniform vec3  uColor;',
        'uniform float uFade;',
        'varying vec3 vWorld;',
        'void main() {',
        // Grid coordinates in units of one cell. Lines sit on the integers.
        '  vec2 c = vWorld.xz / uSize;',
        // Distance to the nearest line, divided by how much c changes across
        // one pixel: the result is "pixels from the line", so the line keeps a
        // constant on-screen width at any zoom.
        '  vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);',
        '  float a = 1.0 - min(min(g.x, g.y), 1.0);',
        '  if (a <= 0.002) discard;',
        '  float d = distance(cameraPosition, vWorld);',
        '  a *= 1.0 - smoothstep(uFade * 0.25, uFade, d);',
        '  if (a <= 0.002) discard;',
        '  gl_FragColor = vec4(uColor, a);',
        '}'
      ].join('\n')
    });

    this.obj = new THREE.Mesh(new THREE.PlaneGeometry(extent, extent), material);
    this.obj.rotation.x = -Math.PI / 2;
    // The quad is enormous and always under the camera; culling it by its
    // bounding sphere only ever gets it wrong.
    this.obj.frustumCulled = false;
    this.obj.minDistView = minDistView;

    scene.add(this.obj);

    this.obj.customUpdateCallback = this.addCoords;


    return this;
  },

  /**
   * Create 2 base grid scaled on Elite: Dangerous grid
   */

  'infos' : function(step, color, minDistView) {

    var size = 50000;
    if(step== undefined) step = 10000;
    this.fixed = true;

    //-- Add global grid

    var gridVerts = [];
    var material = new THREE.LineBasicMaterial( {
      color: 0x555555,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    } );

    for ( var i = - size; i <= size; i += step ) {

        gridVerts.push( - size, 0, i );
        gridVerts.push(   size, 0, i );

        gridVerts.push( i, 0, - size );
        gridVerts.push( i, 0,   size );

    }

    var geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gridVerts), 3));

    this.obj = new THREE.LineSegments( geometry, material );
    this.obj.position.set(0,0,-20000);

    //-- Add quadrant

    var quadrantVerts = [];
    var material = new THREE.LineBasicMaterial( {
      color: 0x888888,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    } );

    quadrantVerts.push( - size, 0, 20000 );
    quadrantVerts.push(   size, 0, 20000 );

    quadrantVerts.push( 0, 0, - size );
    quadrantVerts.push( 0, 0,   size );

    var quadrant = new THREE.BufferGeometry();
    quadrant.setAttribute('position', new THREE.BufferAttribute(new Float32Array(quadrantVerts), 3));
    var quadrantL = new THREE.LineSegments( quadrant, material );


    this.obj.add(quadrantL);


    //-- Add grid to the scene

    scene.add(this.obj);

    return this;
  },

  'addCoords' : function() {

    // r185 dropped THREE.FontUtils; Ed3d.font (a FontLoader result loaded
    // once in Ed3d.init()) provides the equivalent synchronous
    // generateShapes(text, size). Guard in case this runs before the async
    // load has completed.
    if (!Ed3d.font) return;

    var textShow = '0 : 0 : 0';
    var textSize = this.size/20;

    if(this.coordGrid != null) {

      if(
        Math.abs(camera.position.y-this.obj.position.y)>this.size*10
        || Math.abs(camera.position.y-this.obj.position.y) < this.obj.minDistView
      ) {
        this.coordGrid.visible = false;
        return;
      }
      this.coordGrid.visible = true;

      var posX = Math.ceil(controls.target.x/this.size)*this.size;
      var posZ = Math.ceil(controls.target.z/this.size)*this.size;

      var textCoords = posX+' : '+this.obj.position.y+' : '+(-posZ);

      //-- If same coords as previously, return.
      if(this.coordTxt == textCoords) return;
      this.coordTxt = textCoords;

      //-- Generate a new text shape

      this.textShapes = Ed3d.font.generateShapes(this.coordTxt, textSize);
      this.textGeo.dispose();
      this.textGeo = new THREE.ShapeGeometry(this.textShapes);

      var center = this.textGeo.center();
      this.coordGrid.position.set(center.x+posX-(this.size/100), this.obj.position.y, center.z+posZ+(this.size/30));


      this.coordGrid.geometry = this.textGeo;
      this.coordGrid.geometry.needsUpdate = true;

    } else {

      this.textShapes = Ed3d.font.generateShapes(textShow, textSize);
      this.textGeo = new THREE.ShapeGeometry(this.textShapes);
      this.coordGrid = new THREE.Mesh(this.textGeo, Ed3d.material.darkblue);
      this.coordGrid.position.set(this.obj.position.x, this.obj.position.y, this.obj.position.z);
      this.coordGrid.rotation.x = -Math.PI / 2;

      scene.add(this.coordGrid);

    }

  },

  /**
   * Toggle grid view
   */
  'toggleGrid' : function() {

    this.visible = !this.visible;

    if(this.size < 10000 && isFarView) return;
    this.obj.visible = this.visible;

  },

  /**
   * Show grid
   */
  'show' : function() {

    if(!this.visible) return;

    this.obj.visible = true;

  },

  /**
   * Hide grid
   */
  'hide' : function() {

    this.obj.visible = false;

  }

}


export { Grid };
