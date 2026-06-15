/**
 * Generic persistence-on-reload check. Reads the slug + the persisted key + the value
 * to set from env (PERSIST_SLUG / PERSIST_KEY / PERSIST_VAL / PERSIST_ENTER), drives
 * the entry scene to the scene that runs `persistence`, sets the key, lets the change
 * save, reboots (shared storage = a real reload), re-enters, and reports the restored
 * value. Used for the five high-score games (idle-clicker has its own richer test).
 */
const slug = process.env.PERSIST_SLUG;
const key = process.env.PERSIST_KEY || "best";
const val = Number(process.env.PERSIST_VAL || "4242");
const enter = process.env.PERSIST_ENTER || "start-pressed";

export default {
  slug,
  persistentStorage: true,
  actions: [
    { emit: enter, label: "enter" },
    { step: 4, label: "in-play" },
    { eval: `() => window.__GC.setState(${JSON.stringify(key)}, ${val})`, label: "set-key" },
    { step: 30, label: "let-save" },
    { eval: `() => window.__GC.state()[${JSON.stringify(key)}]`, label: "before-reboot" },
    { reboot: true, label: "reboot" },
    { step: 4, label: "post-reboot" },
    { emit: enter, label: "re-enter" },
    { step: 8, label: "settle" },
    { eval: `() => ({ scene: window.__GC.scene(), restored: window.__GC.state()[${JSON.stringify(key)}] })`, label: "restored" },
  ],
};
