import * as THREE from 'three';

var Galaxy = {


  'obj' : null,
  'infos' : null,
  'milkyway' : [],
  'previousBackdrop' : null,
  'milkyway2D' : null,
  'backActive' : true,
  'colors' : [],

  'x' : 25,
  'y' : -21,
  'z' : 25900,

  //-- Objects
  'Action' : null,

  /**
   * Remove galaxy
   */

  'remove' : function() {

    //scene.remove(this.milkyway[0]);
    //scene.remove(this.milkyway[1]);
    scene.remove(this.milkyway2D);

  },

  'addGalaxyCenter' : function () {

    // Scene coordinates (Z is negated to match Three.js convention)
    var sceneX = this.x;
    var sceneY = this.y;
    var sceneZ = -this.z;

    // this.obj is required by getHeightData() as the parent container for
    // the milkyway particle clouds — keep it as a plain Object3D.
    this.obj = new THREE.Object3D();
    this.obj.position.set(sceneX, sceneY, sceneZ);
    scene.add(this.obj);

    // Black hole sphere — depthWrite:true so it properly occludes the centre
    // of the glow sprite, producing a dark-centre / bright-ring appearance.
    var blackGeo = new THREE.SphereGeometry(1, 32, 32);
    var blackMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      depthWrite: true
    });
    var blackDisc = new THREE.Mesh(blackGeo, blackMat);
    blackDisc.position.set(sceneX, sceneY, sceneZ);
    scene.add(blackDisc);

    // Additive glow — slightly larger than the sphere so the bright-centre of
    // the texture is hidden, leaving a visible glowing ring around the void.
    var glowSprite = new THREE.Sprite(Ed3d.material.glow_2);
    glowSprite.position.set(sceneX, sceneY, sceneZ);
    glowSprite.scale.set(7.5, 7.5, 1.0);
    scene.add(glowSprite);

    this.createParticles();
    this.add2DPlane();

  },

  'createParticles' : function () {

    var img = new Image();
    var obj = this;

    img.onload = function () {

      //get height data from img
      obj.getHeightData(img, obj);


      //-- If using start animation: launch it
      if(Ed3d.startAnim) {
        camera.position.set(-10000, 40000, 50000);
        Action.moveInitalPosition(4000);
      } else {
        Action.moveInitalPositionNoAnim();
      }

    };

    //-- load img source
    img.src = Ed3d.basePath + "textures/heightmap7.jpg";

    //-- Add optional infos
    this.showGalaxyInfos();

  },

  /**
   * Add 2D image plane
   */

  'showGalaxyInfos' : function() {

    if(!Ed3d.showGalaxyInfos) return;

    this.infos = new THREE.Object3D();
    var obj = this;

    $.getJSON(Ed3d.basePath + "data/milkyway-ed.json", function(data) {

      // addText() no-ops if Ed3d.font hasn't finished loading yet (see the
      // guard inside it). Everywhere else that matters (grid coordinate
      // labels, HUD selection/hover labels) that call is repeated many times
      // over the page's life, so a missed attempt is invisible — the next
      // one succeeds once the font is ready. This one is different: the
      // quadrant/arm/gap/other labels below are only ever populated once,
      // from this single AJAX success callback. On a real page load the
      // ~63KB font (fetched via FontLoader) and this ~6KB local JSON file
      // (fetched via jQuery) are kicked off within a statement of each other
      // in Ed3d.init()/launchMap(), and the smaller file's fetch can win the
      // race — which would otherwise mean every addText() call below no-ops
      // and these labels never appear for the rest of the page's life.
      // Retrying the whole population once the font shows up avoids that.
      var fontWaits = 0;
      function populate() {
        // Bounded: if the font genuinely fails to load (404, network), give up
        // after ~5s rather than retrying every 50ms for the life of the page.
        if (!Ed3d.font) {
          if (fontWaits++ > 100) {
            console.warn('galaxy: font never loaded, skipping region labels');
            return;
          }
          setTimeout(populate, 50);
          return;
        }

        $.each(data.quadrants, function(key, val) {

          obj.addText(key,val.x,-100,val.z,val.rotate);

        });

        $.each(data.arms, function(key, val) {

          $.each(val, function(keyCh, valCh) {
            obj.addText(key,valCh.x,0,valCh.z,valCh.rotate,300,true);
          });

        });

        $.each(data.gaps, function(key, val) {

          $.each(val, function(keyCh, valCh) {
            obj.addText(key,valCh.x,0,valCh.z,valCh.rotate,160,true);
          });

        });

        $.each(data.others, function(key, val) {

          $.each(val, function(keyCh, valCh) {
            obj.addText(key,valCh.x,0,valCh.z,valCh.rotate,160,true);
          });

        });
      }

      populate();

    }).done(function() {

      scene.add(obj.infos);

    });

  },

  /**
   * Show additional galaxy infos
   */
  'infosShow' : function() {
    if(this.infos == null) this.showGalaxyInfos();
    if(this.infos !== null)  this.infos.visible = Ed3d.showGalaxyInfos;
  },

  /**
   * Show additional galaxy infos
   */
  'infosHide' : function() {
    if(this.infos !== null)  this.infos.visible = false;
  },

  /**
   * Appli opacity for Milky Way info based on distance
   */

  /**
   * Fade the backdrop back as the view widens.
   *
   * The Milky Way is ~26,000 additive sprites at size 500, and once the camera
   * pulls out it covers the whole frame — at which point the map's own systems
   * are competing with it and the clusters stop reading as clusters. Up close
   * the backdrop is context and belongs at full strength; far out it should be
   * background. Opacity is the right lever because additive blending makes it
   * directly proportional to what the sprites contribute.
   */

  'backdropUpdateCallback' : function(scale) {

    if (this.milkyway == null || !this.milkyway.length) return;

    var t = (scale - 8) / 40;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    var opacity = 1 - (0.75 * t);

    if (this.previousBackdrop === opacity) return;
    this.previousBackdrop = opacity;

    for (var i = 0; i < this.milkyway.length; i++) {
      var m = this.milkyway[i];
      if (m && m.material) m.material.opacity = opacity;
    }

    //-- The 2D galaxy floor is the other half of the wash; without it the
    //-- particles thin out but the grey stays.
    if (this.milkyway2D && this.milkyway2D.material) {
      this.milkyway2D.material.opacity = 0.4 * opacity;
    }

  },

  'infosUpdateCallback' : function(scale) {

    if(!Ed3d.showGalaxyInfos || this.infos == null) return;

    scale -= 70;

    var opacity = Math.round(scale/10)/10;
    if(opacity<0) opacity = 0;
    if(opacity>0.8) opacity = 0.8;
    // Keyed on the viewing angle as well as the scale: the camera can swing
    // from overhead to side-on without its distance changing at all, and the
    // edge-on fade below has to follow that.
    var angleKey = 0;
    if (typeof camera !== 'undefined' && camera && typeof controls !== 'undefined' && controls) {
      angleKey = Math.round(
        (Math.abs(camera.position.y - this.y) /
         Math.max(camera.position.distanceTo(controls.target), 1e-6)) * 50);
    }
    var stateKey = opacity + ':' + angleKey;
    if (this.infos.previousOpacity === stateKey) return;

    var opacityMiddle = 1.1-opacity;
    if(opacityMiddle<=0.4) opacityMiddle = 0.2;

    // Fade the labels out as the view comes level with the plane they lie on.
    // They are flat text, so edge-on every glyph collapses into sub-pixel
    // slivers and tears into a band of white dashes along the horizon — the
    // artifact the grid kept getting blamed for.
    //
    // The second band is the one that shows it: opacityMiddle is 1.1 - opacity,
    // so exactly when the normal labels have faded to nothing the "revert"
    // ones are at full strength. Zoomed in at a low angle that leaves opaque
    // flat text lying edge-on across the view.
    var edgeOn = 1;
    if (typeof camera !== 'undefined' && camera && typeof controls !== 'undefined' && controls) {
      var height = Math.abs(camera.position.y - this.y);
      var dist = Math.max(camera.position.distanceTo(controls.target), 1e-6);
      edgeOn = Math.min((height / dist) / 0.45, 1);
      edgeOn = edgeOn * edgeOn * (3 - 2 * edgeOn);          // smoothstep
    }

    // Two shared materials cover every label, so this is two assignments
    // rather than a walk over ~98 meshes.
    if (this.textMaterials !== null) {
      this.textMaterials.normal.opacity = opacity * edgeOn;
      this.textMaterials.revert.opacity = opacityMiddle * edgeOn;
    }

    this.infos.previousOpacity = stateKey;

  },

  /**
   * Add 2D image plane
   */

  'add2DPlane' : function() {

    var texloader = new THREE.TextureLoader();

    //-- Load textures
    var back2D = texloader.load(Ed3d.basePath + "textures/heightmap7.jpg");


    var floorMaterial = new THREE.MeshBasicMaterial( {
      map: back2D,
      transparent: true,
      opacity: 0.4,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    } );

    var floorGeometry = new THREE.PlaneGeometry(104000, 104000, 1, 1);
    this.milkyway2D = new THREE.Mesh(floorGeometry, floorMaterial);
    this.milkyway2D.position.set(this.x, this.y, -this.z);
    this.milkyway2D.rotation.x = -Math.PI / 2;
    this.milkyway2D.showCoord = true;

    scene.add(this.milkyway2D);

  },

  /**
   * Add Shape text
   */

  /**
   * The two materials every region label shares.
   *
   * There is one per opacity band rather than one per label: infosUpdateCallback
   * drives labels to two different opacities depending on their `revert` flag,
   * so two materials cover every case. Previously each label allocated its own
   * identical MeshBasicMaterial — ~98 of them on a galaxy — and the opacity
   * update walked all of them on every scale change. Now it sets two.
   */

  'textMaterials' : null,

  'textMaterial' : function (revert) {
    if (this.textMaterials === null) {
      var make = function () {
        return new THREE.MeshBasicMaterial({
          color: 0x999999,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        });
      };
      this.textMaterials = { normal: make(), revert: make() };
    }
    return revert ? this.textMaterials.revert : this.textMaterials.normal;
  },

  'addText' : function(textShow, x, y, z, rot, size, revert) {

    // r185 dropped THREE.FontUtils; Ed3d.font (loaded once in Ed3d.init())
    // provides the equivalent synchronous generateShapes(text, size). Guard
    // in case this runs before the async load has completed.
    if (!Ed3d.font) return;

    if(revert==undefined) revert = false;
    if(size==undefined) size = 450;
    textShow = textShow.toUpperCase();

    var textShapes = Ed3d.font.generateShapes(textShow, size);

    var textGeo = new THREE.ShapeGeometry(textShapes);

    var textMesh = new THREE.Mesh(textGeo, Galaxy.textMaterial(revert));

    //x -= Math.round(textShow.length*400/2);
    var middleTxt = Math.round(size/2);
    z -= middleTxt;

    textMesh.rotation.x = -Math.PI / 2;
    // r185 renamed BufferGeometry.applyMatrix to applyMatrix4 (the old name
    // is gone, not just deprecated).
    textMesh.geometry.applyMatrix4( new THREE.Matrix4().makeTranslation(-Math.round(textShow.length*size/2), 0, -middleTxt) );
    if(rot != 0) {
      textMesh.rotateOnAxis (new THREE.Vector3( 0, 0, 1 ), Math.PI * (rot) / 180);
    }
    textMesh.position.set(x, y, -z);

    textMesh.revert = revert;

    this.infos.add(textMesh);

  },

  /**
   * Create a particle cloud milkyway from an image
   *
   * @param  {Image} img - Image object
   */

  'getHeightData' : function(img, obj) {

    var particleVerts = [];
    var particleColorVerts = [];
    var particlesBigVerts = [];
    var particlesBigColorVerts = [];

    //-- Get pixels from milkyway image

    var canvas = document.createElement( 'canvas' );
    canvas.width = img.width;
    canvas.height = img.height;
    var context = canvas.getContext( '2d' );

    var size = img.width * img.height;

    context.drawImage(img,0,0);

    var imgd = context.getImageData(0, 0, img.width, img.height);
    var pix = imgd.data;

    //-- Build galaxy from image data

    var j=0;
    var min = 8;
    var nb = 0;
    var maxDensity = 15;

    //var scaleImg = 16.4;
    var scaleImg = 21;

    var colorsBig = [];
    var nbBig = 0;

    for (var i = 0; i<pix.length; i += 20) {

      if(Math.random() > 0.5) i += 8;


      var all = pix[i]+pix[i+1]+pix[i+2];

      var avg = Math.round((pix[i]+pix[i+1]+pix[i+2])/3);

      if(avg>min) {

        var x = scaleImg*((i / 4) % img.width);
        var z = scaleImg*(Math.floor((i / 4) / img.height));

        var density = Math.floor((pix[i]-min)/10);
        if(density>maxDensity) density = maxDensity;

        var add = Math.ceil(density/maxDensity*2);
        for (var y = -density; y < density; y = y+add) {

          var px = x+((Math.random()-0.5) * 25);
          var py = (y*10)+((Math.random()-0.5) * 50);
          var pz = z+((Math.random()-0.5) * 25);

          //-- Particle color from pixel

          var r = Math.round(pix[i]);
          var g = Math.round(pix[i+1]);
          var b = Math.round(pix[i+2]);


          //-- Big particle

          if(density>=2 && Math.abs(y)-1==0 &&  Math.random() * 1000 < 200) {
            particlesBigVerts.push(px, py, pz);
            var colorBig = new THREE.Color("rgb("+r+", "+g+", "+b+")");
            colorsBig[nbBig] = colorBig;
            particlesBigColorVerts.push(colorBig.r, colorBig.g, colorBig.b);
            nbBig++;

          //-- Small particle

          } else if(density<4 || (Math.random() * 1000 < 400-(density*2))) {
            particleVerts.push(px, py, pz);
            var color = new THREE.Color("rgb("+r+", "+g+", "+b+")");
            obj.colors[nb] = color;
            particleColorVerts.push(color.r, color.g, color.b);
            nb++;
          }
        };
      }
    }

    //-- Create small particles milkyway

    var particles = new THREE.BufferGeometry();
    particles.setAttribute('position', new THREE.BufferAttribute(new Float32Array(particleVerts), 3));
    particles.setAttribute('color', new THREE.BufferAttribute(new Float32Array(particleColorVerts), 3));

    var particleMaterial = new THREE.PointsMaterial({
      map: Ed3d.textures.flare_yellow,
      transparent: true,
      size: 64,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    var points = new THREE.Points(particles, particleMaterial);
    particles.center();

    obj.milkyway[0] = points;
    obj.milkyway[0].scale.set(20,20,20);

    obj.obj.add(points);


    //-- Create big particles milkyway

    var particlesBig = new THREE.BufferGeometry();
    particlesBig.setAttribute('position', new THREE.BufferAttribute(new Float32Array(particlesBigVerts), 3));
    particlesBig.setAttribute('color', new THREE.BufferAttribute(new Float32Array(particlesBigColorVerts), 3));

    var particleMaterialBig = new THREE.PointsMaterial({
      map: Ed3d.textures.flare_yellow,
      transparent: true,
      vertexColors: true,
      size: 16,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false
    });

    var pointsBig = new THREE.Points(particlesBig, particleMaterialBig);
    particlesBig.center();

    obj.milkyway[1] = pointsBig;
    obj.milkyway[1].scale.set(20,20,20);

    obj.obj.add(pointsBig);
  }

}

export { Galaxy };
