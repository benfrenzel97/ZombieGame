// ─────────────────────────────────────────────────────────────────────────────
//  Zombie Survival — Multiplayer Server v2
//  Features: BFS pathfinding, runner/screamer zombies, loot rooms,
//             respawn system, chat/ping, sprint/stamina, score screen
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

const TICK=20, TILE=40, MAP_W=150, MAP_H=150;
const DAY_TICKS=TICK*180, NIGHT_TICKS=TICK*135, SCORE_TICKS=TICK*12;
const T_WALL=0,T_FLOOR=1,T_COURT=2,T_BASE=3,T_LOOT=4;

function rng(a,b){return Math.floor(Math.random()*(b-a+1))+a;}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

// ─── Map ──────────────────────────────────────────────────────────────────────
function generateMap(){
  const tiles=Array.from({length:MAP_H},()=>new Array(MAP_W).fill(T_WALL));
  const CX=Math.floor(MAP_W/2),CY=Math.floor(MAP_H/2);
  const BORD=5;
  for(let y=BORD;y<MAP_H-BORD;y++) for(let x=BORD;x<MAP_W-BORD;x++) tiles[y][x]=T_COURT;
  const BASE_R=10;
  const bx1=CX-BASE_R,bx2=CX+BASE_R,by1=CY-BASE_R,by2=CY+BASE_R;
  for(let y=by1;y<=by2;y++) for(let x=bx1;x<=bx2;x++) tiles[y][x]=T_BASE;
  for(let y=by1;y<=by2;y++){tiles[y][bx1]=T_WALL;tiles[y][bx2]=T_WALL;}
  for(let x=bx1;x<=bx2;x++){tiles[by1][x]=T_WALL;tiles[by2][x]=T_WALL;}
  for(let d=-2;d<=2;d++){tiles[by1][CX+d]=T_BASE;tiles[by2][CX+d]=T_BASE;tiles[CY+d][bx1]=T_BASE;tiles[CY+d][bx2]=T_BASE;}
  const lootRooms=[];
  const WING_GAP=7;
  const wings=[
    {dir:'N',x:CX-13,y:BORD,w:26,h:by1-BORD-WING_GAP},
    {dir:'S',x:CX-13,y:by2+WING_GAP,w:26,h:MAP_H-BORD-by2-WING_GAP},
    {dir:'W',x:BORD,y:CY-13,w:bx1-BORD-WING_GAP,h:26},
    {dir:'E',x:bx2+WING_GAP,y:CY-13,w:MAP_W-BORD-bx2-WING_GAP,h:26},
  ];
  for(const w of wings) buildWing(tiles,w,lootRooms);
  // Extra scattered rooms
  for(let i=0;i<22;i++){
    const rw=rng(4,10),rh=rng(4,10);
    const rx=rng(BORD+2,MAP_W-BORD-rw-2),ry=rng(BORD+2,MAP_H-BORD-rh-2);
    if(Math.abs(rx+rw/2-CX)<BASE_R+10&&Math.abs(ry+rh/2-CY)<BASE_R+10) continue;
    if(tiles[ry+1][rx+1]!==T_COURT) continue;
    const isLoot=Math.random()<0.3;
    carveRoom(tiles,rx,ry,rw,rh,isLoot?T_LOOT:T_FLOOR);
    if(isLoot) lootRooms.push({x:rx,y:ry,w:rw,h:rh});
    const side=rng(0,3);
    const mx=rx+Math.floor(rw/2),my=ry+Math.floor(rh/2);
    if(side===0&&ry>BORD) tiles[ry][mx]=T_FLOOR;
    else if(side===1&&ry+rh<MAP_H-BORD) tiles[ry+rh-1][mx]=T_FLOOR;
    else if(side===2&&rx>BORD) tiles[my][rx]=T_FLOOR;
    else if(rx+rw<MAP_W-BORD) tiles[my][rx+rw-1]=T_FLOOR;
  }
  // Perimeter
  for(let y=0;y<MAP_H;y++){for(let x=0;x<BORD;x++)tiles[y][x]=T_WALL;for(let x=MAP_W-BORD;x<MAP_W;x++)tiles[y][x]=T_WALL;}
  for(let x=0;x<MAP_W;x++){for(let y=0;y<BORD;y++)tiles[y][x]=T_WALL;for(let y=MAP_H-BORD;y<MAP_H;y++)tiles[y][x]=T_WALL;}
  const GW=4;
  for(let d=-GW;d<=GW;d++){tiles[BORD][CX+d]=T_COURT;tiles[MAP_H-BORD-1][CX+d]=T_COURT;tiles[CY+d][BORD]=T_COURT;tiles[CY+d][MAP_W-BORD-1]=T_COURT;}
  const ft={indoor:[],court:[],base:[],loot:[]};
  for(let y=0;y<MAP_H;y++) for(let x=0;x<MAP_W;x++){
    const t=tiles[y][x];
    if(t===T_FLOOR)ft.indoor.push({x,y});
    if(t===T_COURT)ft.court.push({x,y});
    if(t===T_BASE) ft.base.push({x,y});
    if(t===T_LOOT) ft.loot.push({x,y});
  }
  return{tiles,ft,lootRooms,CX,CY,bx1,bx2,by1,by2};
}

function buildWing(tiles,{dir,x,y,w,h},lootRooms){
  if(w<8||h<8||x<0||y<0||x+w>=MAP_W||y+h>=MAP_H)return;
  for(let ty=y;ty<y+h;ty++) for(let tx=x;tx<x+w;tx++) tiles[ty][tx]=T_FLOOR;
  for(let ty=y;ty<y+h;ty++){tiles[ty][x]=T_WALL;tiles[ty][x+w-1]=T_WALL;}
  for(let tx=x;tx<x+w;tx++){tiles[y][tx]=T_WALL;tiles[y+h-1][tx]=T_WALL;}
  if(dir==='N'||dir==='S'){
    const hallY=y+Math.floor(h/2);
    for(let tx=x+1;tx<x+w-1;tx++)tiles[hallY][tx]=T_FLOOR;
    let cx2=x+2;
    while(cx2<x+w-5){
      const rw=rng(4,8),rh=rng(3,6);
      if(cx2+rw>=x+w-2)break;
      const il=Math.random()<0.2,ft=il?T_LOOT:T_FLOOR;
      if(hallY-rh-1>y+1){carveRoom(tiles,cx2,hallY-rh-1,rw,rh,ft);tiles[hallY-1][cx2+Math.floor(rw/2)]=T_FLOOR;if(il)lootRooms.push({x:cx2,y:hallY-rh-1,w:rw,h:rh});}
      if(hallY+rh+1<y+h-1){carveRoom(tiles,cx2,hallY+2,rw,rh,ft);tiles[hallY+2][cx2+Math.floor(rw/2)]=T_FLOOR;if(il)lootRooms.push({x:cx2,y:hallY+2,w:rw,h:rh});}
      cx2+=rw+rng(1,3);
    }
    const ex=x+Math.floor(w/2);
    for(let d=-3;d<=3;d++)tiles[dir==='N'?y+h-1:y][ex+d]=T_FLOOR;
  }else{
    const hallX=x+Math.floor(w/2);
    for(let ty=y+1;ty<y+h-1;ty++)tiles[ty][hallX]=T_FLOOR;
    let cy2=y+2;
    while(cy2<y+h-5){
      const rw=rng(3,6),rh=rng(4,8);
      if(cy2+rh>=y+h-2)break;
      const il=Math.random()<0.2,ft=il?T_LOOT:T_FLOOR;
      if(hallX-rw-1>x+1){carveRoom(tiles,hallX-rw-1,cy2,rw,rh,ft);tiles[cy2+Math.floor(rh/2)][hallX-1]=T_FLOOR;if(il)lootRooms.push({x:hallX-rw-1,y:cy2,w:rw,h:rh});}
      if(hallX+rw+1<x+w-1){carveRoom(tiles,hallX+2,cy2,rw,rh,ft);tiles[cy2+Math.floor(rh/2)][hallX+2]=T_FLOOR;if(il)lootRooms.push({x:hallX+2,y:cy2,w:rw,h:rh});}
      cy2+=rh+rng(1,3);
    }
    const ey=y+Math.floor(h/2);
    for(let d=-3;d<=3;d++)tiles[ey+d][dir==='W'?x+w-1:x]=T_FLOOR;
  }
}

function carveRoom(tiles,x,y,w,h,ft=T_FLOOR){
  for(let ty=y;ty<y+h;ty++) for(let tx=x;tx<x+w;tx++) tiles[ty][tx]=T_WALL;
  for(let ty=y+1;ty<y+h-1;ty++) for(let tx=x+1;tx<x+w-1;tx++) tiles[ty][tx]=ft;
}

// ─── BFS Flow Field ───────────────────────────────────────────────────────────
function buildFlow(tiles,ptx,pty){
  const field=new Int8Array(MAP_W*MAP_H*2);
  const dist=new Int32Array(MAP_W*MAP_H).fill(-1);
  const q=[];let head=0;
  const idx=(x,y)=>y*MAP_W+x;
  if(ptx<0||ptx>=MAP_W||pty<0||pty>=MAP_H)return field;
  dist[idx(ptx,pty)]=0;q.push(ptx,pty);
  const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  while(head<q.length){
    const cx=q[head++],cy=q[head++];
    for(const[ddx,ddy]of dirs){
      const nx=cx+ddx,ny=cy+ddy;
      if(nx<0||nx>=MAP_W||ny<0||ny>=MAP_H)continue;
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

// ─── Zombies & Weapons ────────────────────────────────────────────────────────
function makeZombie(id,x,y,type,day){
  const D={
    normal:{hp:40+day*7,  spd:1.1+day*0.09, dmg:15,rate:35},
    big:   {hp:110+day*18,spd:0.6+day*0.05, dmg:28,rate:42},
    runner:{hp:22+day*5,  spd:2.4+day*0.13, dmg:10,rate:22},
    screamer:{hp:50+day*9,spd:0.75+day*0.06,dmg:12,rate:48},
  };
  const d=D[type]||D.normal;
  return{id,x,y,type,hp:d.hp,maxHp:d.hp,speed:d.spd+(Math.random()-0.5)*0.15,
    damage:d.dmg,attackRate:d.rate,angle:0,attackTimer:0,
    screaming:false,screamTimer:rng(40,120),stuckTimer:0,prevX:x,prevY:y};
}

const WDEFS=[
  {name:'Pistol',  ammo:30,maxAmmo:30,damage:22,spread:0.05,pellets:1,cooldown:8, reload:50,bSpeed:14,bLife:55,color:'#ff9'},
  {name:'Shotgun', ammo:8, maxAmmo:8, damage:20,spread:0.22,pellets:6,cooldown:30,reload:85,bSpeed:12,bLife:28,color:'#fa4'},
  {name:'Rifle',   ammo:20,maxAmmo:20,damage:40,spread:0.02,pellets:1,cooldown:4, reload:65,bSpeed:22,bLife:80,color:'#4ff'},
  {name:'SMG',     ammo:35,maxAmmo:35,damage:14,spread:0.10,pellets:1,cooldown:3, reload:60,bSpeed:16,bLife:45,color:'#f4f'},
];

// ─── Game Room ────────────────────────────────────────────────────────────────
class GameRoom{
  constructor(id){
    this.id=id;this.players=new Map();this.zombies=[];this.bullets=[];
    this.pickups=[];this.barricades=[];this.pings=[];
    this.day=1;this.dayTimer=DAY_TICKS;this.phase='day';
    this.scoreTimer=0;this.hordeSpawned=0;this.hordeMax=0;this.hordeTimer=0;
    this.nzid=0;this.npid=0;this.flows=new Map();this.flowTimer=0;
    const map=generateMap();
    Object.assign(this,{tiles:map.tiles,ft:map.ft,lootRooms:map.lootRooms,
      CX:map.CX,CY:map.CY,bx1:map.bx1,bx2:map.bx2,by1:map.by1,by2:map.by2});
    this._spawnZombies(35);this._spawnPickups(35);this._spawnLoot();
    this.interval=setInterval(()=>this.tick(),1000/TICK);
  }
  destroy(){clearInterval(this.interval);}
  isSolid(tx,ty){if(tx<0||tx>=MAP_W||ty<0||ty>=MAP_H)return true;return this.tiles[ty][tx]===T_WALL;}
  _move(e,dx,dy,r=10){
    const nx=e.x+dx,ny=e.y+dy;
    const txL=Math.floor((nx-r)/TILE),txR=Math.floor((nx+r)/TILE);
    const tyT=Math.floor((e.y-r)/TILE),tyB=Math.floor((e.y+r)/TILE);
    const txL2=Math.floor((e.x-r)/TILE),txR2=Math.floor((e.x+r)/TILE);
    const tyT2=Math.floor((ny-r)/TILE),tyB2=Math.floor((ny+r)/TILE);
    if(!this.isSolid(txL,tyT)&&!this.isSolid(txR,tyT)&&!this.isSolid(txL,tyB)&&!this.isSolid(txR,tyB))e.x=nx;
    if(!this.isSolid(txL2,tyT2)&&!this.isSolid(txR2,tyT2)&&!this.isSolid(txL2,tyB2)&&!this.isSolid(txR2,tyB2))e.y=ny;
  }
  _safeTile(pool){
    // BUG FIX: retry up to 20 times to guarantee a non-wall tile
    for(let i=0;i<20;i++){
      const t=pool[rng(0,pool.length-1)];
      if(t&&this.tiles[t.y]&&this.tiles[t.y][t.x]!==T_WALL) return t;
    }
    return pool[0]||{x:this.CX,y:this.CY};
  }
  _spawnZombies(n){
    const pool=[...this.ft.indoor,...this.ft.court];
    const types=['normal','normal','normal','big','runner','screamer'];
    for(let i=0;i<n;i++){
      const t=this._safeTile(pool);
      if(Math.abs(t.x-this.CX)<16&&Math.abs(t.y-this.CY)<16)continue;
      this.zombies.push(makeZombie(this.nzid++,t.x*TILE+TILE/2,t.y*TILE+TILE/2,types[rng(0,types.length-1)],this.day));
    }
  }
  _spawnPickups(n){
    const types=['ammo','medkit','wood','shotgun_ammo','rifle_ammo','smg_ammo'];
    const pool=[...this.ft.indoor,...this.ft.court];
    for(let i=0;i<n;i++){
      const t=this._safeTile(pool);
      this.pickups.push({id:this.npid++,x:t.x*TILE+TILE/2,y:t.y*TILE+TILE/2,type:types[rng(0,types.length-1)],amount:rng(8,20)});
    }
  }
  _spawnLoot(){
    const lt=['shotgun_ammo','rifle_ammo','smg_ammo','medkit'];
    for(const room of this.lootRooms){
      for(let i=0;i<rng(3,6);i++){
        const tx=rng(room.x+1,room.x+room.w-2),ty=rng(room.y+1,room.y+room.h-2);
        this.pickups.push({id:this.npid++,x:tx*TILE+TILE/2,y:ty*TILE+TILE/2,type:lt[rng(0,lt.length-1)],amount:rng(15,30),loot:true});
      }
    }
  }
  addPlayer(sid,name){
    this.players.set(sid,{id:sid,name,
      x:this.CX*TILE+TILE/2+rng(-50,50),y:this.CY*TILE+TILE/2+rng(-50,50),
      hp:100,maxHp:100,angle:0,
      weapons:WDEFS.map(w=>({...w})),
      currentWeapon:0,reloading:false,reloadTimer:0,reloadMax:1,
      wood:0,kills:0,sessionKills:0,alive:true,
      dx:0,dy:0,shooting:false,sprinting:false,shootCooldown:0,
      stamina:100,maxStamina:100,respawnTimer:0,
    });
  }
  removePlayer(sid){this.players.delete(sid);this.flows.delete(sid);}
  handleInput(sid,inp){
    const p=this.players.get(sid);if(!p)return;
    p.dx=clamp(inp.dx||0,-1,1);p.dy=clamp(inp.dy||0,-1,1);
    p.angle=inp.angle||0;p.shooting=!!inp.shooting;p.sprinting=!!inp.sprinting;
    if(inp.switchWeapon!==undefined)p.currentWeapon=clamp(inp.switchWeapon,0,3);
    if(inp.reloadReq&&!p.reloading&&p.alive){
      const w=p.weapons[p.currentWeapon];
      if(w.ammo<w.maxAmmo){p.reloading=true;p.reloadMax=WDEFS[p.currentWeapon].reload;p.reloadTimer=p.reloadMax;}
    }
  }
  handleBuild(sid,{tx,ty}){
    const p=this.players.get(sid);if(!p||p.wood<3||this.isSolid(tx,ty))return;
    if(this.barricades.find(b=>b.tx===tx&&b.ty===ty))return;
    p.wood-=3;
    const bar={tx,ty,wx:tx*TILE+TILE/2,wy:ty*TILE+TILE/2,hp:150,maxHp:150};
    this.barricades.push(bar);io.to(this.id).emit('barricadeAdded',bar);
  }
  handlePing(sid,{wx,wy}){
    const p=this.players.get(sid);if(!p)return;
    io.to(this.id).emit('ping',{id:Date.now(),x:wx,y:wy,name:p.name,timer:TICK*6});
  }
  handleChat(sid,msg){
    const p=this.players.get(sid);if(!p)return;
    io.to(this.id).emit('chat',{name:p.name,text:(msg||'').toString().slice(0,80),ts:Date.now()});
  }
  _rebuildFlows(){
    for(const[sid,p]of this.players){
      if(!p.alive)continue;
      this.flows.set(sid,buildFlow(this.tiles,Math.floor(p.x/TILE),Math.floor(p.y/TILE)));
    }
  }
  _getFlow(z){
    let bestDist=Infinity,bestP=null,bestFlow=null;
    for(const[sid,p]of this.players){
      if(!p.alive)continue;
      const d=Math.hypot(z.x-p.x,z.y-p.y);
      if(d<bestDist){bestDist=d;bestP=p;bestFlow=this.flows.get(sid);}
    }
    if(!bestP||!bestFlow)return[0,0,null,Infinity];
    const tx=Math.floor(z.x/TILE),ty=Math.floor(z.y/TILE);
    if(tx<0||tx>=MAP_W||ty<0||ty>=MAP_H)return[0,0,bestP,bestDist];
    const i=(ty*MAP_W+tx)*2;
    return[bestFlow[i],bestFlow[i+1],bestP,bestDist];
  }
  tick(){
    if(this.players.size===0)return;
    this.flowTimer--;
    if(this.flowTimer<=0){this._rebuildFlows();this.flowTimer=28;}

    // Phase
    if(this.phase==='score'){
      this.scoreTimer--;
      if(this.scoreTimer<=0){
        this.phase='day';this.dayTimer=DAY_TICKS;
        for(const p of this.players.values())p.sessionKills=0;
        io.to(this.id).emit('phaseChange',{phase:'day',day:this.day});
        this._spawnZombies(10+this.day*2);this._spawnPickups(12);this._spawnLoot();
      }
    }else{
      this.dayTimer--;
      if(this.dayTimer<=0){
        if(this.phase==='day'){
          this.phase='night';this.dayTimer=NIGHT_TICKS;
          this.hordeSpawned=0;this.hordeMax=28+this.day*12;this.hordeTimer=0;
          io.to(this.id).emit('phaseChange',{phase:'night',day:this.day});
        }else{
          this.phase='score';this.scoreTimer=SCORE_TICKS;this.day++;
          const scores=Array.from(this.players.values())
            .map(p=>({name:p.name,kills:p.sessionKills,total:p.kills}))
            .sort((a,b)=>b.kills-a.kills);
          io.to(this.id).emit('phaseChange',{phase:'score',day:this.day,scores});
          for(const p of this.players.values()){
            if(!p.alive){p.alive=true;p.hp=p.maxHp;p.respawnTimer=0;
              p.x=this.CX*TILE+TILE/2+rng(-40,40);p.y=this.CY*TILE+TILE/2+rng(-40,40);}
          }
        }
      }
    }

    // Horde
    if(this.phase==='night'&&this.hordeSpawned<this.hordeMax){
      this.hordeTimer--;
      if(this.hordeTimer<=0){
        const pool=[...this.ft.court,...this.ft.indoor];
        for(let a=0;a<40;a++){
          const t=this._safeTile(pool);
          // BUG FIX: double-check tile is actually floor, not wall
          if(!t||this.tiles[t.y]?.[t.x]===T_WALL) continue;
          let ok=true;
          for(const p of this.players.values())if(Math.hypot(t.x*TILE-p.x,t.y*TILE-p.y)<320){ok=false;break;}
          if(!ok)continue;
          const r=Math.random();
          const type=r<0.18?'runner':r<0.28?'screamer':r<0.40?'big':'normal';
          this.zombies.push(makeZombie(this.nzid++,t.x*TILE+TILE/2,t.y*TILE+TILE/2,type,this.day));
          this.hordeSpawned++;this.hordeTimer=rng(3,14);break;
        }
      }
    }

    // Respawn
    for(const p of this.players.values()){
      if(!p.alive&&p.respawnTimer>0){
        p.respawnTimer--;
        if(p.respawnTimer<=0){
          p.alive=true;p.hp=p.maxHp;
          // BUG FIX: clear all input state on respawn so shooting doesn't persist
          p.shooting=false;p.dx=0;p.dy=0;p.sprinting=false;p.shootCooldown=0;
          p.reloading=false;p.reloadTimer=0;
          p.x=this.CX*TILE+TILE/2+rng(-40,40);p.y=this.CY*TILE+TILE/2+rng(-40,40);
          io.to(this.id).emit('playerRespawned',{id:p.id});
        }
      }
    }

    // Players
    for(const[sid,p]of this.players){
      if(!p.alive)continue;
      const canSprint=p.sprinting&&(p.dx||p.dy)&&p.stamina>0;
      const spd=canSprint?5.0:3.0;
      if(canSprint)p.stamina=Math.max(0,p.stamina-1.5);
      else p.stamina=Math.min(p.maxStamina,p.stamina+0.6);
      if(p.dx||p.dy){
        const m=Math.hypot(p.dx,p.dy)||1;
        this._move(p,(p.dx/m)*spd,(p.dy/m)*spd,10);
      }
      if(p.reloading){p.reloadTimer--;if(p.reloadTimer<=0){p.weapons[p.currentWeapon].ammo=p.weapons[p.currentWeapon].maxAmmo;p.reloading=false;}}
      if(p.shootCooldown>0)p.shootCooldown--;
      const wd=WDEFS[p.currentWeapon],wep=p.weapons[p.currentWeapon];
      if(p.shooting&&!p.reloading&&wep.ammo>0&&p.shootCooldown<=0){
        wep.ammo--;p.shootCooldown=wd.cooldown;
        for(let i=0;i<wd.pellets;i++){
          const sp=(Math.random()-0.5)*wd.spread*2,ang=p.angle+sp;
          this.bullets.push({x:p.x,y:p.y,vx:Math.cos(ang)*wd.bSpeed,vy:Math.sin(ang)*wd.bSpeed,
            life:wd.bLife,damage:wd.damage,owner:sid,color:wd.color});
        }
        if(wep.ammo===0){p.reloading=true;p.reloadMax=wd.reload;p.reloadTimer=wd.reload;}
      }
      // Pickups
      this.pickups=this.pickups.filter(pk=>{
        if(Math.hypot(pk.x-p.x,pk.y-p.y)>32)return true;
        let ok=false;
        const wmap={ammo:0,shotgun_ammo:1,rifle_ammo:2,smg_ammo:3};
        if(wmap[pk.type]!==undefined){const wi=wmap[pk.type],w=p.weapons[wi];if(w.ammo<w.maxAmmo){w.ammo=Math.min(w.maxAmmo,w.ammo+pk.amount);ok=true;}}
        else if(pk.type==='medkit'&&p.hp<p.maxHp){p.hp=Math.min(p.maxHp,p.hp+pk.amount);ok=true;}
        else if(pk.type==='wood'){p.wood+=pk.amount;ok=true;}
        if(ok)io.to(this.id).emit('pickupTaken',{id:pk.id,pid:sid});
        return!ok;
      });
    }

    // Bullets
    this.bullets=this.bullets.filter(b=>{
      b.x+=b.vx;b.y+=b.vy;b.life--;
      if(this.isSolid(Math.floor(b.x/TILE),Math.floor(b.y/TILE)))return false;
      for(const bar of this.barricades)if(Math.hypot(b.x-bar.wx,b.y-bar.wy)<22)return false;
      for(const z of this.zombies){
        const r=z.type==='big'?18:z.type==='runner'?9:12;
        if(Math.hypot(b.x-z.x,b.y-z.y)<r){
          z.hp-=b.damage;
          if(z.hp<=0){
            const kp=this.players.get(b.owner);if(kp){kp.kills++;kp.sessionKills++;}
            if(Math.random()<0.28){
              const pt=['ammo','medkit','wood','shotgun_ammo','rifle_ammo','smg_ammo'];
              const pk={id:this.npid++,x:z.x,y:z.y,type:pt[rng(0,pt.length-1)],amount:rng(5,14)};
              this.pickups.push(pk);io.to(this.id).emit('pickupSpawned',pk);
            }
            io.to(this.id).emit('zombieKilled',{id:z.id,x:z.x,y:z.y});
            this.zombies=this.zombies.filter(zz=>zz.id!==z.id);
          }
          return false;
        }
      }
      return b.life>0;
    });

    // Zombies
    for(const z of this.zombies){
      const[fdx,fdy,nearP,nearDist]=this._getFlow(z);
      if(!nearP)continue;
      let mdx=fdx,mdy=fdy;
      if(nearDist<80){mdx=(nearP.x-z.x)/nearDist;mdy=(nearP.y-z.y)/nearDist;}
      const mag=Math.hypot(mdx,mdy)||1;mdx/=mag;mdy/=mag;

      // BUG FIX: Wall avoidance — probe ahead and steer away from walls
      const probeD=TILE*0.8;
      const probeX=z.x+mdx*probeD, probeY=z.y+mdy*probeD;
      const ptx=Math.floor(probeX/TILE),pty=Math.floor(probeY/TILE);
      if(this.isSolid(ptx,pty)){
        // Try sliding along the wall — perp directions
        const perpX=-mdy,perpY=mdx;
        const p1x=z.x+perpX*probeD,p1y=z.y+perpY*probeD;
        const p2x=z.x-perpX*probeD,p2y=z.y-perpY*probeD;
        const c1=this.isSolid(Math.floor(p1x/TILE),Math.floor(p1y/TILE));
        const c2=this.isSolid(Math.floor(p2x/TILE),Math.floor(p2y/TILE));
        if(!c1){mdx=mdx*0.3+perpX*0.7;mdy=mdy*0.3+perpY*0.7;}
        else if(!c2){mdx=mdx*0.3-perpX*0.7;mdy=mdy*0.3-perpY*0.7;}
        else{mdx+=(Math.random()-0.5)*0.8;mdy+=(Math.random()-0.5)*0.8;}
      }

      // BUG FIX: Separation force — push zombies apart so they don't stack
      const r=z.type==='big'?16:z.type==='runner'?9:11;
      let sepX=0,sepY=0;
      for(const z2 of this.zombies){
        if(z2.id===z.id)continue;
        const dx=z.x-z2.x,dy=z.y-z2.y;
        const dd=Math.hypot(dx,dy)||1;
        const minSep=(r+(z2.type==='big'?16:10))*1.1;
        if(dd<minSep){sepX+=dx/dd*(minSep-dd)*0.08;sepY+=dy/dd*(minSep-dd)*0.08;}
      }
      mdx+=sepX;mdy+=sepY;
      // Screamer - call nearby zombies toward nearest player
      if(z.type==='screamer'){
        z.screamTimer--;
        if(z.screamTimer<=0){
          z.screamTimer=TICK*rng(6,12);z.screaming=true;
          for(const z2 of this.zombies){
            if(z2.id===z.id)continue;
            if(Math.hypot(z2.x-z.x,z2.y-z.y)<240)
              z2.speed=Math.min(z2.speed*1.5+0.5,4.5);
          }
          io.to(this.id).emit('screamerPulse',{x:z.x,y:z.y});
        }else z.screaming=false;
      }
      z.prevX=z.x;z.prevY=z.y;
      this._move(z,mdx*z.speed,mdy*z.speed,r);
      z.angle=Math.atan2(mdy,mdx);
      if(Math.abs(z.x-z.prevX)<0.1&&Math.abs(z.y-z.prevY)<0.1){
        z.stuckTimer++;if(z.stuckTimer>35){z.x+=(Math.random()-0.5)*16;z.y+=(Math.random()-0.5)*16;z.stuckTimer=0;}
      }else z.stuckTimer=0;
      let hitBar=false;
      for(const bar of this.barricades){
        if(Math.hypot(z.x-bar.wx,z.y-bar.wy)<r+26){
          z.attackTimer++;
          if(z.attackTimer>=z.attackRate){z.attackTimer=0;bar.hp-=z.type==='big'?22:11;
            if(bar.hp<=0){io.to(this.id).emit('barricadeDestroyed',{tx:bar.tx,ty:bar.ty});this.barricades=this.barricades.filter(b=>b!==bar);}}
          hitBar=true;break;
        }
      }
      if(!hitBar&&nearDist<r+14){
        z.attackTimer++;
        if(z.attackTimer>=z.attackRate){
          z.attackTimer=0;nearP.hp-=z.damage;
          if(nearP.hp<=0){
            nearP.hp=0;nearP.alive=false;nearP.respawnTimer=TICK*12;
            io.to(this.id).emit('playerDied',{id:nearP.id,kills:nearP.kills,day:this.day,respawnIn:12});
          }
        }
      }else if(!hitBar)z.attackTimer=Math.max(0,z.attackTimer-1);
    }
    this.barricades=this.barricades.filter(b=>b.hp>0);

    const snap={
      players:Array.from(this.players.values()).map(p=>({
        id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,maxHp:p.maxHp,
        alive:p.alive,respawnTimer:p.respawnTimer,currentWeapon:p.currentWeapon,
        weapons:p.weapons,wood:p.wood,kills:p.kills,sessionKills:p.sessionKills,
        reloading:p.reloading,reloadTimer:p.reloadTimer,reloadMax:p.reloadMax,
        stamina:p.stamina,maxStamina:p.maxStamina,sprinting:p.sprinting,
      })),
      zombies:this.zombies.map(z=>({id:z.id,x:z.x,y:z.y,hp:z.hp,maxHp:z.maxHp,angle:z.angle,type:z.type,screaming:z.screaming})),
      bullets:this.bullets.map(b=>({x:b.x,y:b.y,vx:b.vx,vy:b.vy,color:b.color})),
      barricades:this.barricades,
      day:this.day,dayTimer:this.dayTimer,phase:this.phase,
      scoreTimer:this.scoreTimer,hordeActive:this.phase==='night',
    };
    io.to(this.id).emit('state',snap);
  }
}

const rooms=new Map();
function getRoom(id){if(!rooms.has(id))rooms.set(id,new GameRoom(id));return rooms.get(id);}

io.on('connection',socket=>{
  console.log(`[+] ${socket.id}`);
  let room=null;
  socket.on('joinRoom',({roomId,name})=>{
    roomId=(roomId||'main').toString().slice(0,20);
    name=(name||'Survivor').toString().slice(0,16);
    room=getRoom(roomId);socket.join(roomId);room.addPlayer(socket.id,name);
    socket.emit('init',{playerId:socket.id,tiles:room.tiles,pickups:room.pickups,
      barricades:room.barricades,lootRooms:room.lootRooms,
      CX:room.CX,CY:room.CY,bx1:room.bx1,bx2:room.bx2,by1:room.by1,by2:room.by2});
    io.to(roomId).emit('playerJoined',{id:socket.id,name});
    console.log(`[>] ${name} → ${roomId} (${room.players.size}p)`);
  });
  socket.on('input', i=>{if(room)room.handleInput(socket.id,i);});
  socket.on('build', d=>{if(room)room.handleBuild(socket.id,d);});
  socket.on('ping',  d=>{if(room)room.handlePing(socket.id,d);});
  socket.on('chat',  m=>{if(room)room.handleChat(socket.id,m);});
  socket.on('disconnect',()=>{
    if(room){room.removePlayer(socket.id);io.to(room.id).emit('playerLeft',{id:socket.id});
      if(room.players.size===0){room.destroy();rooms.delete(room.id);}}
    console.log(`[-] ${socket.id}`);
  });
});

const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log(`🧟 Zombie server on port ${PORT}`));
