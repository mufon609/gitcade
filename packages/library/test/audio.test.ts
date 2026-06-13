import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AudioPlayer } from "@gitcade/sdk";
import { LibraryAudioPlayer, SFX_RECIPES, SFX_KEYS, MUSIC_TRACKS, MUSIC_LOOPS } from "../src/audio/index.js";
import { LIBRARY_PALETTE } from "../src/palette.js";

describe("audio synthesis data", () => {
  it("defines a recipe for every Phase 2B SFX key (+ SDK aliases)", () => {
    expect([...SFX_KEYS]).toEqual(["jump", "shoot", "hit", "collect", "explode", "click", "win", "lose"]);
    for (const key of SFX_KEYS) {
      expect(SFX_RECIPES[key], `recipe for ${key}`).toBeDefined();
      expect(SFX_RECIPES[key]!.layers.length).toBeGreaterThan(0);
    }
    // Aliases keep SDK/2A sound keys working.
    expect(SFX_RECIPES.explode).toBeDefined();
    expect(SFX_RECIPES.score).toBeDefined();
  });

  it("defines exactly two chiptune music loops with voices", () => {
    expect([...MUSIC_LOOPS]).toEqual(["action", "menu"]);
    for (const name of MUSIC_LOOPS) {
      const track = MUSIC_TRACKS[name]!;
      expect(track.bpm).toBeGreaterThan(0);
      expect(track.loopBeats).toBeGreaterThan(0);
      expect(track.voices.length).toBeGreaterThan(0);
      expect(track.voices.flat().length).toBeGreaterThan(0);
    }
  });
});

describe("LibraryAudioPlayer (headless no-op)", () => {
  it("is an AudioPlayer and never throws without an AudioContext", () => {
    const audio = new LibraryAudioPlayer();
    expect(audio).toBeInstanceOf(AudioPlayer);
    // No AudioContext in node → every call is a safe no-op.
    expect(() => audio.play("explode")).not.toThrow();
    expect(() => audio.play("nonexistent-key")).not.toThrow();
    expect(() => audio.startMusic("action")).not.toThrow();
    expect(() => audio.stopMusic()).not.toThrow();
    expect(() => audio.setMuted(true)).not.toThrow();
    expect(() => audio.resume()).not.toThrow();
    // Music never actually starts with no audio backend.
    expect(audio.nowPlaying).toBeNull();
  });
});

describe("palette sync", () => {
  it("src palette matches the gen-assets.ts output (manifest.json)", () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../assets/manifest.json", import.meta.url)), "utf8"),
    ) as { palette: string[] };
    expect([...LIBRARY_PALETTE]).toEqual(manifest.palette);
  });
});
