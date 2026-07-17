# Session Checkpoint — Jul 17, 2026 (ALL pre-prop Phase C checks PASSED — next: motor direction + props)

## Status
Phase A + B complete. Phase C: every pre-prop verification item now passes — axis mapping, motor pin/corner mapping, motor protocol, and failsafe behavior all confirmed. **Next action: motor direction fix** (2 of 4 motors need reversed wiring for CW/CCW alternation), then props on with a final low-throttle check.

### Failsafe check — PASSED, with an important operational lesson
Controller powered off → drone correctly went to `arm flags: FAILSAFE RX_FAILSAFE` (cuts/holds throttle low, does NOT hold last command) — confirmed via two consecutive `status` polls, stable. Controller powered back on → **link did not auto-recover**. Root cause: espnow-rclink's pairing is a one-way lock — once a transmitter believes it's paired, it refuses new pair requests from a receiver that has since forgotten the pairing (e.g. after the receiver reboots), until the transmitter *itself* also power-cycles. Fix: power-cycled the controller (transmitter) first, then rebooted the drone (receiver) — matching esp-fc's documented recommended startup order ("turn on transmitter first, then receiver") — link recovered cleanly within ~14s. **Lesson for future sessions/actual flying: if the link drops mid-session, don't assume turning the controller back on alone will reconnect it — both sides may need a fresh boot, transmitter first.** Not a flight-safety issue itself (drone stays safely failsafe'd during any gap), just an operational quirk to plan around.

**Full plan for this phase: see `ESPFC_PLAN.md`.** Resume there, not here, for phase-by-phase detail.

## Current hardware state
- **Drone**: on USB (`/dev/cu.usbserial-0001`) + battery (LiPo connected to ESCs, BEC red wire disconnected — no dual-5V conflict). Running esp-fc, fully configured and verified.
- **Controller**: on its own battery pack, running axis-swap-corrected `esp32u_espnow` firmware. Independent of the data cable.
- Only one CP2102 data cable total, dedicated to the drone now — see prior lesson about port-name ambiguity (`/dev/cu.usbserial-0001` vs `/dev/cu.SLAB_USBtoUART`), verify board identity via boot text if ever in doubt.

## Phase A — COMPLETE, Phase B — COMPLETE
See prior checkpoint history / `ESPFC_PLAN.md` for full detail.

## Phase C — IN PROGRESS, major progress this turn
### Lesson (still applies): don't use esp-fc's WiFi rescue-mode CLI once a real link exists
The WiFi TCP CLI/MSP server only runs while `rescueConfigMode == RESCUE_CONFIG_ACTIVE`, which self-disables permanently for the rest of a boot once >100 real RC frames arrive. Always use direct USB serial to the drone for anything involving a live link.

### Axis-swap fix — CONFIRMED WORKING
Both joystick modules are physically mounted rotated 90 degrees. Fixed in `controller/src/main_espnow.cpp` (swapped which ADC pin feeds which RC channel, no inversion needed). User confirmed via Configurator's Receiver tab after reflashing: all 4 axes now track correctly (left stick up=throttle, right=yaw; right stick up=pitch, right=roll).

### NEW bug found and fixed this turn: motor output pins didn't match the mixer's spatial assumptions
Motors tab initially showed motor slider 1 spinning the FRONT-LEFT corner. Cross-checked against the board's *live* `mixer` CLI dump (not just generic docs) to derive ground truth:
- Roll mix (`mix_0..3`, src=1): `output_0`,`output_1` = -100 (one side), `output_2`,`output_3` = +100 (other side)
- Pitch mix (`mix_4..7`, src=2): `output_0`,`output_2` = +100 (one side), `output_1`,`output_3` = -100 (other side)
- Combined with the Configurator's own QUADX reference diagram (M1=rear-right, M2=front-right, M3=rear-left, M4=front-left), this fully confirms: **`output_0`=rear-right, `output_1`=front-right, `output_2`=rear-left, `output_3`=front-left** — a specific rotational order, not our project's FL/FR/BR/BL declaration order.

Our original pin mapping (`pin_output_0..3` = 12/14/17/16, i.e. FL/FR/BR/BL in that literal order) only had `output_1`/FR correct by coincidence. **This would have caused wrong physical response to roll/pitch stick input if left unfixed** — each motor spins fine individually, but the mixer math assumes wrong spatial roles, meaning commanding pure roll could produce a mixed/wrong physical torque. Fixed by remapping pins (not rewiring hardware) so each `output_N` drives the physically-correct corner:
- `pin_output_0`: 12→**17** (now BR, matches "output_0=rear-right")
- `pin_output_1`: 14 (unchanged — already correct, FR)
- `pin_output_2`: 17→**16** (now BL, matches "output_2=rear-left")
- `pin_output_3`: 16→**12** (now FL, matches "output_3=front-left")

Saved + rebooted, no unexpected spin. **User confirmed via Motors tab retest: all 4 sliders now spin the correct physical corner.**

**IMPORTANT for future reference**: the `FL=12, FR=14, BR=17, BL=16` pin-to-physical mapping locked in earlier sessions (and in `ESPFC_PLAN.md`/`CLAUDE.md`) is still physically true (which GPIO wire goes to which motor) — what changed is which esp-fc **output index** (`output_0..3`, i.e. which "motor slider" in Configurator) each pin is assigned to. If `CLAUDE.md`/`ESPFC_PLAN.md` are updated later, be precise about this distinction: physical pin→motor is unchanged; output-index→pin is what got corrected.

### Also fixed: motor output protocol
Configurator flagged "no motor output protocol selected" on connect. Found `output_motor_protocol` was `DISABLED` on the device (not `PWM`, despite `PWM` being esp-fc's coded default — actual runtime value differed). Set explicitly:
- `output_motor_protocol PWM` (exact valid string confirmed from `esp-fc/lib/EscDriver/src/EscDriverBase.cpp` `getProtocolNames()`, not guessed)
- `output_min_command 1060`, `output_min_throttle 1070`, `output_max_throttle 1860` — aligned to the project's documented SimonK-safe range (`CLAUDE.md`'s "1060-1860us, NOT 1000-2000us") instead of Betaflight's generic 1000/2000 defaults, for extra margin since these ESCs were never calibrated.

Saved + rebooted with battery already connected on the ESCs (per esp-fc's own docs, this carries a small risk of ESCs interpreting new signal timing as spin-up on first boot after a protocol change) — flagged explicitly to user beforehand, user confirmed ready, reboot was clean, no unexpected spin.

### Known, deferred (not blocking): motor spin direction
User noted all 4 motors currently spin the same direction. QUADX needs diagonal pairs to counter-rotate (FL/BR one way, FR/BL the other) for yaw authority and stability. This is a hardware fix (swap 2 of 3 ESC-to-motor wires on 2 of the 4 motors) — per `ESPFC_PLAN.md`'s existing plan, this happens right before props go on, not now. Not a blocker for the failsafe check.

## Key decisions/lessons locked this session (do not re-derive/re-ask)
- Physical pin wiring: **FL=12, FR=14, BR=17, BL=16** (GPIO to motor, unchanged, matches original soldering).
- esp-fc output-index assignment (corrected this turn): **`pin_output_0`=17(BR), `pin_output_1`=14(FR), `pin_output_2`=16(BL), `pin_output_3`=12(FL)** — do not revert to the old 12/14/17/16 literal FL/FR/BR/BL order, that was the bug.
- `output_motor_protocol`=PWM, range 1060/1070/1860 (min_command/min_throttle/max_throttle) — matches SimonK's documented safe range.
- ESP-NOW channel mapping: AETR order, ch0=roll,1=pitch,2=throttle,3=yaw. Stick axis swap applied in controller firmware (see above).
- Always use direct USB serial to the drone once a live link exists — not the WiFi rescue-mode CLI.
- Controller runs off its own battery pack, independent of the single data cable (which stays on the drone).
- Hard safety gate: no propellers until esp-fc + ESP-NOW control path verified via Betaflight Configurator's Motors tab (props off) AND failsafe check passes — **both now PASSED.**
- If the ESP-NOW link ever drops mid-session, reconnecting may require power-cycling BOTH boards (transmitter/controller first, then receiver/drone) — turning the controller back on alone is not guaranteed to reconnect it.

## Next action
1. **Motor direction fix**: swap 2 of 3 ESC wires on 2 diagonal-opposite motors (FL+BR one direction, FR+BL the other) so they counter-rotate, matching `ESPFC_PLAN.md` step 6. Hardware fix, props still off during this.
2. Only after that: install props (correct CW/CCW per corner — verify against the corrected output mapping, not the old one), final low-throttle check with props on + controller connected.

## Files updated this session
- `esp-fc/` — cloned+built+flashed (Phase A, prior turn)
- `controller/platformio.ini`, `controller/src/diag.cpp` — Phase B (prior turn)
- `controller/src/main_espnow.cpp` — axis-swap fix, reflashed (this session)
- Drone esp-fc config: pin_output_0/2/3 remapped, output_motor_protocol=PWM + throttle range set, saved+rebooted (this turn)
- `TASK_QUEUE.md` — updated to reflect Motors/Receiver tab pass
- `CHECKPOINT_LAST.md` — this file
