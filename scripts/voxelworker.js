importScripts('external/voxel-browser.js');
importScripts('/scripts/engine/external/three/three.js');

console.log('spawned new voxel worker');

function generateVoxels(voxeldata, x,y,z) {
  if (voxeldata[x] !== undefined &&
      voxeldata[x][y] !== undefined &&
      voxeldata[x][y][z] !== undefined) {
    return voxeldata[x][y][z] > 1;
  }
  return 0;
}
function getVoxelMesh(chunkmsg) {
  var chunkid = chunkmsg.chunkid,
      voxeldata = chunkmsg.voxeldata,
      arraybuf = chunkmsg.meshdata;
  var chunksize = chunkmsg.chunksize,
      chunkscale = chunkmsg.chunkscale,
      voxelsize = chunkmsg.voxelsize;

  //var generated = voxel.generate([0,0,0], [chunksize, chunksize, chunksize], voxel.generator['Checker']);
  //voxeldata = generated.voxels;
  var meshdata = voxel.meshers.greedy(voxeldata, [chunksize, chunksize, chunksize]);
  var counts = { 
    faces: meshdata.faces.length, 
    vertices: meshdata.vertices.length 
  };

  var geo = new THREE.BufferGeometry();

  var indexsize = counts.faces * 3 * 2,
      positionsize = counts.vertices * 3;

  var bufsize = (indexsize + positionsize + positionsize) * 4;
  if (!arraybuf || arraybuf.byteLength < bufsize) {
    // round bufsize to next power of two
    var newbufsize = Math.pow(2, Math.ceil(Math.log2(bufsize)))
    //console.log('allocate mesh buffer: ' + newbufsize + ' bytes (actual: ' + bufsize + ' bytes, prev: ' + arraybuf.byteLength + ' bytes)');
    arraybuf = new ArrayBuffer(newbufsize);
  }
  if (true) {
    var indices = new Uint32Array(arraybuf, 0, indexsize);
    var positions = new Float32Array(arraybuf, indices.byteLength, positionsize);
    var normals = new Float32Array(arraybuf, indices.byteLength + positions.byteLength, positionsize);
  } else { 
    var indices = new Uint32Array(counts.faces * 3 * 2);
    var positions = new Float32Array(counts.vertices * 3);
    var normals = new Float32Array(counts.vertices * 3);
  }

  var scale = chunkscale * voxelsize;
  for (var i = 0; i < counts.faces; i++) {
    indices[i * 6    ] = meshdata.faces[i][0];
    indices[i * 6 + 1] = meshdata.faces[i][1];
    indices[i * 6 + 2] = meshdata.faces[i][3];

    indices[i * 6 + 3] = meshdata.faces[i][1];
    indices[i * 6 + 4] = meshdata.faces[i][2];
    indices[i * 6 + 5] = meshdata.faces[i][3];
  }

  for (var i = 0; i < counts.vertices; i++) {
    positions[i * 3] = meshdata.vertices[i][0] * scale;
    positions[i * 3 + 1] = meshdata.vertices[i][1] * scale;
    positions[i * 3 + 2] = meshdata.vertices[i][2] * scale;
  }

  geo.addAttribute('index', new THREE.BufferAttribute(indices, 1)); 
  geo.addAttribute('position', new THREE.BufferAttribute(positions, 3)); 
  geo.addAttribute('normal', new THREE.BufferAttribute(normals, 3)); 
  geo.computeVertexNormals();

  return {chunkid: chunkid, counts: counts, meshdata: arraybuf};
}
onmessage = function(ev) {
  var results = getVoxelMesh(ev.data);

  /**
   * Return format: 
   * [ indices     int32[]    ]
   * [ positions   float32[]  ]
   * [ normals     float32[]  ]
   */

  postMessage(results, [results.meshdata]);
}
