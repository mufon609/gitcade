import { describe, it, expect } from "vitest";
import { num, str, bool, strArray, resolveParams } from "../src/index.js";

/**
 * The param readers must tell an ABSENT optional param (→ its default) apart from one that is
 * PRESENT but the wrong type (→ throw). The latter used to collapse into the same fallback, so a
 * string/boolean `$cfg` value read as a number silently became `0` — a broken game that still
 * booted. These lock in the loud failure and confirm the legitimate absent/default path is intact
 * (including the valid falsy values 0 / "" / false, which must NOT be mistaken for "absent").
 */
describe("param type guards", () => {
  describe("num", () => {
    it("returns a present number, including a valid 0 (not the fallback)", () => {
      expect(num({ speed: 7 }, "speed")).toBe(7);
      expect(num({ speed: 0 }, "speed", 99)).toBe(0);
    });
    it("returns the fallback when absent, null, or undefined", () => {
      expect(num({}, "speed", 5)).toBe(5);
      expect(num({ speed: null }, "speed", 5)).toBe(5);
      expect(num({ speed: undefined }, "speed", 5)).toBe(5);
      expect(num({}, "speed")).toBe(0); // default fallback
    });
    it("THROWS on a present non-number rather than silently reading 0", () => {
      expect(() => num({ speed: "fast" }, "speed")).toThrow(/"speed".*number/);
      expect(() => num({ speed: true }, "speed")).toThrow(/number/);
      expect(() => num({ speed: ["x"] }, "speed")).toThrow(/number/);
    });
    it("names the key and hints at $cfg in the message", () => {
      expect(() => num({ jumpForce: "high" }, "jumpForce")).toThrow(/jumpForce/);
      expect(() => num({ jumpForce: "high" }, "jumpForce")).toThrow(/\$cfg/);
    });
  });

  describe("str", () => {
    it("returns a present string, including an empty string (not the fallback)", () => {
      expect(str({ k: "ArrowUp" }, "k")).toBe("ArrowUp");
      expect(str({ k: "" }, "k", "x")).toBe("");
    });
    it("returns the fallback when absent or null", () => {
      expect(str({}, "k", "d")).toBe("d");
      expect(str({ k: null }, "k", "d")).toBe("d");
    });
    it("THROWS on a present non-string", () => {
      expect(() => str({ k: 3 }, "k")).toThrow(/"k".*string/);
      expect(() => str({ k: false }, "k")).toThrow(/string/);
    });
  });

  describe("bool", () => {
    it("returns a present boolean, including false (not the fallback)", () => {
      expect(bool({ on: true }, "on")).toBe(true);
      expect(bool({ on: false }, "on", true)).toBe(false);
    });
    it("returns the fallback when absent or null", () => {
      expect(bool({}, "on", true)).toBe(true);
      expect(bool({ on: null }, "on", true)).toBe(true);
    });
    it("THROWS on a present non-boolean", () => {
      expect(() => bool({ on: "yes" }, "on")).toThrow(/"on".*boolean/);
      expect(() => bool({ on: 1 }, "on")).toThrow(/boolean/);
    });
  });

  describe("strArray", () => {
    it("wraps a single string and passes an all-string array through", () => {
      expect(strArray({ keys: "ArrowUp" }, "keys")).toEqual(["ArrowUp"]);
      expect(strArray({ keys: ["a", "b"] }, "keys")).toEqual(["a", "b"]);
    });
    it("returns [] when absent or null", () => {
      expect(strArray({}, "keys")).toEqual([]);
      expect(strArray({ keys: null }, "keys")).toEqual([]);
    });
    it("THROWS on a non-string array element (which used to be silently dropped)", () => {
      expect(() => strArray({ keys: ["a", 3] }, "keys")).toThrow(/"keys".*array of strings/);
    });
    it("THROWS on a present non-array, non-string value", () => {
      expect(() => strArray({ keys: 5 }, "keys")).toThrow(/"keys"/);
    });
  });

  // End-to-end: a $cfg string used as a numeric param resolves fine (a string leaf is legal), then
  // throws at the read — exactly the path the validator's smoke boot exercises, so the once-silent
  // "reads 0" mismatch now fails the publish gate instead of shipping.
  it("surfaces a $cfg scalar type mismatch end-to-end", () => {
    const resolved = resolveParams({ speed: "$cfg.difficulty" }, { difficulty: "hard" });
    expect(resolved.speed).toBe("hard"); // resolution is unchanged — the string leaf resolves
    expect(() => num(resolved, "speed")).toThrow(/number/); // but reading it as a number is caught
  });
});
