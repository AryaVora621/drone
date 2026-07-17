// Drone FPV sim (3D) — reads the "Drone Controller" BLE gamepad as a
// Mode-2 transmitter. Keyboard fallback included. Renders a real 3D world
// with a visible quadcopter you chase from behind (C toggles onboard FPV).
//
// Axis mapping is auto-detected: wiggle both sticks to discover which
// axes are live. The 4 responsive axes are sorted by index; the first 2
// become the left stick, the next 2 become the right stick.
// Within each stick a 90° swap is applied (user reports sticks rotated).
// Flip the matching INVERT flag below if a control is reversed.

const cfg = {
  camDist: 3.5, camHgt: 2, camAz: 0, camFollow: false,
  acro: true,
  invert: { yaw: false, throttle: true, roll: true, pitch: true },
  deadzone: { yaw: 0.15, throttle: 0.08, roll: 0.08, pitch: 0.08 },
  speed: 1.0,
};
const _q = new THREE.Quaternion();
const _tv = new THREE.Vector3();

// ---- flight state (world: x,y horizontal, z up) -----------------------
const G = 9.81;
const state = {
  x: 0, y: 0, z: 0,
  heading: 0, pitch: 0, roll: 0,
  vx: 0, vy: 0, vz: 0,
  throttle: 0, dist: 0, lat: 0,
  paused: false,
};
let fpvMode = false;
let settingsVisible = false;

// axis auto-detection: watches for movement, discovers the 4 live axes
let axisMap = null;          // { lx, ly, rx, ry } once auto-detected
let axisLo = [], axisHi = [];// per-axis lo/hi for responsiveness
let mapStatus = "";          // status message while mapping

function dz(v, axis) {
  const d = cfg.deadzone[axis];
  if (Math.abs(v) < d) return 0;
  const s = Math.sign(v);
  return s * (Math.abs(v) - d) / (1 - d);
}

// ---- input -------------------------------------------------------------
const keys = {};
window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  keys[k] = true;
  if (k === "r") resetState();
  if (k === "c") fpvMode = !fpvMode;
  if (k === "z") { settingsVisible = !settingsVisible; document.getElementById("settings").style.display = settingsVisible ? "block" : "none"; }
  if (k === "n") { switchMap(1); }
  if (k === "m") { axisMap = null; axisLo = []; axisHi = []; mapStatus = "press M to re-map"; }
  if (k === " ") { state.paused = !state.paused; e.preventDefault(); }
  if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
});
window.addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });

// raw gamepad axes captured each frame for the debug overlay
let rawAxes = [];
let rawPadId = "";

function readInput() {
  let yaw = (keys["d"] ? 1 : 0) - (keys["a"] ? 1 : 0);
  let throttle = (keys["w"] ? 1 : 0) - (keys["s"] ? 1 : 0);
  let roll = (keys["arrowright"] ? 1 : 0) - (keys["arrowleft"] ? 1 : 0);
  let pitch = (keys["arrowup"] ? 1 : 0) - (keys["arrowdown"] ? 1 : 0);

  let source = "keyboard";
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let pad = null;
  for (const g of pads) { if (g && /drone controller/i.test(g.id || "")) { pad = g; break; } }
  if (!pad) { for (const g of pads) { if (g) { pad = g; break; } } }

  if (pad && pad.axes && pad.axes.length >= 4) {
    source = pad.id || "gamepad";
    rawAxes = Array.from(pad.axes);
    rawPadId = pad.id || "";

    // auto-detect: track per-axis min/max to find the 4 live axes
    const n = rawAxes.length;
    if (axisLo.length !== n) {
      axisLo = Array(n).fill(0);
      axisHi = Array(n).fill(0);
    }
    for (let i = 0; i < n; i++) {
      const v = rawAxes[i];
      axisLo[i] = Math.min(axisLo[i], v);
      axisHi[i] = Math.max(axisHi[i], v);
    }

    if (!axisMap) {
      const responsive = [];
      for (let i = 0; i < n; i++) {
        if (axisHi[i] - axisLo[i] > 0.15) responsive.push(i);
      }
      if (responsive.length >= 4) {
        responsive.sort((a, b) => a - b);
        axisMap = {
          lx: responsive[0], ly: responsive[1],
          rx: responsive[2], ry: responsive[3],
        };
        mapStatus = "mapped";
      } else {
        mapStatus = `wiggle both sticks (${responsive.length}/4 responsive)`;
      }
    }

    if (axisMap) {
      // 90° per-stick swap: throttle=LX, yaw=LY, pitch=RX, roll=RY
      let at = rawAxes[axisMap.lx];
      let ay = rawAxes[axisMap.ly];
      let ap = rawAxes[axisMap.rx];
      let ar = rawAxes[axisMap.ry];
      if (cfg.invert.yaw) ay = -ay;
      if (cfg.invert.throttle) at = -at;
      if (cfg.invert.roll) ar = -ar;
      if (cfg.invert.pitch) ap = -ap;
      pitch = dz(ap, 'pitch');
      roll = dz(ar, 'roll');
      yaw = dz(ay, 'yaw');
      throttle = dz(-at, 'throttle');
    }
  }
  return { yaw, throttle, roll, pitch, source };
}

// ---- physics -----------------------------------------------------------
const PITCH_RATE = 3.5;
const ROLL_RATE  = 3.5;
const YAW_RATE   = 2.0;

function step(dt, inp) {
  const thr = Math.max(0, inp.throttle);
  state.throttle = thr;

  if (cfg.acro) {
    // acro — rate mode: integrate stick input directly
    state.pitch  += inp.pitch  * PITCH_RATE * dt;
    state.roll   += inp.roll   * ROLL_RATE  * dt;
    state.heading += inp.yaw   * YAW_RATE   * dt;

    // thrust direction = body-up rotated into world
    _q.setFromEuler(drone.rotation);
    _tv.set(0, 1, 0).applyQuaternion(_q);
    // Three.js (x, y=up, z) → world (x, y, z=up)
    const ux = _tv.x, uy = _tv.z, uz = _tv.y;
    state.vx += ux * thr * 14 * cfg.speed * dt;
    state.vy += uy * thr * 14 * cfg.speed * dt;
    state.vz += uz * thr * 14 * cfg.speed * dt;
    state.vz -= G * dt;

    state.vx *= (1 - 0.4 * dt);
    state.vy *= (1 - 0.4 * dt);
    state.vz *= (1 - 0.4 * dt);
  } else {
    // level — auto-level: tilt toward stick, then body-relative thrust
    const maxTilt = 0.5;
    state.pitch  += ((inp.pitch  * maxTilt) - state.pitch ) * Math.min(1, dt * 6);
    state.roll   += ((inp.roll   * maxTilt) - state.roll  ) * Math.min(1, dt * 6);
    state.heading += inp.yaw * 1.8 * dt;

    state.vz += (thr * 14 * cfg.speed - G) * dt;
    state.vz *= (1 - 0.4 * dt);

    const fx = Math.sin(state.heading) * inp.pitch + Math.cos(state.heading) * inp.roll;
    const fy = Math.cos(state.heading) * inp.pitch - Math.sin(state.heading) * inp.roll;
    const acc = 9.0 * cfg.speed;
    state.vx += fx * acc * dt;
    state.vy += fy * acc * dt;
    state.vx *= (1 - 1.2 * dt);
    state.vy *= (1 - 1.2 * dt);
  }

  state.x += state.vx * dt;
  state.y += state.vy * dt;
  state.z += state.vz * dt;
  if (state.z < 0) {
    state.z = 0; state.vz = 0;
    state.vx *= Math.max(0, 1 - 3.0 * dt);
    state.vy *= Math.max(0, 1 - 3.0 * dt);
  }

  // storm map mechanics
  if(currentMapIdx === 4){
    // wind gusts
    stormTimer -= dt;
    if(stormTimer <= 0){
      const ang = Math.random()*Math.PI*2;
      stormWind = { x: Math.cos(ang)*(3+Math.random()*5), y: Math.sin(ang)*(3+Math.random()*5) };
      stormTimer = 4+Math.random()*6;
    }
    if(stormTimer > 3.0){ // gust active for first ~1s of timer
      state.vx += stormWind.x * dt;
      state.vy += stormWind.y * dt;
    }
    // rain turbulence below 10m
    if(state.z < 10){
      state.pitch += (Math.random()-0.5)*0.02;
      state.roll  += (Math.random()-0.5)*0.02;
    }
    // cloud ceiling at 50m
    if(state.z > 50){
      state.vz -= 20 * dt;
      state.z = 50;
    }
    // lightning flash
    if(Math.random() < 0.001) lightningFlash = 0.4;
    if(lightningFlash > 0) lightningFlash -= dt;
  }

  const fwdX = Math.sin(state.heading), fwdY = Math.cos(state.heading);
  const rgtX = Math.cos(state.heading), rgtY = -Math.sin(state.heading);
  state.dist += (state.vx * fwdX + state.vy * fwdY) * dt;
  state.lat  += (state.vx * rgtX + state.vy * rgtY) * dt;

  // hoop collision
  for(const h of hoops){
    if(h.hit) continue;
    const dx = state.x - h.pos[0], dy = state.y - h.pos[1], dz = state.z - h.pos[2];
    if(dx*dx + dy*dy + dz*dz < 4.0){ // within 2m of hoop center
      h.hit = true;
      score++;
      h.group.scale.set(0.01,0.01,0.01); // shrink away
      // brief glow pulse via emissive — skip for simplicity
    }
  }
}

function resetState() {
  Object.assign(state, { x: 0, y: 0, z: 0, heading: 0, pitch: 0, roll: 0,
    vx: 0, vy: 0, vz: 0, throttle: 0, dist: 0, lat: 0 });
}

// ---- three.js scene ------------------------------------------------------
const view = document.getElementById("view");
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
view.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b8e8);
scene.fog = new THREE.Fog(0x87b8e8, 60, 320);

const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 6, -8);

scene.add(new THREE.HemisphereLight(0xbfdfff, 0x4a7a3a, 0.95));
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(60, 100, 40);
scene.add(sun);

// world (x,y horizontal, z up) -> three (x, z, y)
function toThree(x, y, z) { return new THREE.Vector3(x, z, y); }

// ---- map system ---------------------------------------------------------
const MAPS = [
  { name:'Grassland',      sky:0x87b8e8, fog:0x87b8e8, fN:60, fF:320,
    gnd:0x4f8a3a, g1:0x335533, g2:0x2a4a2a, hC:0xff6600, hE:0xff4400 },
  { name:'Tokyo Neon',     sky:0x0a0a1a, fog:0x0a0a1a, fN:30, fF:100,
    gnd:null, g1:null, g2:null, hC:0x00ffff, hE:0x0088ff },
  { name:'Desert Canyon',  sky:0xd4a56a, fog:0xd4a56a, fN:40, fF:160,
    gnd:0x8b7355, g1:0x6b5335, g2:0x5a4325, hC:0xc8a070, hE:0x8b6914 },
  { name:'Arctic Glacier', sky:0x1a2a3a, fog:0x1a2a3a, fN:40, fF:140,
    gnd:0xc8d8e8, g1:0x8899aa, g2:0x667788, hC:0x88ddff, hE:0x44aacc },
  { name:'Storm',          sky:0x1a1a1a, fog:0x1a1a1a, fN:20, fF:80,
    gnd:0x2a2a2a, g1:null, g2:null, hC:0xffee88, hE:0xffcc00 },
];
let currentMapIdx = 0;
let tileGroups = new Map();
let mapGround = null;
let score = 0;
let hoops = [];
let stormTimer = 0;
let lightningFlash = 0;
const TILE_SIZE = 32;
const TILE_RADIUS = 4;

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    var t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// --- ground textures -----------------------------------------------------
function createNeonTexture() {
  const c = document.createElement('canvas'); c.width=512; c.height=512;
  const ctx = c.getContext('2d');
  ctx.fillStyle='#0a0a1a'; ctx.fillRect(0,0,512,512);
  ctx.strokeStyle='rgba(0,255,255,0.12)'; ctx.lineWidth=1;
  for(let x=0;x<=512;x+=32){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,512);ctx.stroke(); }
  for(let y=0;y<=512;y+=32){ ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(512,y);ctx.stroke(); }
  ctx.strokeStyle='rgba(255,0,255,0.08)'; ctx.lineWidth=2;
  for(let i=0;i<12;i++){ const x=Math.random()*512; ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,512);ctx.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS=tex.wrapT=THREE.RepeatWrapping; tex.repeat.set(80,80);
  return tex;
}
const neonTex = createNeonTexture();

// --- tile decoration generators -------------------------------------------
function genTrees(g, rng) {
  const trunkM = new THREE.MeshLambertMaterial({ color: 0x6b4a2a });
  const leafM = new THREE.MeshLambertMaterial({ color: 0x2f7d32 });
  const n = 2+Math.floor(rng()*4);
  for(let i=0;i<n;i++){
    const x=(rng()-0.5)*TILE_SIZE*0.85, y=(rng()-0.5)*TILE_SIZE*0.85;
    const h=2+rng()*4;
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.18,h,6),trunkM);
    trunk.position.copy(toThree(x,y,h/2)); g.add(trunk);
    const crown=new THREE.Mesh(new THREE.ConeGeometry(0.8+rng()*0.4,1.5+rng()*1.2,8),leafM);
    crown.position.copy(toThree(x,y,h+0.5+rng()*0.5)); g.add(crown);
  }
}
function genBuildings(g, rng) {
  const wallM = new THREE.MeshLambertMaterial({ color: 0x1a1a2e });
  const winM = new THREE.MeshLambertMaterial({ color: 0xffee88, emissive: 0xffaa00, emissiveIntensity: 0.3 });
  const n = 1+Math.floor(rng()*3);
  for(let i=0;i<n;i++){
    const x=(rng()-0.5)*TILE_SIZE*0.85, y=(rng()-0.5)*TILE_SIZE*0.85;
    const w=0.8+rng()*1.5, d=0.8+rng()*1.5, h=4+rng()*12;
    const wall=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),wallM);
    wall.position.copy(toThree(x,y,h/2)); g.add(wall);
    // windows
    const wRows=Math.floor(h/1.5), wCols=Math.floor(Math.min(w,d)/0.5);
    for(let r=0;r<wRows;r++) for(let c=0;c<wCols;c++){
      if(rng()>0.5) continue;
      const ww=new THREE.Mesh(new THREE.BoxGeometry(0.15,0.2,0.15),winM);
      ww.position.set(x+(rng()-0.5)*w*0.7, 0.5+r*1.2+rng()*0.3, y+d/2+0.01);
      g.add(ww);
    }
  }
}
function genCanyon(g, rng) {
  const rockM = new THREE.MeshLambertMaterial({ color: 0x8b7355 });
  const n = 1+Math.floor(rng()*2);
  for(let i=0;i<n;i++){
    const x=(rng()-0.5)*TILE_SIZE*0.9, y=(rng()-0.5)*TILE_SIZE*0.9;
    const h=6+rng()*14, w=2+rng()*4;
    const wall=new THREE.Mesh(new THREE.BoxGeometry(w,h,w*0.6),rockM);
    wall.position.copy(toThree(x,y,h/2)); g.add(wall);
  }
}
function genIce(g, rng) {
  const iceM = new THREE.MeshLambertMaterial({ color: 0xaaccee, emissive: 0x4488bb, emissiveIntensity: 0.15, transparent: true, opacity: 0.7 });
  const n = 2+Math.floor(rng()*4);
  for(let i=0;i<n;i++){
    const x=(rng()-0.5)*TILE_SIZE*0.9, y=(rng()-0.5)*TILE_SIZE*0.9;
    const h=3+rng()*10, r=0.2+rng()*0.5;
    const spike=new THREE.Mesh(new THREE.ConeGeometry(r,h,8),iceM);
    spike.position.copy(toThree(x,y,h/2)); g.add(spike);
  }
}
function genStormSpire(g, rng) {
  const rockM = new THREE.MeshLambertMaterial({ color: 0x3a3a3a });
  const n = 2+Math.floor(rng()*3);
  for(let i=0;i<n;i++){
    const x=(rng()-0.5)*TILE_SIZE*0.9, y=(rng()-0.5)*TILE_SIZE*0.9;
    const h=4+rng()*10, r=0.3+rng()*0.6;
    const spire=new THREE.Mesh(new THREE.ConeGeometry(r,h,6),rockM);
    spire.position.copy(toThree(x,y,h/2)); g.add(spire);
  }
}

// --- hoops ----------------------------------------------------------------
function makeHoop(x, y, z, map) {
  const g = new THREE.Group();
  const hoop = new THREE.Mesh(
    new THREE.TorusGeometry(2, 0.07, 10, 24),
    new THREE.MeshLambertMaterial({ color: map.hC, emissive: map.hE, emissiveIntensity: 0.5 })
  );
  g.add(hoop);
  // glow ring
  const glow = new THREE.Mesh(
    new THREE.RingGeometry(1.95, 2.2, 24),
    new THREE.MeshBasicMaterial({ color: map.hC, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false })
  );
  glow.rotation.x = -Math.PI/2;
  g.add(glow);
  g.position.copy(toThree(x, y, z));
  return g;
}

// --- tile management ------------------------------------------------------
function clearTiles() {
  for(const g of tileGroups.values()) scene.remove(g);
  tileGroups.clear(); hoops = [];
}
const TILE_DECORATORS = [genTrees, genBuildings, genCanyon, genIce, genStormSpire];

function generateTile(cx, cy) {
  const map = MAPS[currentMapIdx];
  const key = cx+','+cy;
  if(tileGroups.has(key)) return;
  const g = new THREE.Group();
  const rng = mulberry32(1337 + cx*10007 + cy*100003);
  // decoration via lookup table
  TILE_DECORATORS[currentMapIdx](g, rng);
  // hoops
  const hCount = 2+Math.floor(rng()*2);
  for(let i=0;i<hCount;i++){
    const hx=cx*TILE_SIZE+(rng()-0.5)*TILE_SIZE*0.8;
    const hy=cy*TILE_SIZE+(rng()-0.5)*TILE_SIZE*0.8;
    const hz=3+rng()*18;
    const hoop = makeHoop(hx, hy, hz, map);
    g.add(hoop);
    hoops.push({ group: hoop, hit: false, pos: [hx, hy, hz] });
  }
  scene.add(g); tileGroups.set(key, g);
}
function updateTiles() {
  const cx = Math.floor(state.x / TILE_SIZE);
  const cy = Math.floor(state.y / TILE_SIZE);
  for(let dx=-TILE_RADIUS;dx<=TILE_RADIUS;dx++)
    for(let dy=-TILE_RADIUS;dy<=TILE_RADIUS;dy++)
      generateTile(cx+dx, cy+dy);
  for(const [key,g] of tileGroups){
    const [tx,ty]=key.split(',').map(Number);
    if(Math.abs(tx-cx)>TILE_RADIUS+1||Math.abs(ty-cy)>TILE_RADIUS+1){
      scene.remove(g); tileGroups.delete(key);
    }
  }
  // cull distant hoops from collision list
  hoops = hoops.filter(h => {
    if(h.hit) return false;
    const dx = state.x - h.pos[0], dy = state.y - h.pos[1], dz = state.z - h.pos[2];
    return Math.abs(dx) < TILE_SIZE*(TILE_RADIUS+1) && Math.abs(dy) < TILE_SIZE*(TILE_RADIUS+1);
  });
}
function switchMap(dir) {
  clearTiles();
  currentMapIdx = ((currentMapIdx + dir) % MAPS.length + MAPS.length) % MAPS.length;
  const map = MAPS[currentMapIdx];
  scene.background = new THREE.Color(map.sky);
  scene.fog = new THREE.Fog(map.fog, map.fN, map.fF);
  // rebuild ground
  if(mapGround) scene.remove(mapGround);
  if(currentMapIdx === 1){
    mapGround = new THREE.Mesh(new THREE.PlaneGeometry(4000,4000), new THREE.MeshLambertMaterial({ map: neonTex }));
  } else {
    mapGround = new THREE.Mesh(new THREE.PlaneGeometry(4000,4000), new THREE.MeshLambertMaterial({ color: map.gnd }));
  }
  mapGround.rotation.x = -Math.PI/2; scene.add(mapGround);
  // grid
  scene.children = scene.children.filter(c => !(c instanceof THREE.GridHelper));
  if(map.g1 !== null && map.g2 !== null){
    const grid = new THREE.GridHelper(4000, 160, map.g1, map.g2);
    grid.position.y = 0.05; scene.add(grid);
  }
  // reset state for new map
  resetState(); score = 0; stormTimer = 0; lightningFlash = 0;
  updateTiles();
}

// --- initial scene --------------------------------------------------------
const mapDef = MAPS[0];
scene.background = new THREE.Color(mapDef.sky);
scene.fog = new THREE.Fog(mapDef.fog, mapDef.fN, mapDef.fF);
mapGround = new THREE.Mesh(new THREE.PlaneGeometry(4000,4000), new THREE.MeshLambertMaterial({ color: mapDef.gnd }));
mapGround.rotation.x = -Math.PI/2; scene.add(mapGround);
const grid = new THREE.GridHelper(4000, 160, mapDef.g1, mapDef.g2);
grid.position.y = 0.05; scene.add(grid);

// --- storm mechanics helpers -----------------------------------------------
let stormWind = { x: 0, y: 0 };

// quadcopter model
const drone = new THREE.Group();
const bodyMat = new THREE.MeshLambertMaterial({ color: 0x222831 });
const armMat = new THREE.MeshLambertMaterial({ color: 0x444c5a });
drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), bodyMat));
const corners = [[0.32, 0.32], [-0.32, 0.32], [0.32, -0.32], [-0.32, -0.32]];
const props = [];

function createPropGroup(cx, cz) {
  const g = new THREE.Group();
  // hub
  g.add(new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.065, 0.025, 12),
    new THREE.MeshLambertMaterial({ color: 0x444c5a })
  ));
  // blade shape — teardrop profile
  const bladeShape = new THREE.Shape();
  bladeShape.moveTo(0, 0);
  bladeShape.quadraticCurveTo(-0.025, 0.07, -0.015, 0.16);
  bladeShape.quadraticCurveTo(0, 0.19, 0.015, 0.16);
  bladeShape.quadraticCurveTo(0.025, 0.07, 0.01, 0);
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0xd0d0d0, side: THREE.DoubleSide });
  const bladeGeo = new THREE.ShapeGeometry(bladeShape);
  const ang = Math.atan2(cx, cz);
  for (let i = 0; i < 2; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.rotation.x = -Math.PI / 2;   // lay flat (XZ plane)
    blade.rotation.z = ang + i * Math.PI;
    blade.position.y = 0.001;
    g.add(blade);
  }
  // spin blur disc
  const blurDisc = new THREE.Mesh(
    new THREE.CircleGeometry(0.25, 24),
    new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false })
  );
  blurDisc.rotation.x = -Math.PI / 2;
  g.add(blurDisc);
  return g;
}

for (const [cx, cz] of corners) {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.62), armMat);
  arm.position.set(cx / 2, 0, cz / 2);
  arm.lookAt(new THREE.Vector3(cx, 0, cz));
  drone.add(arm);
  const motor = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.14, 12), bodyMat);
  motor.position.set(cx, 0.07, cz);
  drone.add(motor);
  const prop = createPropGroup(cx, cz);
  prop.position.set(cx, 0.16, cz);
  drone.add(prop);
  props.push(prop);
}
// forward arrow on top to mark the front (+Z local = forward)
const arrow = new THREE.Mesh(
  new THREE.ConeGeometry(0.1, 0.32, 12),
  new THREE.MeshLambertMaterial({ color: 0xff3333 })
);
arrow.rotation.x = Math.PI / 2;    // cone tip points -Z (forward)
arrow.position.set(0, 0.22, -0.2);
drone.add(arrow);

drone.rotation.order = "YXZ";
scene.add(drone);

// ---- camera -------------------------------------------------------------
const DEG2RAD = Math.PI / 180;
const _fwd = new THREE.Vector3();
const _desired = new THREE.Vector3();
const _look = new THREE.Vector3();
function updateCamera() {
  const dp = toThree(state.x, state.y, state.z + 0.25);
  drone.position.copy(dp);
  drone.rotation.y = -state.heading;
  drone.rotation.x = state.pitch;
  drone.rotation.z = state.roll;
  drone.updateMatrixWorld();

  _q.setFromEuler(drone.rotation);

  if (!fpvMode) {
    if (cfg.camFollow) {
      // rigid rear mount: camera quaternion = drone quaternion (preserves roll)
      _tv.set(0, cfg.camHgt, -cfg.camDist).applyQuaternion(_q);
      camera.position.copy(dp).add(_tv);
      camera.quaternion.copy(_q);
    } else {
      // world-fixed orbit
      const az = cfg.camAz * DEG2RAD;
      _desired.set(
        dp.x - Math.sin(az) * cfg.camDist,
        dp.y + cfg.camHgt,
        dp.z - Math.cos(az) * cfg.camDist
      );
      if (_desired.y < 1.0) _desired.y = 1.0;
      camera.position.copy(_desired);
      camera.lookAt(dp);
    }
  } else {
    // FPV: cockpit position, drone quaternion for orientation
    _tv.set(0, 0.3, 0.35).applyQuaternion(_q);
    camera.position.copy(dp).add(_tv);
    camera.quaternion.copy(_q);
  }
}

// ---- HUD ---------------------------------------------------------------
function updateHud(inp) {
  const map = MAPS[currentMapIdx];
  document.getElementById("status").innerHTML =
    `ALT ${state.z.toFixed(1)} m<br/>` +
    `SPD ${Math.hypot(state.vx, state.vy).toFixed(1)} m/s<br/>` +
    `PIT ${(-state.pitch * 57.3).toFixed(0)}&deg; ` +
    `ROL ${(state.roll * 57.3).toFixed(0)}&deg;<br/>` +
    `CAM ${fpvMode ? "FPV" : "CHASE"}<br/>` +
    `SRC ${inp.source}<br/>` +
    `MAP ${map.name} &middot; SCORE ${score}` +
    (lightningFlash > 0 ? ' &middot; <span style="color:#fff">FLASH</span>' : '');
  document.getElementById("thrfill").style.height = (state.throttle * 100).toFixed(0) + "%";

  // comprehensive axis debugger: visual bars for every axis the browser exposes
  let pfx = rawPadId ? rawPadId.replace(/^.*?(Drone.*)$/i, "$1") : "-";
  let dbg = `<b>${pfx}</b> (${rawAxes.length} axes)`;
  if (mapStatus) dbg += ` &middot; ${mapStatus}`;
  if (axisMap) {
    dbg += ` &middot; L[${axisMap.lx},${axisMap.ly}] R[${axisMap.rx},${axisMap.ry}]`;
  }
  for (let i = 0; i < rawAxes.length; i++) {
    const v = rawAxes[i];
    const range = axisLo[i] !== undefined ? (axisHi[i] - axisLo[i]) : 0;
    const active = range > 0.15;
    const dead = range < 0.02 && axisLo.length > i;
    const pct = (v + 1) / 2 * 100; // 0% = -1, 50% = 0, 100% = +1
    const dotColor = dead ? "#555" : (active ? "#ff9" : "#886");
    let label = `<span style="width:38px;text-align:right;display:inline-block">a[${i}]</span>`;
    if (axisMap) {
      if      (i === axisMap.lx) label = `<span style="width:38px;text-align:right;display:inline-block;color:#6f6">LX→THR</span>`;
      else if (i === axisMap.ly) label = `<span style="width:38px;text-align:right;display:inline-block;color:#6f6">LY→YAW</span>`;
      else if (i === axisMap.rx) label = `<span style="width:38px;text-align:right;display:inline-block;color:#6f6">RX→PIT</span>`;
      else if (i === axisMap.ry) label = `<span style="width:38px;text-align:right;display:inline-block;color:#6f6">RY→ROL</span>`;
    }
    dbg += `<div style="display:flex;align-items:center;gap:3px;margin:0">${label}`;
    dbg += `<span style="position:relative;width:80px;height:5px;background:rgba(0,0,0,0.3);flex-shrink:0;border-radius:2px;overflow:hidden">`;
    dbg += `<span style="position:absolute;top:0;left:${pct}%;width:3px;height:100%;background:${dotColor};transform:translateX(-1.5px)"></span>`;
    dbg += `</span>`;
    dbg += `<span style="width:40px;text-align:right">${v.toFixed(2)}</span>`;
    dbg += `<span style="color:${active?"#9f9":"#555"}">${active?"●":dead?"○":"?"}</span></div>`;
  }
  document.getElementById("axisdebug").innerHTML = dbg;
}

// ---- settings panel -----------------------------------------------------
function setCamDist(v)     { cfg.camDist = +v; document.getElementById("lblCamDist").textContent = v; }
function setCamHgt(v)      { cfg.camHgt  = +v; document.getElementById("lblCamHgt").textContent  = v; }
function setCamAz(v)       { cfg.camAz   = +v; document.getElementById("lblCamAz").textContent    = v; }
function setCamFollow(v)   { cfg.camFollow = v; document.getElementById("azRange").disabled = v; }
function toggleAcro(v)     { cfg.acro = v; }
function setInvert(axis)   { return function(v) { cfg.invert[axis] = v; }; }
function setDeadzone(axis) { return function(v) { cfg.deadzone[axis] = +v; document.getElementById("lblDeadzone"+axis).textContent = (+v).toFixed(2); }; }
function setSpeed(v)       { cfg.speed = +v; document.getElementById("lblSpeed").textContent = (+v).toFixed(1); }

function renderSettings() {
  const s = document.getElementById("settings");
  s.innerHTML =
    `<label>Cam Dist <input type="range" min="1" max="10" step="0.5" value="${cfg.camDist}"` +
    ` oninput="setCamDist(this.value)"> <span id="lblCamDist">${cfg.camDist}</span></label>` +
    `<label>Cam Height <input type="range" min="-2" max="5" step="0.5" value="${cfg.camHgt}"` +
    ` oninput="setCamHgt(this.value)"> <span id="lblCamHgt">${cfg.camHgt}</span></label>` +
    `<label>Cam Azimuth <input id="azRange" type="range" min="-180" max="180" step="5" value="${cfg.camAz}"` +
    ` ${cfg.camFollow ? "disabled" : ""} oninput="setCamAz(this.value)">` +
    ` <span id="lblCamAz">${cfg.camAz}</span></label>` +
    `<label>Cam Follow <input type="checkbox" ${cfg.camFollow ? "checked" : ""}` +
    ` onchange="setCamFollow(this.checked)"></label>` +
    `<label>Acro Mode <input type="checkbox" ${cfg.acro ? "checked" : ""}` +
    ` onchange="toggleAcro(this.checked)"></label>` +
    `<hr/>` +
    `<label>Invert Yaw <input type="checkbox" ${cfg.invert.yaw ? "checked" : ""}` +
    ` onchange="setInvert('yaw')(this.checked)"></label>` +
    `<label>Invert Throttle <input type="checkbox" ${cfg.invert.throttle ? "checked" : ""}` +
    ` onchange="setInvert('throttle')(this.checked)"></label>` +
    `<label>Invert Roll <input type="checkbox" ${cfg.invert.roll ? "checked" : ""}` +
    ` onchange="setInvert('roll')(this.checked)"></label>` +
    `<label>Invert Pitch <input type="checkbox" ${cfg.invert.pitch ? "checked" : ""}` +
    ` onchange="setInvert('pitch')(this.checked)"></label>` +
    `<hr/>` +
    `<label>DZ Yaw <input type="range" min="0.02" max="0.30" step="0.01" value="${cfg.deadzone.yaw}"` +
    ` oninput="setDeadzone('yaw')(this.value)"> <span id="lblDeadzoneyaw">${cfg.deadzone.yaw.toFixed(2)}</span></label>` +
    `<label>DZ Thr <input type="range" min="0.02" max="0.20" step="0.01" value="${cfg.deadzone.throttle}"` +
    ` oninput="setDeadzone('throttle')(this.value)"> <span id="lblDeadzonethrottle">${cfg.deadzone.throttle.toFixed(2)}</span></label>` +
    `<label>DZ Rol <input type="range" min="0.02" max="0.20" step="0.01" value="${cfg.deadzone.roll}"` +
    ` oninput="setDeadzone('roll')(this.value)"> <span id="lblDeadzoneroll">${cfg.deadzone.roll.toFixed(2)}</span></label>` +
    `<label>DZ Pit <input type="range" min="0.02" max="0.20" step="0.01" value="${cfg.deadzone.pitch}"` +
    ` oninput="setDeadzone('pitch')(this.value)"> <span id="lblDeadzonepitch">${cfg.deadzone.pitch.toFixed(2)}</span></label>` +
    `<hr/>` +
    `<label>Speed <input type="range" min="0.2" max="5.0" step="0.1" value="${cfg.speed}"` +
    ` oninput="setSpeed(this.value)"> <span id="lblSpeed">${cfg.speed.toFixed(1)}</span></label>`;
  s.style.display = settingsVisible ? "block" : "none";
}

// ---- loop ---------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

let last = performance.now();
function loop(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  const inp = readInput();
  if (!state.paused) {
    step(dt, inp);
    const spin = state.throttle * 3.0;
    for (const p of props) p.rotation.y += spin;
  }
  updateTiles();
  updateCamera();
  // lightning flash overlay
  const flashEl = document.getElementById("flash");
  if(lightningFlash > 0 && currentMapIdx === 4){
    flashEl.style.opacity = Math.min(0.85, lightningFlash * 4);
  } else {
    flashEl.style.opacity = 0;
  }
  renderer.render(scene, camera);
  updateHud(inp);
  requestAnimationFrame(loop);
}
try { renderSettings(); } catch (e) { console.warn("Settings panel error:", e); }
requestAnimationFrame(loop);
