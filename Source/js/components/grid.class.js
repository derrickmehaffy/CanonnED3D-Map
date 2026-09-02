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

    // r75: GridHelper(halfExtent, stepInWorldUnits) drew a grid spanning
    // +/-1,000,000 with a line every `size` world units, coloured after the
    // fact via setColors(). r185: GridHelper(fullExtent, divisions,
    // colorCenterLine, colorGrid) takes the FULL extent and a division
    // count, and setColors() no longer exists — colour is constructor-only.
    // To reproduce the same line spacing: full extent is the old half-extent
    // doubled, and divisions is extent / size (one division per `size`
    // units, same as before).
    var extent = 1000000 * 2;
    this.obj = new THREE.GridHelper(extent, extent / size, color, color);
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
