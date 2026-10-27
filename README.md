# ERIC: Hollow Creek

A short third-person horror shooter. Eric Kosoy and Sean Perrius break down outside a town that isn't on any map, and something there already knows Eric's name.

**Play:** https://8tsmith11.github.io/eric-game/

## Modes

- **Solo:** you're Eric. Sean is tied up at the church; free him and he fights beside you as an AI partner.
- **Online co-op (2 players):** the host plays Eric with a pump shotgun, the guest plays Sean with a pistol.
  1. Host clicks **HOST CO-OP** and sends the 5-letter room code or invite link.
  2. Guest clicks **JOIN CO-OP** and enters the code (the invite link fills it in).
  3. Host clicks **START**.

  A player who loses all health goes down instead of dying, and the other player can hold **E** to help them up. You lose if both are down. If the guest disconnects, Sean switches to AI and the host keeps playing.

## Controls

WASD move · mouse aim · left click fire · right click aim down sights · Shift sprint · Space dodge · R reload · Q flare (stuns) · E interact · F flashlight · V voices on/off · Esc pause

## How co-op works

Players connect peer-to-peer over WebRTC using [PeerJS](https://peerjs.com/). The public PeerJS server only introduces the two browsers; after that, game traffic goes directly between them. The host's browser runs the world (enemies, pickups, story) and sends updates to the guest 20 times a second. Each player controls their own character directly.

Some strict networks (certain office, school, or mobile networks) block direct peer-to-peer connections. If joining times out, try a different network.

## Code layout

| File | What it does |
| --- | --- |
| `index.html` | Page shell, HUD markup, title screen and lobby |
| `css/style.css` | All styling |
| `js/main.js` | Entry point: lobby, input, main loop |
| `js/game.js` | Gameplay: players, enemies, boss, AI Sean, story, network sync |
| `js/world.js` | The town: buildings, forest, lights, weather |
| `js/characters.js` | Character and weapon models built from primitives |
| `js/core.js` | Renderer, camera, lights, collision, shared state |
| `js/audio.js` | Synthesized sound effects, music, and voices |
| `js/fx.js` | Particles, blood, tracers, muzzle flashes |
| `js/hud.js` | Subtitles, messages, notes, film grain |
| `js/net.js` | PeerJS connection handling |

No build step. Three.js and PeerJS load from jsDelivr.

## Run locally

ES modules don't load from `file://`, so serve the folder:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Add `?test` to the URL to expose a `window.G` debug object.
