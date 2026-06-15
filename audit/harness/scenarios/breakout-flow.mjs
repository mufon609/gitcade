/**
 * Breakout flow + core-loop regression. title → level-1 (start-pressed), then let the
 * ball bounce and smash bricks for a while; confirm bricks deplete, score rises, and
 * the run advances/ends via flow with 0 console errors. Persistence (best) is checked
 * by the breakout smoke suite; here we exercise the live loop.
 */
export default {
  slug: "breakout",
  actions: [
    { emit: "start-pressed", label: "to-level-1" },
    { step: 4, label: "level-1-start" },
    {
      eval: "() => ({ scene: window.__GC.scene(), bricks: window.__GC.entities().filter(e=>e.tags.includes('breakable')).length, balls: window.__GC.entities().filter(e=>e.tags.includes('ball')).length })",
      label: "initial",
    },
    { step: 600, label: "bounce-600" },
    {
      eval: "() => ({ scene: window.__GC.scene(), score: window.__GC.state().score, lives: window.__GC.state().lives, bricks: window.__GC.entities().filter(e=>e.tags.includes('breakable')).length })",
      label: "after-bounce",
    },
  ],
};
