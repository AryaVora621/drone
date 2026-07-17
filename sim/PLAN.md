# FPV Sim — Implementation Plan

## Files to change

| File | What |
|------|------|
| `sim/fpv.js` | Settings object, acro physics, camera modes, roll sign fix, settings panel rendering |
| `sim/fpv.html` | Settings panel div + CSS |

---

## 1. Settings object (replaces DEADZONE + INVERT consts)

Remove `const DEADZONE = 0.06` and `const INVERT = {...}`.
Add after auto-detection globals:

```js
const cfg = {
  camDist: 4, camHgt: 2, camAz: 0, camFollow: true,
  acro: false,
  invert: { yaw: true, throttle: true, roll: true, pitch: true },
  deadzone: 0.06,
};
const _q = new THREE.Quaternion();
const _tv = new THREE.Vector3();
```

`dz()` reads `cfg.deadzone`. `readInput` reads `cfg.invert.*`.

---

## 2. Fix visual roll sign

`drone.rotation.z = state.roll` (remove the `-`).

---

## 3. Acro physics (cfg.acro === true)

```
PITCH_RATE = 3.5, ROLL_RATE = 3.5, YAW_RATE = 2.0 (rad/s per unit stick)
state.pitch += inp.pitch * PITCH_RATE * dt
state.roll  += inp.roll  * ROLL_RATE * dt
state.heading += inp.yaw * YAW_RATE * dt
thr = Math.max(0, inp.throttle)
```

Thrust direction: `_q.setFromEuler(drone.rotation)` then `_tv.set(0,1,0).applyQuaternion(_q)`.
Convert Three direction (x, y=up, z=north) to our z-up: `(tx, tz, ty)`.

```
vx += ux * thr * 14 * dt
vy += uy * thr * 14 * dt
vz += uz * thr * 14 * dt
vz -= G * dt
vx *= (1 - 0.4 * dt); vy *= (1 - 0.4 * dt); vz *= (1 - 0.4 * dt)
```

Level mode (cfg.acro === false): keep existing physics unchanged.

---

## 4. Camera modes

Follow mode (cfg.camFollow === true): `az = state.heading + Math.PI` (behind).
Fixed mode (false): `az = cfg.camAz * DEG2RAD` (world-fixed).

```
camOffset = (-sin(az)*camDist, camHgt, -cos(az)*camDist)
desired = dp + camOffset; clamp desired.y >= 1
camera.position.copy(desired)
camera.lookAt(dp)
```

---

## 5. Settings panel (Z toggle)

**HTML** (`fpv.html`): add `<div id="settings"></div>` + CSS (centered overlay, dark translucent background, monospace, z-index 10).

**JS** (`fpv.js`): `renderSettings()` sets `innerHTML` with:

  - Cam Dist range 1–10 step 0.5
  - Cam Height range -2–5 step 0.5
  - Cam Azimuth range -180–180 step 5 (disabled when follow)
  - Cam Follow checkbox
  - Acro Mode checkbox
  - Invert Yaw/Throttle/Roll/Pitch checkboxes
  - Deadzone range 0.02–0.20 step 0.01

Each control has an `onchange` → global setter (`setCamDist(v)` etc.) that updates `cfg` + label.

**Key handler**: Z toggles `settingsVisible` + display of `#settings`.

---

## 6. Throttle behavior

No reverse thrust. `thr = Math.max(0, inp.throttle)` in both acro and level modes.

---

## Order of implementation

1. Add `cfg` + `_q` + `_tv`; remove old consts.
2. Update `dz()` and `readInput` to use cfg.
3. Fix visual roll sign.
4. Add acro physics branch in `step()`.
5. Rewrite `updateCamera()` with follow/fixed modes.
6. Add `renderSettings()` function.
7. Add Z key handler.
8. Update `fpv.html`: panel div + CSS.
