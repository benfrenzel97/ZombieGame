# Zombie Survival — Bug Tracker

## Fixed in Build A (post-Stage 3 polish)

### B1 — Zombie damage flip-flop ✅
Fixed by introducing engagement vs reset zones. Zombies now keep attacking once they reach `r+18` of the player, and only reset their attack timer if they retreat past `r+30`. No more bouncing in/out of attack range.

### B2 — Zombie clips into character on rear attack ✅
Fixed with a hard push-out: if a zombie's center comes within `r+9` of a player, the server pushes the zombie out by 70% of the overlap distance.

### B3 — Sprint continues after stamina depleted ✅
Fixed with an exhaustion lock. Once stamina hits 0, the player is flagged exhausted and can't sprint until stamina recovers to 30% of max.

### B4 — Zombies in walls / corner pathing ✅
Fixed with three improvements: (1) wall avoidance now probes both forward AND left/right at zombie body radius, (2) hard safeguard pushes zombies out of wall tiles every tick if they end up in one, (3) priority for sliding away from blocked side.

### B5 — Stash UI inert ✅
Fixed by adding explicit `pointer-events:auto` to all overlay descendants and disabling canvas pointer-events while overlays are open. Canvas was intercepting clicks because of its `cursor:none` setup.

### B6 — Character slowly rotates while running ✅
Fixed by recomputing `mouse.wx/wy` from current camera position every input tick instead of only on mousemove. Cached value was going stale as the camera followed the player.

### B7 — Hospital rooms face the hallway with no entry ✅
Hospital generator rewritten. Rooms now sit cleanly between hallway runs, with doors guaranteed to open onto a pre-carved hallway tile. Each room gets 1-2 randomly chosen doors on the sides facing hallways.

### B8 — Hospital hallways cluttered with rooms ✅
Same rewrite. Grid spacing tightened — clean alternating pattern of `[HALL 3w] [ROOM 7w] [HALL 3w] [ROOM 7w]` so corridors stay clear and rooms don't overlap them.

---

## Open bugs

(none currently tracked)

---

## Notes
- All 8 originally-tracked bugs are now resolved as of Build A.
- Build B (next) will add the death system overhaul (spectator, no night respawn, all-die reset, solo lives).

