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
  for(let x=22;x<42;x++)  tiles[22][x]=T_WALL;     // hub | terminal
  // Door openings (3 tiles each)
  for(let dy=0;dy<3;dy++) tiles[10+dy][22]=T_BASE_HUB;
  for(let dy=0;dy<3;dy++) tiles[10+dy][42]=T_BASE_HUB;
  for(let dx=0;dx<3;dx++) tiles[22][30+dx]=T_BASE_HUB;
  for(let dx=0;dx<3;dx++) tiles[22][10+dx]=T_BASE_HUB;
  // Exit corridor (south)
  for(let x=46;x<=50;x++) for(let y=BASE_H-2;y<BASE_H;y++) tiles[y][x]=T_CORRIDOR;
  return tiles;
}

const BASE_LAYOUT={
  stashTx: 11, stashTy: 10,
  terminalTx: 32, terminalTy: 28,
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

  const ft={indoor:[],court:[],loot:[]};
  for(let y=0;y<H;y++) for(let x=0;x<W;x++){
    const t=tiles[y][x];
    if(t===T_FLOOR)ft.indoor.push({x,y});
    if(t===T_COURT)ft.court.push({x,y});
    if(t===T_LOOT) ft.loot.push({x,y});
  }
  return{tiles,ft,lootRooms,W,H,entryX,entryY:BORD,size};
}

function carveRoom(tiles,x,y,w,h,ft){
  for(let ty=y;ty<y+h;ty++) for(let tx=x;tx<x+w;tx++) tiles[ty][tx]=T_WALL;
  for(let ty=y+1;ty<y+h-1;ty++) for(let tx=x+1;tx<x+w-1;tx++) tiles[ty][tx]=ft;
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
    damage:d.dmg,attackRate:d.rate,angle:0,attackTimer:0,
    screaming:false,screamTimer:rng(40,120),screamRadius:0,
    stuckTimer:0,prevX:x,prevY:y,
    knockbackVx:0,knockbackVy:0,
    zigzagPhase:Math.random()*Math.PI*2,_alertTimer:0};
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
    this._tick=0;
    this.nzid=0;this.npid=0;this.ngwid=0;this.ntid=0;

    // Persistent base
    this.baseTiles=generateBase();
    this.baseBarricades=[];
    this.baseTurrets=[];

    // Stash (Turn 2 will wire UI; now just exists)
    this.stash={
      resources:{wood:0,scrap:0,pistol_ammo:0,shotgun_ammo:0,rifle_ammo:0,smg_ammo:0},
      weapons:[],
    };

    // Phase state
    this.day=1;
    this.phase='base';
    this.phaseTimer=0;
    this.zoneTimer=0;
    this.nightTimer=0;
    this.sleepUnlockTime=TICK*60;
    this.sleepAvailable=false;
    this.fightBonus={wood:0,scrap:0,ammo:0,fullNight:false};

    this.zone=null;
    this.scoutReport=this._rollScoutReport();

    this.flows=new Map();this.flowTimer=0;

    this.interval=setInterval(()=>this.tick(),1000/TICK);
  }

  destroy(){clearInterval(this.interval);}

  _rollScoutReport(){
    const sizes=['small','medium','large'];
    const themes=['mall']; // Stage 1: mall only
    const hordeFlavors=[
      'Balanced — mixed types',
      'Heavy — more bigs',
      'Swift — more runners',
      'Loud — more screamers',
    ];
    return{theme:pick(themes),size:pick(sizes),hordeFlavor:pick(hordeFlavors)};
  }

  _stashSize(){
    const n=this.players.size;
    return 6+(n>0?(n-1)*2:0);
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

  _freshLoadout(){return[makeGunSlot('pistol'),null,makeMeleeSlot('knife')];}

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
      nearStash:false,nearTerminal:false,nearSleep:false,
      meleeSwinging:false,meleeAngle:0,
      lastVx:0,lastVy:0,
      damageFromX:0,damageFromY:0,damageFromTimer:0,
      atBase: !inZone,
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
  }

  _tryInteract(sid,p){
    if(p.nearTerminal&&this.phase==='base'){this._startDay();return;}
    if(p.nearSleep&&this.phase==='night'&&this.sleepAvailable){this._sleepThroughNight();return;}
    if(p.nearStash){this._tryOpenStash(sid,p);return;}
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
    this.zone=generateMallZone(this.scoutReport.size);
    this.barricades=[];this.turrets=[];
    this.zombies=[];this.bullets=[];this.pickups=[];this.groundWeapons=[];
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

  _spawnZombiesInZone(){
    if(!this.zone)return;
    const pool=[...this.zone.ft.indoor,...this.zone.ft.court];
    const total=20+this.day*4;
    const types=['normal','normal','normal','big','runner','screamer'];
    for(let i=0;i<total;i++){
      const t=this._safeTile(pool);
      if(Math.abs(t.x-this.zone.entryX)<8&&t.y<this.zone.entryY+12)continue;
      this.zombies.push(makeZombie(this.nzid++,t.x*TILE+TILE/2,t.y*TILE+TILE/2,
        types[rng(0,types.length-1)],this.day));
    }
  }

  _spawnLootInZone(){
    if(!this.zone)return;
    const pool=[...this.zone.ft.indoor,...this.zone.ft.court];
    for(let i=0;i<20;i++){
      const t=this._safeTile(pool);
      const types=['medkit','medkit','wood','wood','wood','scrap'];
      this.pickups.push({id:this.npid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,
        type:pick(types),amount:rng(15,30)});
    }
    const gunTypes=['shotgun','rifle','smg','pistol'];
    for(let i=0;i<14;i++){
      const t=this._safeTile(pool);
      const type=pick(gunTypes);const wd=WDEFS[type];
      this.groundWeapons.push({
        id:this.ngwid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,
        kind:'gun',type,name:wd.name,
        mag:Math.floor(wd.maxMag*0.5),maxMag:wd.maxMag,
        reserve:Math.floor(wd.maxReserve*0.3),maxReserve:wd.maxReserve,
      });
    }
    const melTypes=['bat','axe','machete'];
    for(let i=0;i<4;i++){
      const t=this._safeTile(pool);
      const type=pick(melTypes);const md=MDEFS[type];
      this.groundWeapons.push({
        id:this.ngwid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,
        kind:'melee',type,name:md.name,
      });
    }
    for(const r of this.zone.lootRooms){
      const tx=rng(r.x+1,r.x+r.w-2),ty=rng(r.y+1,r.y+r.h-2);
      const type=pick(['shotgun','rifle','smg']);
      const wd=WDEFS[type];
      this.groundWeapons.push({
        id:this.ngwid++,x:tx*TILE+TILE/2,y:ty*TILE+TILE/2,
        kind:'gun',type,name:wd.name,
        mag:wd.maxMag,maxMag:wd.maxMag,
        reserve:Math.floor(wd.maxReserve*0.7),maxReserve:wd.maxReserve,
        loot:true,
      });
      for(let i=0;i<rng(3,5);i++){
        const tx2=rng(r.x+1,r.x+r.w-2),ty2=rng(r.y+1,r.y+r.h-2);
        const ammoTypes=['pistol_ammo','shotgun_ammo','rifle_ammo','smg_ammo'];
        this.pickups.push({id:this.npid++,x:tx2*TILE+TILE/2,y:ty2*TILE+TILE/2,
          type:pick(ammoTypes),amount:rng(8,18),loot:true});
      }
      const tx3=rng(r.x+1,r.x+r.w-2),ty3=rng(r.y+1,r.y+r.h-2);
      this.pickups.push({id:this.npid++,x:tx3*TILE+TILE/2,y:ty3*TILE+TILE/2,
        type:'medkit',amount:40,loot:true});
    }
  }

  _enterExtract(){
    this.phase='extract';this.phaseTimer=EXTRACT_TICKS;
    io.to(this.id).emit('phaseChange',{phase:'extract'});
  }

  _enterNight(){
    // Players still in zone die
    for(const p of this.players.values()){
      if(p.alive&&!p.atBase){
        p.hp=0;p.alive=false;p.respawnTimer=TICK*5;
        this._dropWeaponsAtDeath(p);
        io.to(this.id).emit('playerDied',{id:p.id,kills:p.kills,day:this.day,respawnIn:5,reason:'caught_by_night'});
      }
    }
    // Unload zone
    this.zone=null;
    this.barricades=[];this.turrets=[];
    this.zombies=[];this.bullets=[];this.pickups=[];this.groundWeapons=[];
    this.flows=new Map();
    for(const p of this.players.values()){
      p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
      p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
      p.atBase=true;
    }
    this.phase='night';this.nightTimer=NIGHT_TICKS;
    this.sleepAvailable=false;
    this.fightBonus={wood:0,scrap:0,ammo:0,fullNight:false};
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
    // Distribute fight bonuses to stash
    if(this.fightBonus.wood>0)this.stash.resources.wood+=this.fightBonus.wood;
    if(this.fightBonus.scrap>0)this.stash.resources.scrap+=this.fightBonus.scrap;
    if(this.fightBonus.ammo>0){
      for(let i=0;i<this.fightBonus.ammo;i++){
        const t=pick(['pistol_ammo','shotgun_ammo','rifle_ammo','smg_ammo']);
        this.stash.resources[t]++;
      }
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
    this.zombies=[];this.bullets=[];this.pickups=[];this.groundWeapons=[];
    this.scoutReport=this._rollScoutReport();
    for(const p of this.players.values()){
      p.hp=p.maxHp;p.alive=true;p.respawnTimer=0;
      p.x=BASE_LAYOUT.spawnTx*TILE+TILE/2+rng(-30,30);
      p.y=BASE_LAYOUT.spawnTy*TILE+TILE/2;
      p.atBase=true;
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
    p.slots=this._freshLoadout();p.activeSlot=0;
    p.wood=0;p.scrap=0;
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
      const canSprint=p.sprinting&&(p.dx||p.dy)&&p.stamina>0;
      const spd=canSprint?5.0:3.0;
      if(canSprint)p.stamina=Math.max(0,p.stamina-1.5);
      else p.stamina=Math.min(p.maxStamina,p.stamina+0.6);
      let dxMove=0,dyMove=0;
      if(p.dx||p.dy){
        const m=Math.hypot(p.dx,p.dy)||1;
        dxMove=(p.dx/m)*spd;dyMove=(p.dy/m)*spd;
        this._move(p,dxMove,dyMove,10);
      }
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
            this.gunshots.push({x:p.x,y:p.y,life:1});
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
      p.nearStash=false;p.nearTerminal=false;p.nearSleep=false;
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
          // Auto-deposit resources (Turn 1 stub — wired UI is Turn 2)
          if(p.wood>0){this.stash.resources.wood+=p.wood;p.wood=0;}
          if(p.scrap>0){this.stash.resources.scrap+=p.scrap;p.scrap=0;}
        }
        const ttx=BASE_LAYOUT.terminalTx*TILE+TILE/2,tty=BASE_LAYOUT.terminalTy*TILE+TILE/2;
        if(Math.hypot(ttx-p.x,tty-p.y)<55) p.nearTerminal=true;
        if(this.phase==='night'&&Math.hypot(ttx-p.x,tty-p.y)<55) p.nearSleep=true;
      }
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
        else if(ammoMap[pk.type]){
          const wType=ammoMap[pk.type];
          for(const sw of p.slots){
            if(sw&&sw.kind==='gun'&&sw.type===wType&&sw.reserve<sw.maxReserve){
              sw.reserve=Math.min(sw.maxReserve,sw.reserve+pk.amount);ok=true;break;
            }
          }
        }
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

  _tickZombies(){
    for(const z of this.zombies){
      if(z.knockbackVx||z.knockbackVy){
        this._move(z,z.knockbackVx,z.knockbackVy,z.type==='big'?16:11);
        z.knockbackVx*=0.7;z.knockbackVy*=0.7;
        if(Math.abs(z.knockbackVx)<0.05)z.knockbackVx=0;
        if(Math.abs(z.knockbackVy)<0.05)z.knockbackVy=0;
      }
      const[fdx,fdy,nearP,nearDist]=this._getFlow(z);
      if(!nearP)continue;
      let mdx=fdx,mdy=fdy;
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
      const mag=Math.hypot(mdx,mdy)||1;mdx/=mag;mdy/=mag;
      const probeD=TILE*0.8,probeX=z.x+mdx*probeD,probeY=z.y+mdy*probeD;
      if(this.isSolid(Math.floor(probeX/TILE),Math.floor(probeY/TILE),true)){
        const px=-mdy,py=mdx;
        const c1=this.isSolid(Math.floor((z.x+px*probeD)/TILE),Math.floor((z.y+py*probeD)/TILE),true);
        const c2=this.isSolid(Math.floor((z.x-px*probeD)/TILE),Math.floor((z.y-py*probeD)/TILE),true);
        if(!c1){mdx=mdx*0.3+px*0.7;mdy=mdy*0.3+py*0.7;}
        else if(!c2){mdx=mdx*0.3-px*0.7;mdy=mdy*0.3-py*0.7;}
        else{mdx+=(Math.random()-0.5)*0.8;mdy+=(Math.random()-0.5)*0.8;}
      }
      const r=z.type==='big'?16:z.type==='runner'?9:11;
      let sepX=0,sepY=0;
      for(const z2 of this.zombies){
        if(z2.id===z.id)continue;
        const dx=z.x-z2.x,dy=z.y-z2.y,dd=Math.hypot(dx,dy)||1;
        const minSep=(r+(z2.type==='big'?16:10))*1.1;
        if(dd<minSep){sepX+=dx/dd*(minSep-dd)*0.08;sepY+=dy/dd*(minSep-dd)*0.08;}
      }
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
      if(z._alertTimer>0)z._alertTimer--;
      if(this.gunshots.length>0&&nearDist>200&&Math.random()<0.65){
        const gs=this.gunshots[this.gunshots.length-1];
        if(Math.hypot(z.x-gs.x,z.y-gs.y)<400){
          z._alertTimer=TICK*5;
          const ax=gs.x-z.x,ay=gs.y-z.y,ad=Math.hypot(ax,ay)||1;
          mdx=mdx*0.3+ax/ad*0.7;mdy=mdy*0.3+ay/ad*0.7;
        }
      }
      z.prevX=z.x;z.prevY=z.y;
      const fm=Math.hypot(mdx,mdy)||1;
      this._move(z,(mdx/fm)*z.speed,(mdy/fm)*z.speed,r);
      z.angle=Math.atan2(mdy,mdx);
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
      if(!hitObstacle&&nearDist<r+14){
        z.attackTimer++;
        if(z.attackTimer>=z.attackRate){
          z.attackTimer=0;nearP.hp-=z.damage;
          nearP.damageFromX=z.x;nearP.damageFromY=z.y;nearP.damageFromTimer=TICK*1.5;
          if(nearP.hp<=0){
            nearP.hp=0;nearP.alive=false;nearP.respawnTimer=TICK*12;
            this._dropWeaponsAtDeath(nearP);
            io.to(this.id).emit('playerDied',{id:nearP.id,kills:nearP.kills,day:this.day,respawnIn:12});
          }
        }
      }else if(!hitObstacle)z.attackTimer=Math.max(0,z.attackTimer-1);
    }
  }

  _tickTurrets(){
    const turrets=this._allTurrets();
    for(const t of turrets){
      if(t.cooldown>0)t.cooldown--;
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
    const nightProgress=1-(this.nightTimer/NIGHT_TICKS);
    const spawnRate=Math.max(8,40-Math.floor(nightProgress*32));
    if((this._tick%spawnRate)===0){
      const edges=[
        {x:1,y:rng(2,BASE_H-3)},
        {x:BASE_W-2,y:rng(2,BASE_H-3)},
        {x:rng(2,BASE_W-3),y:1},
        {x:rng(2,BASE_W-3),y:BASE_H-2},
      ];
      const e=pick(edges);
      const r=Math.random();
      const type=r<0.18?'runner':r<0.28?'screamer':r<0.40?'big':'normal';
      this.zombies.push(makeZombie(this.nzid++,
        e.x*TILE+TILE/2,e.y*TILE+TILE/2,type,this.day));
    }
  }

  _broadcast(){
    const snap={
      players:Array.from(this.players.values()).map(p=>({
        id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,
        alive:p.alive,respawnTimer:p.respawnTimer,activeSlot:p.activeSlot,
        slots:p.slots,reloading:p.reloading,reloadTimer:p.reloadTimer,reloadMax:p.reloadMax,
        wood:p.wood,scrap:p.scrap,kills:p.kills,sessionKills:p.sessionKills,
        stamina:p.stamina,maxStamina:p.maxStamina,sprinting:p.sprinting,
        nearWeaponId:p.nearWeaponId,nearDoorId:p.nearDoorId,nearTurretId:p.nearTurretId,
        nearStash:p.nearStash,nearTerminal:p.nearTerminal,nearSleep:p.nearSleep,
        meleeSwinging:p.meleeSwinging,meleeAngle:p.meleeAngle,
        damageFromX:p.damageFromX,damageFromY:p.damageFromY,damageFromTimer:p.damageFromTimer,
        atBase:p.atBase,
      })),
      zombies:this.zombies.map(z=>({id:z.id,x:z.x,y:z.y,hp:z.hp,maxHp:z.maxHp,
        angle:z.angle,type:z.type,screaming:z.screaming,screamRadius:z.screamRadius||0})),
      bullets:this.bullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,color:b.color})),
      barricades:this._allBarricades(),
      turrets:this._allTurrets(),
      groundWeapons:this.groundWeapons,
      pickups:this.pickups,
      day:this.day,
      phase:this.phase,
      zoneTimer:this.zoneTimer,nightTimer:this.nightTimer,phaseTimer:this.phaseTimer,
      sleepAvailable:this.sleepAvailable,
      fightBonus:this.fightBonus,
      scoutReport:this.scoutReport,
      stashSize:this._stashSize(),
      stashCount:this.stash.weapons.length,
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
  socket.on('openStash',()=>{if(room)room.handleInput(socket.id,{openStash:true});});
  socket.on('stashOp',op=>{if(room)room.handleInput(socket.id,{stashOp:op});});
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
