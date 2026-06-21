import { describe, it, expect } from "vitest";
import { Game, AudioPlayer, supportsMusic, SceneSchema, type Scene } from "../src/index.js";

/**
 * 1.13.0 — `scene.music` is no longer a DEAD field. The runtime drives a scene's declarative music on
 * load through any music-capable audio player (the optional {@link supportsMusic} / `MusicChannel`
 * surface the library's player implements; the SDK's primitive player no-ops it). Music is a side
 * effect outside the sim snapshot, so this never touches determinism.
 */

/** A music-capable audio player that records the runtime's music calls (the library's player is the real one). */
class RecordingMusicPlayer extends AudioPlayer {
  readonly calls: string[] = [];
  startMusic(track: string): void {
    this.calls.push(`start:${track}`);
  }
  stopMusic(): void {
    this.calls.push("stop");
  }
}

const scenes: Scene[] = [
  { id: "title", music: "menu", entities: [], systems: [], size: { width: 100, height: 100 } },
  { id: "play", music: "action", entities: [], systems: [], size: { width: 100, height: 100 } },
  { id: "over", entities: [], systems: [], size: { width: 100, height: 100 } }, // no music
].map((s) => SceneSchema.parse(s));

describe("scene.music — capability guard", () => {
  it("supportsMusic is false for the primitive player, true for one with a music channel", () => {
    expect(supportsMusic(new AudioPlayer())).toBe(false);
    expect(supportsMusic(new RecordingMusicPlayer())).toBe(true);
  });
});

describe("scene.music — runtime wiring", () => {
  it("starts the entry scene's track on boot", () => {
    const audio = new RecordingMusicPlayer();
    new Game({ scenes, config: {}, audio, entrySceneId: "title", canvas: null });
    expect(audio.calls).toEqual(["start:menu"]);
  });

  it("switches the track on a transition to a scene that names a different one", () => {
    const audio = new RecordingMusicPlayer();
    const game = new Game({ scenes, config: {}, audio, entrySceneId: "title", canvas: null });
    game.loadScene("play");
    expect(audio.calls).toEqual(["start:menu", "start:action"]);
  });

  it("stops music when entering a scene that names none", () => {
    const audio = new RecordingMusicPlayer();
    const game = new Game({ scenes, config: {}, audio, entrySceneId: "play", canvas: null });
    game.loadScene("over");
    expect(audio.calls).toEqual(["start:action", "stop"]);
  });

  it("no-ops cleanly on the primitive (non-music) player — a scene with music still boots", () => {
    // Default base AudioPlayer has no music channel; applySceneMusic must silently skip it.
    const game = new Game({ scenes, config: {}, entrySceneId: "title", canvas: null });
    expect(game.scene.id).toBe("title");
  });
});

describe("tile `lane` removal — catchall still accepts it", () => {
  it("a tilemap may still carry `lane` (now a game-defined catchall marker, boolean OR number)", () => {
    const parsed = SceneSchema.parse({
      id: "m",
      entities: [],
      systems: [],
      tilemap: {
        tileSize: 16,
        cols: 2,
        rows: 1,
        tiles: [0, 1],
        properties: { "0": { lane: true, walkable: true }, "1": { lane: 5 } },
      },
    });
    const props = parsed.tilemap!.properties!;
    expect(props["0"].lane).toBe(true); // boolean lane via catchall (was the named field)
    expect(props["0"].walkable).toBe(true); // a still-named, consumed flag
    expect(props["1"].lane).toBe(5); // numeric lane — now allowed via the catchall, not the dropped boolean field
  });
});
