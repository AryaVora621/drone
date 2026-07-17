# FPV Sim — Design Decisions

## Default config
camDist: 3.5, camHgt: 2, camAz: 0, camFollow: false, acro: true,
deadzone: { yaw: 0.15, throttle: 0.08, roll: 0.08, pitch: 0.08 },
speed: 1.0, invert: { yaw: false, throttle: true, roll: true, pitch: true }

## Camera
Both chase mount and FPV use drone's quaternion directly (not lookAt).
- Chase (camFollow): position offset (0, camHgt, -camDist) rotated by drone quaternion.
  Camera quaternion = drone quaternion (preserves roll).
- FPV (C key): position offset (0, 0.3, 0.35) in local space (cockpit).
  Camera quaternion = drone quaternion.
- World-fixed orbit (camFollow=false): unchanged.

## Speed
Slider 0.2-5.0, step 0.1. Scales all thrust in both acro and level.

## Propellers
Zero throttle = zero spin. `spin = state.throttle * 3.0`.
Group per motor: hub + 2 teardrop blades (ShapeGeometry) + blur disc.

## Ground friction
z <= 0: z=0, vz=0, vx/vy decay at 3x/s.

## Map system (N key to cycle)
5 maps. 32x32 tiles, VIEW_RADIUS=4, seeded RNG, infinite procedural.
1-3 hoops per tile (2m radius, TorusGeometry).
Hoop collision detection: score counter + particle burst + recycle.

### Grassland (1/5)
Sky 0x87b8e8, green PlaneGeometry, GridHelper. Trees (Cylinder+Cone).
Orange hoops.

### Tokyo Neon (2/5)
Sky 0x0a0a1a, fog 30-100. Canvas-texture ground (dark + glowing grid lines).
Buildings with emissive windows. Cyan hoops.

### Desert Canyon (3/5)
Sky 0xd4a56a, warm haze. Sandy ground. Canyon walls + mesa buttes
(BoxGeometry groups in slot layouts). Stone-arch hoops.

### Arctic Glacier (4/5)
Sky 0x1a2a3a, cold blue fog. Reflective ice ground. Ice spikes
(ConeGeometry) + crystal columns. Aurora light strips. Cyan/white
translucent ice hoops.

### Storm (5/5 - Hard)
Sky 0x1a1a1a, short dark fog. Dark wet rock ground. Jagged rock spires.
Yellow/white emissive hoops.
Mechanics: wind gusts (3-8s, 3-8N, 1s active), lightning flash (400ms blind,
0.001/frame chance), rain turbulence (+/-0.02 perturbs below 10m),
cloud ceiling (50m hard cap).
