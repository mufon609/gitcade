/**
 * Snake core-loop + food-placement regression. Drives title → play, then steers the
 * snake around eating food for a while, asserting on every sample that food is never
 * on a wall (out of bounds), never on a snake cell (head/body), and — the 0.2.1 #2
 * cleanup — never on the head's IMMINENT (next) cell. Tracks growth + score.
 */
const steer = () => {
  // A boustrophedon-ish wander that keeps eating without immediately self-colliding.
  const seq = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowRight"];
  const out = [];
  for (let i = 0; i < 16; i++) {
    const k = seq[i % seq.length];
    out.push({ keydown: k, sample: false }, { keyup: k, sample: false }, { step: 14, sample: false },
      {
        eval:
          "() => { const ents = window.__GC.entities(); const b = window.__GC.info().bounds; const foods = ents.filter(e=>e.tags.includes('food')); const snake = ents.filter(e=>e.tags.includes('snake-cell')); const imm = ents.filter(e=>e.tags.includes('imminent')); const onSnake = foods.some(f=>snake.some(s=>Math.abs(f.x-s.x)<1&&Math.abs(f.y-s.y)<1)); const onImm = foods.some(f=>imm.some(s=>Math.abs(f.x-s.x)<1&&Math.abs(f.y-s.y)<1)); const oob = foods.some(f=>f.x<0||f.y<0||f.x+f.w>b.width||f.y+f.h>b.height); return { scene: window.__GC.scene(), score: window.__GC.state().score, foods: foods.length, segs: snake.length-1, markers: imm.length, onSnake, onImm, oob }; }",
        label: `eat-${i}`,
      });
  }
  return out;
};

export default {
  slug: "snake",
  actions: [
    { emit: "start-pressed", label: "to-play" },
    { step: 4, label: "play-start" },
    ...steer(),
  ],
};
