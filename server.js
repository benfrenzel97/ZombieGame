// ─────────────────────────────────────────────────────────────────────────────
//  Zombie Survival — Server v5 (Stage 1 · Turn 1)
//  Phase machine: base → day → extract → night → morning → base
//  Persistent base + procedural daily zones (mall theme)
// ─────────────────────────────────────────────────────────────────────────────
const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Room browser endpoint — list active rooms with player counts
app.get('/api/rooms', (req, res) => {
  const list=[];
  for(const[id,room]of rooms){
    const players=Array.from(room.players.values()).map(p=>p.name||'?');
    list.push({
      id,
      playerCount:room.players.size,
      maxPlayers:6,
      day:room.day||1,
      phase:room.phase||'base',
      players,
    });
  }
  res.json({rooms:list});
});

const TICK=20, TILE=40;
const T_WALL=0, T_FLOOR=1, T_COURT=2, T_BASE=3, T_LOOT=4, T_BASE_HUB=5, T_CORRIDOR=6;
const DAY_TICKS=TICK*180, NIGHT_TICKS=TICK*135;
const EXTRACT_TICKS=TICK*30, MORNING_TICKS=TICK*10;

function rng(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function pick(arr){return arr[rng(0,arr.length-1)];}

// ─── Weapon Definitions ───────────────────────────────────────────────────────
const WDEFS={
  pistol:  {name:'Pistol',  type:'gun', mag:12,maxMag:12,reserve:36, maxReserve:60, damage:22,spread:0.05,pellets:1,cooldown:8, reload:50,bSpeed:14,bLife:55,color:'#ff9'},
  shotgun: {name:'Shotgun', type:'gun', mag:6, maxMag:6, reserve:12, maxReserve:24, damage:20,spread:0.22,pellets:6,cooldown:32,reload:90,bSpeed:12,bLife:28,color:'#fa4'},
  rifle:   {name:'Rifle',   type:'gun', mag:10,maxMag:10,reserve:30, maxReserve:50, damage:40,spread:0.02,pellets:1,cooldown:5, reload:70,bSpeed:22,bLife:80,color:'#4ff'},
  smg:     {name:'SMG',     type:'gun', mag:20,maxMag:20,reserve:40, maxReserve:80, damage:14,spread:0.10,pellets:1,cooldown:3, reload:65,bSpeed:16,bLife:45,color:'#f4f'},
};
const MDEFS={
  knife:   {name:'Knife',   type:'melee',damage:18, range:38, arc:0.6, cooldown:14, knockback:2.5, color:'#aaf'},
  bat:     {name:'Bat',     type:'melee',damage:28, range:46, arc:0.8, cooldown:22, knockback:5.0, color:'#fa8'},
  axe:     {name:'Axe',     type:'melee',damage:48, range:50, arc:1.0, cooldown:36, knockback:3.5, color:'#f44'},
  machete: {name:'Machete', type:'melee',damage:35, range:55, arc:0.7, cooldown:20, knockback:3.0, color:'#4fa'},
};
function makeGunSlot(t){const d=WDEFS[t];return!d?null:{kind:'gun',type:t,name:d.name,mag:d.mag,maxMag:d.maxMag,reserve:d.reserve,maxReserve:d.maxReserve};}
function makeMeleeSlot(t){const d=MDEFS[t];return!d?null:{kind:'melee',type:t,name:d.name,cooldown:0};}

// ─── Zone size config ────────────────────────────────────────────────────────
const ZONE_SIZES={
  small:  {w:80,  h:80,  loot:3, name:'Small'},
  medium: {w:120, h:120, loot:6, name:'Medium'},
  large:  {w:160, h:160, loot:10,name:'Large'},
};

// ─── Upgrade definitions (Stage 3) ───────────────────────────────────────────
// Each upgrade has 3 tiers, costs scale moderately
// Cost format: { parts, wood, scrap }
const UPGRADE_DEFS={
  // TEAM upgrades
  stash_capacity:{
    name:'Stash Capacity', cat:'defensive', scope:'team',
    desc:'Increases shared stash size',
    effects:['+2 slots','+4 slots','+6 slots'],
    costs:[{parts:5,wood:30,scrap:0},{parts:10,wood:60,scrap:0},{parts:20,wood:100,scrap:0}],
  },
  reinforced_walls:{
    name:'Reinforced Walls', cat:'defensive', scope:'team',
    desc:'Stronger base barricades',
    effects:['Base barricades +50% HP','+100% HP','+150% HP'],
    costs:[{parts:5,wood:30,scrap:10},{parts:10,wood:0,scrap:30},{parts:20,wood:0,scrap:60}],
  },
  sentry_slot:{
    name:'Sentry Slot', cat:'defensive', scope:'team',
    desc:'Auto-turrets at base entrance with passive ammo regen',
    effects:['1 sentry slot','2 sentry slots','3 sentry slots'],
    costs:[{parts:5,wood:0,scrap:30},{parts:10,wood:0,scrap:50},{parts:20,wood:0,scrap:80}],
  },
  // RESOURCE upgrades (also team)
  conversion:{
    name:'Wood Converter', cat:'resource', scope:'team',
    desc:'Workshop converts wood into scrap',
    effects:['5 wood → 1 scrap','3 wood → 1 scrap','2 wood → 1 scrap'],
    costs:[{parts:5,wood:30,scrap:0},{parts:10,wood:60,scrap:0},{parts:20,wood:100,scrap:0}],
  },
  refinery:{
    name:'Ammo Refinery', cat:'resource', scope:'team',
    desc:'Passive ammo generated per night survived',
    effects:['+5 ammo/night','+10 ammo/night','+20 ammo/night'],
    costs:[{parts:5,wood:0,scrap:30},{parts:10,wood:0,scrap:50},{parts:20,wood:0,scrap:100}],
  },
  greenhouse:{
    name:'Medical Greenhouse', cat:'resource', scope:'team',
    desc:'Passive medkit ammo per night survived',
    effects:['+1 medkit/night','+2 medkits/night','+3 medkits/night'],
    costs:[{parts:5,wood:30,scrap:0},{parts:10,wood:50,scrap:0},{parts:20,wood:80,scrap:0}],
  },
  // PERSONAL upgrades
  starting_gun:{
    name:'Better Starting Gun', cat:'offensive', scope:'personal',
    desc:'Upgraded starting weapon on respawn',
    effects:['Spawn with SMG','Spawn with Shotgun','Spawn with Rifle'],
    costs:[{parts:5,wood:0,scrap:30},{parts:10,wood:0,scrap:50},{parts:20,wood:0,scrap:80}],
  },
  faster_respawn:{
    name:'Faster Respawn', cat:'offensive', scope:'personal',
    desc:'Reduced respawn timer',
    effects:['Respawn in 9s','Respawn in 6s','Respawn in 4s'],
    costs:[{parts:5,wood:30,scrap:0},{parts:10,wood:50,scrap:0},{parts:20,wood:80,scrap:0}],
  },
  larger_reserves:{
    name:'Larger Mag Reserves', cat:'offensive', scope:'personal',
    desc:'Higher max reserve ammo cap on all guns',
    effects:['+25% reserve cap','+50% reserve cap','+75% reserve cap'],
    costs:[{parts:5,wood:0,scrap:30},{parts:10,wood:0,scrap:50},{parts:20,wood:0,scrap:80}],
  },
};
function isPersonalUpgrade(key){ return UPGRADE_DEFS[key]?.scope==='personal'; }
function upgradeCost(key,nextTier){
  const d=UPGRADE_DEFS[key];
  if(!d||nextTier<1||nextTier>3)return null;
  return d.costs[nextTier-1];
}

// ─── Base layout (fixed, persistent) ─────────────────────────────────────────
const BASE_W=60, BASE_H=42;
function generateBase(){
  const tiles=Array.from({length:BASE_H},()=>new Array(BASE_W).fill(T_WALL));
  // Carve interior
  for(let y=2;y<BASE_H-2;y++) for(let x=2;x<BASE_W-2;x++) tiles[y][x]=T_BASE_HUB;
  // Interior walls
  for(let y=2;y<BASE_H-2;y++) tiles[y][22]=T_WALL; // stash | hub
  for(let y=2;y<BASE_H-2;y++) tiles[y][42]=T_WALL; // hub | workshop
  for(let x=2;x<22;x++)   tiles[22][x]=T_WALL;     // stash | sleep
  for(let x=22;x<42;x++)  tiles[22][x]=T_WALL;     // hub | (lower hub)
  // Door openings (3 tiles each)
  for(let dy=0;dy<3;dy++) tiles[10+dy][22]=T_BASE_HUB;
  for(let dy=0;dy<3;dy++) tiles[10+dy][42]=T_BASE_HUB;
  for(let dx=0;dx<3;dx++) tiles[22][30+dx]=T_BASE_HUB;
  for(let dx=0;dx<3;dx++) tiles[22][10+dx]=T_BASE_HUB;
  // Exit corridor (south) — open it through to the workshop room interior
  for(let x=46;x<=50;x++) for(let y=BASE_H-2;y<BASE_H;y++) tiles[y][x]=T_CORRIDOR;
  // Make sure the workshop room floor extends down to the corridor
  for(let x=46;x<=50;x++) for(let y=BASE_H-5;y<BASE_H-2;y++) tiles[y][x]=T_BASE_HUB;
  return tiles;
}

const BASE_LAYOUT={
  stashTx: 11, stashTy: 10,
  terminalTx: 48, terminalTy: BASE_H-5,    // moved next to exit corridor (south side, near gate)
  spawnTx: 11, spawnTy: 32,
  exitTx: 48, exitTy: BASE_H-1,
  workshopTx: 50, workshopTy: 18,
};

// ─── Zone generation (mall theme) ────────────────────────────────────────────
function generateMallZone(size){
  const cfg=ZONE_SIZES[size]||ZONE_SIZES.medium;
  const W=cfg.w, H=cfg.h;
  const tiles=Array.from({length:H},()=>new Array(W).fill(T_WALL));
  const BORD=4;
  for(let y=BORD;y<H-BORD;y++) for(let x=BORD;x<W-BORD;x++) tiles[y][x]=T_COURT;
  const lootRooms=[];
  const numStores=Math.max(8,Math.floor((W*H)/500));
  for(let i=0;i<numStores;i++){
    const rw=rng(6,12),rh=rng(5,10);
    const rx=rng(BORD+2,W-BORD-rw-2),ry=rng(BORD+2,H-BORD-rh-2);
    if(tiles[ry+1]?.[rx+1]!==T_COURT)continue;
    const isLoot=(lootRooms.length<cfg.loot)||(Math.random()<0.25);
    carveRoom(tiles,rx,ry,rw,rh,isLoot?T_LOOT:T_FLOOR);
    if(isLoot)lootRooms.push({x:rx,y:ry,w:rw,h:rh});
    const side=rng(0,3),mx=rx+Math.floor(rw/2),my=ry+Math.floor(rh/2);
    if(side===0&&ry>BORD)tiles[ry][mx]=T_FLOOR;
    else if(side===1&&ry+rh<H-BORD)tiles[ry+rh-1][mx]=T_FLOOR;
    else if(side===2&&rx>BORD)tiles[my][rx]=T_FLOOR;
    else if(rx+rw<W-BORD)tiles[my][rx+rw-1]=T_FLOOR;
  }
  // North entry from base — wider corridor
  const entryX=Math.floor(W/2);
  for(let dy=0;dy<6;dy++) for(let dx=-2;dx<=2;dx++) tiles[BORD+dy][entryX+dx]=T_CORRIDOR;
  for(let dx=-2;dx<=2;dx++) tiles[BORD-1][entryX+dx]=T_CORRIDOR;
  return finalizeZone(tiles,W,H,lootRooms,entryX,BORD,size);
}

function carveRoom(tiles,x,y,w,h,ft){
  for(let ty=y;ty<y+h;ty++) for(let tx=x;tx<x+w;tx++) tiles[ty][tx]=T_WALL;
  for(let ty=y+1;ty<y+h-1;ty++) for(let tx=x+1;tx<x+w-1;tx++) tiles[ty][tx]=ft;
}

// ─── Hospital Zone ───────────────────────────────────────────────────────────
// Narrow corridors, lots of small rooms, claustrophobic
function generateHospitalZone(size){
  const cfg=ZONE_SIZES[size]||ZONE_SIZES.medium;
  const W=cfg.w, H=cfg.h;
  const tiles=Array.from({length:H},()=>new Array(W).fill(T_WALL));
  const BORD=4;
  const lootRooms=[];

  // B7/B8 fix: clean ward layout
  // Layout pattern (vertical slice, repeats):
  //   [HALL 3w] [ROOM 7w] [HALL 3w] [ROOM 7w] ...
  // Same for vertical: alternating hallway rows and room rows.
  // Doors always open onto a hallway tile that's already cleared.
  const ROOM_W=7, ROOM_H=6;
  const HALL_W=3;

  // Carve all horizontal hallways first
  for(let y=BORD; y<H-BORD; y++){
    // Row pattern: hallway row if (y - BORD) % (ROOM_H + HALL_W) is within HALL_W
    const yp=(y-BORD)%(ROOM_H+HALL_W);
    if(yp<HALL_W){
      for(let x=BORD;x<W-BORD;x++) tiles[y][x]=T_FLOOR;
    }
  }
  // Carve all vertical hallways
  for(let x=BORD; x<W-BORD; x++){
    const xp=(x-BORD)%(ROOM_W+HALL_W);
    if(xp<HALL_W){
      for(let y=BORD;y<H-BORD;y++) tiles[y][x]=T_FLOOR;
    }
  }

  // Now carve rooms in the cell areas (between hallways)
  // A room sits at cells: x = BORD + HALL_W + n*(ROOM_W+HALL_W), y similarly
  for(let gy=BORD+HALL_W; gy<H-BORD-ROOM_H; gy+=(ROOM_H+HALL_W)){
    for(let gx=BORD+HALL_W; gx<W-BORD-ROOM_W; gx+=(ROOM_W+HALL_W)){
      // Random loot or regular
      const isLoot=(lootRooms.length<cfg.loot)&&(Math.random()<0.5);
      const roomFill=isLoot?T_LOOT:T_FLOOR;
      // Carve room walls + interior
      for(let y=gy;y<gy+ROOM_H;y++) for(let x=gx;x<gx+ROOM_W;x++) tiles[y][x]=T_WALL;
      for(let y=gy+1;y<gy+ROOM_H-1;y++) for(let x=gx+1;x<gx+ROOM_W-1;x++) tiles[y][x]=roomFill;
      if(isLoot)lootRooms.push({x:gx,y:gy,w:ROOM_W,h:ROOM_H});

      // 1-2 doors per room, randomly choose sides facing hallways
      const doorSides=[];
      // North side opens to hallway above (which exists by grid design)
      if(gy>BORD)doorSides.push('N');
      // South
      if(gy+ROOM_H<H-BORD)doorSides.push('S');
      // West
      if(gx>BORD)doorSides.push('W');
      // East
      if(gx+ROOM_W<W-BORD)doorSides.push('E');
      // Pick 1-2 doors
      const numDoors=rng(1,Math.min(2,doorSides.length));
      // Shuffle
      for(let i=doorSides.length-1;i>0;i--){
        const j=rng(0,i);[doorSides[i],doorSides[j]]=[doorSides[j],doorSides[i]];
      }
      const chosen=doorSides.slice(0,numDoors);
      const doorX=gx+Math.floor(ROOM_W/2), doorY=gy+Math.floor(ROOM_H/2);
      for(const side of chosen){
        if(side==='N')tiles[gy][doorX]=roomFill;
        if(side==='S')tiles[gy+ROOM_H-1][doorX]=roomFill;
        if(side==='W')tiles[doorY][gx]=roomFill;
        if(side==='E')tiles[doorY][gx+ROOM_W-1]=roomFill;
      }
    }
  }

  // North entry corridor
  const entryX=Math.floor(W/2);
  for(let dy=0;dy<6;dy++) for(let dx=-2;dx<=2;dx++){
    if(BORD+dy<H&&entryX+dx>=0&&entryX+dx<W)tiles[BORD+dy][entryX+dx]=T_CORRIDOR;
  }
  for(let dx=-2;dx<=2;dx++) tiles[BORD-1][entryX+dx]=T_CORRIDOR;
  return finalizeZone(tiles,W,H,lootRooms,entryX,BORD,size);
}

// ─── Military Outpost Zone ───────────────────────────────────────────────────
// Gated perimeter with central command building
function generateMilitaryZone(size){
  const cfg=ZONE_SIZES[size]||ZONE_SIZES.medium;
  const W=cfg.w, H=cfg.h;
  const tiles=Array.from({length:H},()=>new Array(W).fill(T_WALL));
  const BORD=4;
  // Open courtyard everywhere
  for(let y=BORD;y<H-BORD;y++) for(let x=BORD;x<W-BORD;x++) tiles[y][x]=T_COURT;
  const lootRooms=[];

  // Central command building — large fortified structure
  const cx=Math.floor(W/2), cy=Math.floor(H/2);
  const cmdW=Math.floor(W/4), cmdH=Math.floor(H/4);
  const cmdX=cx-Math.floor(cmdW/2), cmdY=cy-Math.floor(cmdH/2);
  carveRoom(tiles,cmdX,cmdY,cmdW,cmdH,T_LOOT);
  lootRooms.push({x:cmdX,y:cmdY,w:cmdW,h:cmdH});
  // Multiple doorways into command building
  tiles[cmdY][cx]=T_FLOOR; tiles[cmdY+cmdH-1][cx]=T_FLOOR;
  tiles[cy][cmdX]=T_FLOOR; tiles[cy][cmdX+cmdW-1]=T_FLOOR;

  // Perimeter wall (one tile inside the border, with 4 gates)
  const perim=BORD+3;
  for(let x=perim;x<W-perim;x++){tiles[perim][x]=T_WALL;tiles[H-perim-1][x]=T_WALL;}
  for(let y=perim;y<H-perim;y++){tiles[y][perim]=T_WALL;tiles[y][W-perim-1]=T_WALL;}
  // Open 4 gates (cardinal)
  for(let d=-3;d<=3;d++){
    tiles[perim][cx+d]=T_COURT;
    tiles[H-perim-1][cx+d]=T_COURT;
    tiles[cy+d][perim]=T_COURT;
    tiles[cy+d][W-perim-1]=T_COURT;
  }

  // Bunker rooms in 4 corners
  const bunkerSize=8;
  const bunkers=[
    {x:perim+3,y:perim+3},
    {x:W-perim-bunkerSize-3,y:perim+3},
    {x:perim+3,y:H-perim-bunkerSize-3},
    {x:W-perim-bunkerSize-3,y:H-perim-bunkerSize-3},
  ];
  for(const b of bunkers){
    if(b.x<BORD+1||b.y<BORD+1||b.x+bunkerSize>=W-BORD||b.y+bunkerSize>=H-BORD)continue;
    const isLoot=lootRooms.length<cfg.loot;
    carveRoom(tiles,b.x,b.y,bunkerSize,bunkerSize,isLoot?T_LOOT:T_FLOOR);
    if(isLoot)lootRooms.push({x:b.x,y:b.y,w:bunkerSize,h:bunkerSize});
    // Door on inward side
    const dx=(b.x<cx)?b.x+bunkerSize-1:b.x;
    const dy=(b.y<cy)?b.y+bunkerSize-1:b.y;
    tiles[b.y+Math.floor(bunkerSize/2)][dx]=T_FLOOR;
    tiles[dy][b.x+Math.floor(bunkerSize/2)]=T_FLOOR;
  }

  // Watchtower outposts (small loot rooms) scattered
  for(let i=0;i<Math.min(cfg.loot-lootRooms.length,4);i++){
    const rx=rng(BORD+2,W-BORD-7),ry=rng(BORD+2,H-BORD-7);
    if(tiles[ry+1]?.[rx+1]!==T_COURT)continue;
    if(Math.abs(rx-cx)<cmdW&&Math.abs(ry-cy)<cmdH)continue;
    carveRoom(tiles,rx,ry,5,5,T_LOOT);
    lootRooms.push({x:rx,y:ry,w:5,h:5});
    tiles[ry+2][rx]=T_FLOOR;
  }

  // North entry corridor (cuts through perimeter)
  const entryX=cx;
  for(let dy=0;dy<6;dy++) for(let dx=-2;dx<=2;dx++){
    if(BORD+dy<H&&entryX+dx>=0&&entryX+dx<W)tiles[BORD+dy][entryX+dx]=T_CORRIDOR;
  }
  for(let dx=-2;dx<=2;dx++) tiles[BORD-1][entryX+dx]=T_CORRIDOR;
  return finalizeZone(tiles,W,H,lootRooms,entryX,BORD,size);
}

// ─── Suburb Zone ─────────────────────────────────────────────────────────────
// Grid of houses with streets between them
function generateSuburbZone(size){
  const cfg=ZONE_SIZES[size]||ZONE_SIZES.medium;
  const W=cfg.w, H=cfg.h;
  const tiles=Array.from({length:H},()=>new Array(W).fill(T_WALL));
  const BORD=4;
  // Streets = open courtyard
  for(let y=BORD;y<H-BORD;y++) for(let x=BORD;x<W-BORD;x++) tiles[y][x]=T_COURT;
  const lootRooms=[];

  // Generate a grid of houses — each house has 2-4 rooms
  const HOUSE_W=14, HOUSE_H=11, STREET=6;
  const cellW=HOUSE_W+STREET, cellH=HOUSE_H+STREET;

  for(let gy=BORD+2;gy<H-BORD-HOUSE_H;gy+=cellH){
    for(let gx=BORD+2;gx<W-BORD-HOUSE_W;gx+=cellW){
      // Build a house: outer walls, internal partitions
      // House outline
      for(let y=gy;y<gy+HOUSE_H;y++) for(let x=gx;x<gx+HOUSE_W;x++) tiles[y][x]=T_WALL;
      const isLoot=lootRooms.length<cfg.loot&&Math.random()<0.7;
      const fillT=isLoot?T_LOOT:T_FLOOR;
      // Number of internal rooms (2-4)
      const numRooms=rng(2,4);
      // Carve interior
      for(let y=gy+1;y<gy+HOUSE_H-1;y++) for(let x=gx+1;x<gx+HOUSE_W-1;x++) tiles[y][x]=fillT;
      if(isLoot)lootRooms.push({x:gx,y:gy,w:HOUSE_W,h:HOUSE_H});
      // Internal partitions for rooms
      if(numRooms>=2){
        // Vertical partition
        const px=gx+Math.floor(HOUSE_W/2);
        for(let y=gy+1;y<gy+HOUSE_H-1;y++) tiles[y][px]=T_WALL;
        // Doorway
        tiles[gy+Math.floor(HOUSE_H/2)][px]=fillT;
      }
      if(numRooms>=3){
        // Horizontal partition (top half)
        const py=gy+Math.floor(HOUSE_H/3);
        for(let x=gx+1;x<gx+Math.floor(HOUSE_W/2);x++) tiles[py][x]=T_WALL;
        tiles[py][gx+Math.floor(HOUSE_W/4)]=fillT;
      }
      if(numRooms>=4){
        // Horizontal partition (bottom half)
        const py=gy+Math.floor(HOUSE_H*2/3);
        for(let x=gx+Math.floor(HOUSE_W/2)+1;x<gx+HOUSE_W-1;x++) tiles[py][x]=T_WALL;
        tiles[py][gx+Math.floor(HOUSE_W*3/4)]=fillT;
      }
      // Front door (south side)
      const doorX=gx+Math.floor(HOUSE_W/2);
      tiles[gy+HOUSE_H-1][doorX]=T_COURT;
      tiles[gy+HOUSE_H-1][doorX-1]=T_COURT;
      // Driveway (small garage entrance)
      if(Math.random()<0.6){
        const garageX=gx+rng(1,3);
        tiles[gy+HOUSE_H-1][garageX]=T_COURT;
        tiles[gy+HOUSE_H-1][garageX+1]=T_COURT;
      }
    }
  }

  // Make sure streets are clear (roads form a grid pattern)
  // Already handled by carving courtyard first then placing house walls within

  // North entry corridor
  const entryX=Math.floor(W/2);
  for(let dy=0;dy<6;dy++) for(let dx=-2;dx<=2;dx++){
    if(BORD+dy<H&&entryX+dx>=0&&entryX+dx<W)tiles[BORD+dy][entryX+dx]=T_CORRIDOR;
  }
  for(let dx=-2;dx<=2;dx++) tiles[BORD-1][entryX+dx]=T_CORRIDOR;
  return finalizeZone(tiles,W,H,lootRooms,entryX,BORD,size);
}

// ─── Helper: finalize a zone (extract floor pools) ──────────────────────────
function finalizeZone(tiles,W,H,lootRooms,entryX,entryY,size){
  const ft={indoor:[],court:[],loot:[]};
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const t=tiles[y][x];
    if(t===T_FLOOR)ft.indoor.push({x,y});
    if(t===T_COURT)ft.court.push({x,y});
    if(t===T_LOOT) ft.loot.push({x,y});
  }
  return{tiles,ft,lootRooms,W,H,entryX,entryY,size};
}

// ─── Theme dispatcher ────────────────────────────────────────────────────────
function generateZone(theme,size){
  switch(theme){
    case 'hospital': return generateHospitalZone(size);
    case 'military': return generateMilitaryZone(size);
    case 'suburb':   return generateSuburbZone(size);
    case 'mall':
    default:         return generateMallZone(size);
  }
}

// ─── BFS Flow Field ──────────────────────────────────────────────────────────
function buildFlow(tiles,W,H,ptx,pty){
  const field=new Int8Array(W*H*2);
  const dist=new Int32Array(W*H).fill(-1);
  const q=[];let head=0;
  const idx=(x,y)=>y*W+x;
  if(ptx<0||ptx>=W||pty<0||pty>=H)return field;
  dist[idx(ptx,pty)]=0;q.push(ptx,pty);
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  while(head<q.length){
    const cx=q[head++],cy=q[head++];
    for(const[ddx,ddy]of dirs){
      const nx=cx+ddx,ny=cy+ddy;
      if(nx<0||nx>=W||ny<0||ny>=H)continue;
      if(tiles[ny][nx]===T_WALL)continue;
      if(ddx&&ddy&&(tiles[cy][nx]===T_WALL||tiles[ny][cx]===T_WALL))continue;
      if(dist[idx(nx,ny)]!==-1)continue;
      dist[idx(nx,ny)]=dist[idx(cx,cy)]+1;
      field[idx(nx,ny)*2]=-ddx;field[idx(nx,ny)*2+1]=-ddy;
      q.push(nx,ny);
    }
  }
  return field;
}

// ─── Zombie ──────────────────────────────────────────────────────────────────
function makeZombie(id,x,y,type,day){
  const D={
    normal:  {hp:40+day*7,  spd:1.1+day*0.09, dmg:15,rate:35},
    big:     {hp:110+day*18,spd:0.6+day*0.05, dmg:28,rate:42},
    runner:  {hp:22+day*5,  spd:2.4+day*0.13, dmg:10,rate:22},
    screamer:{hp:50+day*9,  spd:0.75+day*0.06,dmg:12,rate:48},
  };
  const d=D[type]||D.normal;
  return{id,x,y,type,hp:d.hp,maxHp:d.hp,
    speed:d.spd+(Math.random()-0.5)*0.15,
    damage:d.dmg,attackRate:d.rate,angle:Math.random()*Math.PI*2,attackTimer:0,
    screaming:false,screamTimer:rng(40,120),screamRadius:0,
    stuckTimer:0,prevX:x,prevY:y,
    knockbackVx:0,knockbackVy:0,
    zigzagPhase:Math.random()*Math.PI*2,_alertTimer:0,
    // Stealth state machine (day-only)
    aiState:'idle',                        // 'idle' | 'alerted' | 'chasing'
    investigateX:null, investigateY:null,  // last known target position when alerted
    investigateLook:0,                     // ticks left to "look around" at investigate point
    wanderDir:Math.random()*Math.PI*2,     // current wander direction
    wanderChange:rng(80,140),              // ticks until next direction change
    wanderPause:0,                         // ticks left of paused wander
    chaseTargetId:null,                    // which player they're locked onto
  };
}

// ─── Game Room ───────────────────────────────────────────────────────────────

// Map of socket.id → socket, for sending per-player events (stash UI etc.)
const sockets = new Map();
function socketBySid(sid) { return sockets.get(sid); }

class GameRoom{
  constructor(id){
    this.id=id;
    this.players=new Map();
    this.zombies=[];this.bullets=[];
    this.pickups=[];this.groundWeapons=[];
    this.barricades=[];this.turrets=[];
    this.pings=[];this.gunshots=[];
    this.grenadesActive=[];
    this._tick=0;
    this.nzid=0;this.npid=0;this.ngwid=0;this.ntid=0;

    // Persistent base
    this.baseTiles=generateBase();
    this.baseBarricades=[];
    this.baseTurrets=[];

    // Stash — resources include parts now
    this.stash={
      resources:{wood:0,scrap:0,parts:0,
        pistol_ammo:0,shotgun_ammo:0,rifle_ammo:0,smg_ammo:0},
      weapons:[],
    };

    // Team-shared upgrades (persist for the run)
    this.teamUpgrades={
      stash_capacity:0,    // 0..3 — adds 2/4/6 to stash size
      reinforced_walls:0,  // 0..3 — base barricade HP multiplier
      sentry_slot:0,       // 0..3 — auto turrets at base entrance
      conversion:0,        // 0..3 — wood→scrap converter (lower wood per scrap)
      refinery:0,          // 0..3 — passive ammo per night survived
      greenhouse:0,        // 0..3 — passive medkit per night survived
    };

    // Phase state
    this.day=1;
    this.phase='base';
    this.phaseTimer=0;
    this.zoneTimer=0;
    this.nightTimer=0;
    this.sleepUnlockTime=TICK*60;
    this.sleepAvailable=false;
    this.fightBonus={wood:0,scrap:0,ammo:0,parts:0,fullNight:false};

    // Death system (Build B)
    this.soloLives=2;          // Solo-only: 2 lives, first death = lose stash, second = full reset
    this.gameResetPending=false;

    this.zone=null;
    this.scoutReport=this._rollScoutReport();

    this.flows=new Map();this.flowTimer=0;

    this.interval=setInterval(()=>this.tick(),1000/TICK);
  }

  destroy(){clearInterval(this.interval);}

  _rollScoutReport(){
    const sizes=['small','medium','large'];
    const themes=['mall','hospital','military','suburb'];
    const theme=pick(themes);
    // Theme-flavored horde descriptions
    const flavors={
      mall:    ['Balanced — mixed types','Loud — more screamers','Swift — more runners','Heavy — more bigs'],
      hospital:['Screamers swarm the halls','Patient zero outbreak','Crowded — many normals','Echoes of the dying'],
      military:['Armored juggernauts','Heavy — many bigs','Soldiers turned tanks','Reinforced ranks'],
      suburb:  ['Track teams sprinting','Swift — many runners','Joggers chase relentlessly','Suburban swarm'],
    };
    return{
      theme,
      size:pick(sizes),
      hordeFlavor:pick(flavors[theme]||flavors.mall),
    };
  }

  _activeWorld(){
    return this.zone||{tiles:this.baseTiles,W:BASE_W,H:BASE_H};
  }

  _atBasePhase(){return this.phase==='base'||this.phase==='night'||this.phase==='morning';}
  _atZonePhase(){return this.phase==='day'||this.phase==='extract';}

  _allBarricades(){return this._atZonePhase()?this.barricades:this.baseBarricades;}
  _allTurrets(){return this._atZonePhase()?this.turrets:this.baseTurrets;}

  isSolid(tx,ty,ignoreDoors=false){
    const w=this._activeWorld();
    if(tx<0||tx>=w.W||ty<0||ty>=w.H)return true;
    if(w.tiles[ty][tx]===T_WALL)return true;
    if(!ignoreDoors){
      for(const bar of this._allBarricades()){
        if(bar.tx===tx&&bar.ty===ty&&!(bar.isDoor&&bar.isOpen))return true;
      }
    }
    return false;
  }

  // ─── Stealth helpers (day phase) ──────────────────────────────────────────
  // Bresenham-style ray cast through tile grid, returns true if no wall blocks LOS.
  hasLineOfSight(x1,y1,x2,y2){
    const t1x=Math.floor(x1/TILE), t1y=Math.floor(y1/TILE);
    const t2x=Math.floor(x2/TILE), t2y=Math.floor(y2/TILE);
    const dx=Math.abs(t2x-t1x), dy=Math.abs(t2y-t1y);
    let x=t1x, y=t1y;
    const sx=t1x<t2x?1:-1, sy=t1y<t2y?1:-1;
    let err=dx-dy;
    let steps=0;
    while(steps<60){  // safety cap
      if(x===t2x&&y===t2y)return true;
      // Don't count the start tile; check current as potential wall (but ignore doors so closed doors block LOS too — actually we want walls only for vision)
      if(!(x===t1x&&y===t1y)){
        const w=this._activeWorld();
        if(x<0||x>=w.W||y<0||y>=w.H)return false;
        if(w.tiles[y][x]===T_WALL)return false;
        // Closed barricades/doors also block sight
        for(const bar of this._allBarricades()){
          if(bar.tx===x&&bar.ty===y&&!(bar.isDoor&&bar.isOpen))return false;
        }
      }
      const e2=2*err;
      if(e2>-dy){err-=dy;x+=sx;}
      if(e2< dx){err+=dx;y+=sy;}
      steps++;
    }
    return false;
  }

  // Returns the closest player visible to this zombie (in cone, in range, in LOS), or null.
  zombieDayVision(z){
    const VISION_RANGE=250;
    const VISION_HALF_ANGLE=Math.PI/4;  // 90° cone (45° each side)
    let best=null, bestD=Infinity;
    for(const p of this.players.values()){
      if(!p.alive||p.spectating)continue;
      const dx=p.x-z.x, dy=p.y-z.y, dd=Math.hypot(dx,dy);
      if(dd>VISION_RANGE)continue;
      // Cone check: angle between zombie facing and player direction
      const playerAng=Math.atan2(dy,dx);
      let diff=playerAng-z.angle;
      while(diff>Math.PI)diff-=2*Math.PI;
      while(diff<-Math.PI)diff+=2*Math.PI;
      if(Math.abs(diff)>VISION_HALF_ANGLE)continue;
      // Line of sight check
      if(!this.hasLineOfSight(z.x,z.y,p.x,p.y))continue;
      if(dd<bestD){bestD=dd;best=p;}
    }
    return best;
  }

  // Detect by sound: closest player whose sound radius reaches this zombie.
  zombieHearing(z){
    let best=null, bestD=Infinity;
    for(const p of this.players.values()){
      if(!p.alive||p.spectating)continue;
      const dd=Math.hypot(p.x-z.x,p.y-z.y);
      // Walking radius 80px, sprinting 280px
      const soundRadius=p.sprinting&&(p.dx||p.dy)?280:((p.dx||p.dy)?80:0);
      if(soundRadius<=0)continue;
      if(dd<=soundRadius&&dd<bestD){bestD=dd;best=p;}
    }
    return best;
  }

  _barricadeAt(wx,wy,r=12){
    for(const bar of this._allBarricades()){
      if(bar.isDoor&&bar.isOpen)continue;
      if(Math.hypot(wx-bar.wx,wy-bar.wy)<r+18)return bar;
    }
    return null;
  }

  _move(e,dx,dy,r=10){
    const nx=e.x+dx,ny=e.y+dy;
    const txL=Math.floor((nx-r)/TILE),txR=Math.floor((nx+r)/TILE);
    const tyT=Math.floor((e.y-r)/TILE),tyB=Math.floor((e.y+r)/TILE);
    const txL2=Math.floor((e.x-r)/TILE),txR2=Math.floor((e.x+r)/TILE);
    const tyT2=Math.floor((ny-r)/TILE),tyB2=Math.floor((ny+r)/TILE);
    if(!this.isSolid(txL,tyT)&&!this.isSolid(txR,tyT)&&!this.isSolid(txL,tyB)&&!this.isSolid(txR,tyB)){
      if(!this._barricadeAt(nx,e.y,r))e.x=nx;
    }
    if(!this.isSolid(txL2,tyT2)&&!this.isSolid(txR2,tyT2)&&!this.isSolid(txL2,tyB2)&&!this.isSolid(txR2,tyB2)){
      if(!this._barricadeAt(e.x,ny,r))e.y=ny;
    }
  }

  _safeTile(pool){
    for(let i=0;i<20;i++){
      const t=pool[rng(0,pool.length-1)];
      if(t)return t;
    }
    return pool[0]||{x:5,y:5};
  }

  _freshLoadout(p){
    const tier=p?.personalUpgrades?.starting_gun||0;
    // T0: pistol; T1: SMG; T2: Shotgun; T3: Rifle
    const startGun=['pistol','smg','shotgun','rifle'][tier];
    const reserveMult=[1,1.25,1.5,1.75][p?.personalUpgrades?.larger_reserves||0];
    const slot=makeGunSlot(startGun);
    if(slot){
      slot.maxReserve=Math.floor(slot.maxReserve*reserveMult);
    }
    return[slot,null,makeMeleeSlot('knife')];
  }

  // ── Player ──
  addPlayer(sid,name){
    // If game is in zone phase, spawn the new player at zone entry; otherwise base
    const inZone = this._atZonePhase() && this.zone;
    const sx = inZone ? this.zone.entryX*TILE+TILE/2+rng(-30,30)
                      : BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
    const sy = inZone ? (this.zone.entryY+2)*TILE+TILE/2
                      : BASE_LAYOUT.spawnTy*TILE+TILE/2+rng(-15,15);
    this.players.set(sid,{
      id:sid,name,
      x:sx, y:sy,
      hp:100,maxHp:100,angle:0,
      slots:this._freshLoadout(),activeSlot:0,
      reloading:false,reloadTimer:0,reloadMax:1,
      wood:0,scrap:0,kills:0,sessionKills:0,alive:true,
      dx:0,dy:0,shooting:false,sprinting:false,
      shootCooldown:0,meleeCooldown:0,
      stamina:100,maxStamina:100,respawnTimer:0,
      nearWeaponId:null,nearDoorId:null,nearTurretId:null,
      nearStash:false,nearTerminal:false,nearSleep:false,nearWorkshop:false,
      meleeSwinging:false,meleeAngle:0,
      lastVx:0,lastVy:0,
      damageFromX:0,damageFromY:0,damageFromTimer:0,
      atBase: !inZone,
      // Signature pickup state
      adrenalineTimer:0,    // ticks remaining of free-sprint buff
      grenades:0,           // grenade count (throwable)
      toolboxes:0,          // toolbox count (use to repair barricades)
      parts:0,              // upgrade currency (carried, deposits to stash)
      // Personal upgrades — each player gets their own progression
      personalUpgrades:{
        starting_gun:0,
        faster_respawn:0,
        larger_reserves:0,
      },
      // Spectator state (Build B)
      spectating:false,
      spectateTargetId:null,
    });
  }
  removePlayer(sid){this.players.delete(sid);this.flows.delete(sid);}

  handleInput(sid,inp){
    const p=this.players.get(sid);if(!p)return;
    p.dx=clamp(inp.dx||0,-1,1);
    p.dy=clamp(inp.dy||0,-1,1);
    p.angle=inp.angle||0;
    p.shooting=!!inp.shooting;
    p.sprinting=!!inp.sprinting;
    if(inp.swapSlot){p.activeSlot=(p.activeSlot+1)%3;if(p.reloading){p.reloading=false;p.reloadTimer=0;}}
    if(inp.selectSlot!==undefined) p.activeSlot=clamp(inp.selectSlot,0,2);
    if(inp.reloadReq&&!p.reloading&&p.alive){
      const w=p.slots[p.activeSlot];
      if(w&&w.kind==='gun'&&w.mag<w.maxMag&&w.reserve>0){
        p.reloading=true;
        p.reloadMax=WDEFS[w.type].reload;p.reloadTimer=p.reloadMax;
      }
    }
    if(inp.pickupWeapon&&p.alive) this._tryPickup(sid,p);
    if(inp.toggleDoor&&p.alive)   this._tryToggleDoor(p);
    if(inp.interact&&p.alive)     this._tryInteract(sid,p);
    if(inp.openStash&&p.alive)    this._tryOpenStash(sid,p);
    if(inp.stashOp)               this._handleStashOp(sid,p,inp.stashOp);
    if(inp.openWorkshop&&p.alive) this._tryOpenWorkshop(sid,p);
    if(inp.workshopOp)            this._handleWorkshopOp(sid,p,inp.workshopOp);
    if(inp.throwGrenade&&p.alive) this._tryThrowGrenade(p);
    if(inp.useToolbox&&p.alive)   this._tryUseToolbox(p);
    if(inp.useAdrenaline&&p.alive)this._tryUseAdrenaline(p);
    if(inp.spectateNext&&p.spectating)this._spectateCycle(p,1);
    if(inp.spectatePrev&&p.spectating)this._spectateCycle(p,-1);
  }

  _tryThrowGrenade(p){
    if(p.grenades<=0)return;
    p.grenades--;
    // Throw grenade in aim direction — 5 second fuse, then explodes
    const throwDist=200;
    const fx=p.x+Math.cos(p.angle)*throwDist;
    const fy=p.y+Math.sin(p.angle)*throwDist;
    const g={
      id:this._tick+'-'+Math.random(),
      x:p.x,y:p.y,tx:fx,ty:fy,
      vx:Math.cos(p.angle)*8,vy:Math.sin(p.angle)*8,
      fuse:TICK*2.5, // 2.5 sec fuse mid-flight + after landing
      owner:p.id,
    };
    if(!this.grenadesActive)this.grenadesActive=[];
    this.grenadesActive.push(g);
    io.to(this.id).emit('grenadeThrown',{x:p.x,y:p.y,tx:fx,ty:fy,id:g.id});
  }

  _tryUseToolbox(p){
    if(p.toolboxes<=0)return;
    // Repair all friendly barricades + turrets within 100 px
    let repaired=0;
    for(const bar of this._allBarricades()){
      if(Math.hypot(bar.wx-p.x,bar.wy-p.y)<140 && bar.hp<bar.maxHp){
        bar.hp=bar.maxHp;repaired++;
      }
    }
    for(const t of this._allTurrets()){
      if(Math.hypot(t.x-p.x,t.y-p.y)<140){
        t.hp=t.maxHp;t.ammo=t.maxAmmo;repaired++;
      }
    }
    if(repaired>0){
      p.toolboxes--;
      io.to(this.id).emit('toolboxUsed',{x:p.x,y:p.y,radius:140,count:repaired});
    }
  }

  _tryUseAdrenaline(p){
    // Adrenaline auto-applies on pickup, but allow manual stack/use too if player has any reserves
    // Currently it's instant — kept hook for future
    return;
  }

  _tryInteract(sid,p){
    if(p.nearTerminal&&this.phase==='base'){this._startDay();return;}
    if(p.nearSleep&&this.phase==='night'&&this.sleepAvailable){this._sleepThroughNight();return;}
    if(p.nearStash){this._tryOpenStash(sid,p);return;}
    if(p.nearWorkshop){this._tryOpenWorkshop(sid,p);return;}
    this._tryToggleDoor(p);
  }

  // ── Stash UI ──
  _stashSnapshot(){
    return{
      size:this._stashSize(),
      resources:{...this.stash.resources},
      weapons:this.stash.weapons.map(w=>({...w})),
    };
  }

  _tryOpenStash(sid,p){
    if(!p.nearStash){return;}
    const sock=socketBySid(sid);
    if(sock)sock.emit('stashOpen',this._stashSnapshot());
  }

  _broadcastStashToNearby(){
    // Anyone currently near the stash gets a fresh snapshot (multiplayer sync)
    for(const[sid,p]of this.players){
      if(p.nearStash){
        const sock=socketBySid(sid);
        if(sock)sock.emit('stashUpdate',this._stashSnapshot());
      }
    }
  }

  _handleStashOp(sid,p,op){
    if(!p.nearStash||!op||!op.action)return;

    if(op.action==='deposit_weapon'){
      // Player chooses which slot to deposit
      const slotIdx=clamp(op.slot|0,0,2);
      const w=p.slots[slotIdx];
      if(!w)return;
      // Don't allow depositing the starting knife (slot 2 with type='knife')
      // unless they have a different melee to replace it
      this.stash.weapons.push({...w});
      // After deposit: melee slot resets to knife, gun slots become null
      if(slotIdx===2)p.slots[2]=makeMeleeSlot('knife');
      else p.slots[slotIdx]=null;
      // Reset reload state if active slot was deposited
      if(p.activeSlot===slotIdx){p.reloading=false;p.reloadTimer=0;p.shootCooldown=0;p.meleeCooldown=0;}
      this._broadcastStashToNearby();
    }
    else if(op.action==='withdraw_weapon'){
      const idx=op.idx|0;
      if(idx<0||idx>=this.stash.weapons.length)return;
      const w=this.stash.weapons[idx];
      // Determine target slot in player loadout
      let target;
      if(w.kind==='melee'){
        target=2;
      }else{
        // Gun: prefer first empty gun slot (0 then 1), else replace active gun slot
        if(!p.slots[0])target=0;
        else if(!p.slots[1])target=1;
        else target=p.activeSlot<2?p.activeSlot:0;
      }
      // If target has something, swap it back into stash
      const cur=p.slots[target];
      if(cur){
        // Don't put the starting knife back in stash — just discard it
        if(!(cur.kind==='melee'&&cur.type==='knife')){
          this.stash.weapons.push({...cur});
        }
      }
      this.stash.weapons.splice(idx,1);
      p.slots[target]={...w};
      if(p.activeSlot===target){p.reloading=false;p.reloadTimer=0;p.shootCooldown=0;p.meleeCooldown=0;}
      this._broadcastStashToNearby();
    }
    else if(op.action==='deposit_resources'){
      // Deposit all carried resources
      this.stash.resources.wood+=p.wood;p.wood=0;
      this.stash.resources.scrap+=p.scrap;p.scrap=0;
      this.stash.resources.parts+=p.parts;p.parts=0;
      this._broadcastStashToNearby();
    }
    else if(op.action==='withdraw_resources'){
      const t=op.type;
      const amt=clamp(op.amt|0,1,9999);
      if(!t||!(t in this.stash.resources))return;
      const have=this.stash.resources[t];
      if(have<amt)return;
      this.stash.resources[t]-=amt;
      if(t==='wood')p.wood+=amt;
      else if(t==='scrap')p.scrap+=amt;
      else if(t==='parts')p.parts+=amt;
      else{
        // Ammo into matching gun reserve
        const gunMap={pistol_ammo:'pistol',shotgun_ammo:'shotgun',rifle_ammo:'rifle',smg_ammo:'smg'};
        const wType=gunMap[t];
        let loaded=0;
        for(const sw of p.slots){
          if(sw&&sw.kind==='gun'&&sw.type===wType){
            const free=sw.maxReserve-sw.reserve;
            const take=Math.min(free,amt-loaded);
            sw.reserve+=take;loaded+=take;
            if(loaded>=amt)break;
          }
        }
        // Refund any leftover (no matching gun, or all reserves full)
        if(loaded<amt) this.stash.resources[t]+=(amt-loaded);
      }
      this._broadcastStashToNearby();
    }
    else if(op.action==='withdraw_resources_all'){
      // Convenience — withdraw all of given type
      const t=op.type;
      if(!t||!(t in this.stash.resources))return;
      const have=this.stash.resources[t];
      if(have<=0)return;
      this._handleStashOp(sid,p,{action:'withdraw_resources',type:t,amt:have});
    }
  }

  // ── Workshop UI ──
  _workshopSnapshot(sid){
    const p=this.players.get(sid);
    return{
      teamUpgrades:{...this.teamUpgrades},
      personalUpgrades:p?{...p.personalUpgrades}:{},
      stashResources:{...this.stash.resources},
      defs:UPGRADE_DEFS,
    };
  }

  _tryOpenWorkshop(sid,p){
    if(!p.nearWorkshop)return;
    const sock=socketBySid(sid);
    if(sock)sock.emit('workshopOpen',this._workshopSnapshot(sid));
  }

  _broadcastWorkshopToNearby(){
    for(const[sid,pl]of this.players){
      if(pl.nearWorkshop){
        const sock=socketBySid(sid);
        if(sock)sock.emit('workshopUpdate',this._workshopSnapshot(sid));
      }
    }
  }

  _handleWorkshopOp(sid,p,op){
    if(!p.nearWorkshop||!op||!op.action)return;
    if(op.action==='purchase_upgrade'){
      const key=op.key;
      const def=UPGRADE_DEFS[key];
      if(!def)return;
      const isPersonal=def.scope==='personal';
      const currentTier=isPersonal?(p.personalUpgrades[key]||0):(this.teamUpgrades[key]||0);
      if(currentTier>=3)return; // max
      const nextTier=currentTier+1;
      const cost=upgradeCost(key,nextTier);
      if(!cost)return;
      // Check stash has enough
      if((this.stash.resources.parts||0)<(cost.parts||0))return;
      if((this.stash.resources.wood||0)<(cost.wood||0))return;
      if((this.stash.resources.scrap||0)<(cost.scrap||0))return;
      // Deduct
      this.stash.resources.parts-=cost.parts||0;
      this.stash.resources.wood-=cost.wood||0;
      this.stash.resources.scrap-=cost.scrap||0;
      // Apply
      if(isPersonal) p.personalUpgrades[key]=nextTier;
      else this.teamUpgrades[key]=nextTier;
      // Apply immediate effects
      this._applyUpgradeEffect(key,nextTier,p);
      this._broadcastWorkshopToNearby();
      this._broadcastStashToNearby();
    }
    else if(op.action==='convert_wood_to_scrap'){
      const tier=this.teamUpgrades.conversion||0;
      if(tier<1)return;
      const ratios=[5,3,2]; // wood per 1 scrap
      const ratio=ratios[tier-1];
      const have=this.stash.resources.wood||0;
      if(have<ratio)return;
      const amt=op.amt|0||1;
      const totalWood=Math.min(have,amt*ratio);
      const actualScrap=Math.floor(totalWood/ratio);
      const actualWood=actualScrap*ratio;
      this.stash.resources.wood-=actualWood;
      this.stash.resources.scrap+=actualScrap;
      this._broadcastWorkshopToNearby();
      this._broadcastStashToNearby();
    }
  }

  _applyUpgradeEffect(key,tier,p){
    // Apply effect immediately at purchase time where appropriate.
    if(key==='reinforced_walls'){
      // Multiply HP of existing base barricades
      const mults=[1.5,2.0,2.5];
      const m=mults[tier-1];
      for(const bar of this.baseBarricades){
        // Recalculate to new base
        const baseHp=bar.isMetal?350:150;
        bar.maxHp=baseHp*m;
        bar.hp=Math.min(bar.maxHp,bar.hp*m);
      }
    } else if(key==='sentry_slot'){
      // Spawn a new sentry at base entrance corridor
      const sentryX=BASE_LAYOUT.exitTx*TILE+TILE/2+(tier-2)*TILE;
      const sentryY=(BASE_H-3)*TILE+TILE/2;
      const sentry={
        id:this.ntid++,x:sentryX,y:sentryY,
        angle:0,ammo:60,maxAmmo:60,cooldown:0,
        hp:120,maxHp:120,
        sentry:true,             // persistent + auto-regen ammo
      };
      this.baseTurrets.push(sentry);
      io.to(this.id).emit('turretAdded',sentry);
    } else if(key==='larger_reserves'){
      // Recompute current player's gun reserve caps
      const mults=[1.25,1.5,1.75];
      const m=mults[tier-1];
      for(const slot of p.slots){
        if(slot&&slot.kind==='gun'){
          const wd=WDEFS[slot.type];
          slot.maxReserve=Math.floor(wd.maxReserve*m);
        }
      }
    }
  }

  _stashSize(){
    const n=this.players.size;
    const baseSize=6+(n>0?(n-1)*2:0);
    const upTier=this.teamUpgrades?.stash_capacity||0;
    const upBonuses=[0,2,4,6];
    return baseSize+upBonuses[upTier];
  }

  _tryPickup(sid,p){
    let nearest=null,nearestDist=60;
    for(const gw of this.groundWeapons){
      const d=Math.hypot(gw.x-p.x,gw.y-p.y);
      if(d<nearestDist){nearestDist=d;nearest=gw;}
    }
    if(!nearest)return;
    let targetSlot=nearest.kind==='melee'?2:(p.activeSlot<2?p.activeSlot:(p.slots[0]?1:0));
    const current=p.slots[targetSlot];
    if(current){
      const dropped={
        id:this.ngwid++,
        x:p.x+(Math.random()-0.5)*24,y:p.y+(Math.random()-0.5)*24,
        kind:current.kind,type:current.type,name:current.name,
      };
      if(current.kind==='gun'){
        dropped.mag=current.mag;dropped.maxMag=current.maxMag;
        dropped.reserve=current.reserve;dropped.maxReserve=current.maxReserve;
      }
      this.groundWeapons.push(dropped);
      io.to(this.id).emit('groundWeaponAdded',dropped);
    }
    if(nearest.kind==='gun'){
      p.slots[targetSlot]={kind:'gun',type:nearest.type,name:nearest.name,
        mag:nearest.mag,maxMag:nearest.maxMag,reserve:nearest.reserve,maxReserve:nearest.maxReserve};
    }else{
      p.slots[targetSlot]={kind:'melee',type:nearest.type,name:nearest.name,cooldown:0};
    }
    if(p.activeSlot===targetSlot){p.reloading=false;p.reloadTimer=0;p.shootCooldown=0;p.meleeCooldown=0;}
    this.groundWeapons=this.groundWeapons.filter(g=>g.id!==nearest.id);
    io.to(this.id).emit('groundWeaponRemoved',{id:nearest.id});
  }

  _tryToggleDoor(p){
    for(const bar of this._allBarricades()){
      if(!bar.isDoor)continue;
      if(Math.hypot(bar.wx-p.x,bar.wy-p.y)<60){
        bar.isOpen=!bar.isOpen;
        io.to(this.id).emit('doorToggled',{tx:bar.tx,ty:bar.ty,isOpen:bar.isOpen});
        return;
      }
    }
  }

  handleBuild(sid,{tx,ty,buildType}){
    const p=this.players.get(sid);if(!p)return;
    if(this.isSolid(tx,ty,true))return;
    if(this._allBarricades().find(b=>b.tx===tx&&b.ty===ty))return;
    if(this._allTurrets().find(t=>Math.hypot(t.x-(tx*TILE+TILE/2),t.y-(ty*TILE+TILE/2))<TILE))return;
    const wx=tx*TILE+TILE/2,wy=ty*TILE+TILE/2;
    let bar;
    if(buildType==='barricade'){
      if(p.wood<3)return;p.wood-=3;
      bar={tx,ty,wx,wy,hp:150,maxHp:150,isDoor:false,isOpen:false,isMetal:false};
    }else if(buildType==='door'){
      if(p.wood<3)return;p.wood-=3;
      bar={tx,ty,wx,wy,hp:150,maxHp:150,isDoor:true,isOpen:false,isMetal:false};
    }else if(buildType==='metal'){
      if(p.scrap<5)return;p.scrap-=5;
      bar={tx,ty,wx,wy,hp:350,maxHp:350,isDoor:false,isOpen:false,isMetal:true};
    }else if(buildType==='turret'){
      if(p.scrap<8)return;p.scrap-=8;
      const turret={id:this.ntid++,x:wx,y:wy,angle:0,ammo:60,maxAmmo:60,cooldown:0,hp:80,maxHp:80};
      if(this._atBasePhase())this.baseTurrets.push(turret);
      else this.turrets.push(turret);
      io.to(this.id).emit('turretAdded',turret);
      return;
    }
    if(!bar)return;
    if(this._atBasePhase())this.baseBarricades.push(bar);
    else this.barricades.push(bar);
    io.to(this.id).emit('barricadeAdded',bar);
  }

  handlePing(sid,{wx,wy}){
    const p=this.players.get(sid);if(!p)return;
    io.to(this.id).emit('ping',{id:Date.now(),x:wx,y:wy,name:p.name});
  }
  handleChat(sid,msg){
    const p=this.players.get(sid);if(!p)return;
    io.to(this.id).emit('chat',{name:p.name,text:(msg||'').toString().slice(0,80)});
  }

  // ── Phase Transitions ──
  _startDay(){
    if(this.phase!=='base')return;
    this.zone=generateZone(this.scoutReport.theme,this.scoutReport.size);
    this.zone.theme=this.scoutReport.theme;
    this.barricades=[];this.turrets=[];
    this.zombies=[];this.bullets=[];this.pickups=[];this.groundWeapons=[];this.grenadesActive=[];
    this.flows=new Map();
    this._spawnZombiesInZone();
    this._spawnLootInZone();
    for(const p of this.players.values()){
      p.x=this.zone.entryX*TILE+TILE/2+rng(-30,30);
      p.y=(this.zone.entryY+2)*TILE+TILE/2;
      p.atBase=false;p.alive=true;p.hp=p.maxHp;p.respawnTimer=0;
    }
    this.phase='day';this.zoneTimer=DAY_TICKS;
    io.to(this.id).emit('phaseChange',{phase:'day',scoutReport:this.scoutReport});
    io.to(this.id).emit('worldSwap',{
      tiles:this.zone.tiles,W:this.zone.W,H:this.zone.H,
      lootRooms:this.zone.lootRooms,
      entryX:this.zone.entryX,entryY:this.zone.entryY,
      kind:'zone',
    });
  }

  _hordeTypesForTheme(theme){
    // Strong tilt — each theme dramatically biases zombie types
    switch(theme){
      case 'hospital':
        return ['normal','normal','normal','normal','screamer','screamer','screamer','runner'];
      case 'military':
        return ['big','big','big','big','normal','normal','runner'];
      case 'suburb':
        return ['runner','runner','runner','runner','runner','normal','normal'];
      case 'mall':
      default:
        return ['normal','normal','normal','big','runner','screamer'];
    }
  }

  _signaturePickupForTheme(theme){
    // Each theme has a unique signature pickup
    switch(theme){
      case 'hospital': return 'adrenaline';
      case 'military': return 'grenade';
      case 'suburb':   return 'toolbox';
      default: return null;
    }
  }

  _lootBiasForTheme(theme){
    // Strong tilt — 90% of theme's specialty, 10% general
    // Returns { generalPickups: [array biased toward specialty], gunWeights: { gun: weight } }
    const SIG=this._signaturePickupForTheme(theme);
    switch(theme){
      case 'hospital':
        return{
          // 90% medkits/scrap; 10% general
          general:['medkit','medkit','medkit','medkit','medkit','medkit','medkit','medkit','scrap','wood'],
          // Loot room ammo specialty: pistol-heavy
          ammo:['pistol_ammo','pistol_ammo','smg_ammo','rifle_ammo','shotgun_ammo'],
          // Gun spawn weighting: lots of pistols (hospital security), few rifles
          gunMix:['pistol','pistol','pistol','smg','shotgun','rifle'],
          signature:SIG,
        };
      case 'military':
        return{
          // 90% guns/ammo focus; less general supply
          general:['scrap','scrap','medkit','wood','scrap'],
          ammo:['rifle_ammo','rifle_ammo','rifle_ammo','shotgun_ammo','shotgun_ammo','smg_ammo','pistol_ammo'],
          gunMix:['rifle','rifle','rifle','shotgun','smg','pistol'],
          signature:SIG,
        };
      case 'suburb':
        return{
          // 90% wood/tools focus
          general:['wood','wood','wood','wood','wood','wood','wood','wood','medkit','scrap'],
          ammo:['pistol_ammo','pistol_ammo','shotgun_ammo','smg_ammo','rifle_ammo'],
          // Suburban: lots of pistols + shotguns (home defense), few rifles
          gunMix:['pistol','pistol','shotgun','shotgun','smg','rifle'],
          signature:SIG,
        };
      case 'mall':
      default:
        return{
          general:['medkit','medkit','wood','wood','wood','scrap'],
          ammo:['pistol_ammo','shotgun_ammo','rifle_ammo','smg_ammo'],
          gunMix:['pistol','shotgun','rifle','smg'],
          signature:null,
        };
    }
  }

  _spawnZombiesInZone(){
    if(!this.zone)return;
    const pool=[...this.zone.ft.indoor,...this.zone.ft.court];
    const total=20+this.day*4;
    const types=this._hordeTypesForTheme(this.zone.theme);
    // Base spawns
    for(let i=0;i<total;i++){
      const t=this._safeTile(pool);
      if(Math.abs(t.x-this.zone.entryX)<8&&t.y<this.zone.entryY+12)continue;
      this.zombies.push(makeZombie(this.nzid++,t.x*TILE+TILE/2,t.y*TILE+TILE/2,
        types[rng(0,types.length-1)],this.day));
    }
    // Extra defenders near each loot room (3-5 zombies in or right outside)
    for(const r of this.zone.lootRooms){
      const guards=rng(3,5);
      for(let i=0;i<guards;i++){
        // Spawn within the room or just outside
        const ox=rng(-2,r.w+1), oy=rng(-2,r.h+1);
        const sx=r.x+ox, sy=r.y+oy;
        if(sx<0||sx>=this.zone.W||sy<0||sy>=this.zone.H)continue;
        // Don't spawn in walls
        if(this.zone.tiles[sy][sx]===T_WALL)continue;
        // Skip if too close to entry
        if(Math.abs(sx-this.zone.entryX)<8&&sy<this.zone.entryY+12)continue;
        this.zombies.push(makeZombie(this.nzid++,sx*TILE+TILE/2,sy*TILE+TILE/2,
          types[rng(0,types.length-1)],this.day));
      }
    }
  }

  _spawnLootInZone(){
    if(!this.zone)return;
    const pool=[...this.zone.ft.indoor,...this.zone.ft.court];
    const bias=this._lootBiasForTheme(this.zone.theme);

    // General pickups (theme-biased)
    for(let i=0;i<20;i++){
      const t=this._safeTile(pool);
      this.pickups.push({id:this.npid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,
        type:pick(bias.general),amount:rng(15,30)});
    }
    // Ground guns (theme-biased mix)
    for(let i=0;i<14;i++){
      const t=this._safeTile(pool);
      const type=pick(bias.gunMix);const wd=WDEFS[type];
      this.groundWeapons.push({
        id:this.ngwid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,
        kind:'gun',type,name:wd.name,
        mag:Math.floor(wd.maxMag*0.5),maxMag:wd.maxMag,
        reserve:Math.floor(wd.maxReserve*0.3),maxReserve:wd.maxReserve,
      });
    }
    // Ground melee (universal)
    const melTypes=['bat','axe','machete'];
    for(let i=0;i<4;i++){
      const t=this._safeTile(pool);
      const type=pick(melTypes);const md=MDEFS[type];
      this.groundWeapons.push({
        id:this.ngwid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,
        kind:'melee',type,name:md.name,
      });
    }
    // Signature pickups — only spawn in non-mall themes
    if(bias.signature){
      const sigCount=3+Math.floor((this.zone.lootRooms.length||1)/2);
      for(let i=0;i<sigCount;i++){
        const t=this._safeTile(pool);
        this.pickups.push({id:this.npid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,
          type:bias.signature,amount:1,signature:true});
      }
    }
    // Loot rooms — extra-good gear
    for(const r of this.zone.lootRooms){
      const tx=rng(r.x+1,r.x+r.w-2),ty=rng(r.y+1,r.y+r.h-2);
      const type=pick(bias.gunMix.filter(g=>g!=='pistol'));
      const wd=WDEFS[type];
      this.groundWeapons.push({
        id:this.ngwid++,x:tx*TILE+TILE/2,y:ty*TILE+TILE/2,
        kind:'gun',type,name:wd.name,
        mag:wd.maxMag,maxMag:wd.maxMag,
        reserve:Math.floor(wd.maxReserve*0.7),maxReserve:wd.maxReserve,
        loot:true,
      });
      // Loot room ammo (theme-biased)
      for(let i=0;i<rng(3,5);i++){
        const tx2=rng(r.x+1,r.x+r.w-2),ty2=rng(r.y+1,r.y+r.h-2);
        this.pickups.push({id:this.npid++,x:tx2*TILE+TILE/2,y:ty2*TILE+TILE/2,
          type:pick(bias.ammo),amount:rng(8,18),loot:true});
      }
      // Always a medkit in loot rooms
      const tx3=rng(r.x+1,r.x+r.w-2),ty3=rng(r.y+1,r.y+r.h-2);
      this.pickups.push({id:this.npid++,x:tx3*TILE+TILE/2,y:ty3*TILE+TILE/2,
        type:'medkit',amount:40,loot:true});
      // Bonus signature pickup in loot rooms
      if(bias.signature){
        const tx4=rng(r.x+1,r.x+r.w-2),ty4=rng(r.y+1,r.y+r.h-2);
        this.pickups.push({id:this.npid++,x:tx4*TILE+TILE/2,y:ty4*TILE+TILE/2,
          type:bias.signature,amount:1,signature:true,loot:true});
      }
    }
  }

  _enterExtract(){
    // Extract timer scales with zone size: small=20s, medium=30s, large=45s
    let secs=30;
    if(this.zone&&this.zone.size){
      if(this.zone.size==='small')secs=20;
      else if(this.zone.size==='large')secs=45;
    }
    this.phase='extract';this.phaseTimer=TICK*secs;
    io.to(this.id).emit('phaseChange',{phase:'extract',extractSecs:secs});
  }

  _enterNight(){
    // Set phase first so death routing knows we're in night
    this.phase='night';
    this.nightTimer=NIGHT_TICKS;
    this.sleepAvailable=false;
    this.fightBonus={wood:0,scrap:0,ammo:0,parts:0,fullNight:false};
    // Players still in zone die — caught by the horde (now correctly routed to spectator)
    for(const p of this.players.values()){
      if(p.alive&&!p.atBase){
        p.hp=0;
        this._handlePlayerDeath(p,'caught_by_night');
      }
    }
    // Unload zone
    this.zone=null;
    this.barricades=[];this.turrets=[];
    this.zombies=[];this.bullets=[];this.pickups=[];this.groundWeapons=[];this.grenadesActive=[];
    this.flows=new Map();
    for(const p of this.players.values()){
      // Only relocate players who weren't already inside the base.
      // Anyone who already extracted stays right where they were.
      if(!p.atBase){
        p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
        p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
        p.atBase=true;
      }
      // Reset transient combat/movement state for everyone so the night starts cleanly
      p.shooting=false;p.dx=0;p.dy=0;p.sprinting=false;
      p.shootCooldown=0;p.meleeCooldown=0;
      p.exhausted=false;p.stamina=p.maxStamina;
    }
    io.to(this.id).emit('phaseChange',{phase:'night'});
    io.to(this.id).emit('worldSwap',{
      tiles:this.baseTiles,W:BASE_W,H:BASE_H,
      lootRooms:[],
      entryX:BASE_LAYOUT.exitTx,entryY:BASE_LAYOUT.exitTy,
      kind:'base',
    });
  }

  _enterMorning(){
    this.phase='morning';this.phaseTimer=MORNING_TICKS;
    // Clear all hostile entities — night is over
    this.zombies=[];this.bullets=[];this.grenadesActive=[];
    // Build B: revive any spectators — at least one player survived to dawn
    let revivedAny=false;
    for(const p of this.players.values()){
      if(p.spectating){
        p.spectating=false;
        p.spectateTargetId=null;
        p.alive=true;
        p.hp=p.maxHp;
        p.respawnTimer=0;
        p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
        p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
        p.atBase=true;
        p.slots=this._freshLoadout(p);p.activeSlot=0;
        p.exhausted=false;p.stamina=p.maxStamina;
        revivedAny=true;
        io.to(this.id).emit('playerRespawned',{id:p.id});
      }
    }
    // Distribute fight bonuses to stash
    if(this.fightBonus.wood>0)this.stash.resources.wood+=this.fightBonus.wood;
    if(this.fightBonus.scrap>0)this.stash.resources.scrap+=this.fightBonus.scrap;
    if(this.fightBonus.parts>0)this.stash.resources.parts+=this.fightBonus.parts;
    if(this.fightBonus.ammo>0){
      for(let i=0;i<this.fightBonus.ammo;i++){
        const t=pick(['pistol_ammo','shotgun_ammo','rifle_ammo','smg_ammo']);
        this.stash.resources[t]++;
      }
    }
    // Apply Refinery upgrade — passive ammo per night survived
    const refTier=this.teamUpgrades.refinery||0;
    if(refTier>0){
      const ammoBonus=[0,5,10,20][refTier];
      for(let i=0;i<ammoBonus;i++){
        const t=pick(['pistol_ammo','shotgun_ammo','rifle_ammo','smg_ammo']);
        this.stash.resources[t]++;
      }
      this.fightBonus.refineryAmmo=ammoBonus;
    }
    // Apply Greenhouse upgrade — passive medkit pickups added to morning summary
    const ghTier=this.teamUpgrades.greenhouse||0;
    if(ghTier>0){
      const medkits=[0,1,2,3][ghTier];
      // Spawn medkits in stash as a pseudo-resource — store in resources.medkit_count
      this.stash.resources.medkit_count=(this.stash.resources.medkit_count||0)+medkits;
      this.fightBonus.greenhouseMed=medkits;
    }
    if(this.fightBonus.fullNight){
      const rares=['rifle','shotgun','smg'];
      const type=pick(rares);const wd=WDEFS[type];
      this.stash.weapons.push({
        kind:'gun',type,name:wd.name,
        mag:wd.maxMag,maxMag:wd.maxMag,
        reserve:wd.maxReserve,maxReserve:wd.maxReserve,
        jackpot:true,
      });
    }
    io.to(this.id).emit('phaseChange',{phase:'morning',fightBonus:this.fightBonus,day:this.day});
  }

  _enterBase(){
    this.phase='base';this.day++;
    this.zombies=[];this.bullets=[];this.pickups=[];this.groundWeapons=[];this.grenadesActive=[];
    this.scoutReport=this._rollScoutReport();
    for(const p of this.players.values()){
      p.hp=p.maxHp;p.alive=true;p.respawnTimer=0;
      p.exhausted=false;p.stamina=p.maxStamina;
      // Only relocate if not already at base (e.g., a corpse waiting to revive)
      // or if their current position is invalid (in a wall)
      const tx=Math.floor(p.x/TILE), ty=Math.floor(p.y/TILE);
      const inBaseTile=this.baseTiles[ty]?.[tx];
      const inWall=(inBaseTile===undefined||inBaseTile===T_WALL);
      if(!p.atBase||inWall){
        p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
        p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
        p.atBase=true;
      }
    }
    io.to(this.id).emit('phaseChange',{phase:'base',scoutReport:this.scoutReport,day:this.day});
  }

  _sleepThroughNight(){
    if(this.phase!=='night'||!this.sleepAvailable)return;
    this._enterMorning();
  }

  _dropWeaponsAtDeath(p){
    const EXPIRY=TICK*120;
    for(let i=0;i<3;i++){
      const w=p.slots[i];if(!w)continue;
      if(w.kind==='melee'&&w.type==='knife')continue;
      const dropped={
        id:this.ngwid++,
        x:p.x+(Math.random()-0.5)*40,y:p.y+(Math.random()-0.5)*40,
        kind:w.kind,type:w.type,name:w.name,
        deathDrop:true,expiresAt:this._tick+EXPIRY,
      };
      if(w.kind==='gun'){
        dropped.mag=w.mag;dropped.maxMag=w.maxMag;
        dropped.reserve=w.reserve;dropped.maxReserve=w.maxReserve;
      }
      if(this._atZonePhase()||this.phase==='night'){
        this.groundWeapons.push(dropped);
        io.to(this.id).emit('groundWeaponAdded',dropped);
      }
    }
    p.slots=this._freshLoadout(p);p.activeSlot=0;
    // Death penalty: lose carried resources, signature pickups, and active buffs
    p.wood=0;p.scrap=0;p.parts=0;
    p.grenades=0;p.toolboxes=0;
    p.adrenalineTimer=0;
  }

  // ── Build B: Death system ──
  _isNightDeath(){
    return this.phase==='night';
  }

  _firstLivingPlayer(excludeId){
    for(const[sid,p]of this.players){
      if(sid===excludeId)continue;
      if(p.alive&&!p.spectating)return p;
    }
    return null;
  }

  _allPlayersDeadOrSpectating(){
    for(const p of this.players.values()){
      if(p.alive&&!p.spectating)return false;
    }
    return this.players.size>0;
  }

  _handlePlayerDeath(p,reason){
    p.hp=0;
    p.alive=false;
    this._dropWeaponsAtDeath(p);
    if(this._isNightDeath()){
      // Night/extract death = no respawn until dawn (or game reset if all dead)
      p.spectating=true;
      p.respawnTimer=0;
      // Pick a spectate target
      const target=this._firstLivingPlayer(p.id);
      p.spectateTargetId=target?target.id:null;
      io.to(this.id).emit('playerDied',{
        id:p.id, kills:p.kills, day:this.day,
        respawnIn:0, reason:reason||'killed', spectating:true,
      });
      // Check if everyone is dead
      if(this._allPlayersDeadOrSpectating()){
        this._handleTeamWipe();
      }
    } else {
      // Day death = normal respawn
      const respawnSecs=[12,9,6,4][p.personalUpgrades?.faster_respawn||0];
      p.respawnTimer=TICK*respawnSecs;
      p.spectating=false;
      io.to(this.id).emit('playerDied',{
        id:p.id, kills:p.kills, day:this.day, respawnIn:respawnSecs, reason:reason||'killed',
      });
    }
  }

  _handleTeamWipe(){
    // All players dead during night
    const isSolo = this.players.size===1;
    if(isSolo){
      this.soloLives--;
      if(this.soloLives>=1){
        // First solo death: lose stash, keep upgrades, advance to morning
        this.stash.weapons=[];
        this.stash.resources={wood:0,scrap:0,parts:0,
          pistol_ammo:0,shotgun_ammo:0,rifle_ammo:0,smg_ammo:0,medkit_count:0};
        io.to(this.id).emit('soloLifeLost',{livesRemaining:this.soloLives});
        // Advance to morning so player auto-respawns
        this._enterMorning();
        return;
      }
      // Out of lives — full reset
    }
    // Multiplayer wipe OR solo out-of-lives — full game reset
    this._resetGame();
  }

  _resetGame(){
    io.to(this.id).emit('gameReset',{day:this.day});
    this.day=1;
    this.zombies=[];this.bullets=[];this.pickups=[];this.groundWeapons=[];this.grenadesActive=[];
    this.barricades=[];this.turrets=[];
    this.baseBarricades=[];this.baseTurrets=[];
    // Wipe stash
    this.stash={
      resources:{wood:0,scrap:0,parts:0,
        pistol_ammo:0,shotgun_ammo:0,rifle_ammo:0,smg_ammo:0},
      weapons:[],
    };
    // Wipe team upgrades
    this.teamUpgrades={
      stash_capacity:0, reinforced_walls:0, sentry_slot:0,
      conversion:0, refinery:0, greenhouse:0,
    };
    // Reset solo lives
    this.soloLives=2;
    // Wipe each player
    for(const p of this.players.values()){
      p.alive=true;p.hp=p.maxHp;p.respawnTimer=0;
      p.spectating=false;p.spectateTargetId=null;
      p.wood=0;p.scrap=0;p.parts=0;
      p.kills=0;p.sessionKills=0;
      p.adrenalineTimer=0;p.grenades=0;p.toolboxes=0;
      p.exhausted=false;p.stamina=p.maxStamina;
      p.personalUpgrades={starting_gun:0,faster_respawn:0,larger_reserves:0};
      p.slots=this._freshLoadout(p);p.activeSlot=0;
      p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
      p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
      p.atBase=true;
    }
    this.zone=null;
    this.scoutReport=this._rollScoutReport();
    this.phase='base';
    this.fightBonus={wood:0,scrap:0,ammo:0,parts:0,fullNight:false};
    io.to(this.id).emit('phaseChange',{phase:'base',scoutReport:this.scoutReport,day:this.day});
    io.to(this.id).emit('worldSwap',{
      tiles:this.baseTiles,W:BASE_W,H:BASE_H,
      lootRooms:[],
      entryX:BASE_LAYOUT.exitTx,entryY:BASE_LAYOUT.exitTy,
      kind:'base',
    });
  }

  _spectateCycle(p,direction){
    // direction: 1 (next) or -1 (prev)
    const livingIds=[];
    for(const[sid,pl]of this.players){
      if(pl.alive&&!pl.spectating)livingIds.push(sid);
    }
    if(livingIds.length===0)return;
    let idx=livingIds.indexOf(p.spectateTargetId);
    if(idx===-1)idx=0;
    else idx=(idx+direction+livingIds.length)%livingIds.length;
    p.spectateTargetId=livingIds[idx];
  }

  _rebuildFlows(){
    const w=this._activeWorld();
    for(const[sid,p]of this.players){
      if(!p.alive)continue;
      this.flows.set(sid,buildFlow(w.tiles,w.W,w.H,Math.floor(p.x/TILE),Math.floor(p.y/TILE)));
    }
  }
  _getFlow(z){
    const w=this._activeWorld();
    let bestDist=Infinity,bestP=null,bestFlow=null;
    for(const[sid,p]of this.players){
      if(!p.alive)continue;
      const d=Math.hypot(z.x-p.x,z.y-p.y);
      if(d<bestDist){bestDist=d;bestP=p;bestFlow=this.flows.get(sid);}
    }
    if(!bestP||!bestFlow)return[0,0,bestP,bestDist];
    const tx=Math.floor(z.x/TILE),ty=Math.floor(z.y/TILE);
    if(tx<0||tx>=w.W||ty<0||ty>=w.H)return[0,0,bestP,bestDist];
    const i=(ty*w.W+tx)*2;
    return[bestFlow[i],bestFlow[i+1],bestP,bestDist];
  }

  // ── Tick ──
  tick(){
    if(this.players.size===0)return;
    this._tick++;

    // Expire death drops
    const expired=this.groundWeapons.filter(gw=>gw.deathDrop&&gw.expiresAt<=this._tick);
    for(const gw of expired) io.to(this.id).emit('groundWeaponRemoved',{id:gw.id});
    this.groundWeapons=this.groundWeapons.filter(gw=>!gw.deathDrop||gw.expiresAt>this._tick);

    // Phase machine
    if(this.phase==='day'){
      this.zoneTimer--;
      if(this.zoneTimer<=0)this._enterExtract();
    }else if(this.phase==='extract'){
      this.phaseTimer--;
      if(this.phaseTimer<=0)this._enterNight();
    }else if(this.phase==='night'){
      this.nightTimer--;
      if(!this.sleepAvailable&&(NIGHT_TICKS-this.nightTimer)>=this.sleepUnlockTime){
        this.sleepAvailable=true;
      }
      this._tickNightHorde();
      if(this.nightTimer<=0){
        this.fightBonus.fullNight=true;
        this._enterMorning();
      }
    }else if(this.phase==='morning'){
      this.phaseTimer--;
      if(this.phaseTimer<=0)this._enterBase();
    }

    // Flows only during combat phases
    if(this._atZonePhase()||this.phase==='night'){
      this.flowTimer--;
      if(this.flowTimer<=0){this._rebuildFlows();this.flowTimer=28;}
    }

    // Respawn
    for(const p of this.players.values()){
      if(!p.alive&&p.respawnTimer>0){
        p.respawnTimer--;
        if(p.respawnTimer<=0){
          p.alive=true;p.hp=p.maxHp;
          p.shooting=false;p.dx=0;p.dy=0;p.sprinting=false;
          p.shootCooldown=0;p.meleeCooldown=0;p.reloading=false;p.reloadTimer=0;
          if(this._atZonePhase()&&this.zone){
            p.x=this.zone.entryX*TILE+TILE/2+rng(-30,30);
            p.y=(this.zone.entryY+2)*TILE+TILE/2;
            p.atBase=false;
          }else{
            p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
            p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
            p.atBase=true;
          }
          io.to(this.id).emit('playerRespawned',{id:p.id});
        }
      }
    }

    this._tickPlayers();
    this._tickBullets();
    this._tickGrenades();
    if(this._atZonePhase()||this.phase==='night')this._tickZombies();
    if(this._atZonePhase()||this.phase==='night')this._tickTurrets();

    // Cleanup
    this.barricades=this.barricades.filter(b=>b.hp>0);
    this.baseBarricades=this.baseBarricades.filter(b=>b.hp>0);
    const destroyedT=[...this.turrets,...this.baseTurrets].filter(t=>t.hp<=0);
    for(const t of destroyedT) io.to(this.id).emit('turretRemoved',{id:t.id});
    this.turrets=this.turrets.filter(t=>t.hp>0);
    this.baseTurrets=this.baseTurrets.filter(t=>t.hp>0);

    this._broadcast();
  }

  _tickPlayers(){
    for(const[sid,p]of this.players){
      if(!p.alive)continue;
      // Decay adrenaline timer
      if(p.adrenalineTimer>0)p.adrenalineTimer--;
      const onAdrenaline=p.adrenalineTimer>0;
      // B3 fix: exhaustion lock — once stamina hits 0, can't sprint until recovered to 30%
      if(p.stamina<=0)p.exhausted=true;
      if(p.exhausted&&p.stamina>=p.maxStamina*0.3)p.exhausted=false;
      const canSprint=p.sprinting&&(p.dx||p.dy)&&(onAdrenaline||(p.stamina>0&&!p.exhausted));
      const spd=canSprint?5.0:3.0;
      if(canSprint&&!onAdrenaline)p.stamina=Math.max(0,p.stamina-1.5);
      else p.stamina=Math.min(p.maxStamina,p.stamina+0.6);
      let dxMove=0,dyMove=0;
      if(p.dx||p.dy){
        const m=Math.hypot(p.dx,p.dy)||1;
        dxMove=(p.dx/m)*spd;dyMove=(p.dy/m)*spd;
        this._move(p,dxMove,dyMove,10);
      }
      // B6 fix: lastVx/lastVy still used by zombie zigzag prediction, but DO NOT touch p.angle
      // (angle is set purely from client mouse input, which is correct)
      p.lastVx=dxMove*0.4+(p.lastVx||0)*0.6;
      p.lastVy=dyMove*0.4+(p.lastVy||0)*0.6;

      if(p.shootCooldown>0)p.shootCooldown--;
      if(p.meleeCooldown>0){p.meleeCooldown--;if(p.meleeCooldown===0)p.meleeSwinging=false;}
      if(p.damageFromTimer>0)p.damageFromTimer--;

      if(p.reloading){
        p.reloadTimer--;
        if(p.reloadTimer<=0){
          const w=p.slots[p.activeSlot];
          if(w&&w.kind==='gun'){
            const need=w.maxMag-w.mag;
            const take=Math.min(need,w.reserve);
            w.mag+=take;w.reserve-=take;
          }
          p.reloading=false;
        }
      }

      const slot=p.slots[p.activeSlot];
      if(p.shooting&&slot&&!p.reloading){
        if(slot.kind==='gun'){
          const wd=WDEFS[slot.type];
          if(slot.mag>0&&p.shootCooldown<=0){
            slot.mag--;p.shootCooldown=wd.cooldown;
            for(let i=0;i<wd.pellets;i++){
              const sp=(Math.random()-0.5)*wd.spread*2,ang=p.angle+sp;
              this.bullets.push({x:p.x,y:p.y,vx:Math.cos(ang)*wd.bSpeed,vy:Math.sin(ang)*wd.bSpeed,
                life:wd.bLife,damage:wd.damage,owner:sid,color:wd.color});
            }
            // Extend life so zombies have a chance to react (decays over ~6 ticks)
            this.gunshots.push({x:p.x,y:p.y,life:6,type:slot.type});
            if(slot.mag===0&&slot.reserve>0){p.reloading=true;p.reloadMax=wd.reload;p.reloadTimer=wd.reload;}
          }
        }else if(slot.kind==='melee'){
          const md=MDEFS[slot.type];
          if(p.meleeCooldown<=0){
            p.meleeCooldown=md.cooldown;p.meleeSwinging=true;p.meleeAngle=p.angle;
            for(const z of this.zombies){
              const dx=z.x-p.x,dy=z.y-p.y;
              const dist=Math.hypot(dx,dy);
              if(dist>md.range)continue;
              const ang=Math.atan2(dy,dx);
              let diff=ang-p.angle;
              while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;
              if(Math.abs(diff)>md.arc)continue;
              z.hp-=md.damage;
              z.knockbackVx=(dx/dist)*md.knockback;
              z.knockbackVy=(dy/dist)*md.knockback;
              if(z.hp<=0){
                p.kills++;p.sessionKills++;
                io.to(this.id).emit('killFeed',{killer:p.name,killerId:sid,zombieType:z.type});
                // Parts drop — uncommon (18% per kill)
                if(Math.random()<0.18){
                  const pk={id:this.npid++,x:z.x,y:z.y,type:'parts',amount:1};
                  this.pickups.push(pk);io.to(this.id).emit('pickupSpawned',pk);
                }
                if(this.phase==='night'){
                  const r=Math.random();
                  if(r<0.30)this.fightBonus.wood+=rng(2,5);
                  else if(r<0.50)this.fightBonus.scrap+=rng(1,2);
                  else if(r<0.65)this.fightBonus.ammo+=rng(1,3);
                  else if(r<0.78)this.fightBonus.parts=(this.fightBonus.parts||0)+1;
                }
                io.to(this.id).emit('zombieKilled',{id:z.id,x:z.x,y:z.y});
                this.zombies=this.zombies.filter(zz=>zz.id!==z.id);
              }
            }
            io.to(this.id).emit('meleeSwing',{pid:sid,angle:p.angle,type:slot.type});
          }
        }
      }

      // Near detection
      p.nearWeaponId=null;p.nearDoorId=null;p.nearTurretId=null;
      p.nearStash=false;p.nearTerminal=false;p.nearSleep=false;p.nearWorkshop=false;
      for(const gw of this.groundWeapons){
        if(Math.hypot(gw.x-p.x,gw.y-p.y)<58){p.nearWeaponId=gw.id;break;}
      }
      for(const bar of this._allBarricades()){
        if(bar.isDoor&&Math.hypot(bar.wx-p.x,bar.wy-p.y)<65){p.nearDoorId=`${bar.tx}_${bar.ty}`;break;}
      }
      for(const t of this._allTurrets()){
        if(Math.hypot(t.x-p.x,t.y-p.y)<55){p.nearTurretId=t.id;break;}
      }
      // Base interactions
      if(this._atBasePhase()){
        const stx=BASE_LAYOUT.stashTx*TILE+TILE/2,sty=BASE_LAYOUT.stashTy*TILE+TILE/2;
        if(Math.hypot(stx-p.x,sty-p.y)<60){
          p.nearStash=true;
          // Auto-deposit resources (parts deposit too)
          if(p.wood>0){this.stash.resources.wood+=p.wood;p.wood=0;}
          if(p.scrap>0){this.stash.resources.scrap+=p.scrap;p.scrap=0;}
          if(p.parts>0){this.stash.resources.parts+=p.parts;p.parts=0;}
        }
        const ttx=BASE_LAYOUT.terminalTx*TILE+TILE/2,tty=BASE_LAYOUT.terminalTy*TILE+TILE/2;
        if(Math.hypot(ttx-p.x,tty-p.y)<55) p.nearTerminal=true;
        if(this.phase==='night'&&Math.hypot(ttx-p.x,tty-p.y)<55) p.nearSleep=true;
        // Workshop detection
        const wpx=BASE_LAYOUT.workshopTx*TILE+TILE/2,wpy=BASE_LAYOUT.workshopTy*TILE+TILE/2;
        if(Math.hypot(wpx-p.x,wpy-p.y)<70) p.nearWorkshop=true;
        else p.nearWorkshop=false;
      } else { p.nearWorkshop=false; }
      // Auto-extract zone exit during extract
      if(this.phase==='extract'&&this.zone){
        const ex=this.zone.entryX*TILE+TILE/2;
        const ey=(this.zone.entryY-1)*TILE+TILE/2;
        if(Math.hypot(ex-p.x,ey-p.y)<70){
          p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
          p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
          p.atBase=true;
          io.to(this.id).emit('playerExtracted',{id:p.id});
        }
      }

      // Pickups
      this.pickups=this.pickups.filter(pk=>{
        if(Math.hypot(pk.x-p.x,pk.y-p.y)>32)return true;
        let ok=false;
        const ammoMap={pistol_ammo:'pistol',shotgun_ammo:'shotgun',rifle_ammo:'rifle',smg_ammo:'smg'};
        if(pk.type==='medkit'&&p.hp<p.maxHp){p.hp=Math.min(p.maxHp,p.hp+pk.amount);ok=true;}
        else if(pk.type==='wood'){p.wood+=pk.amount;ok=true;}
        else if(pk.type==='scrap'){p.scrap+=pk.amount;ok=true;}
        else if(pk.type==='parts'){p.parts=(p.parts||0)+pk.amount;ok=true;}
        else if(ammoMap[pk.type]){
          const wType=ammoMap[pk.type];
          for(const sw of p.slots){
            if(sw&&sw.kind==='gun'&&sw.type===wType&&sw.reserve<sw.maxReserve){
              sw.reserve=Math.min(sw.maxReserve,sw.reserve+pk.amount);ok=true;break;
            }
          }
        }
        // Signature pickups
        else if(pk.type==='adrenaline'){p.adrenalineTimer+=TICK*5;ok=true;}
        else if(pk.type==='grenade'){p.grenades+=1;ok=true;}
        else if(pk.type==='toolbox'){p.toolboxes+=1;ok=true;}
        if(ok)io.to(this.id).emit('pickupTaken',{id:pk.id,pid:sid});
        return!ok;
      });
    }
  }

  _tickBullets(){
    this.bullets=this.bullets.filter(b=>{
      b.x+=b.vx;b.y+=b.vy;b.life--;
      if(this.isSolid(Math.floor(b.x/TILE),Math.floor(b.y/TILE)))return false;
      for(const bar of this._allBarricades()){
        if(bar.isDoor&&bar.isOpen)continue;
        if(Math.hypot(b.x-bar.wx,b.y-bar.wy)<22)return false;
      }
      for(const z of this.zombies){
        const r=z.type==='big'?18:z.type==='runner'?9:12;
        if(Math.hypot(b.x-z.x,b.y-z.y)<r){
          z.hp-=b.damage;
          if(z.hp<=0){
            const isTurret=b.owner==='turret';
            const kp=isTurret?null:this.players.get(b.owner);
            if(kp){kp.kills++;kp.sessionKills++;}
            io.to(this.id).emit('killFeed',{killer:isTurret?'Turret':(kp?.name||'?'),killerId:b.owner,zombieType:z.type});
            // Parts drop — uncommon (15-20% per kill, 1 part each)
            if(Math.random()<0.18){
              const pk={id:this.npid++,x:z.x,y:z.y,type:'parts',amount:1};
              this.pickups.push(pk);io.to(this.id).emit('pickupSpawned',pk);
            }
            if(Math.random()<0.05){
              const ammoTypes=['pistol_ammo','shotgun_ammo','rifle_ammo','smg_ammo'];
              const pk={id:this.npid++,x:z.x,y:z.y,type:pick(ammoTypes),amount:rng(2,6)};
              this.pickups.push(pk);io.to(this.id).emit('pickupSpawned',pk);
            }else if(Math.random()<0.10){
              const pk={id:this.npid++,x:z.x,y:z.y,type:'scrap',amount:rng(1,3)};
              this.pickups.push(pk);io.to(this.id).emit('pickupSpawned',pk);
            }else if(Math.random()<0.12){
              const pk={id:this.npid++,x:z.x,y:z.y,type:'medkit',amount:rng(8,18)};
              this.pickups.push(pk);io.to(this.id).emit('pickupSpawned',pk);
            }
            // Night fight bonus accrual — scales meaningfully over night
            if(this.phase==='night'){
              const r=Math.random();
              if(r<0.30)this.fightBonus.wood+=rng(2,5);
              else if(r<0.50)this.fightBonus.scrap+=rng(1,2);
              else if(r<0.65)this.fightBonus.ammo+=rng(1,3);
              else if(r<0.78)this.fightBonus.parts=(this.fightBonus.parts||0)+1;
            }
            io.to(this.id).emit('zombieKilled',{id:z.id,x:z.x,y:z.y});
            this.zombies=this.zombies.filter(zz=>zz.id!==z.id);
          }
          return false;
        }
      }
      return b.life>0;
    });
    this.gunshots=this.gunshots.filter(g=>{g.life--;return g.life>0;});
  }

  _tickGrenades(){
    if(!this.grenadesActive||this.grenadesActive.length===0)return;
    for(const g of this.grenadesActive){
      // Travel toward target until close, then stop and tick fuse
      const dxT=g.tx-g.x, dyT=g.ty-g.y, dT=Math.hypot(dxT,dyT);
      if(dT>10){
        g.x+=g.vx; g.y+=g.vy;
        // Wall stop
        if(this.isSolid(Math.floor(g.x/TILE),Math.floor(g.y/TILE))){
          g.x-=g.vx;g.y-=g.vy;g.vx=0;g.vy=0;g.tx=g.x;g.ty=g.y;
        }
      }
      g.fuse--;
      if(g.fuse<=0){
        // Explode!
        const radius=110;
        for(const z of this.zombies){
          const d=Math.hypot(z.x-g.x,z.y-g.y);
          if(d<radius){
            // Damage falls off with distance
            const dmg=Math.max(40,90*(1-d/radius));
            z.hp-=dmg;
            // Knockback away from blast
            if(d>0){
              z.knockbackVx=(z.x-g.x)/d*8;
              z.knockbackVy=(z.y-g.y)/d*8;
            }
            if(z.hp<=0){
              const kp=this.players.get(g.owner);
              if(kp){kp.kills++;kp.sessionKills++;}
              io.to(this.id).emit('killFeed',{killer:kp?.name||'?',killerId:g.owner,zombieType:z.type});
              io.to(this.id).emit('zombieKilled',{id:z.id,x:z.x,y:z.y});
            }
          }
        }
        this.zombies=this.zombies.filter(z=>z.hp>0);
        // Damage barricades too (friendly fire)
        for(const bar of this._allBarricades()){
          if(Math.hypot(bar.wx-g.x,bar.wy-g.y)<radius) bar.hp-=30;
        }
        io.to(this.id).emit('grenadeExplode',{x:g.x,y:g.y,radius});
      }
    }
    this.grenadesActive=this.grenadesActive.filter(g=>g.fuse>0);
  }

  _tickZombies(){
    const isDayPhase=(this.phase==='day'||this.phase==='extract');
    for(const z of this.zombies){
      if(z.knockbackVx||z.knockbackVy){
        this._move(z,z.knockbackVx,z.knockbackVy,z.type==='big'?16:11);
        z.knockbackVx*=0.7;z.knockbackVy*=0.7;
        if(Math.abs(z.knockbackVx)<0.05)z.knockbackVx=0;
        if(Math.abs(z.knockbackVy)<0.05)z.knockbackVy=0;
      }
      // ─── DAY PHASE: stealth state machine ────────────────────────────────
      // Detect any player by sight or sound (sets state)
      let mdx=0, mdy=0, nearP=null, nearDist=Infinity;
      if(isDayPhase){
        const seen=this.zombieDayVision(z);     // closest player visible in cone
        const heard=this.zombieHearing(z);      // closest player making sound
        // Sight has priority over sound when picking chase target
        const detected=seen||heard;
        if(seen){
          // Lock onto seen player → CHASING
          z.aiState='chasing';
          z.chaseTargetId=seen.id;
          z.investigateX=seen.x;z.investigateY=seen.y;
          z.investigateLook=0;
        } else if(heard){
          // Heard something but didn't see → ALERTED, investigate
          if(z.aiState!=='chasing'){
            z.aiState='alerted';
            z.investigateX=heard.x;z.investigateY=heard.y;
            z.investigateLook=0;
          } else {
            // Already chasing — refresh investigate point with new sound location
            z.investigateX=heard.x;z.investigateY=heard.y;
          }
        } else {
          // No detection this tick. Check if we should drop chase.
          if(z.aiState==='chasing'){
            // Lost sight — downgrade to alerted, head to last known spot
            z.aiState='alerted';
          }
        }
        // Movement based on state
        if(z.aiState==='chasing'){
          // Chase the locked target if still alive, else nearest visible player
          let tgt=null;
          for(const p of this.players.values()){
            if(p.id===z.chaseTargetId&&p.alive&&!p.spectating){tgt=p;break;}
          }
          if(!tgt){
            // Target gone — drop to alerted with last known investigate point
            z.aiState='alerted';
          } else {
            mdx=tgt.x-z.x;mdy=tgt.y-z.y;
            nearP=tgt;nearDist=Math.hypot(mdx,mdy)||1;
            mdx/=nearDist;mdy/=nearDist;
            // Runner zigzag (preserve existing behavior at close range)
            if(z.type==='runner'&&nearDist<80){
              z.zigzagPhase+=0.18;
              const perp=Math.sin(z.zigzagPhase)*0.6;
              const ox=mdx;mdx=mdx-mdy*perp;mdy=mdy+ox*perp;
              const m=Math.hypot(mdx,mdy)||1;mdx/=m;mdy/=m;
            }
            z.investigateX=tgt.x;z.investigateY=tgt.y;
          }
        }
        if(z.aiState==='alerted'){
          // Walk to last known position. When arrived, "look around" then revert.
          if(z.investigateX==null){
            z.aiState='idle';
          } else {
            const dx=z.investigateX-z.x, dy=z.investigateY-z.y, dd=Math.hypot(dx,dy);
            if(dd>30){
              mdx=dx/dd;mdy=dy/dd;
              z.investigateLook=0;
            } else {
              // Arrived. Look around (rotate slowly) for ~2.5s
              if(z.investigateLook===0)z.investigateLook=TICK*Math.floor(rng(20,30)/10);
              z.investigateLook--;
              // Slow scan: rotate angle gradually
              z.angle+=0.04;
              if(z.investigateLook<=0){
                z.aiState='idle';
                z.investigateX=null;z.investigateY=null;
              }
              continue;  // No movement during look-around
            }
          }
        }
        if(z.aiState==='idle'){
          // Wander slowly with occasional pauses
          if(z.wanderPause>0){
            z.wanderPause--;
            // Slow rotation while paused (looking around)
            z.angle+=0.015;
            continue;  // Stationary
          }
          z.wanderChange--;
          if(z.wanderChange<=0){
            z.wanderDir=Math.random()*Math.PI*2;
            z.wanderChange=rng(80,140);
            // 25% chance to pause for 1-3 seconds instead of moving
            if(Math.random()<0.25){
              z.wanderPause=rng(20,60);
              continue;
            }
          }
          mdx=Math.cos(z.wanderDir);
          mdy=Math.sin(z.wanderDir);
        }
      } else {
        // ─── NIGHT/OTHER: original auto-see-all behavior via flow field ───
        const[fdx,fdy,np,nd]=this._getFlow(z);
        if(!np)continue;
        nearP=np;nearDist=nd;
        mdx=fdx;mdy=fdy;
        if(nearDist<80){
          if(z.type==='runner'){
            z.zigzagPhase+=0.18;
            const leadDist=clamp(nearDist*0.3,0,40);
            const targetX=nearP.x+(nearP.lastVx||0)*leadDist*0.3;
            const targetY=nearP.y+(nearP.lastVy||0)*leadDist*0.3;
            const tdx=targetX-z.x,tdy=targetY-z.y,td=Math.hypot(tdx,tdy)||1;
            const perp=Math.sin(z.zigzagPhase)*0.6;
            mdx=tdx/td-tdy/td*perp;mdy=tdy/td+tdx/td*perp;
          }else{
            mdx=(nearP.x-z.x)/nearDist;mdy=(nearP.y-z.y)/nearDist;
          }
        }
        // Always-chasing during night
        z.aiState='chasing';
      }
      const mag=Math.hypot(mdx,mdy)||1;mdx/=mag;mdy/=mag;
      // B4 fix: probe at zombie radius in movement direction (catches corner clip),
      // plus left/right side probes to detect tight passages
      const probeD=TILE*0.8;
      const r0=z.type==='big'?16:z.type==='runner'?9:11;
      const fwdX=z.x+mdx*probeD, fwdY=z.y+mdy*probeD;
      const wallFwd=this.isSolid(Math.floor(fwdX/TILE),Math.floor(fwdY/TILE),true);
      // Check side probes — perpendicular to movement direction at zombie body radius
      const px=-mdy, py=mdx;
      const sideR=r0*1.2;
      const wallL=this.isSolid(Math.floor((fwdX+px*sideR)/TILE),Math.floor((fwdY+py*sideR)/TILE),true);
      const wallR=this.isSolid(Math.floor((fwdX-px*sideR)/TILE),Math.floor((fwdY-py*sideR)/TILE),true);
      if(wallFwd||wallL||wallR){
        // Try sliding along open side
        const c1=this.isSolid(Math.floor((z.x+px*probeD)/TILE),Math.floor((z.y+py*probeD)/TILE),true);
        const c2=this.isSolid(Math.floor((z.x-px*probeD)/TILE),Math.floor((z.y-py*probeD)/TILE),true);
        if(!c1&&wallR){mdx=mdx*0.2+px*0.8;mdy=mdy*0.2+py*0.8;}
        else if(!c2&&wallL){mdx=mdx*0.2-px*0.8;mdy=mdy*0.2-py*0.8;}
        else if(!c1){mdx=mdx*0.3+px*0.7;mdy=mdy*0.3+py*0.7;}
        else if(!c2){mdx=mdx*0.3-px*0.7;mdy=mdy*0.3-py*0.7;}
        else{mdx+=(Math.random()-0.5)*0.8;mdy+=(Math.random()-0.5)*0.8;}
      }
      const r=r0;
      // ─── Separation force (anti-blob) ──────────────────────────────────────
      // Zombies push apart from each other so they don't stack into a single mass.
      let sepX=0,sepY=0;
      for(const z2 of this.zombies){
        if(z2.id===z.id)continue;
        const dx=z.x-z2.x,dy=z.y-z2.y,dd=Math.hypot(dx,dy)||1;
        const r2=z2.type==='big'?16:z2.type==='runner'?9:11;
        const minSep=(r+r2)*1.3;  // wider separation buffer
        if(dd<minSep){
          // Soft push when overlapping
          const overlap=(minSep-dd)/minSep;
          const force=overlap*0.55;  // stronger than before (was 0.08)
          sepX+=dx/dd*force;
          sepY+=dy/dd*force;
          // Hard anti-stack: if very close, push extra to prevent perfect overlap
          if(dd<(r+r2)*0.7){
            sepX+=dx/dd*0.4;
            sepY+=dy/dd*0.4;
          }
        }
      }
      // Player separation (don't pile on the player when they're already in attack range)
      for(const p of this.players.values()){
        if(!p.alive)continue;
        const dx=z.x-p.x,dy=z.y-p.y,dd=Math.hypot(dx,dy)||1;
        const attackRange=r+14,sepRange=r+22;
        if(dd>attackRange&&dd<sepRange){
          const push=(sepRange-dd)*0.25;
          sepX+=dx/dd*push;sepY+=dy/dd*push;
        }
      }
      mdx+=sepX;mdy+=sepY;
      // ─── Screamer special ──
      if(z.type==='screamer'){
        z.screamTimer--;
        if(z.screamTimer<=0){
          z.screamTimer=TICK*rng(6,12);z.screaming=true;z.screamRadius=240;
          for(const z2 of this.zombies)
            if(z2.id!==z.id&&Math.hypot(z2.x-z.x,z2.y-z.y)<240)
              z2.speed=Math.min(z2.speed*1.5+0.5,4.5);
          io.to(this.id).emit('screamerPulse',{x:z.x,y:z.y});
        }else{z.screaming=false;z.screamRadius=0;}
      }
      // ─── Gunshot reaction (alert state) ───────────────────────────────────
      // Decay alert timer. Find best gunshot to react to.
      if(z._alertTimer>0)z._alertTimer--;
      else{z._alertTargetX=null;z._alertTargetY=null;}
      // Per-gun-type alert range — louder guns = farther reach
      const gunRange={pistol:300,smg:340,shotgun:420,rifle:500};
      // Scan ALL recent gunshots, pick the closest one this zombie could hear
      let bestGs=null,bestGsDist=Infinity;
      for(const gs of this.gunshots){
        const range=gunRange[gs.type]||320;
        const d=Math.hypot(z.x-gs.x,z.y-gs.y);
        if(d<range&&d<bestGsDist){bestGs=gs;bestGsDist=d;}
      }
      if(bestGs){
        const closenessFactor=Math.min(1,nearDist===Infinity?1:nearDist/250);
        const alertTicks=Math.floor(TICK*4*closenessFactor + TICK*1);
        if(z._alertTimer<alertTicks){
          z._alertTimer=alertTicks;
          z._alertTargetX=bestGs.x;
          z._alertTargetY=bestGs.y;
        }
        // During day phase, gunshots also wake idle zombies into alerted state
        if(isDayPhase&&z.aiState==='idle'){
          z.aiState='alerted';
          z.investigateX=bestGs.x;z.investigateY=bestGs.y;
          z.investigateLook=0;
        }
      }
      // Apply alert bias if active (only meaningful when zombie has a chase target)
      if(z._alertTimer>0&&z._alertTargetX!=null&&nearP){
        const ax=z._alertTargetX-z.x,ay=z._alertTargetY-z.y,ad=Math.hypot(ax,ay)||1;
        const pullStrength=0.6*(z._alertTimer/(TICK*4));
        if(nearDist>180){
          mdx=mdx*(1-pullStrength)+(ax/ad)*pullStrength;
          mdy=mdy*(1-pullStrength)+(ay/ad)*pullStrength;
        } else {
          mdx+=(ax/ad)*0.15;
          mdy+=(ay/ad)*0.15;
        }
      }
      z.prevX=z.x;z.prevY=z.y;
      const fm=Math.hypot(mdx,mdy)||1;
      // Speed multiplier based on AI state
      // Idle = slow wander, Alerted = brisk investigate, Chasing = full speed
      let speedMult=1.0;
      if(z.aiState==='idle')speedMult=0.4;
      else if(z.aiState==='alerted')speedMult=0.7;
      this._move(z,(mdx/fm)*z.speed*speedMult,(mdy/fm)*z.speed*speedMult,r);
      z.angle=Math.atan2(mdy,mdx);
      // B4 fix: hard safeguard — if zombie center is INSIDE a wall, push out toward nearest open tile
      const ztx=Math.floor(z.x/TILE), zty=Math.floor(z.y/TILE);
      if(this.isSolid(ztx,zty,true)){
        // Find nearest non-solid tile within 2 tiles
        let bestDx=0, bestDy=0, bestD=Infinity;
        for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++){
          if(dx===0&&dy===0)continue;
          if(!this.isSolid(ztx+dx,zty+dy,true)){
            const d=Math.hypot(dx,dy);
            if(d<bestD){bestD=d;bestDx=dx;bestDy=dy;}
          }
        }
        if(bestD<Infinity){
          const tx=(ztx+bestDx)*TILE+TILE/2, ty=(zty+bestDy)*TILE+TILE/2;
          z.x=tx; z.y=ty;
        }
      }
      if(Math.abs(z.x-z.prevX)<0.05&&Math.abs(z.y-z.prevY)<0.05){
        z.stuckTimer++;
        if(z.stuckTimer>20){
          const dirs=[[1,0],[-1,0],[0,1],[0,-1]];
          let escaped=false;
          for(const[ex,ey]of dirs){
            if(!this.isSolid(Math.floor((z.x+ex*TILE*0.6)/TILE),Math.floor((z.y+ey*TILE*0.6)/TILE),true)){
              z.x+=ex*2.5;z.y+=ey*2.5;escaped=true;break;
            }
          }
          if(!escaped){z.x=Math.floor(z.x/TILE)*TILE+TILE/2;z.y=Math.floor(z.y/TILE)*TILE+TILE/2;}
          z.stuckTimer=0;
        }
      }else z.stuckTimer=0;

      let hitObstacle=false;
      for(const bar of this._allBarricades()){
        if(bar.isDoor&&bar.isOpen)continue;
        if(Math.hypot(z.x-bar.wx,z.y-bar.wy)<r+26){
          z.attackTimer++;
          if(z.attackTimer>=z.attackRate){
            const dmg=z.type==='big'?22:11;
            z.attackTimer=0;bar.hp-=bar.isMetal?dmg*0.5:dmg;
            if(bar.hp<=0)io.to(this.id).emit('barricadeDestroyed',{tx:bar.tx,ty:bar.ty});
          }
          hitObstacle=true;break;
        }
      }
      if(!hitObstacle){
        for(const t of this._allTurrets()){
          if(Math.hypot(z.x-t.x,z.y-t.y)<r+24){
            z.attackTimer++;
            if(z.attackTimer>=z.attackRate){z.attackTimer=0;t.hp-=z.type==='big'?22:11;}
            hitObstacle=true;break;
          }
        }
      }
      // B1 fix: use a wider attack-engagement zone so zombies don't flip in and out of range every tick.
      // Zombie sticks to attacking once close enough; only resets timer when they retreat well past engagement range.
      const attackEngageR=r+18;        // when within this, attackTimer keeps building
      const attackResetR =r+30;        // only reset attackTimer if much further away
      // B2 fix: if zombie has overlapped into the player (rear attack stuck), push out hard
      // Only run combat code if zombie has a target player (not idle/wandering)
      if(nearP){
        if(!hitObstacle && nearDist < r+9){
          const dx=z.x-nearP.x, dy=z.y-nearP.y, dd=Math.hypot(dx,dy)||1;
          const overlap=(r+9-dd);
          z.x += dx/dd * overlap * 0.7;
          z.y += dy/dd * overlap * 0.7;
        }
        if(!hitObstacle && nearDist < attackEngageR){
          z.attackTimer++;
          if(z.attackTimer>=z.attackRate){
            z.attackTimer=0;nearP.hp-=z.damage;
            nearP.damageFromX=z.x;nearP.damageFromY=z.y;nearP.damageFromTimer=TICK*1.5;
            if(nearP.hp<=0){
              this._handlePlayerDeath(nearP);
            }
          }
        } else if(!hitObstacle && nearDist > attackResetR){
          // Only reset timer when zombie clearly retreated
          z.attackTimer=Math.max(0,z.attackTimer-1);
        }
      }
      // (else: in the "buffer zone" between engage and reset — keep timer as-is, no flip-flop)
    }
  }

  _tickTurrets(){
    const turrets=this._allTurrets();
    for(const t of turrets){
      if(t.cooldown>0)t.cooldown--;
      // Sentry slot: passive ammo regen at base (1 ammo every 30 ticks = 1.5s)
      if(t.sentry && t.ammo<t.maxAmmo && (this._tick%30)===0)t.ammo++;
      if(t.ammo<=0||t.hp<=0)continue;
      let nearest=null,nearestD=300;
      for(const z of this.zombies){
        const d=Math.hypot(z.x-t.x,z.y-t.y);
        if(d<nearestD){nearestD=d;nearest=z;}
      }
      if(!nearest)continue;
      t.angle=Math.atan2(nearest.y-t.y,nearest.x-t.x);
      if(t.cooldown<=0){
        t.cooldown=10;t.ammo--;
        this.bullets.push({
          x:t.x,y:t.y,
          vx:Math.cos(t.angle)*16,vy:Math.sin(t.angle)*16,
          life:50,damage:18,owner:'turret',color:'#fc4',
        });
      }
    }
  }

  _tickNightHorde(){
    // Escalating spawns based on night progress
    // Higher spawn rate per user request
    const nightProgress=1-(this.nightTimer/NIGHT_TICKS);
    // Was: max(8, 40-32*progress). Now faster — max(5, 28-22*progress)
    const spawnRate=Math.max(5,28-Math.floor(nightProgress*22));
    if((this._tick%spawnRate)===0){
      // All night zombies spawn from the exit corridor and swarm toward base
      // Spread spawns across the corridor entry (x=46..50) just outside the base
      const corridorX = BASE_LAYOUT.exitTx + rng(-2,2);
      const corridorY = BASE_H - 1;
      const r=Math.random();
      const type=r<0.18?'runner':r<0.28?'screamer':r<0.40?'big':'normal';
      this.zombies.push(makeZombie(this.nzid++,
        corridorX*TILE+TILE/2, corridorY*TILE+TILE/2, type, this.day));
    }
  }

  _broadcast(){
    // Pre-compute per-player stealth status (worst state of any zombie targeting them)
    const stealthByPid=new Map();
    const isDayPhase=(this.phase==='day'||this.phase==='extract');
    if(isDayPhase){
      for(const p of this.players.values()){stealthByPid.set(p.id,'unseen');}
      for(const z of this.zombies){
        if(z.aiState==='chasing'&&z.chaseTargetId){
          stealthByPid.set(z.chaseTargetId,'chased');
        } else if(z.aiState==='alerted'){
          // Find the player nearest to investigate point — they're the "alerted target"
          if(z.investigateX!=null){
            let bestId=null,bestD=Infinity;
            for(const p of this.players.values()){
              if(!p.alive)continue;
              const d=Math.hypot(p.x-z.investigateX,p.y-z.investigateY);
              if(d<400&&d<bestD){bestD=d;bestId=p.id;}
            }
            if(bestId&&stealthByPid.get(bestId)!=='chased'){
              stealthByPid.set(bestId,'alerted');
            }
          }
        }
      }
    }
    const snap={
      players:Array.from(this.players.values()).map(p=>({
        id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,
        alive:p.alive,respawnTimer:p.respawnTimer,activeSlot:p.activeSlot,
        slots:p.slots,reloading:p.reloading,reloadTimer:p.reloadTimer,reloadMax:p.reloadMax,
        wood:p.wood,scrap:p.scrap,parts:p.parts||0,kills:p.kills,sessionKills:p.sessionKills,
        stamina:p.stamina,maxStamina:p.maxStamina,sprinting:p.sprinting,
        nearWeaponId:p.nearWeaponId,nearDoorId:p.nearDoorId,nearTurretId:p.nearTurretId,
        nearStash:p.nearStash,nearTerminal:p.nearTerminal,nearSleep:p.nearSleep,nearWorkshop:p.nearWorkshop,
        meleeSwinging:p.meleeSwinging,meleeAngle:p.meleeAngle,
        damageFromX:p.damageFromX,damageFromY:p.damageFromY,damageFromTimer:p.damageFromTimer,
        atBase:p.atBase,
        adrenalineTimer:p.adrenalineTimer||0,
        grenades:p.grenades||0,
        toolboxes:p.toolboxes||0,
        personalUpgrades:p.personalUpgrades||{},
        spectating:p.spectating||false,
        spectateTargetId:p.spectateTargetId||null,
        stealthStatus:stealthByPid.get(p.id)||null,
      })),
      zombies:this.zombies.map(z=>({id:z.id,x:z.x,y:z.y,hp:z.hp,maxHp:z.maxHp,
        angle:z.angle,type:z.type,screaming:z.screaming,screamRadius:z.screamRadius||0,
        alerted:(z._alertTimer||0)>0,
        aiState:z.aiState||'chasing'})),
      bullets:this.bullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,color:b.color})),
      barricades:this._allBarricades(),
      turrets:this._allTurrets(),
      groundWeapons:this.groundWeapons,
      pickups:this.pickups,
      grenades:(this.grenadesActive||[]).map(g=>({id:g.id,x:g.x,y:g.y,fuse:g.fuse})),
      day:this.day,
      phase:this.phase,
      zoneTimer:this.zoneTimer,nightTimer:this.nightTimer,phaseTimer:this.phaseTimer,
      sleepAvailable:this.sleepAvailable,
      fightBonus:this.fightBonus,
      scoutReport:this.scoutReport,
      stashSize:this._stashSize(),
      stashCount:this.stash.weapons.length,
      zoneTheme:this.zone?this.zone.theme:null,
      zoneEntryX:this.zone?(this.zone.entryX*TILE+TILE/2):null,
      zoneEntryY:this.zone?((this.zone.entryY-1)*TILE+TILE/2):null,
      zoneSize:this.zone?this.zone.size:null,
      teamUpgrades:{...this.teamUpgrades},
      soloLives:this.soloLives,
      isSolo:this.players.size===1,
    };
    io.to(this.id).emit('state',snap);
  }
}

const rooms=new Map();
function getRoom(id){if(!rooms.has(id))rooms.set(id,new GameRoom(id));return rooms.get(id);}

io.on('connection',socket=>{
  console.log(`[+] ${socket.id}`);
  let room=null;
  sockets.set(socket.id, socket);
  socket.on('joinRoom',({roomId,name})=>{
    roomId=(roomId||'main').toString().slice(0,20);
    name=(name||'Survivor').toString().slice(0,16);
    room=getRoom(roomId);socket.join(roomId);room.addPlayer(socket.id,name);
    // Send world matching current phase
    const inZone = room._atZonePhase() && room.zone;
    const worldTiles = inZone ? room.zone.tiles : room.baseTiles;
    const worldW = inZone ? room.zone.W : BASE_W;
    const worldH = inZone ? room.zone.H : BASE_H;
    const lootRooms = inZone ? room.zone.lootRooms : [];
    socket.emit('init',{
      playerId:socket.id,
      tiles:worldTiles, W:worldW, H:worldH,
      worldKind: inZone ? 'zone' : 'base',
      baseLayout: BASE_LAYOUT,
      pickups: room.pickups, barricades: room._allBarricades(), turrets: room._allTurrets(),
      groundWeapons: room.groundWeapons, lootRooms,
      phase: room.phase,
      scoutReport: room.scoutReport,
    });
    io.to(roomId).emit('playerJoined',{id:socket.id,name});
    console.log(`[>] ${name} → ${roomId} (${room.players.size}p)`);
  });
  socket.on('input',  i=>{if(room)room.handleInput(socket.id,i);});
  socket.on('build',  d=>{if(room)room.handleBuild(socket.id,d);});
  socket.on('pickup', ()=>{if(room)room.handleInput(socket.id,{pickupWeapon:true});});
  socket.on('door',   ()=>{if(room)room.handleInput(socket.id,{toggleDoor:true});});
  socket.on('interact',()=>{if(room)room.handleInput(socket.id,{interact:true});});
  socket.on('throwGrenade',()=>{if(room)room.handleInput(socket.id,{throwGrenade:true});});
  socket.on('useToolbox',()=>{if(room)room.handleInput(socket.id,{useToolbox:true});});
  socket.on('openStash',()=>{if(room)room.handleInput(socket.id,{openStash:true});});
  socket.on('stashOp',op=>{if(room)room.handleInput(socket.id,{stashOp:op});});
  socket.on('openWorkshop',()=>{if(room)room.handleInput(socket.id,{openWorkshop:true});});
  socket.on('workshopOp',op=>{if(room)room.handleInput(socket.id,{workshopOp:op});});
  socket.on('spectateNext',()=>{if(room)room.handleInput(socket.id,{spectateNext:true});});
  socket.on('spectatePrev',()=>{if(room)room.handleInput(socket.id,{spectatePrev:true});});
  socket.on('ping',   d=>{if(room)room.handlePing(socket.id,d);});
  socket.on('chat',   m=>{if(room)room.handleChat(socket.id,m);});
  socket.on('disconnect',()=>{
    sockets.delete(socket.id);
    if(room){room.removePlayer(socket.id);io.to(room.id).emit('playerLeft',{id:socket.id});
      if(room.players.size===0){room.destroy();rooms.delete(room.id);}}
    console.log(`[-] ${socket.id}`);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🧟 Zombie server (Stage 1 · Turn 1) on port ${PORT}`));
