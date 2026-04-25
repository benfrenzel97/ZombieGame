# 🧟 Zombie Survival — Multiplayer Setup Guide

## What's in this folder

```
zombie-game/
├── server.js          ← Node.js multiplayer server (Socket.io)
├── package.json       ← Dependencies
├── public/
│   └── index.html     ← Mobile game client (works on phone + desktop)
└── SETUP.md           ← This file
```

---

## Option A: Play on your local network (same WiFi)

Great for playing with friends in the same house.

### Step 1 — Install Node.js
Download from https://nodejs.org (LTS version)

### Step 2 — Install dependencies
Open a terminal in the `zombie-game` folder:
```bash
npm install
```

### Step 3 — Start the server
```bash
node server.js
```
You should see:
```
🧟 Zombie server running on port 3000
```

### Step 4 — Find your local IP
- **Mac:** System Settings → Wi-Fi → Details → IP Address
- **Windows:** Run `ipconfig` in Command Prompt, look for IPv4 Address
- Example: `192.168.1.42`

### Step 5 — Share the link
Everyone on the same WiFi opens:
```
http://192.168.1.42:3000
```
- Enter a name and the same room code (e.g. `alpha`)
- Up to 6 players supported

---

## Option B: Play online with friends anywhere (free hosting)

Uses Railway — free tier, no credit card needed, takes ~5 minutes.

### Step 1 — Create a GitHub repo
1. Go to https://github.com/new
2. Create a new repository (e.g. `zombie-survival`)
3. Upload your `zombie-game` folder contents to it

Or use GitHub Desktop / VS Code to push the folder.

### Step 2 — Deploy on Railway
1. Go to https://railway.app
2. Sign up with GitHub (free)
3. Click **New Project → Deploy from GitHub repo**
4. Select your `zombie-survival` repo
5. Railway auto-detects Node.js and runs `npm start`

### Step 3 — Get your URL
Railway gives you a public URL like:
```
https://zombie-survival-production.up.railway.app
```

### Step 4 — Share with friends
Send that URL to up to 5 friends. Everyone:
1. Opens the URL on phone or desktop
2. Types their name + the same room code
3. Hits JOIN GAME

That's it — you're playing together!

---

## Controls

### Mobile (phone/tablet)
| Control | Action |
|---------|--------|
| Left joystick | Move |
| Right joystick | Aim + shoot (hold) |
| 1 / 2 / 3 buttons | Switch weapon |
| ↺ Reload button | Reload current weapon |
| 🪵 Build button | Toggle build mode — then tap to place barricade |

### Desktop (keyboard + mouse)
| Control | Action |
|---------|--------|
| WASD / Arrow keys | Move |
| Mouse | Aim |
| Left click (hold) | Shoot |
| 1 / 2 / 3 | Switch weapon |
| R | Reload |
| B | Toggle build mode |

---

## Game Rules

- **Daytime (~3 min):** Explore the map, loot ammo/medkits/wood, kill zombies
- **Night (~2 min):** Horde spawns — get to the Central Base and defend it
- **Barricades:** Cost 3 wood each, placed in build mode. Zombies will attack them
- **Weapons:**
  - Pistol — unlimited ammo drops, reliable
  - Shotgun — 6 pellets, devastating up close
  - Rifle — long range, high damage

---

## Troubleshooting

**"Connection failed — is the server running?"**
→ Make sure you ran `node server.js` and the server printed the port message

**Friends can't connect on local network**
→ Check your firewall allows port 3000
→ Make sure everyone is on the same WiFi network

**Railway deployment not starting**
→ Make sure `package.json` has `"start": "node server.js"` in scripts
→ Check Railway logs in the dashboard

**Game is laggy**
→ Free Railway tier has some cold-start delay on first load
→ Local network play is always faster for nearby friends
