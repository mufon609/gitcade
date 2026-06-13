/**
 * Audio half of the Phase 2B library: runtime-SYNTHESIZED SFX + two chiptune music
 * loops, with zero binary audio assets (locked audio direction). The catalog audio
 * parts (kind `asset`, category `audio`) describe these by key; the implementation
 * lives in {@link LibraryAudioPlayer} (wired into a game as its `audio` instance)
 * and {@link synth}. All of it no-ops cleanly with no `AudioContext` (headless).
 */
export { LibraryAudioPlayer } from "./library-audio-player.js";
export {
  playSfx,
  MusicPlayer,
  SFX_RECIPES,
  SFX_KEYS,
  MUSIC_TRACKS,
  MUSIC_LOOPS,
  type SfxKey,
  type MusicLoop,
  type SfxRecipe,
  type SfxLayer,
  type MusicTrack,
  type Note,
} from "./synth.js";
