/**
 * The replay-intro host helper: a skippable **Echo** of the player's last run, played back on the
 * canvas before live play begins. Built on the SDK's run-recording primitive (`createReplay`, new in
 * sdk 1.13.0).
 *
 * Like {@link ScreenEffects} / {@link LibraryAudioPlayer}, this is a host-side CODE export, NOT a
 * data-part — it orchestrates a second Game instance + the canvas rAF loop + skip input, which a
 * behavior/system (frozen inside one Game's tick) cannot do. So it registers no runtime type and adds
 * no CATALOG entry. The controller ({@link ReplayIntro}) is pure and unit-testable; the
 * {@link attachReplayIntro} glue runs the rAF loop and is a safe no-op (never stranding `onDone`)
 * headless. {@link parseRecording} safe-loads a recording persisted through the storage bridge.
 */
export {
  ReplayIntro,
  attachReplayIntro,
  parseRecording,
  type ReplayIntroOptions,
  type ReplayIntroDoneInfo,
  type ReplayIntroVisuals,
} from "./replay-intro.js";
