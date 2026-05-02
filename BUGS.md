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

## Build A also added

- Terminal moved next to exit corridor (south side of base)
- Night zombies now spawn from exit corridor only and swarm the entrance
- Night spawn rate increased (peaks every 5 ticks vs every 8)
- Each loot room in zones spawns 3-5 extra zombies as guards

## Build B — Death system overhaul ✅

- **Night/extract death = no respawn.** Player goes to spectator mode instead.
- **Spectator mode:** camera follows a living teammate, arrow keys cycle target. T/ESC still work for chat/menu.
- **Survivors revive spectators:** if anyone reaches morning (sleep or full night), all spectators auto-respawn for the next day.
- **Team wipe:** if all players are dead/spectating, the run resets to Day 1 with stash and upgrades wiped.
- **Solo lives:** solo player gets 2 lives. First death = stash wiped, upgrades preserved, advance to morning. Second death = full reset.
- **Day deaths unchanged:** normal respawn timer (12s/9s/6s/4s based on Faster Respawn upgrade).

## Build B Hotfix — Phase transition teleport bug ✅

### B9 — Player teleported to bad spawn when horde countdown ends ✅
When the horde countdown ended (night → morning → base transition), the server was forcibly teleporting ALL players to the sleep quarters spawn point on the left side of the map, regardless of where they actually were. If players were defending at the corridor when night ended, they'd suddenly find themselves yanked across the map, sometimes inside a wall or in a position that killed them.

**Fix:** Both `_enterNight` and `_enterBase` now only relocate players who actually need it — players already at base stay put. `_enterBase` also has a wall-safety check that relocates a player if their position ended up inside a wall tile. `_enterMorning` now also clears all zombies/bullets/grenades so the morning transition is visually clean.

---

## Build B Hotfix 2 — Bug trace findings ✅

While walking through the death system mentally, I found four more bugs and fixed them:

### B10 — Caught-by-night incorrectly sent to day-respawn ✅
`_enterNight` was killing players still in the zone *before* setting the phase to 'night'. That meant `_handlePlayerDeath` saw the phase as still 'extract' and routed them through the day-death path instead of spectator mode. They'd "respawn" at base 12 seconds later, breaking the no-respawn-at-night rule.

**Fix:** `_enterNight` now sets `this.phase='night'` as the very first thing, so caught-by-night deaths correctly route to spectator mode.

### B11 — Extract phase deaths going to spectator instead of normal respawn ✅
`_isNightDeath` returned true for both 'night' and 'extract'. That meant if you died in the zone during the 30-second extract window (still trying to escape), you'd go to spectator mode. Should only happen during the actual horde defense.

**Fix:** `_isNightDeath` now returns true for 'night' phase only.

### B12 — Death didn't reset all carried inventory ✅
Death cleared wood and scrap, but not parts (upgrade currency), grenades, toolboxes, or adrenaline buff. Inconsistent.

**Fix:** All carried resources, signature pickups, and active buffs now zero out on death.

### B13 — Spectator stuck on disconnected teammate ✅
If your spectate target disconnected, the camera lookup returned null and the camera fell back to your own corpse. You had to hit arrow keys manually to find a new target.

**Fix:** Spectator camera now auto-falls-back to any other living teammate if the current target is gone or dead.

---

## Open bugs

(none currently tracked)

---

## Notes
- All 8 originally-tracked bugs and the death system overhaul are complete as of Build B.

