// ─────────────────────────────────────────────────────────────────────────────
//  Zombie Survival — Multiplayer Server
//  Stack: Node.js + Socket.io
//  Run:   node server.js
// ─────────────────────────────────────────────────────────────────────────────

const express   = require('express');
const http      = require('http');
const { Server } = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors: { origin: '*', methods: ['GET','POST'] }
});

// Serve the game client
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ─── Constants ────────────────────────────────────────────────────────────────
const TICK_RATE    = 20;          // server ticks per second
const TILE         = 40;
const MAP_W        = 130;
const MAP_H        = 130;
const DAY_DUR      = 60 * TICK_RATE * 3;   // 3 min day
const NIGHT_DUR    = 45 * TICK_RATE * 3;   // 2.25 min night

const T_WALL = 0, T_FLOOR = 1, T_COURTYARD = 2, T_BASE = 3;

// ─── Map Generation (server-side, same algorithm as client) ──────────────────
function rng(a, b) { return Math.floor(Math.random() * (b - a + 1)) + a; }

function generateMap() {
  const tiles = Array.from({ length: MAP_H }, () => new Array(MAP_W).fill(T_WALL));
  const CX = Math.floor(MAP_W / 2), CY = Math.floor(MAP_H / 2);
  const BORD = 4;

  // Complex footprint
  for (let y = BORD; y < MAP_H - BORD; y++)
    for (let x = BORD; x < MAP_W - BORD; x++)
      tiles[y][x] = T_COURTYARD;

  // Central base
  const BASE_R = 9;
  const bx1 = CX - BASE_R, bx2 = CX + BASE_R;
  const by1 = CY - BASE_R, by2 = CY + BASE_R;
  for (let y = by1; y <= by2; y++)
    for (let x = bx1; x <= bx2; x++)
      tiles[y][x] = T_BASE;
  for (let y = by1; y <= by2; y++) { tiles[y][bx1] = T_WALL; tiles[y][bx2] = T_WALL; }
  for (let x = bx1; x <= bx2; x++) { tiles[by1][x] = T_WALL; tiles[by2][x] = T_WALL; }
  for (let d = -1; d <= 1; d++) {
    tiles[by1][CX + d] = T_BASE; tiles[by2][CX + d] = T_BASE;
    tiles[CY + d][bx1] = T_BASE; tiles[CY + d][bx2] = T_BASE;
  }

  // Wings
  const WING_GAP = 6;
  const wings = [
    { dir: 'N', x: CX - 11, y: BORD,               w: 22, h: by1 - BORD - WING_GAP },
    { dir: 'S', x: CX - 11, y: by2 + WING_GAP,     w: 22, h: MAP_H - BORD - by2 - WING_GAP },
    { dir: 'W', x: BORD,    y: CY - 11,             w: bx1 - BORD - WING_GAP, h: 22 },
    { dir: 'E', x: bx2 + WING_GAP, y: CY - 11,     w: MAP_W - BORD - bx2 - WING_GAP, h: 22 },
  ];
  for (const wing of wings) buildWing(tiles, wing);

  // Perimeter walls
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < BORD; x++) tiles[y][x] = T_WALL;
    for (let x = MAP_W - BORD; x < MAP_W; x++) tiles[y][x] = T_WALL;
  }
  for (let x = 0; x < MAP_W; x++) {
    for (let y = 0; y < BORD; y++) tiles[y][x] = T_WALL;
    for (let y = MAP_H - BORD; y < MAP_H; y++) tiles[y][x] = T_WALL;
  }
  // Gate openings
  const gw = 3;
  for (let d = -gw; d <= gw; d++) {
    tiles[BORD][CX + d] = T_COURTYARD;
    tiles[MAP_H - BORD - 1][CX + d] = T_COURTYARD;
    tiles[CY + d][BORD] = T_COURTYARD;
    tiles[CY + d][MAP_W - BORD - 1] = T_COURTYARD;
  }

  // Collect floor tiles
  const floorTiles = { indoor: [], courtyard: [], base: [] };
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) {
    const t = tiles[y][x];
    if (t === T_FLOOR)     floorTiles.indoor.push({ x, y });
    if (t === T_COURTYARD) floorTiles.courtyard.push({ x, y });
    if (t === T_BASE)      floorTiles.base.push({ x, y });
  }

  return { tiles, floorTiles, CX, CY, bx1, bx2, by1, by2 };
}

function buildWing(tiles, { dir, x, y, w, h }) {
  if (w < 8 || h < 8 || x < 0 || y < 0 || x + w >= MAP_W || y + h >= MAP_H) return;
  for (let ty = y; ty < y + h; ty++)
    for (let tx = x; tx < x + w; tx++)
      tiles[ty][tx] = T_FLOOR;
  for (let ty = y; ty < y + h; ty++) { tiles[ty][x] = T_WALL; tiles[ty][x + w - 1] = T_WALL; }
  for (let tx = x; tx < x + w; tx++) { tiles[y][tx] = T_WALL; tiles[y + h - 1][tx] = T_WALL; }

  if (dir === 'N' || dir === 'S') {
    const hallY = y + Math.floor(h / 2);
    for (let tx = x + 1; tx < x + w - 1; tx++) tiles[hallY][tx] = T_FLOOR;
    let cx2 = x + 2;
    while (cx2 < x + w - 5) {
      const rw2 = rng(4, 7), rh2 = rng(3, 5);
      if (cx2 + rw2 >= x + w - 2) break;
      if (hallY - rh2 - 1 > y + 1) {
        carveRoom(tiles, cx2, hallY - rh2 - 1, rw2, rh2);
        tiles[hallY - 1][cx2 + Math.floor(rw2 / 2)] = T_FLOOR;
      }
      if (hallY + rh2 + 1 < y + h - 1) {
        carveRoom(tiles, cx2, hallY + 2, rw2, rh2);
        tiles[hallY + 2][cx2 + Math.floor(rw2 / 2)] = T_FLOOR;
      }
      cx2 += rw2 + 2;
    }
    const entX = x + Math.floor(w / 2);
    for (let d = -2; d <= 2; d++)
      tiles[dir === 'N' ? y + h - 1 : y][entX + d] = T_FLOOR;
  } else {
    const hallX = x + Math.floor(w / 2);
    for (let ty = y + 1; ty < y + h - 1; ty++) tiles[ty][hallX] = T_FLOOR;
    let cy2 = y + 2;
    while (cy2 < y + h - 5) {
      const rw2 = rng(3, 5), rh2 = rng(4, 7);
      if (cy2 + rh2 >= y + h - 2) break;
      if (hallX - rw2 - 1 > x + 1) {
        carveRoom(tiles, hallX - rw2 - 1, cy2, rw2, rh2);
        tiles[cy2 + Math.floor(rh2 / 2)][hallX - 1] = T_FLOOR;
      }
      if (hallX + rw2 + 1 < x + w - 1) {
        carveRoom(tiles, hallX + 2, cy2, rw2, rh2);
        tiles[cy2 + Math.floor(rh2 / 2)][hallX + 2] = T_FLOOR;
      }
      cy2 += rh2 + 2;
    }
    const entY = y + Math.floor(h / 2);
    for (let d = -2; d <= 2; d++)
      tiles[entY + d][dir === 'W' ? x + w - 1 : x] = T_FLOOR;
  }
}

function carveRoom(tiles, x, y, w, h) {
  for (let ty = y; ty < y + h; ty++)
    for (let tx = x; tx < x + w; tx++)
      tiles[ty][tx] = T_WALL;
  for (let ty = y + 1; ty < y + h - 1; ty++)
    for (let tx = x + 1; tx < x + w - 1; tx++)
      tiles[ty][tx] = T_FLOOR;
}

// ─── Game Room ────────────────────────────────────────────────────────────────
class GameRoom {
  constructor(id) {
    this.id       = id;
    this.players  = new Map();   // socketId → playerState
    this.zombies  = [];
    this.pickups  = [];
    this.barricades = [];
    this.bullets  = [];

    this.day      = 1;
    this.dayTimer = DAY_DUR;
    this.isNight  = false;
    this.hordeActive  = false;
    this.hordeSpawned = 0;
    this.hordeMax     = 20;
    this.hordeSpawnTimer = 0;
    this.nextZombieId = 0;
    this.nextPickupId = 0;

    const map = generateMap();
    this.tiles      = map.tiles;
    this.floorTiles = map.floorTiles;
    this.CX = map.CX; this.CY = map.CY;
    this.bx1 = map.bx1; this.bx2 = map.bx2;
    this.by1 = map.by1; this.by2 = map.by2;

    this._spawnInitialZombies();
    this._spawnInitialPickups();

    this.interval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  destroy() { clearInterval(this.interval); }

  isSolid(tx, ty) {
    if (tx < 0 || tx >= MAP_W || ty < 0 || ty >= MAP_H) return true;
    return this.tiles[ty][tx] === T_WALL;
  }

  _safeFloor(pool) {
    if (!pool.length) return { x: this.CX, y: this.CY };
    return pool[rng(0, pool.length - 1)];
  }

  _spawnInitialZombies() {
    const pool = [...this.floorTiles.indoor, ...this.floorTiles.courtyard];
    for (let i = 0; i < 30; i++) {
      const t = pool[rng(0, pool.length - 1)];
      if (Math.abs(t.x - this.CX) < 15 && Math.abs(t.y - this.CY) < 15) continue;
      this._addZombie(t.x * TILE + TILE / 2, t.y * TILE + TILE / 2);
    }
  }

  _spawnInitialPickups() {
    const types = ['ammo','medkit','wood','shotgun_ammo','rifle_ammo'];
    for (let i = 0; i < 25; i++) {
      const pool = Math.random() < 0.6 ? this.floorTiles.indoor : this.floorTiles.courtyard;
      const t = pool[rng(0, pool.length - 1)];
      this.pickups.push({
        id: this.nextPickupId++,
        x: t.x * TILE + TILE / 2, y: t.y * TILE + TILE / 2,
        type: types[rng(0, 4)], amount: rng(8, 20),
      });
    }
  }

  _addZombie(x, y, big) {
    big = big || Math.random() < 0.12;
    const z = {
      id: this.nextZombieId++, x, y,
      hp: big ? 90 + this.day * 12 : 30 + this.day * 5,
      maxHp: big ? 90 + this.day * 12 : 30 + this.day * 5,
      speed: big ? 0.55 + Math.random() * 0.3 : 0.95 + Math.random() * 0.7 + this.day * 0.07,
      type: big ? 'big' : 'normal',
      angle: 0, attackTimer: 0,
      vx: 0, vy: 0,
    };
    this.zombies.push(z);
    return z;
  }

  _moveEntity(e, dx, dy, r) {
    r = r || 10;
    const nx = e.x + dx, ny = e.y + dy;
    const txL  = Math.floor((nx - r) / TILE), txR  = Math.floor((nx + r) / TILE);
    const tyT  = Math.floor((e.y - r) / TILE), tyB  = Math.floor((e.y + r) / TILE);
    const txL2 = Math.floor((e.x - r) / TILE), txR2 = Math.floor((e.x + r) / TILE);
    const tyT2 = Math.floor((ny - r) / TILE), tyB2 = Math.floor((ny + r) / TILE);
    if (!this.isSolid(txL,tyT)&&!this.isSolid(txR,tyT)&&!this.isSolid(txL,tyB)&&!this.isSolid(txR,tyB)) e.x = nx;
    if (!this.isSolid(txL2,tyT2)&&!this.isSolid(txR2,tyT2)&&!this.isSolid(txL2,tyB2)&&!this.isSolid(txR2,tyB2)) e.y = ny;
  }

  addPlayer(socketId, name) {
    this.players.set(socketId, {
      id: socketId, name,
      x: this.CX * TILE + TILE / 2 + rng(-60, 60),
      y: this.CY * TILE + TILE / 2 + rng(-60, 60),
      hp: 100, maxHp: 100,
      angle: 0,
      weapons: [
        { name:'Pistol',   ammo:30, maxAmmo:30 },
        { name:'Shotgun',  ammo:0,  maxAmmo:8  },
        { name:'Rifle',    ammo:0,  maxAmmo:20 },
      ],
      currentWeapon: 0,
      wood: 0, kills: 0, alive: true,
      vx: 0, vy: 0,
      shootCooldown: 0,
    });
  }

  removePlayer(socketId) { this.players.delete(socketId); }

  handleInput(socketId, input) {
    const p = this.players.get(socketId);
    if (!p || !p.alive) return;
    p.dx    = input.dx    || 0;
    p.dy    = input.dy    || 0;
    p.angle = input.angle || 0;
    p.shooting      = input.shooting || false;
    p.switchWeapon  = input.switchWeapon;
    p.reloadReq     = input.reloadReq || false;
  }

  handleBuild(socketId, { tx, ty }) {
    const p = this.players.get(socketId);
    if (!p || p.wood < 3) return;
    if (this.isSolid(tx, ty)) return;
    if (this.barricades.find(b => b.tx === tx && b.ty === ty)) return;
    p.wood -= 3;
    this.barricades.push({ tx, ty, wx: tx*TILE+TILE/2, wy: ty*TILE+TILE/2, hp:100, maxHp:100 });
    io.to(this.id).emit('barricadeAdded', { tx, ty, wx: tx*TILE+TILE/2, wy: ty*TILE+TILE/2 });
  }

  tick() {
    // Day/night
    this.dayTimer--;
    if (this.dayTimer <= 0) {
      if (!this.isNight) {
        this.isNight = true; this.dayTimer = NIGHT_DUR;
        this.hordeActive = true; this.hordeSpawned = 0;
        this.hordeMax = 20 + this.day * 10;
        io.to(this.id).emit('hordeStart', { day: this.day });
      } else {
        this.isNight = false; this.day++; this.dayTimer = DAY_DUR;
        this.hordeActive = false;
        io.to(this.id).emit('dayStart', { day: this.day });
        // Respawn
        const pool = [...this.floorTiles.indoor, ...this.floorTiles.courtyard];
        for (let i = 0; i < 6 + this.day; i++) {
          const t = pool[rng(0, pool.length - 1)];
          if (Math.abs(t.x-this.CX)<12&&Math.abs(t.y-this.CY)<12) continue;
          this._addZombie(t.x*TILE+TILE/2, t.y*TILE+TILE/2);
        }
        const ptypes=['ammo','medkit','wood','shotgun_ammo','rifle_ammo'];
        for (let i=0;i<7;i++) {
          const pool2=Math.random()<0.6?this.floorTiles.indoor:this.floorTiles.courtyard;
          const t=pool2[rng(0,pool2.length-1)];
          const pk={id:this.nextPickupId++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,type:ptypes[rng(0,4)],amount:rng(8,20)};
          this.pickups.push(pk);
          io.to(this.id).emit('pickupSpawned', pk);
        }
      }
    }

    // Horde spawning
    if (this.hordeActive && this.hordeSpawned < this.hordeMax) {
      this.hordeSpawnTimer--;
      if (this.hordeSpawnTimer <= 0) {
        const pool=[...this.floorTiles.courtyard,...this.floorTiles.indoor];
        for (let attempt=0;attempt<20;attempt++) {
          const t=pool[rng(0,pool.length-1)];
          // Spawn away from all players
          let tooClose=false;
          for (const p of this.players.values()) {
            if (Math.hypot(t.x*TILE-p.x,t.y*TILE-p.y)<400){tooClose=true;break;}
          }
          if (tooClose) continue;
          const z=this._addZombie(t.x*TILE+TILE/2,t.y*TILE+TILE/2);
          io.to(this.id).emit('zombieSpawned',z);
          this.hordeSpawned++;
          this.hordeSpawnTimer=rng(6,20);
          break;
        }
      }
    }

    // Update players
    const WEAPON_COOLDOWNS = [8, 35, 4];
    const WEAPON_RELOADS   = [80, 120, 100];
    const WEAPON_SPEEDS    = [14, 12, 22];
    const WEAPON_LIVES     = [55, 28, 80];
    const WEAPON_DAMAGE    = [22, 18, 38];
    const WEAPON_PELLETS   = [1, 6, 1];
    const WEAPON_SPREAD    = [0.05, 0.22, 0.02];

    for (const [sid, p] of this.players) {
      if (!p.alive) continue;
      if (p.switchWeapon !== undefined && p.switchWeapon !== p.currentWeapon) {
        p.currentWeapon = p.switchWeapon; p.reloading = false; p.reloadTimer = 0;
        p.switchWeapon = undefined;
      }
      const speed = 3.2;
      let dx = p.dx || 0, dy = p.dy || 0;
      const mag = Math.hypot(dx, dy);
      if (mag > 1) { dx /= mag; dy /= mag; }
      this._moveEntity(p, dx * speed, dy * speed, 10);

      // Reload
      if (p.reloading) {
        p.reloadTimer--;
        if (p.reloadTimer <= 0) {
          p.weapons[p.currentWeapon].ammo = p.weapons[p.currentWeapon].maxAmmo;
          p.reloading = false;
        }
      }
      if (p.reloadReq && !p.reloading) {
        p.reloading = true; p.reloadTimer = WEAPON_RELOADS[p.currentWeapon];
        p.reloadReq = false;
      }

      // Shoot
      if (p.shootCooldown > 0) p.shootCooldown--;
      const wi = p.currentWeapon;
      const wep = p.weapons[wi];
      if (p.shooting && !p.reloading && wep.ammo > 0 && p.shootCooldown <= 0) {
        wep.ammo--;
        p.shootCooldown = WEAPON_COOLDOWNS[wi];
        for (let pel=0;pel<WEAPON_PELLETS[wi];pel++) {
          const sp = (Math.random()-0.5)*WEAPON_SPREAD[wi]*2;
          const ang = p.angle + sp;
          this.bullets.push({
            x:p.x, y:p.y, vx:Math.cos(ang)*WEAPON_SPEEDS[wi], vy:Math.sin(ang)*WEAPON_SPEEDS[wi],
            life:WEAPON_LIVES[wi], damage:WEAPON_DAMAGE[wi], owner:sid,
          });
        }
        if (wep.ammo === 0) { p.reloading=true; p.reloadTimer=WEAPON_RELOADS[wi]; }
      }

      // Pickup collection
      this.pickups = this.pickups.filter(pk => {
        const d = Math.hypot(pk.x-p.x, pk.y-p.y);
        if (d < 32) {
          let taken = false;
          if (pk.type==='ammo'&&p.weapons[0].ammo<p.weapons[0].maxAmmo){p.weapons[0].ammo=Math.min(p.weapons[0].maxAmmo,p.weapons[0].ammo+pk.amount);taken=true;}
          else if (pk.type==='shotgun_ammo'){p.weapons[1].ammo=Math.min(p.weapons[1].maxAmmo,p.weapons[1].ammo+pk.amount);taken=true;}
          else if (pk.type==='rifle_ammo'){p.weapons[2].ammo=Math.min(p.weapons[2].maxAmmo,p.weapons[2].ammo+pk.amount);taken=true;}
          else if (pk.type==='medkit'&&p.hp<p.maxHp){p.hp=Math.min(p.maxHp,p.hp+pk.amount);taken=true;}
          else if (pk.type==='wood'){p.wood+=pk.amount;taken=true;}
          if (taken) { io.to(this.id).emit('pickupTaken', { id:pk.id, playerId:sid }); return false; }
        }
        return true;
      });
    }

    // Update bullets
    this.bullets = this.bullets.filter(b => {
      b.x += b.vx; b.y += b.vy; b.life--;
      if (this.isSolid(Math.floor(b.x/TILE), Math.floor(b.y/TILE))) return false;
      for (const bar of this.barricades) if (Math.hypot(b.x-bar.wx,b.y-bar.wy)<20) return false;
      for (const z of this.zombies) {
        const r = z.type==='big'?16:12;
        if (Math.hypot(b.x-z.x,b.y-z.y)<r) {
          z.hp -= b.damage;
          if (z.hp <= 0) {
            const p = this.players.get(b.owner);
            if (p) p.kills++;
            // Drop pickup
            if (Math.random()<0.25) {
              const types=['ammo','medkit','wood'];
              const pk={id:this.nextPickupId++,x:z.x,y:z.y,type:types[rng(0,2)],amount:rng(5,12)};
              this.pickups.push(pk);
              io.to(this.id).emit('pickupSpawned',pk);
            }
            io.to(this.id).emit('zombieKilled', { id: z.id, killerId: b.owner });
            this.zombies = this.zombies.filter(zz => zz.id !== z.id);
          }
          return false;
        }
      }
      return b.life > 0;
    });

    // Update zombies — move toward nearest player
    for (const z of this.zombies) {
      let nearestDist = Infinity, nearestP = null;
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(z.x-p.x, z.y-p.y);
        if (d < nearestDist) { nearestDist = d; nearestP = p; }
      }
      if (!nearestP) continue;

      const toX = nearestP.x - z.x, toY = nearestP.y - z.y;
      const d = Math.hypot(toX, toY) || 1;
      let mdx = toX/d, mdy = toY/d;
      const mag2 = Math.hypot(mdx, mdy)||1;
      mdx /= mag2; mdy /= mag2;
      const r = z.type==='big'?14:10;
      this._moveEntity(z, mdx*z.speed, mdy*z.speed, r);
      z.angle = Math.atan2(mdy, mdx);

      // Attack barricades
      let hitBarricade = false;
      for (const bar of this.barricades) {
        if (Math.hypot(z.x-bar.wx,z.y-bar.wy)<r+22) {
          z.attackTimer++;
          if (z.attackTimer>=45*TICK_RATE/20) {
            z.attackTimer=0; bar.hp-=z.type==='big'?14:7;
            if (bar.hp<=0) {
              io.to(this.id).emit('barricadeDestroyed',{tx:bar.tx,ty:bar.ty});
              this.barricades=this.barricades.filter(b=>b!==bar);
            }
          }
          hitBarricade=true; break;
        }
      }
      if (!hitBarricade && nearestDist < r+12) {
        z.attackTimer++;
        if (z.attackTimer>=40) {
          z.attackTimer=0;
          nearestP.hp -= z.type==='big'?13:7;
          if (nearestP.hp<=0) {
            nearestP.hp=0; nearestP.alive=false;
            io.to(this.id).emit('playerDied',{id:nearestP.id,kills:nearestP.kills,day:this.day});
          }
        }
      } else if (hitBarricade) {
        // reset
      } else { z.attackTimer=Math.max(0,z.attackTimer-1); }
    }

    // Broadcast state at tick rate
    const state = {
      players: Array.from(this.players.values()).map(p=>({
        id:p.id, name:p.name, x:p.x, y:p.y, angle:p.angle, hp:p.hp, maxHp:p.maxHp,
        currentWeapon:p.currentWeapon, weapons:p.weapons, wood:p.wood, kills:p.kills,
        alive:p.alive, reloading:p.reloading,
      })),
      zombies: this.zombies.map(z=>({id:z.id,x:z.x,y:z.y,hp:z.hp,maxHp:z.maxHp,angle:z.angle,type:z.type})),
      bullets: this.bullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy})),
      barricades: this.barricades.map(b=>({tx:b.tx,ty:b.ty,wx:b.wx,wy:b.wy,hp:b.hp,maxHp:b.maxHp})),
      day: this.day, dayTimer: this.dayTimer, isNight: this.isNight,
      hordeActive: this.hordeActive,
    };
    io.to(this.id).emit('state', state);
  }
}

// ─── Room management ──────────────────────────────────────────────────────────
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new GameRoom(roomId));
  return rooms.get(roomId);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[+] Connected: ${socket.id}`);
  let currentRoom = null;
  let playerName  = 'Survivor';

  socket.on('joinRoom', ({ roomId, name }) => {
    roomId = (roomId || 'main').toString().slice(0, 20);
    playerName = (name || 'Survivor').toString().slice(0, 16);

    currentRoom = getOrCreateRoom(roomId);
    socket.join(roomId);
    currentRoom.addPlayer(socket.id, playerName);

    // Send map and initial state to joining player
    socket.emit('init', {
      playerId: socket.id,
      tiles:    currentRoom.tiles,
      pickups:  currentRoom.pickups,
      barricades: currentRoom.barricades,
      CX: currentRoom.CX, CY: currentRoom.CY,
      bx1:currentRoom.bx1, bx2:currentRoom.bx2,
      by1:currentRoom.by1, by2:currentRoom.by2,
    });

    console.log(`[>] ${playerName} joined room ${roomId} (${currentRoom.players.size} players)`);
    io.to(roomId).emit('playerJoined', { id: socket.id, name: playerName });
  });

  socket.on('input', input => {
    if (currentRoom) currentRoom.handleInput(socket.id, input);
  });

  socket.on('build', data => {
    if (currentRoom) currentRoom.handleBuild(socket.id, data);
  });

  socket.on('disconnect', () => {
    if (currentRoom) {
      currentRoom.removePlayer(socket.id);
      io.to(currentRoom.id).emit('playerLeft', { id: socket.id });
      if (currentRoom.players.size === 0) {
        currentRoom.destroy();
        rooms.delete(currentRoom.id);
        console.log(`[x] Room ${currentRoom.id} destroyed`);
      }
    }
    console.log(`[-] Disconnected: ${socket.id}`);
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🧟 Zombie server running on port ${PORT}`));
