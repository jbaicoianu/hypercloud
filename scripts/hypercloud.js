elation.require(['engine.engine', 'engine.things.player', 'hypercloud.external.voxel-browser'], function() {
  elation.component.add('hypercloud', function() {
    this.initWorld = function() {
      this.name = this.args.name || 'default';
      this.panel = elation.ui.panel({append: document.body, classname: 'hypercloud_panel'});

      this.root = this.world.spawn('generic', 'default');
      this.pointsource = this.root.spawn('pointcloudsource', this.name, { position: [ 0, 0, 0], physical: false });

      this.world.setClearColor(0x333333, 1);
      this.world.setFogExp(0.03, 0x333333);

      this.player = this.root.spawn('player', 'player', { position: [0,0,2], mass: 20, radius: .5, height: 0 });
      this.view.setactivething(this.player);
      this.player.enable();
      this.sun = this.root.spawn('light', 'sun', { position: [50,50,27], type: "directional"});
      this.pointlight = this.player.spawn('light', 'pointlight', { position: [0,0,0], type: "point"});

      var savelink = elation.html.create({tag: 'button', append: this.panel});
      savelink.href = "#";
      savelink.innerHTML = "Export";
      elation.events.add(savelink, 'click', elation.bind(this.pointsource, this.pointsource.export, "default"));

      var clearlink = elation.html.create({tag: 'button', append: this.panel});
      clearlink.href = "#";
      clearlink.innerHTML = "Clear";
      elation.events.add(clearlink, 'click', elation.bind(this.pointsource, this.pointsource.clear));

      var voxellink = elation.html.create({tag: 'button', append: this.panel});
      voxellink.href = "#";
      voxellink.innerHTML = "Toggle Voxels";
      elation.events.add(voxellink, 'click', elation.bind(this.pointsource, this.pointsource.toggleVoxels, true));

      var logo = elation.html.create({tag: 'div', classname: 'hypercloud_logo', append: document.body});
      logolabel = elation.html.create({tag: 'h1', append: logo});
      logolabel.innerHTML = 'hypercloud.cool';
    } 
  }, elation.engine.client);


  elation.component.add('engine.things.pointcloudsource', function() {
    this.epsilon = 1e-8;

    this.postinit = function() {
      this.defineProperties({
        points: { type: 'int', default: 25000 },
        //host: { type: 'string', default: '192.168.42.187' },
        host: { type: 'string', default: window.location.host },
        port: { type: 'int', default: 9918 },
        voxelsize: { type: 'float', default: .01 },
        chunksize: { type: 'int', default: 32 },
        chunkscale: { type: 'float', default: 1 },
      });

      this.voxelchunks = {};
      this.pendingchunks = {};
      this.pendingchunklist = [];
      this.showvoxels = true;

      this.chunkers = [];
      this.activechunkers = [];

      this.addChunkers(4);

      //this.ws = new WebSocket("ws://" + this.properties.host + ":" +  this.properties.port);
      this.ws = {};
      elation.events.add(this.ws, 'message', elation.bind(this, this.handleMessage));

      this.tmpvec = new THREE.Vector3();
      this.tmpmat = new THREE.Matrix4();
      this.tmprot = new THREE.Euler();

      this.controlstate = this.engine.systems.controls.addContext('pointcloudsource', {
        'clear_points': ['keyboard_f,gamepad_0_button_1', elation.bind(this, this.clearPoints)],
        'clear_voxels': ['keyboard_v,gamepad_0_button_2', elation.bind(this, this.clearVoxels)],
        'toggle_voxels': ['keyboard_shift_v', elation.bind(this, this.toggleVoxels)]
      });
      this.engine.systems.controls.activateContext('pointcloudsource');
    }
    this.createObject3D = function() {
      var geometry = new THREE.BufferGeometry();
      var positions = new Float32Array(this.properties.points * 3);
      var colors = new Float32Array(this.properties.points * 3);
      var sizes = new Float32Array(this.properties.points);

      geometry.addAttribute( 'position', new THREE.BufferAttribute( positions, 3 ) );
      geometry.addAttribute( 'customColor', new THREE.BufferAttribute( colors, 3 ) );
      geometry.addAttribute( 'size', new THREE.BufferAttribute( sizes, 1 ) );

      //var material = new THREE.PointCloudMaterial({color: 0xaaaa66, transparent: false, opacity: .7, size: .25});
      var material = elation.engine.materials.getShaderMaterial('hypercloud_pointcloud');
      material.uniforms.color.value.setHex(0xff0000);
      material.transparent = true;
      //material.blending = THREE.MultiplyBlending;
      material.alphaTest = 0.5;
      material.depthTest = true;

      var particlesystem = new THREE.PointCloud(geometry, material);

      this.geometry = geometry;
      this.material = material;
      this.positions = positions;
      this.colors = colors;
      this.sizes = sizes;

      this.pointoffset = 0;

      this.tango = new THREE.PerspectiveCamera(38.1762, 4/3, 0.75, .7501);
      particlesystem.add(this.tango);
      particlesystem.add(new THREE.CameraHelper(this.tango));

      var gridhelper = new THREE.GridHelper(20, 1);
      particlesystem.add(gridhelper);
      gridhelper.position.y = -5;

      this.clearPoints();

      return particlesystem;
    }
    this.handleMessage = function(ev) {
      var message = JSON.parse(ev.data);
      //console.log('message for you sir!', message);

      if (message.type == 'tango_intro') {
        //console.log('NEW TANGO GUY', message);
        this.clearPoints();
        this.clearVoxels();
      } else if (message.type == 'tango_pose') {
        this.updateTangoPose(message.translation, message.orientation);
      } else if (message.type == 'tango_points') {
        this.updateTangoPose(message.translation, message.orientation);
        this.updateTangoPoints(message.pointdata, message.colordata);

      } else if (message.type == 'tango_clear') {
        this.clearPoints();
        this.clearVoxels();
      }
    }
    this.clearPoints = function(ev) {
      if (typeof ev == 'undefined' || ev.value == 1) {
        var reallyfar = 1 / this.epsilon;
        for (var i = 0; i < this.properties.points; i++) {
          this.positions[i * 3] = reallyfar * (Math.random() < .5 ? -1 : 1);
          this.positions[i * 3 + 1] = reallyfar * (Math.random() < .5 ? -1 : 1);
          this.positions[i * 3 + 2] = reallyfar * (Math.random() < .5 ? -1 : 1);
        }
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.computeBoundingSphere();
        this.refresh();
      }
    }
    this.updateTangoPose = function(pos, orient) {
      this.tango.position.set(pos[0], pos[1], pos[2]);
      //this.tango.quaternion.set(orient[0], orient[1], orient[2], orient[3]);

      this.tango.quaternion.setFromEuler(new THREE.Euler(-Math.PI/2, 0, 0));
      var q = new THREE.Quaternion().set(orient[0], orient[1], orient[2], orient[3]);
      this.tango.quaternion.multiply(q);

      this.tango.updateMatrix();
      this.tango.updateMatrixWorld();
      this.refresh();
    }
    this.updateTangoPoints = function(points, colors) {
      var scale = 1;
      var tmpvec = this.tmpvec;
      var tmpmat = this.tmpmat;
      var tmprot = this.tmprot;

      /*
      tmprot.x = this.tango.rotation.x;
      tmprot.y = -this.tango.rotation.y;
      tmprot.z = -this.tango.rotation.z;

      tmpmat.makeRotationFromEuler(tmprot);
      */
      //tmpmat.copyPosition(this.tango.matrixWorldInverse);
      //tmprot.z = -Math.PI/2;
      tmpmat.makeRotationFromEuler(tmprot);

      //tmpmat.copy(this.tango.matrixWorld);

      var updatedchunks = [];
      for (var i = 0; i < points.length; i++) {
        var idx = (this.pointoffset + i) % this.properties.points;
        tmpvec.set(points[i][0], points[i][1], points[i][2]).multiplyScalar(scale);
        tmpvec.applyMatrix4(tmpmat);
        
        var offset = idx * 3;
        this.positions[offset] = tmpvec.x * 1;
        this.positions[offset + 1] = tmpvec.y * 1;
        this.positions[offset + 2] = tmpvec.z * 1;
        this.colors[offset] = colors[i][0] / 256;
        this.colors[offset+1] = colors[i][1] / 256;
        this.colors[offset+2] = colors[i][2] / 256;

        this.sizes[idx] = 0.20;


        var voxeldata = this.pointToVoxel(tmpvec);
        var chunkid = voxeldata[0].join(',');
        var chunk = this.getChunk(chunkid);
        chunk.setVoxel(voxeldata[1], 1);
      }
      this.pointoffset = (this.pointoffset + points.length) % this.properties.points;
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.customColor.needsUpdate = true;
      this.geometry.attributes.size.needsUpdate = true;
      //this.geometry.computeBoundingSphere();
    }
    this.clear = function() {
      this.clearVoxels();
      this.clearPoints();
    }
    this.clearVoxels = function(ev) {
      if (typeof ev == 'undefined' || ev.value == 1) {
        var chunks = Object.keys(this.voxelchunks);
        for (var i = 0; i < chunks.length; i++) {
          var chunkname = chunks[i];
          this.voxelchunks[chunkname].clear();
        }
        this.refresh();
      }
    }
    this.toggleVoxels = function(ev) {
      if (!ev || ev === true || ev.value == 1) {
        this.showvoxels = !this.showvoxels;
        for (var k in this.voxelchunks) {
          this.voxelchunks[k].setVisibility(this.showvoxels);
        }
      }
    }
    this.filterPoints = function() {
      var points = [];
      var reallyfar = 1 / this.epsilon;
      for (var i = 0; i < this.properties.points; i++) {
        var p = [this.positions[i * 3], this.positions[i * 3 + 1], this.positions[i * 3 + 2]];
        if (!(Math.abs(p[0]) == reallyfar && Math.abs(p[1]) == reallyfar && Math.abs(p[2]) == reallyfar)) {
          points.push(p);
        }
      }
      return points;
    }
    this.export = function(filename, ev) {
      var points = this.filterPoints();

      var fileout = [
        "ply",
        "format ascii 1.0",
        "element vertex " + points.length,
        "property float x",
        "property float y",
        "property float z",
/*
        "property float nx",
        "property float ny",
        "property float nz",
        "property float intensity",
        "property uchar diffuse_red",
        "property uchar diffuse_green",
        "property uchar diffuse_blue",
*/
        "end_header",
        ""
      ].join("\n");

      for (var i = 0; i < points.length; i++) {
        fileout += points[i].join(" ") + "\n";
      }

      var foo = new Blob([fileout], {type: 'application/octet-stream'});
      var link = window.URL.createObjectURL(foo);
      
      var filename = prompt("Scene name?", "default");
      var a = ev.target;
      a.href = link;
      a.download = filename + ".ply";
    }
    this.pointToVoxel = function(point) {
      var voxelsize = this.properties.voxelsize,
          chunksize = this.properties.chunksize
      var chunk = [
        Math.floor(point.x / (voxelsize * chunksize)),
        Math.floor(point.y / (voxelsize * chunksize)),
        Math.floor(point.z / (voxelsize * chunksize))
      ];
      var voxel = [
        Math.floor(point.x / voxelsize) % chunksize,
        Math.floor(point.y / voxelsize) % chunksize,
        Math.floor(point.z / voxelsize) % chunksize
      ];
      if (voxel[0] < 0) voxel[0] += chunksize;
      if (voxel[1] < 0) voxel[1] += chunksize;
      if (voxel[2] < 0) voxel[2] += chunksize;
      return [chunk, voxel];
    }
    this.getChunk = function(chunk) {
      var chunkid = chunk;
      if (elation.utils.isArray(chunk)) {
        chunkid = chunk.join(',');
      } else {
        chunk = chunkid.split(',');
      }

      if (!this.voxelchunks[chunkid]) {
        var chunksize = this.properties.chunksize,
            voxelsize = this.properties.voxelsize,
            chunkscale = this.properties.chunkscale;
        var chunkpos = [
          chunk[0] * chunksize * voxelsize * chunkscale,
          chunk[1] * chunksize * voxelsize * chunkscale,
          chunk[2] * chunksize * voxelsize * chunkscale
        ];
        this.voxelchunks[chunkid] = this.spawn('hypercloud_voxel_chunk', 'voxelchunk_' + chunkid, { 
          position: chunkpos,
          chunkid: chunkid,
          chunksize: chunksize,
          chunkscale: chunkscale,
          voxelsize: voxelsize,
          visible: this.showvoxels
        });
        elation.events.add(this.voxelchunks[chunkid], 'chunk_change', elation.bind(this, this.chunk_change));
      }
      return this.voxelchunks[chunkid];
    }
    this.addChunkers = function(num) {
      if (!num) num = 1;
      for (var i = 0; i < num; i++) {
        var chunker = new Worker('/scripts/hypercloud/voxelworker.js');
        elation.events.add(chunker, 'message', elation.bind(this, this.chunk_complete));
        this.chunkers.push(chunker);
      }
    }
    this.getFreeChunker = function() {
      if (this.chunkers.length > 0) {
        var chunker = this.chunkers.pop();
        this.activechunkers.push(chunker);
        return chunker;
      }
      return false;
    }
    this.startChunking = function() {
      if (this.pendingchunklist.length > 0 && this.chunkers.length > 0) {
        // Get the next pending chunk from pendingchunk list, but don't remove it from the pendingchunk map until it's done processing
        var chunkid = this.pendingchunklist.shift();
        var chunk = this.getChunk(chunkid);
        var chunker = this.getFreeChunker();
        if (chunker) {
          //console.log('do a chunk', [chunkid, chunk.properties.chunksize, chunk.voxeldata]);
          var chunkmsg = {
            chunkid: chunkid,
            chunksize: chunk.properties.chunksize,
            chunkscale: chunk.properties.chunkscale,
            voxelsize: chunk.properties.voxelsize,
            voxeldata: chunk.voxeldata,
            meshdata: chunk.prevmeshdata
          };
          //chunker.postMessage([chunkid, [chunk.properties.chunksize, chunk.properties.chunkscale, chunk.properties.voxelsize],  chunk.voxeldata]); 
          chunker.postMessage(chunkmsg, [chunkmsg.meshdata]);
        }
      }
    }
    this.chunk_change = function(ev) {
      //console.log('chunk changed@', ev);
      var chunk = ev.target;
      if (!this.pendingchunks[chunk.chunkid]) {
        this.pendingchunks[chunk.chunkid] = chunk;
        this.pendingchunklist.push(chunk.chunkid);

        this.startChunking();
      }
    }
    this.chunk_complete = function(ev) {
      var result = ev.data;
      var chunkid = result.chunkid;
      var chunk = this.getChunk(chunkid);
      chunk.setMeshData(result.counts, result.meshdata);
      delete this.pendingchunks[chunkid];

      var chunker = ev.target;
      this.activechunkers.splice(this.activechunkers.indexOf(chunker), 1);
      this.chunkers.push(chunker);
      setTimeout(elation.bind(this, this.startChunking), 100);
    }
  }, elation.engine.things.generic);

  elation.component.add('engine.things.hypercloud_voxel_chunk', function() {
    this.postinit = function() {
      this.defineProperties({
        chunkid: { type: 'string', default: '0,0,0' },
        chunksize: { type: 'int', default: 32 },
        chunkscale: { type: 'float', default: 0.1 },
        voxelsize: { type: 'float', default: 0.1 },
        visible: { type: 'bool', default: true },
      });

      this.allocateBuffers();
      this.chunkid = this.properties.chunkid;
      this.voxeldata = new Int32Array(Math.pow(this.properties.chunksize, 3));
      this.setVisibility(this.properties.visible);
    }
    this.allocateBuffers = function() {
      // create a double buffer so we can make full use of Transferrable ArrayBuffers
      this.prevmeshdata = new ArrayBuffer(0);
      this.meshdata = new ArrayBuffer(0);
    }
    this.createObject3D = function() {
      this.geometry = new THREE.BufferGeometry();

      // FIXME - I don't think these sizes are right
      this.maxverts = 1; //Math.pow(this.properties.chunksize, 3);
      this.indices = new Uint32Array(this.maxverts * 6);
      this.positions = new Float32Array(this.maxverts * 3);
      this.normals = new Float32Array(this.maxverts * 3);

      var size = this.properties.chunkscale * this.properties.voxelsize * this.properties.chunksize;
      var diagonal1 = Math.sqrt(size*size * 2);
      var diagonal2 = Math.sqrt(size*size + diagonal1*diagonal1);

      this.geometry.addAttribute('index', new THREE.BufferAttribute(this.indices, 1)); 
      this.geometry.addAttribute('position', new THREE.BufferAttribute(this.positions, 3)); 
      this.geometry.addAttribute('normal', new THREE.BufferAttribute(this.normals, 3)); 
      this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(size/2, size/2, size/2), diagonal2 / 2);

      //return new THREE.Mesh(this.geometry, new THREE.MeshPhongMaterial({color: 0x999999 + 0x333333 * Math.random()}));
      var mesh = new THREE.Mesh(this.geometry, new THREE.MeshPhongMaterial({color: 0xdddddd}));
      mesh.visible = this.properties.visible;;
      return mesh;
    }
    this.setMeshData = function(counts, meshdata) {
      var geo = this.geometry;

      var indices = new Uint32Array(meshdata, 0, counts.faces * 3 * 2);
          positions = new Float32Array(meshdata, indices.byteLength, counts.vertices * 3);
          normals = new Float32Array(meshdata, indices.byteLength + positions.byteLength, counts.vertices * 3);

      if (indices.length != this.geometry.attributes.index.array.length) {
        this.geometry.addAttribute('index', new THREE.BufferAttribute(indices, 1));
        this.geometry.addAttribute('position', new THREE.BufferAttribute(positions, 3)); 
        this.geometry.addAttribute('normal', new THREE.BufferAttribute(normals, 3)); 
      } else {
        this.geometry.attributes.index.array = indices;
        this.geometry.attributes.position.array = positions;
        this.geometry.attributes.normal.array = normals;

        this.geometry.attributes.index.needsUpdate = true;
        this.geometry.attributes.position.needsUpdate = true;
        this.geometry.attributes.normal.needsUpdate = true;
      }
      this.prevmeshdata = this.meshdata;
      this.meshdata = meshdata;
    }
    this.update = function() {

    }
    this.setVoxel = function(voxel, state) {
      var chunksize = this.properties.chunksize;
      var voxelid = ((voxel[2] * chunksize) + voxel[1]) * chunksize + voxel[0];
      this.voxeldata[voxelid]++;
      elation.events.fire({element: this, type: 'chunk_change'});
    }
    this.clear = function() {
      for (var i = 0; i < this.voxeldata.length; i++) {
        this.voxeldata[i] = 0;
      }
      this.setMeshData({faces: 0, vertices: 0}, new ArrayBuffer(0));
      //elation.events.fire({element: this, type: 'chunk_change'});
    }
    this.setVisibility = function(visible) {
      if (visible === undefined) visible = !this.objects['3d'].visible;
      if (this.objects['3d']) this.objects['3d'].visible = visible;
      this.visible = visible;
    }
  }, elation.engine.things.generic);

  elation.engine.materials.addChunk('hypercloud_pointcloud', {
    uniforms: {
      color:     { type: "c", value: new THREE.Color( 0xffffff ) },
      //texture:   { type: "t", value: THREE.ImageUtils.loadTexture( "/images/hypercloud/spark1.png" ) }
    },
    attributes: {
      size:        { type: 'f', value: null },
      customColor: { type: 'c', value: null }
    },

    common_pars: [
    ].join('\n'),

    vertex_pars: [
      'attribute float size;',
      'attribute vec3 customColor;',
      'varying vec3 vColor;',
      'varying vec3 vNormal;',
    ].join('\n'),

    vertex: [
      'vColor = customColor;',
      'vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
      'gl_PointSize = size * ( 100.0 / length( mvPosition.xyz ) );',
      'vNormal = vec3(0,1,0);',
      'gl_Position = projectionMatrix * mvPosition;',
    ].join('\n'),

    fragment_pars: [
      'uniform vec3 color;',
      //'uniform sampler2D texture;',
      'varying vec3 vColor;',
      'varying vec3 vNormal;',
    ].join('\n'),

    fragment: [
      'vec2 foo = (gl_PointCoord * 2.0) - vec2(1.0);',
      'gl_FragColor = vec4( color + vColor, 1.0 - sqrt(foo.x * foo.x + foo.y * foo.y) );',
      //'gl_FragColor = vec4( vNormal + vColor, 1.0 - sqrt(foo.x * foo.x + foo.y * foo.y) );',
      //'gl_FragColor = gl_FragColor * texture2D( texture, gl_PointCoord );'
    ].join('\n'),
  });
  elation.engine.materials.buildShader("hypercloud_pointcloud", {
    attributes: [
      'hypercloud_pointcloud'
    ],
    uniforms: [
      'hypercloud_pointcloud'
    ],
    chunks_vertex: [
      'hypercloud_pointcloud',
    ],
    chunks_fragment: [
      'hypercloud_pointcloud',
    ]
  });
});
