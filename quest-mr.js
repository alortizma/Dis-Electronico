
/* =========================================================
   PROYECTO CAFECITO — Modo Mixed Reality para Meta Quest
   Motor WebXR: muestra la cámara real (passthrough) con
   plantas de café 3D alrededor del jugador. Escaneo con la
   mirada y panel flotante con los botones del mando.
   → <script src="quest-mr.js" defer> (se carga después del juego)
   ========================================================= */
(function () {
'use strict';

/* ---------- utilidades ---------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const rint = (a, b) => Math.floor(rand(a, b + 1));
const norm = (v) => { const d = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / d, v[1] / d, v[2] / d]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/* ---------- matrices 4×4 (column-major, estilo WebGL) ---------- */
const M4 = {
  ident(o) { o.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); return o; },
  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    o.set([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0]);
    return o;
  },
  mul(o, a, b) {
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
      }
    }
    return o;
  },
  /* segura para o === m */
  trans(o, m, x, y, z) {
    o.set(m);
    o[12] = m[0] * x + m[4] * y + m[8] * z + m[12];
    o[13] = m[1] * x + m[5] * y + m[9] * z + m[13];
    o[14] = m[2] * x + m[6] * y + m[10] * z + m[14];
    o[15] = m[3] * x + m[7] * y + m[11] * z + m[15];
    return o;
  },
  rotY(o, m, rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    const r = M4.ident(new Float32Array(16));
    r[0] = c; r[2] = -s; r[8] = s; r[10] = c;
    const t = new Float32Array(16);
    M4.mul(t, r, m);
    o.set(t);
    return o;
  },
  rotX(o, m, rad) {
    const c = Math.cos(rad), s = Math.sin(rad);
    const r = M4.ident(new Float32Array(16));
    r[5] = c; r[6] = s; r[9] = -s; r[10] = c;
    const t = new Float32Array(16);
    M4.mul(t, r, m);
    o.set(t);
    return o;
  },
  scl(o, m, sx, sy, sz) {
    o.set(m);
    o[0] *= sx; o[1] *= sx; o[2] *= sx; o[3] *= sx;
    o[4] *= sy; o[5] *= sy; o[6] *= sy; o[7] *= sy;
    o[8] *= sz; o[9] *= sz; o[10] *= sz; o[11] *= sz;
    return o;
  },
  /* billboard: orientar un plano en `pos` de cara a `eye` */
  face(o, pos, eye) {
    let dx = eye[0] - pos[0], dy = eye[1] - pos[1], dz = eye[2] - pos[2];
    const d = Math.hypot(dx, dy, dz) || 1;
    dx /= d; dy /= d; dz /= d;
    let ax = dz, ay = 0, az = -dx;               /* cross((0,1,0), zAxis) */
    const al = Math.hypot(ax, ay, az) || 1;
    ax /= al; az /= al;
    const bx = dy * az - dz * ay, by = dz * ax - dx * az, bz = dx * ay - dy * ax;
    o[0] = ax; o[1] = ay; o[2] = az;
    o[4] = bx; o[5] = by; o[6] = bz;
    o[8] = dx; o[9] = dy; o[10] = dz;
    o[3] = 0; o[7] = 0; o[11] = 0;
    o[12] = pos[0]; o[13] = pos[1]; o[14] = pos[2]; o[15] = 1;
    return o;
  }
};
const _m1 = new Float32Array(16);

/* ---------- cuaterniones (para rotaciones de la cabeza / mando) ---------- */
function quatFromMat(m) {
  const t = m[0] + m[5] + m[10];
  let x, y, z, w;
  if (t > 0) {
    const s = 0.5 / Math.sqrt(t + 1.0);
    w = 0.25 / s;
    x = (m[6] - m[9]) * s;
    y = (m[8] - m[2]) * s;
    z = (m[1] - m[4]) * s;
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = 2 * Math.sqrt(1.0 + m[0] - m[5] - m[10]);
    w = (m[6] - m[9]) / s; x = 0.25 * s;
    y = (m[1] + m[4]) / s; z = (m[2] + m[8]) / s;
  } else if (m[5] > m[10]) {
    const s = 2 * Math.sqrt(1.0 + m[5] - m[0] - m[10]);
    w = (m[8] - m[2]) / s;
    x = (m[1] + m[4]) / s; y = 0.25 * s; z = (m[6] + m[9]) / s;
  } else {
    const s = 2 * Math.sqrt(1.0 + m[10] - m[0] - m[5]);
    w = (m[1] - m[4]) / s;
    x = (m[2] + m[8]) / s; y = (m[6] + m[9]) / s; z = 0.25 * s;
  }
  return [x, y, z, w];
}
function rotVec(q, v) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx)
  ];
}

/* ---------- estado del modo MR ---------- */
const MR = {
  supported: false, active: false, session: null, gl: null, canvas: null, layer: null,
  ref: null, passthrough: false, prog: null, time: 0, lastT: 0,
  head: { pos: [0, 1.6, 0], q: [0, 0, 0, 1], fwd: [0, 0, -1], up: [0, 1, 0] },
  plants: [], offX: 0, offZ: 0, level: 0, score: 0, beans: 0,
  timeLeft: 0, cured: 0, sickTotal: 0, running: false,
  aim: null, reticlePos: null, reticleProg: null, reticleKey: -1,
  reticleCanvas: null, reticleTex: null,
  panel: null,
  hudCanvas: null, hudTex: null, hudKey: '',
  toastCanvas: null, toastTex: null, toastMsg: '', toastT: 0,
  end: null, particles: [],
  ray: { pos: [0, -0.3, -1], dir: [0, 0, -1], show: false },
  _cureLatch: false, _closeLatch: false
};

/* ---------- shaders (textura + tint) ---------- */
const VS_SRC = 'attribute vec3 aPos; attribute vec2 aUV;' +
  'uniform mat4 uProj; uniform mat4 uView; uniform mat4 uModel;' +
  'varying vec2 vUV;' +
  'void main(){ vUV=aUV; gl_Position=uProj*uView*uModel*vec4(aPos,1.0); }';
const FS_SRC = 'precision mediump float;' +
  'varying vec2 vUV; uniform sampler2D uTex; uniform vec4 uColor;' +
  'void main(){ vec4 t=texture2D(uTex,vUV); gl_FragColor=vec4(t.rgb*uColor.rgb, t.a*uColor.a); }';

function makeProg(gl, vs, fs) {
  const p = gl.createProgram();
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return {
    prog: p,
    aPos: gl.getAttribLocation(p, 'aPos'),
    aUV: gl.getAttribLocation(p, 'aUV'),
    uProj: gl.getUniformLocation(p, 'uProj'),
    uView: gl.getUniformLocation(p, 'uView'),
    uModel: gl.getUniformLocation(p, 'uModel'),
    uTex: gl.getUniformLocation(p, 'uTex'),
    uColor: gl.getUniformLocation(p, 'uColor')
  };
}

/* ---------- meshes ---------- */
function makeQuad() {
  return {
    pos: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]),
    uv: new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
    idx: new Uint16Array([0, 1, 2, 2, 1, 3]),
    count: 6
  };
}
function makeSphere(seg, rings, r) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= rings; i++) {
    const th = (i / rings) * Math.PI;
    const s = Math.sin(th), c = Math.cos(th);
    for (let j = 0; j <= seg; j++) {
      const ph = (j / seg) * Math.PI * 2;
      pos.push(r * s * Math.cos(ph), r * c, r * s * Math.sin(ph));
      uv.push(j / seg, i / rings);
    }
  }
  const row = seg + 1;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < seg; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, c, b, d);
    }
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx), count: idx.length };
}
function makeCylinder(seg, rTop, rBot, h) {
  const pos = [], uv = [], idx = [];
  const yT = h / 2, yB = -h / 2;
  for (let i = 0; i <= seg; i++) {
    const ph = (i / seg) * Math.PI * 2;
    const cp = Math.cos(ph), sp = Math.sin(ph);
    pos.push(rTop * cp, yT, rTop * sp); uv.push(i / seg, 0);
    pos.push(rBot * cp, yB, rBot * sp); uv.push(i / seg, 1);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  return { pos: new Float32Array(pos), uv: new Float32Array(uv), idx: new Uint16Array(idx), count: idx.length };
}
function floorPoints() {
  const pts = [];
  for (let x = -5; x <= 5; x++) { pts.push(x, 0, -5, x, 0, 5); }
  for (let z = -5; z <= 5; z++) { pts.push(-5, 0, z, 5, 0, z); }
  const uv = new Float32Array(pts.length / 3 * 2);
  return { pos: new Float32Array(pts), uv, idx: null, count: pts.length / 3 };
}
function meshGL(gl, m) {
  const pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, m.pos, gl.STATIC_DRAW);
  const uv = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, uv);
  gl.bufferData(gl.ARRAY_BUFFER, m.uv, gl.STATIC_DRAW);
  let ib = null;
  if (m.idx) {
    ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, m.idx, gl.STATIC_DRAW);
  }
  return { pos, uv, ib, count: m.count };
}

/* ---------- textures ---------- */
function texFromCanvas(gl, cv) {
  const t = gl.createTexture();
  uploadTex(gl, t, cv);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  return t;
}
function uploadTex(gl, tex, cv) {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
}
function makeWhiteTex(gl) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 2;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 2, 2);
  return texFromCanvas(gl, cv);
}
function makeLeafTex(gl) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, 128, 128);
  c.fillStyle = '#ffffff';
  c.beginPath(); c.arc(64, 64, 60, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(0,0,0,.15)'; c.lineWidth = 3;
  for (let i = 0; i < 5; i++) {
    c.beginPath();
    c.moveTo(64, 64);
    c.lineTo(64 + Math.cos(i * 1.3) * 58, 64 + Math.sin(i * 1.3) * 58);
    c.stroke();
  }
  return texFromCanvas(gl, cv);
}

/* ---------- sesión WebXR (Meta Quest) ---------- */
async function startMR() {
  try {
    MR.session = await navigator.xr.requestSession('immersive-vr', {
      optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'passthrough']
    });
  } catch (e) {
    MR.session = null;
    return false;
  }
  const gl = MR.canvas.getContext('webgl', { xrCompatible: true, alpha: true, antialias: true });
  if (!gl) { try { MR.session.endSession(); } catch (e) {} return false; }
  MR.gl = gl;
  try {
    MR.prog = makeProg(gl, VS_SRC, FS_SRC);
    MR.meshQuad = meshGL(gl, makeQuad());
    MR.meshSphere = meshGL(gl, makeSphere(10, 7, 1));
    MR.meshCyl = meshGL(gl, makeCylinder(8, 1, 1, 1));
    MR.meshLines = meshGL(gl, floorPoints());
    MR.linesModel = M4.ident(new Float32Array(16));
    MR.texWhite = makeWhiteTex(gl);
    MR.texLeaf = makeLeafTex(gl);
    MR.layer = new XRWebGLLayer(MR.session, gl, { framebufferScaleFactor: 1.0 });
    await MR.session.updateRenderState({ baseLayer: MR.layer });
    try {
      MR.ref = await MR.session.requestReferenceSpace('local-floor');
    } catch (e) {
      MR.ref = await MR.session.requestReferenceSpace('local');
    }
    /* passthrough: cámara real visible detrás del scene */
    MR.passthrough = false;
    try {
      const feats = MR.session.enabledFeatures || [];
      if (feats.indexOf('passthrough') >= 0) {
        await MR.session.requestRenderState({ passthrough: true });
        MR.passthrough = true;
      }
    } catch (e) { /* sin passthrough → fondo oscuro */ }
    MR.session.addEventListener('endsession', endMR);
    MR.level = 0; MR.score = 0; MR.beans = 0;
    setupLevelMR();
    MR.running = true;
    MR.active = true;
    MR.lastT = 0;
    document.getElementById('intro').classList.add('hidden');
    MR.session.requestAnimationFrame(mrFrame);
    return true;
  } catch (e) {
    try { MR.session.endSession(); } catch (e2) {}
    return false;
  }
}

function endMR() {
  if (!MR.session) return;
  try { MR.session.removeEventListener('endsession', endMR); } catch (e) {}
  MR.active = false;
  MR.running = false;
  MR.session = null;
  if (MR.canvas && MR.canvas.parentNode) MR.canvas.parentNode.removeChild(MR.canvas);
  MR.canvas = null;
  document.getElementById('intro').classList.remove('hidden');
  const btn = document.getElementById('btnVR');
  if (btn) {
    btn.disabled = false;
    btn.textContent = '🥽 JUGAR EN META QUEST (VR)';
  }
}

/* ---------- ciclo de frames WebXR ---------- */
function mrFrame(t, frame) {
  if (!MR.session || !MR.active) return;
  MR.session.requestAnimationFrame(mrFrame);
  let dt = (t - (MR.lastT || t)) / 1000;
  MR.lastT = t;
  if (!(dt > 0)) dt = 0.016;
  dt = Math.min(0.06, dt);
  MR.time += dt;
  handleInput(frame, dt);
  updateMR(dt);
  const pose = frame.getViewerPose(MR.ref);
  if (!pose || !pose.views || !pose.views.length) return;
  const m = pose.transform.matrix;
  MR.head.pos = [m[12], m[13], m[14]];
  MR.head.q = quatFromMat(m);
  MR.head.fwd = norm(rotVec(MR.head.q, [0, 0, -1]));
  MR.head.up = norm(rotVec(MR.head.q, [0, 1, 0]));
  render(pose.views);
}

/* =========================================================
   PARTE B — render, escena, escaneo
   ========================================================= */

/* ---------- draw ---------- */
function drawMesh(mesh, view, model, tex, color) {
  const gl = MR.gl, p = MR.prog;
  gl.useProgram(p.prog);
  gl.uniformMatrix4fv(p.uProj, false, view.projectionMatrix);
  gl.uniformMatrix4fv(p.uView, false, view.transform.matrix);
  gl.uniformMatrix4fv(p.uModel, false, model);
  gl.uniform4fv(p.uColor, color);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.uniform1i(p.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos);
  gl.enableVertexAttribArray(p.aPos);
  gl.vertexAttribPointer(p.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uv);
  gl.enableVertexAttribArray(p.aUV);
  gl.vertexAttribPointer(p.aUV, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ib);
  gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
}

function drawLines(view) {
  const gl = MR.gl, p = MR.prog;
  gl.useProgram(p.prog);
  gl.uniformMatrix4fv(p.uProj, false, view.projectionMatrix);
  gl.uniformMatrix4fv(p.uView, false, view.transform.matrix);
  gl.uniformMatrix4fv(p.uModel, false, MR.linesModel);
  gl.uniform4fv(p.uColor, [0.3, 0.85, 1, 0.13]);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, MR.texWhite);
  gl.uniform1i(p.uTex, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, MR.meshLines.pos);
  gl.enableVertexAttribArray(p.aPos);
  gl.vertexAttribPointer(p.aPos, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, MR.meshLines.uv);
  gl.enableVertexAttribArray(p.aUV);
  gl.vertexAttribPointer(p.aUV, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINES, 0, MR.meshLines.count);
}

/* ---------- planta de café 3D ---------- */
const LEAF_BASE = {
  'Café Arábica': [0.18, 0.55, 0.18],
  'Café Robusta': [0.14, 0.42, 0.11],
  'Café Catimor': [0.22, 0.60, 0.20],
  'Café Geisha':  [0.20, 0.58, 0.22]
};
const VAR_SIZE = {
  'Café Robusta': 1.12, 'Café Geisha': 1.0, 'Café Arábica': 0.95, 'Café Catimor': 0.85
};
function leafColor(p) {
  const base = LEAF_BASE[p.variety.name] || [0.2, 0.5, 0.16];
  if (p.cured) return [Math.min(1, base[0] * 1.15 + 0.05), Math.min(1, base[1] * 1.15 + 0.08), Math.min(1, base[2] * 1.15 + 0.05)];
  if (p.healthy) return base;
  return [base[0] * 0.5, base[1] * 0.42 + 0.06, base[2] * 0.38];
}
function drawPlant(p, view) {
  const s = p.scale * 0.85;
  const px = p.x + MR.offX, pz = p.z + MR.offZ;
  const H = 1.15 * s;
  const leaf = leafColor(p);
  let m = M4.ident(_m1);
  M4.trans(m, m, px, H / 2, pz);
  M4.rotY(m, m, p.ry);
  M4.scl(m, m, s * 0.05, s * 0.11, s * 0.05);
  drawMesh(MR.meshCyl, view, m, MR.texWhite, [0.32, 0.18, 0.10, 1]);
  const bob = (MR.cured && p.cured) ? Math.sin(MR.time * 5) * 0.03 : 0;
  const foli = [[0.17, 0.10, 0.0], [-0.17, 0.07, 0.03], [0.0, 0.23, -0.06]];
  for (let i = 0; i < foli.length; i++) {
    const f = foli[i];
    m = M4.ident(_m1);
    M4.trans(m, m, px + f[0] * s, H + f[1] * s + bob, pz + f[2] * s);
    if (!p.healthy && !p.cured) M4.rotX(m, m, 0.28); /* enfermo: hojas caídas */
    M4.rotY(m, m, p.ry);
    M4.scl(m, m, 0.36 * s, 0.32 * s, 0.36 * s);
    drawMesh(MR.meshSphere, view, m, MR.texLeaf, leaf);
  }
  if (p.healthy || p.cured) {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.7;
      m = M4.ident(_m1);
      M4.trans(m, m, px + Math.cos(a) * 0.12 * s, H + 0.16 * s, pz + Math.sin(a) * 0.12 * s);
      M4.scl(m, m, 0.055 * s, 0.055 * s, 0.055 * s);
      drawMesh(MR.meshSphere, view, m, MR.texWhite, p.cured ? [0.9, 0.35, 0.2, 1] : [0.75, 0.18, 0.12, 1]);
    }
  }
  if (!p.healthy && !p.cured) {
    for (let i = 0; i < p.spots; i++) {
      const a = i * 2.1 + 1.1;
      m = M4.ident(_m1);
      M4.trans(m, m, px + Math.cos(a) * 0.2 * s, H + 0.16 * s + (i % 2) * 0.08, pz + Math.sin(a) * 0.2 * s);
      M4.scl(m, m, 0.07 * s, 0.07 * s, 0.07 * s);
      drawMesh(MR.meshSphere, view, m, MR.texWhite, [0.62, 0.13, 0.1, 1]);
    }
  }
}

/* ---------- rayo del mando derecho ---------- */
function drawRay(view) {
  const d = MR.ray.dir;
  let ax = d[2], ay = 0, az = -d[0];
  const al = Math.hypot(ax, ay, az) || 1;
  ax /= al; az /= al;
  const bx = d[1] * az - d[2] * ay, by = d[2] * ax - d[0] * az, bz = d[0] * ay - d[1] * ax;
  const m = M4.ident(_m1);
  m[0] = ax; m[1] = ay; m[2] = az;
  m[4] = bx; m[5] = by; m[6] = bz;
  m[8] = d[0]; m[9] = d[1]; m[10] = d[2];
  m[12] = MR.ray.pos[0]; m[13] = MR.ray.pos[1]; m[14] = MR.ray.pos[2];
  M4.scl(m, m, 0.02, 3, 1);
  drawMesh(MR.meshQuad, view, m, MR.texWhite, [0.3, 0.9, 1, 0.35]);
}

/* ---------- partículas de cura ---------- */
function updateParticles(dt) {
  for (let i = MR.particles.length - 1; i >= 0; i--) {
    const q = MR.particles[i];
    q.t += dt;
    if (q.t > q.life) { MR.particles.splice(i, 1); continue; }
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
    q.vy -= 3.2 * dt;
  }
}
function drawParticles(view) {
  for (const q of MR.particles) {
    const a = 1 - q.t / q.life;
    let m = M4.ident(_m1);
    M4.face(m, [q.x, q.y, q.z], MR.head.pos);
    M4.scl(m, m, q.size, q.size, 1);
    drawMesh(MR.meshQuad, view, m, MR.texWhite, [q.col[0], q.col[1], q.col[2], a]);
  }
}

/* ---------- lógica: escaneo + temporizadores ---------- */
function updateMR(dt) {
  if (MR.toastT > 0) MR.toastT -= dt;
  updateParticles(dt);
  if (!MR.running) return;
  MR.timeLeft -= dt;
  if (MR.timeLeft <= 0) {
    MR.timeLeft = 0;
    if (MR.cured < MR.sickTotal) {
      Cafecito.Sound.lose();
      showEndMR(false);
    }
  }
  /* HUD solo cuando algo cambia */
  const key = MR.level + '|' + Math.floor(MR.timeLeft) + '|' + MR.score + '|' + MR.beans + '|' + MR.cured;
  if (key !== MR.hudKey) { MR.hudKey = key; drawHUDTex(); }

  /* escaneo por la mirada */
  let best = null, bestScore = 0;
  const head = MR.head.pos;
  for (const p of MR.plants) {
    if (p.locked || p.cured) continue;
    const px = p.x + MR.offX, pz = p.z + MR.offZ;
    const dx = px - head[0], dz = pz - head[2];
    const dist = Math.hypot(dx, dz);
    if (dist < 0.6 || dist > 4.5) continue;
    const facing = dot3([dx, 0, dz], MR.head.fwd) / dist;
    if (facing < 0.66) continue;
    const score = facing - dist * 0.1;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  MR.aim = best;
  if (best) {
    if (best.aim === 0) Cafecito.Sound.aim();
    best.aim += dt;
    const prog = clamp(best.aim / 1.3, 0, 1);
    const dist = Math.hypot(best.x + MR.offX - head[0], best.z + MR.offZ - head[2]);
    MR.reticlePos = [
      head[0] + MR.head.fwd[0] * dist,
      1.1 * best.scale,
      head[2] + MR.head.fwd[2] * dist
    ];
    MR.reticleProg = prog;
    const rk = Math.floor(prog * 24) + (best.aim >= 1.3 ? 100 : 0);
    if (rk !== MR.reticleKey) { MR.reticleKey = rk; drawReticleTex(); }
    if (best.aim >= 1.3) {
      best.locked = true;
      Cafecito.Sound.lock();
      openPanelMR(best);
      MR.reticleProg = null;
      MR.reticlePos = null;
    }
  } else {
    MR.reticleProg = null;
    MR.reticlePos = null;
  }
  if (MR.panel) placePanel();
}

/* ---------- render completo (ojo izquierdo + derecho) ---------- */
function render(views) {
  const gl = MR.gl;
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    const viewport = MR.layer.getViewport(view);
    gl.viewport(viewport.x, viewport.y, viewport.width, viewport.height);
    gl.clearColor(MR.passthrough ? 0 : 0.02, MR.passthrough ? 0 : 0.06, MR.passthrough ? 0 : 0.08, MR.passthrough ? 0 : 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.depthMask(true);
    drawLines(view);
    for (const p of MR.plants) drawPlant(p, view);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    if (MR.running && MR.aim && !MR.aim.locked && MR.aim.aim > 0 && MR.reticlePos) {
      drawReticle(view);
    }
    if (MR.panel) drawPanel(view);
    drawParticles(view);
    if (MR.ray.show) drawRay(view);
    drawHUD(view);
    if (MR.toastT > 0) drawToast(view);
    if (MR.end) drawEnd(view);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }
}

/* =========================================================
   PARTE C — canvas UI, panel, input, flujo de niveles
   ========================================================= */

/* ---------- helpers de canvas ---------- */
function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}
function wrapText(c, text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (c.measureText(test).width > maxW && line) {
      c.fillText(line, x, yy);
      line = w;
      yy += lh;
    } else {
      line = test;
    }
  }
  c.fillText(line, x, yy);
}
function inRect(x, y, r) {
  return r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}
function buttonRect(c, x, y, w, h, label, hover, primary) {
  roundRect(c, x, y, w, h, 12);
  c.fillStyle = primary
    ? (hover ? 'rgba(56,224,122,.95)' : 'rgba(56,224,122,.85)')
    : (hover ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.10)');
  c.fill();
  c.strokeStyle = hover ? '#ffd54f' : 'rgba(255,255,255,.25)';
  c.lineWidth = 2;
  c.stroke();
  c.font = '700 22px "Segoe UI", sans-serif';
  c.fillStyle = primary ? '#04210f' : '#cfefff';
  c.textAlign = 'center';
  c.fillText(label, x + w / 2, y + 35);
  c.textAlign = 'left';
}

/* ---------- visor/reticle ---------- */
function drawReticleTex() {
  const gl = MR.gl, cv = MR.reticleCanvas, c = cv.getContext('2d');
  c.clearRect(0, 0, 256, 256);
  const locked = MR.aim && MR.aim.aim >= 1.3;
  c.strokeStyle = 'rgba(77,215,255,.22)';
  c.lineWidth = 8;
  c.beginPath(); c.arc(128, 128, 100, 0, Math.PI * 2); c.stroke();
  const prog = MR.reticleProg || 0;
  if (prog > 0) {
    c.strokeStyle = locked ? '#ffd54f' : '#4dd7ff';
    c.lineWidth = 12;
    c.beginPath();
    c.arc(128, 128, 100, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * prog);
    c.stroke();
  }
  c.fillStyle = locked ? 'rgba(255,213,79,.95)' : 'rgba(77,215,255,.7)';
  c.beginPath(); c.arc(128, 128, 7, 0, Math.PI * 2); c.fill();
  if (MR.reticleTex) uploadTex(gl, MR.reticleTex, cv);
  else MR.reticleTex = texFromCanvas(gl, cv);
}
function drawReticle(view) {
  let m = M4.ident(_m1);
  M4.face(m, MR.reticlePos, MR.head.pos);
  M4.scl(m, m, 0.34, 0.34, 1);
  drawMesh(MR.meshQuad, view, m, MR.reticleTex, [1, 1, 1, 1]);
}

/* ---------- panel flotante ---------- */
function drawPanelTex() {
  const gl = MR.gl, pn = MR.panel, cv = pn.canvas, c = cv.getContext('2d');
  const p = pn.plant;
  c.clearRect(0, 0, 512, 384);
  roundRect(c, 12, 12, 488, 96, 16);
  c.fillStyle = 'rgba(8,22,32,.94)';
  c.fill();
  c.strokeStyle = 'rgba(77,215,255,.55)';
  c.lineWidth = 2;
  c.stroke();
  c.font = '500 18px "Segoe UI", sans-serif';
  c.fillStyle = 'rgba(160,220,255,.85)';
  c.fillText(p.variety.type, 30, 42);
  c.font = '700 34px "Segoe UI", sans-serif';
  c.fillStyle = '#e8f6ff';
  c.fillText('🌿 ' + p.variety.name, 30, 78);
  let badge, bc, bg;
  if (p.cured) { badge = 'CUREADA ✓'; bc = '#0e3a1e'; bg = '#38e07a'; }
  else if (p.healthy) { badge = 'SALUDABLE'; bc = '#0e3a1e'; bg = '#38e07a'; }
  else { badge = 'ENFERMO · ' + p.health + '%'; bc = '#3a0e0e'; bg = '#ff6b6b'; }
  c.font = '700 20px "Segoe UI", sans-serif';
  const bw = c.measureText(badge).width + 36;
  roundRect(c, 300, 22, bw, 36, 18);
  c.fillStyle = bc;
  c.fill();
  c.fillStyle = bg;
  c.textAlign = 'center';
  c.fillText(badge, 300 + bw / 2, 48);
  c.textAlign = 'left';
  if (p.cured) {
    c.font = '500 21px "Segoe UI", sans-serif';
    c.fillStyle = '#d8ffe8';
    c.fillText('¡La planta fue curada! Ahora luce sana y productiva. 🌱', 32, 162);
  } else if (p.healthy) {
    c.font = '500 21px "Segoe UI", sans-serif';
    c.fillStyle = '#d8ffe8';
    wrapText(c, p.variety.desc, 32, 162, 440, 28);
    c.fillText('Sin síntomas. ¡Sigue así! ✓', 32, 252);
  } else {
    c.font = '700 22px "Segoe UI", sans-serif';
    c.fillStyle = '#ffb4b4';
    c.fillText('Sintomas detectados:', 32, 160);
    c.font = '500 20px "Segoe UI", sans-serif';
    c.fillStyle = '#ffe0e0';
    let yy = 194;
    for (const s of p.symptoms) { c.fillText(s.icon + ' ' + s.t, 40, yy); yy += 30; }
  }
  const hover = pn.hover;
  if (p.cured) {
    buttonRect(c, 180, 288, 152, 52, 'Cerrar', hover === 'close', false);
  } else if (p.healthy) {
    buttonRect(c, 30, 288, 180, 52, '✓ Confirmar', hover === 'confirm', true);
    buttonRect(c, 222, 288, 152, 52, 'Cerrar', hover === 'close', false);
  } else {
    buttonRect(c, 30, 288, 180, 52, '🌿 CURAR', hover === 'cure', true);
    buttonRect(c, 222, 288, 152, 52, 'Cerrar', hover === 'close', false);
  }
  pn.buttons = {
    cure: (p.cured || p.healthy) ? null : { x0: 30, y0: 288, x1: 210, y1: 340 },
    confirm: (!p.cured && p.healthy) ? { x0: 30, y0: 288, x1: 210, y1: 340 } : null,
    close: { x0: 222, y0: 288, x1: 374, y1: 340 }
  };
  if (pn.tex) uploadTex(gl, pn.tex, cv);
  else pn.tex = texFromCanvas(gl, cv);
}
function placePanel() {
  const pn = MR.panel;
  if (!pn) return;
  const p = pn.plant;
  const h = MR.head.pos;
  const px = p.x + MR.offX, pz = p.z + MR.offZ;
  let dx = h[0] - px, dz = h[2] - pz;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d; dz /= d;
  pn.pos = [px + dx * 0.9, 1.4 * p.scale, pz + dz * 0.9];
  M4.face(_m1, pn.pos, h);
  pn.rot = [_m1[0], _m1[1], _m1[2], _m1[4], _m1[5], _m1[6], _m1[8], _m1[9], _m1[10]];
}
function drawPanel(view) {
  const pn = MR.panel;
  let m = M4.ident(_m1);
  M4.face(m, pn.pos, MR.head.pos);
  M4.scl(m, m, pn.w, pn.h, 1);
  drawMesh(MR.meshQuad, view, m, pn.tex, [1, 1, 1, 1]);
}
function openPanelMR(p) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 384;
  MR.panel = { plant: p, canvas: cv, tex: null, w: 0.56, h: 0.42, pos: null, rot: null, hover: null, buttons: {} };
  drawPanelTex();
}
function closePanelMR() {
  if (MR.panel && MR.panel.plant) MR.panel.plant.locked = false;
  MR.panel = null;
}
function rayPanel() {
  const pn = MR.panel;
  if (!pn || !MR.ray.show) return null;
  const rot = pn.rot, pos = pn.pos;
  const nx = rot[6], ny = rot[7], nz = rot[8];
  const dx = MR.ray.dir[0], dy = MR.ray.dir[1], dz = MR.ray.dir[2];
  const denom = dx * nx + dy * ny + dz * nz;
  if (Math.abs(denom) < 1e-4) return null;
  const px = pos[0] - MR.ray.pos[0], py = pos[1] - MR.ray.pos[1], pz = pos[2] - MR.ray.pos[2];
  const t = (px * nx + py * ny + pz * nz) / denom;
  if (t < 0.2 || t > 3) return null;
  const hx = MR.ray.pos[0] + dx * t, hy = MR.ray.pos[1] + dy * t, hz = MR.ray.pos[2] + dz * t;
  const lx = hx - pos[0], ly = hy - pos[1], lz = hz - pos[2];
  const lx2 = lx * rot[0] + ly * rot[1] + lz * rot[2];
  const ly2 = lx * rot[3] + ly * rot[4] + lz * rot[5];
  const u = 0.5 + lx2 / pn.w, v = 0.5 + ly2 / pn.h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const cx = u * 512, cy = (1 - v) * 384;
  if (inRect(cx, cy, pn.buttons.cure)) return 'cure';
  if (inRect(cx, cy, pn.buttons.confirm)) return 'confirm';
  if (inRect(cx, cy, pn.buttons.close)) return 'close';
  return null;
}

/* ---------- HUD ---------- */
function drawHUDTex() {
  const gl = MR.gl, cv = MR.hudCanvas, c = cv.getContext('2d');
  c.clearRect(0, 0, 512, 128);
  roundRect(c, 4, 4, 504, 120, 18);
  c.fillStyle = 'rgba(6,18,26,.72)';
  c.fill();
  c.strokeStyle = 'rgba(77,215,255,.35)';
  c.lineWidth = 2;
  c.stroke();
  c.textAlign = 'left';
  c.font = '600 24px "Segoe UI", sans-serif';
  c.fillStyle = '#9fe6ff';
  c.fillText('NIVEL ' + (MR.level + 1), 26, 42);
  c.font = '700 34px "Segoe UI", sans-serif';
  c.fillStyle = MR.timeLeft <= 15 ? '#ff97a3' : '#ffffff';
  c.fillText(Cafecito.fmtTime(Math.max(0, MR.timeLeft)), 26, 96);
  c.textAlign = 'right';
  c.font = '600 22px "Segoe UI", sans-serif';
  c.fillStyle = '#ffe9a3';
  c.fillText('⭐ ' + MR.score, 486, 44);
  c.fillStyle = '#e8c9a3';
  c.fillText('☕ ' + MR.beans, 486, 76);
  c.fillStyle = '#9fe6b0';
  c.fillText('🌿 ' + MR.cured + '/' + MR.sickTotal, 486, 108);
  c.textAlign = 'left';
  if (MR.hudTex) uploadTex(gl, MR.hudTex, cv);
  else MR.hudTex = texFromCanvas(gl, cv);
}
function drawHUD(view) {
  if (MR.hudTex && MR.running) {
    const f = MR.head.fwd, u = MR.head.up;
    const pos = [
      MR.head.pos[0] + f[0] * 0.55 + u[0] * -0.22,
      MR.head.pos[1] + f[1] * 0.55 + u[1] * -0.22,
      MR.head.pos[2] + f[2] * 0.55 + u[2] * -0.22
    ];
    let m = M4.ident(_m1);
    M4.face(m, pos, MR.head.pos);
    M4.scl(m, m, 0.5, 0.122, 1);
    drawMesh(MR.meshQuad, view, m, MR.hudTex, [1, 1, 1, 1]);
  }
}

/* ---------- toast ---------- */
function toastMR(msg) {
  MR.toastMsg = msg;
  MR.toastT = 1.9;
  drawToastTex();
}
function drawToastTex() {
  const gl = MR.gl, cv = MR.toastCanvas, c = cv.getContext('2d');
  c.clearRect(0, 0, 512, 110);
  c.font = '600 30px "Segoe UI", sans-serif';
  const w = Math.min(500, c.measureText(MR.toastMsg).width + 50);
  roundRect(c, (512 - w) / 2, 20, w, 56, 28);
  c.fillStyle = 'rgba(8,22,32,.92)';
  c.fill();
  c.strokeStyle = 'rgba(77,215,255,.5)';
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = '#e8f6ff';
  c.textAlign = 'center';
  c.fillText(MR.toastMsg, 256, 58);
  c.textAlign = 'left';
  if (MR.toastTex) uploadTex(gl, MR.toastTex, cv);
  else MR.toastTex = texFromCanvas(gl, cv);
}
function drawToast(view) {
  if (MR.toastT > 0 && MR.toastTex) {
    const f = MR.head.fwd, u = MR.head.up;
    const pos = [
      MR.head.pos[0] + f[0] * 0.55 + u[0] * -0.38,
      MR.head.pos[1] + f[1] * 0.55 + u[1] * -0.38,
      MR.head.pos[2] + f[2] * 0.55 + u[2] * -0.38
    ];
    const a = MR.toastT > 1.7 ? (1.9 - MR.toastT) / 0.2 : Math.min(1, MR.toastT / 0.25);
    let m = M4.ident(_m1);
    M4.face(m, pos, MR.head.pos);
    M4.scl(m, m, 0.62, 0.13, 1);
    drawMesh(MR.meshQuad, view, m, MR.toastTex, [1, 1, 1, a]);
  }
}

/* ---------- pantalla final ---------- */
function drawEndTex() {
  const e = MR.end;
  if (!e) return;
  const gl = MR.gl, cv = e.canvas, c = cv.getContext('2d');
  c.clearRect(0, 0, 512, 384);
  roundRect(c, 12, 12, 488, 360, 20);
  c.fillStyle = 'rgba(8,22,32,.96)';
  c.fill();
  c.strokeStyle = e.win ? 'rgba(56,224,122,.6)' : 'rgba(255,90,90,.6)';
  c.lineWidth = 3;
  c.stroke();
  c.textAlign = 'center';
  c.font = '700 64px "Segoe UI", sans-serif';
  c.fillText(e.win ? (e.last ? '🏆' : '🌿') : '⏱', 256, 96);
  c.font = '700 32px "Segoe UI", sans-serif';
  c.fillStyle = e.win ? '#38e07a' : '#ff97a3';
  c.fillText(e.win ? (e.last ? '¡Campeón de Cafecito!' : '¡Misión completa!') : 'Se agotó el tiempo', 256, 138);
  c.font = '500 19px "Segoe UI", sans-serif';
  c.fillStyle = '#cfefff';
  c.fillText(e.win ? 'Todas las plantas de Café están sanas.' : 'Quedaron plantas enfermas sin curar.', 256, 166);
  const stats = [
    [MR.cured + '/' + MR.sickTotal, 'Plantas curadas'],
    [MR.beans, '☕ Granos'],
    [MR.score, '⭐ Puntos'],
    [e.used, '⏱ Usado']
  ];
  for (let i = 0; i < stats.length; i++) {
    const col = i % 2, row = Math.floor(i / 2);
    const x = 90 + col * 200, y = 196 + row * 66;
    roundRect(c, x, y, 170, 56, 12);
    c.fillStyle = 'rgba(255,255,255,.06)';
    c.fill();
    c.font = '700 24px "Segoe UI", sans-serif';
    c.fillStyle = '#fff';
    c.fillText(stats[i][0], x + 85, y + 27);
    c.font = '500 13px "Segoe UI", sans-serif';
    c.fillStyle = 'rgba(207,239,255,.7)';
    c.fillText(stats[i][1], x + 85, y + 46);
  }
  buttonRect(c, 70, 300, 180, 56, 'Reintentar', e.hover === 'retry', true);
  buttonRect(c, 262, 300, 180, 56, 'Menú', e.hover === 'menu', false);
  if (e.tex) uploadTex(gl, e.tex, cv);
  else e.tex = texFromCanvas(gl, cv);
}
function drawEnd(view) {
  const e = MR.end;
  if (!e) return;
  const f = MR.head.fwd, u = MR.head.up;
  const pos = [MR.head.pos[0] + f[0] * 1.1, MR.head.pos[1] + 0.05, MR.head.pos[2] + f[2] * 1.1];
  e.pos = pos;
  let m = M4.ident(_m1);
  M4.face(m, pos, MR.head.pos);
  M4.scl(m, m, e.w, e.h, 1);
  e.rot = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]];
  drawMesh(MR.meshQuad, view, m, e.tex, [1, 1, 1, 1]);
}
function rayEnd() {
  const e = MR.end;
  if (!e || !e.pos || !MR.ray.show) return null;
  const rot = e.rot, pos = e.pos;
  const nx = rot[6], ny = rot[7], nz = rot[8];
  const dx = MR.ray.dir[0], dy = MR.ray.dir[1], dz = MR.ray.dir[2];
  const denom = dx * nx + dy * ny + dz * nz;
  if (Math.abs(denom) < 1e-4) return null;
  const px = pos[0] - MR.ray.pos[0], py = pos[1] - MR.ray.pos[1], pz = pos[2] - MR.ray.pos[2];
  const t = (px * nx + py * ny + pz * nz) / denom;
  if (t < 0.3 || t > 3) return null;
  const hx = MR.ray.pos[0] + dx * t, hy = MR.ray.pos[1] + dy * t, hz = MR.ray.pos[2] + dz * t;
  const lx = hx - pos[0], ly = hy - pos[1], lz = hz - pos[2];
  const lx2 = lx * rot[0] + ly * rot[1] + lz * rot[2];
  const ly2 = lx * rot[3] + ly * rot[4] + lz * rot[5];
  const u = 0.5 + lx2 / e.w, v = 0.5 + ly2 / e.h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const cx = u * 512, cy = (1 - v) * 384;
  if (inRect(cx, cy, e.buttons.retry)) return 'retry';
  if (inRect(cx, cy, e.buttons.menu)) return 'menu';
  return null;
}
function showEndMR(win) {
  const last = MR.level >= Cafecito.LEVELS.length - 1;
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 384;
  MR.end = {
    canvas: cv, tex: null, w: 0.7, h: 0.52,
    pos: null, rot: null, hover: null, win, last,
    used: Cafecito.fmtTime(Math.max(0, Cafecito.LEVELS[MR.level].time - MR.timeLeft)),
    buttons: {
      retry: { x0: 70, y0: 300, x1: 250, y1: 356 },
      menu: { x0: 262, y0: 300, x1: 442, y1: 356 }
    }
  };
  drawEndTex();
}
function retryMR() {
  MR.end = null;
  setupLevelMR();
  MR.running = true;
}

/* ---------- curar / confirmar / partículas ---------- */
function burstMR(p) {
  const px = p.x + MR.offX, pz = p.z + MR.offZ;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2, sp = rand(0.5, 2.0);
    MR.particles.push({
      x: px + rand(-0.1, 0.1), y: 1.2 * p.scale + rand(-0.15, 0.15), z: pz + rand(-0.1, 0.1),
      vx: Math.cos(a) * sp * 0.5, vy: rand(0.7, 2.4), vz: Math.sin(a) * sp * 0.5,
      t: 0, life: rand(0.7, 1.1), size: rand(0.03, 0.07),
      col: Math.random() < 0.5 ? [0.3, 0.95, 0.45, 1] : [1, 0.85, 0.3, 1]
    });
  }
}
function curePlantMR(p) {
  if (p.cured || p.healthy) return;
  p.cured = true;
  p.health = 100;
  p.symptoms = [];
  p.aim = 0;
  MR.score += 100;
  MR.beans += 1;
  MR.cured += 1;
  Cafecito.Sound.cure();
  burstMR(p);
  toastMR('🌿 Curada ' + p.variety.name + '  +100 ⭐  +1 ☕');
  drawPanelTex();
  if (MR.cured >= MR.sickTotal) {
    MR.running = false;
    setTimeout(() => showEndMR(true), 800);
  }
}
function confirmPlantMR(p) {
  if (p.cured || !p.healthy) return;
  MR.score += 20;
  Cafecito.Sound.ok();
  toastMR('Planta en buen estado  +20 ⭐');
  closePanelMR();
}

/* ---------- niveles ---------- */
function setupLevelMR() {
  const cfg = Cafecito.LEVELS[MR.level];
  MR.plants = [];
  MR.cured = 0;
  MR.sickTotal = cfg.sick;
  MR.timeLeft = cfg.time;
  MR.offX = 0;
  MR.offZ = 0;
  MR.aim = null;
  MR.reticleProg = null;
  MR.reticlePos = null;
  MR.reticleKey = -1;
  MR.particles = [];
  closePanelMR();
  MR.end = null;
  const shuffled = Cafecito.VARIETIES.slice().sort(() => Math.random() - 0.5);
  const sickSet = new Set();
  while (sickSet.size < cfg.sick) sickSet.add(rint(0, cfg.n - 1));
  const arc = 2.4 + cfg.n * 0.14;
  const span = Math.min(160, 50 + cfg.n * 15);
  for (let i = 0; i < cfg.n; i++) {
    const ang = (-span / 2 + span * (i + 0.5) / cfg.n) * Math.PI / 180;
    const r = arc * rand(0.85, 1.12);
    const variety = shuffled[i % shuffled.length];
    const healthy = !sickSet.has(i);
    MR.plants.push({
      x: Math.sin(ang) * r,
      z: Math.cos(ang) * r + 0.4,
      ry: rand(0, Math.PI * 2),
      scale: (VAR_SIZE[variety.name] || 0.9) * rand(0.85, 1.1),
      variety, healthy, cured: false, locked: false, aim: 0,
      health: healthy ? 100 : rint(18, 45),
      symptoms: healthy ? [] : Cafecito.pickSymptoms(),
      spots: healthy ? 0 : rint(2, 3)
    });
  }
  MR.hudKey = '';
  drawHUDTex();
  toastMR('Nivel ' + (MR.level + 1) + ' · Cura ' + cfg.sick + ' planta(s) enferma(s)');
}

/* ---------- entrada de mandos ---------- */
function handleInput(frame, dt) {
  MR.ray.show = false;
  for (const src of MR.session.inputSources) {
    if (!src.gamepad) continue;
    const gp = src.gamepad;
    if (src.handedness === 'left') {
      /* LZ: mover (arriba = avanzar) */
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const sp = 1.7;
      if (Math.abs(ax) > 0.25) MR.offX = clamp(MR.offX + ax * sp * dt, -2.2, 2.2);
      if (Math.abs(ay) > 0.25) MR.offZ = clamp(MR.offZ - ay * sp * dt, -2.2, 2.2);
    } else if (src.handedness === 'right') {
      let pose = null;
      if (src.targetRaySpace) pose = frame.getPose(src.targetRaySpace, MR.ref);
      if (!pose && src.gripSpace) pose = frame.getPose(src.gripSpace, MR.ref);
      if (pose) {
        const mm = pose.transform.matrix;
        MR.ray.pos = [mm[12], mm[13], mm[14]];
        const q = quatFromMat(mm);
        MR.ray.dir = norm(rotVec(q, [0, 0, -1]));
        MR.ray.show = true;
      }
      const trig = gp.buttons[0] && gp.buttons[0].pressed;
      const aBtn = gp.buttons[4] && gp.buttons[4].pressed;
      const bBtn = gp.buttons[5] && gp.buttons[5].pressed;
      const sel = !!(trig || aBtn);
      if (sel && !MR._cureLatch) {
        MR._cureLatch = true;
        if (MR.panel) {
          const hit = rayPanel();
          if (hit === 'cure') curePlantMR(MR.panel.plant);
          else if (hit === 'confirm') confirmPlantMR(MR.panel.plant);
        } else if (MR.end) {
          const hit = rayEnd();
          if (hit === 'retry') retryMR();
          else if (hit === 'menu') { try { MR.session.endSession(); } catch (e) {} }
        }
      }
      if (!sel) MR._cureLatch = false;
      if (bBtn && !MR._closeLatch) {
        MR._closeLatch = true;
        if (MR.panel) closePanelMR();
      }
      if (!bBtn) MR._closeLatch = false;
    }
  }
  /* hover visual */
  if (MR.panel) {
    const hit = rayPanel();
    if (hit !== MR.panel.hover) { MR.panel.hover = hit; drawPanelTex(); }
  }
  if (MR.end) {
    const hit = rayEnd();
    if (hit !== MR.end.hover) { MR.end.hover = hit; drawEndTex(); }
  }
}

/* ---------- botón en el menú ---------- */
function addVRButton() {
  const btn = document.createElement('button');
  btn.className = 'primary big';
  btn.id = 'btnVR';
  btn.style.cssText = 'margin-top:16px;';
  btn.textContent = '🥽 JUGAR EN META QUEST (VR)';
  btn.addEventListener('click', async () => {
    if (MR.active) return;
    if (window.Cafecito && Cafecito.Sound) Cafecito.Sound.click();
    btn.disabled = true;
    btn.textContent = '🥽 Cargando VR…';
    const ok = await startMR();
    if (!ok) {
      btn.disabled = false;
      btn.textContent = '🥽 JUGAR EN META QUEST (VR)';
    }
  });
  document.getElementById('intro').appendChild(btn);
}

/* ---------- arranque ---------- */
async function init() {
  try {
    if (!('XR' in navigator) || !navigator.xr || !navigator.xr.isSessionSupported) return;
    MR.supported = await navigator.xr.isSessionSupported('immersive-vr');
  } catch (e) {
    MR.supported = false;
  }
  if (!MR.supported) return;
  MR.canvas = document.createElement('canvas');
  MR.canvas.style.cssText = 'position:fixed; inset:0; width:100%; height:100%; display:block;';
  document.body.appendChild(MR.canvas);
  MR.reticleCanvas = document.createElement('canvas');
  MR.reticleCanvas.width = MR.reticleCanvas.height = 256;
  MR.panelCanvas = document.createElement('canvas');
  MR.panelCanvas.width = 512;
  MR.panelCanvas.height = 384;
  MR.hudCanvas = document.createElement('canvas');
  MR.hudCanvas.width = 512;
  MR.hudCanvas.height = 128;
  MR.toastCanvas = document.createElement('canvas');
  MR.toastCanvas.width = 512;
  MR.toastCanvas.height = 110;
  addVRButton();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window.QuestMR = MR;
})();
