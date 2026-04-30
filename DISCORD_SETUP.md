# 🧟 Zombie Survival — Discord Server Setup Guide

---

## SERVER NAME IDEAS
Pick one that fits the vibe:

| Name | Vibe |
|------|------|
| **Zombie Survival HQ** | Simple, direct |
| **Dead By Dawn** | Dramatic, game-themed |
| **The Last Base** | Ties into the central base mechanic |
| **Horde Night** | Instantly communicates the game |
| **Survive Together** | Emphasizes the multiplayer angle |
| **The Outbreak** | Mysterious, build-in-public feel |

---

## ROLES

Create these roles in Server Settings → Roles (top to bottom = highest to lowest):

| Role | Color | Who Gets It | Permissions |
|------|-------|-------------|-------------|
| 🛠️ **Dev** | Red `#e44` | You | Admin |
| 🔧 **Mod** | Orange `#fa0` | Your 1-2 helpers | Manage Messages, Kick |
| 🎮 **Playtester** | Green `#4e4` | Invite-only testers | Access all channels |
| 👁️ **Observer** | Gray `#888` | Public viewers | Read-only most channels |
| 🤖 **Bot** | Blue | Bots only | As needed |

**How the Mixed (public/invite) setup works:**
- Observer = default role everyone gets when they join
- Playtester = you manually assign to people you invite to play
- Observers can READ but not WRITE in most channels
- Playtesters can read and write everywhere

---

## CHANNEL STRUCTURE

Build it exactly in this order in Discord:

---

### 📌 INFORMATION  *(read-only for everyone)*
```
# 📌┃welcome
# 📋┃rules
# 🗺️┃roadmap
# 📜┃changelog
```

**#welcome** — Paste this when you set it up:
```
👋 Welcome to the Zombie Survival dev server!

This is a build-in-public community for a multiplayer zombie 
survival game being built live. Watch the development, test 
early builds, and help shape the game.

🟢 Public viewers can read all channels
🎮 Playtesters can join game nights and post feedback

To become a playtester, ask in #general.

🔗 Play the game: [your Railway URL here]
```

**#rules** — Paste this:
```
📋 RULES

1. Be respectful — this is a small community, keep it civil
2. Bug reports go in #bug-reports — screenshots help a lot
3. Feedback in #feedback — be specific, not just "it sucks"
4. Game night scheduling in #game-night
5. Keep #dev-updates read-only — react with ✅ if you saw it
6. Off-topic stuff in #off-topic only
7. No spam, no self-promotion
```

**#roadmap** — Paste the full roadmap from the progress document

**#changelog** — This is where you post every update. Format each entry like:
```
## v0.3 — Phase 2 Complete
📅 April 2026

✅ Added
- 3-slot weapon system (2 guns + melee)
- Cone of vision — 110° day / 80° night
- Buildable doors
- Reserve ammo system
- Score screen between horde nights

🐛 Fixed
- Zombie flip-flop attack bug
- Zombies killing players during score screen
- Death weapons now expire after 2 minutes
- Respawn now resets to pistol + knife
```

---

### 💬 COMMUNITY  *(Observers read, Playtesters write)*
```
# 💬┃general
# 🎮┃game-night
# 💡┃feedback
# 🐛┃bug-reports
```

**#general** — General chat, introductions, discussion

**#game-night** — Scheduling sessions. Suggested format to pin:
```
📅 GAME NIGHT FORMAT

Post like this to schedule:
🗓️ Date: [day + time + timezone]
🔗 Room code: [your room code]
👥 Spots: [how many slots open]
React ✅ if you're in
```

**#feedback** — Pin this message:
```
💡 FEEDBACK FORMAT

Please use this format when possible:
🎮 What were you doing?
❓ What did you expect to happen?
⚠️ What actually happened?
📊 How often does it happen?

Screenshots and screen recordings are gold.
```

**#bug-reports** — Pin this message:
```
🐛 BUG REPORT FORMAT

**Bug:** [short description]
**Steps to reproduce:** 
1. 
2. 
3. 
**Expected:** 
**Actual:** 
**Screenshot/video:** 
**Browser + OS:** 
```

---

### 🛠️ DEV  *(Everyone can read, only Dev/Mod can post)*
```
# 📣┃dev-updates
# 🔨┃build-log
# 🧪┃testing-notes
```

**#dev-updates** — Big announcements only. New features, major milestones, phase completions. Keep it clean and formatted. Example:
```
📣 PHASE 2 COMPLETE

The core gameplay overhaul is done. Here's what shipped:

🔫 Weapon system — 3 slots, ground weapons, reserve ammo
👁️ Cone of vision — flashlight at night, wide in day
🌙 Day/night visuals — dusk tint, near-black nights
🚪 Buildable doors — open/close, zombies break them down
🏆 Score screen between horde nights

Play it here: [link]
Room code for testing: [code]

Feedback in #feedback, bugs in #bug-reports ✅
```

**#build-log** — Casual, frequent updates. Think of this as your dev diary. Short posts, no pressure. Examples:
```
🔨 Fixed the zombie flip-flop bug — they were being 
pushed away and pulled in at the same time every frame. 
Simple fix, big feel difference.
```
```
🔨 Working on the main menu today. Thinking animated 
background showing a live zombie map. Might be wild to pull off.
```

**#testing-notes** — Internal notes for you and your mods. What to test, known issues, things to watch.

---

### 🎉 OFF-TOPIC  *(Everyone can read and write)*
```
# 🎉┃off-topic
# 🎮┃other-games
```

---

## PERMISSIONS SETUP

Go to each channel → Edit Channel → Permissions:

**For #dev-updates, #build-log, #testing-notes:**
- @everyone → Send Messages: ❌
- @Observer → Send Messages: ❌, View Channel: ✅
- @Playtester → Send Messages: ❌, View Channel: ✅
- @Dev → Send Messages: ✅
- @Mod → Send Messages: ✅

**For #welcome, #rules, #roadmap, #changelog:**
- @everyone → View Channel: ✅, Send Messages: ❌

**For #general, #feedback, #bug-reports, #game-night, #off-topic:**
- @Observer → View Channel: ✅, Send Messages: ❌
- @Playtester → View Channel: ✅, Send Messages: ✅

**Server-level default (@everyone):**
- View Channels: ❌ (override per channel above)
- This way people start with nothing and you grant access per role

---

## BOTS TO ADD  *(optional but useful)*

| Bot | What it does | Link |
|-----|-------------|------|
| **MEE6** | Welcome messages, role assignment, moderation | mee6.xyz |
| **Carl-bot** | Reaction roles (let people self-assign Observer) | carl.gg |
| **Statbot** | Server activity stats | statbot.net |

**Reaction role setup with Carl-bot** (so people can self-assign Observer):
Post in #welcome:
```
React below to get access to the server:
👁️ = Observer (view only)
```
Then set Carl-bot to assign @Observer when someone reacts with 👁️.

---

## LAUNCH CHECKLIST

- [ ] Create server
- [ ] Set server name and icon (use a zombie or skull emoji as temp icon)
- [ ] Create all 4 roles
- [ ] Build all channels in order
- [ ] Set permissions per channel
- [ ] Paste welcome, rules, roadmap, and first changelog entry
- [ ] Pin the feedback and bug report format messages
- [ ] Add Carl-bot and set up reaction role in #welcome
- [ ] Invite your 1-2 mods and assign roles
- [ ] Set your invite link to never expire (Server Settings → Invites)
- [ ] Share the link

---

## FIRST POST TEMPLATE  *(for #dev-updates)*

```
📣 SERVER IS LIVE

Hey everyone — welcome to the Zombie Survival dev server.

This is a build-in-public project. I'm building a multiplayer 
zombie survival game in the browser — no download needed, 
runs on any PC. Up to 6 players per room.

Where things are right now:
✅ Full multiplayer working
✅ 3-slot weapon system (2 guns + melee)  
✅ Cone of vision + day/night lighting
✅ Horde nights with score screen
✅ Buildable barricades and doors
✅ 4 zombie types with pathfinding AI

What's coming next:
🔄 Main menu revamp
🔄 Multiple map types (hospital, military, suburban)
🔄 Turrets and metal walls
🔄 Damage indicators + kill feed
🔄 Character progression

Play it here: [your Railway URL]
Room code: [code]

Drop feedback in #feedback and bugs in #bug-reports.
Game nights getting scheduled in #game-night soon.
```
