# Shinzu

A two-player browser stealth prototype set in **Orchard Gate**, a walled hamlet built from boxes. The pace is slow: you walk, you crouch, you wait. Glowing hook points are how you reach the roofs. Guards patrol, listen, and can lose you if you break their line of sight.

This is an original mission. It does not use characters, names, stages, or interface from any existing stealth game.

Sable hosts. Cinder joins with a four-character code. The host is the authority for guards, takedowns, and the mission. Each shinobi moves locally so controls stay responsive.

## Run locally

```bash
npm install
npm start
```

The server listens on `0.0.0.0` and `PORT` (default **43123**). Open `http://127.0.0.1:43123`.

- **Host mission** starts a room and drops you in the southwest corner as Sable.
- **Join** with the code as Cinder. You share the same hamlet, the same guards, and the same objective.

`npm run check` runs a headless pass over collision, the grapple, rear takedowns, vision, patrol, and the win rule.

## Mission

Silence **Envoy Voss** — the gold figure in the tall house with the red mark, east of the yard — then reach the green ring on the south ford.

- A solo host can finish alone.
- With two shinobi, both have to stand on the ford. Being seen does not fail the mission. Break line of sight, hide, and continue.
- A loud takedown (standing, or against someone who already noticed you) draws nearby guards. A crouched takedown from behind an unaware guard does not.

## Controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Move | WASD or arrows | Left stick |
| Look | Mouse (click the view to capture) | Drag the right side |
| Crouch | C or Ctrl | Crouch |
| Rise, jump, pull up | Space | Rise |
| Grapple | F, when the reticle lights | Hook |
| Silent takedown | E, when the prompt shows | Down |
| Drop from a ledge | C, or step back | Crouch |

Walk is the default. Crouch is slower and much quieter. There is no sprint.

A small practice beam sits in the spawn corner: jump at it, hang, then Rise to pull up. Roofs are higher than a jump. Use the hooks.

Press `` ` `` to toggle a coordinate readout.

## Replacing the placeholder art

Everything you see is an untextured primitive. Gameplay does not use the meshes. Colliders, hook landings, patrol points, and the extract ring are data. One meter is one unit. Character feet sit at the origin of their group.

Named anchors:

| `name` / `userData.kind` | What it is |
| --- | --- |
| `playerA`, `playerB` | Sable and Cinder |
| `guard` | A patrolling guard. `userData.id` is `gate`, `street`, `alley`, `court`, `east`, `door`, `inside`, `bridge`, `ridge`, `gallery` |
| `target` | Envoy Voss (`userData.id === 'voss'`) |
| `house` | A building. `userData.id` is `houseWest`, `houseNorth`, `houseEast`, `houseEnvoy`, `shed`, `store` |
| `wall`, `roof`, `walkway`, `crate` | Solid pieces. Walls and roofs are also colliders |
| `hookPoint` | A grapple anchor. The gameplay landing is not the mesh; it is `hook.land` in `buildWorld` |
| `tree`, `well`, `lantern`, `extract` | Dressing and the ford |

Each anchor has `userData.visual`, a child group that holds the placeholder meshes. Clear that group and parent your model there. Keep the anchor at the feet / building origin, and scale the visual child rather than the anchor.

In the browser console during a mission, `shinzu.scene` is the Three.js scene:

```javascript
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();
loader.load('/assets/sable.glb', (gltf) => {
  const anchor = shinzu.scene.getObjectByName('playerA');
  const visual = anchor.userData.visual;
  visual.clear();
  visual.add(gltf.scene);
});
```

Put files in `public/assets/` and they are served as `/assets/...`. The import map already points `three` and `three/addons/` at the installed Three.js build.

To move a building or a route, edit `public/js/world.js`:

- Houses, walls, bridges, and crates push entries onto `colliders`.
- `addHook(...)` stores `position` (where the reticle locks) and `land` (where the feet arrive).
- `patrols` is the guard list. `roam: false` keeps a guard on an elevated route instead of chasing across open ground.

`npm run check` is worth running after you move a collider or a landing spot. It fails if a spawn, a guard, or a grapple landing starts inside geometry.
