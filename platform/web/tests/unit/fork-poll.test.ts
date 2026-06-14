import { describe, it, expect } from "vitest";
import { forkSlug, forkDisplayName } from "@/lib/fork";
import { shouldRebuild } from "@/lib/poll";

describe("fork naming (Locked Decision)", () => {
  it("builds {original-slug}--{username}, lowercased", () => {
    expect(forkSlug("snake", "Ada")).toBe("snake--ada");
    expect(forkSlug("tower-defense", "mufon609")).toBe("tower-defense--mufon609");
  });

  it('display name is "Original Name (username\'s fork)"', () => {
    expect(forkDisplayName("Tower Defense", "ada")).toBe("Tower Defense (ada's fork)");
  });

  it("a fork-of-a-fork slug stays valid (double-hyphen chains)", () => {
    // SDK SlugSchema regex allows repeated `--` segments.
    const re = /^[a-z0-9]+(?:-+[a-z0-9]+)*$/;
    expect(re.test(forkSlug(forkSlug("snake", "ada"), "bob"))).toBe(true);
  });
});

describe("shouldRebuild (polling fallback decision)", () => {
  it("rebuilds when HEAD moved past the last built commit", () => {
    expect(shouldRebuild("newsha", "oldsha")).toBe(true);
  });
  it("rebuilds a never-built branch (lastBuilt null)", () => {
    expect(shouldRebuild("sha", null)).toBe(true);
  });
  it("does NOT rebuild when HEAD equals last built", () => {
    expect(shouldRebuild("samesha", "samesha")).toBe(false);
  });
  it("does NOT rebuild on an unknown HEAD (GitHub error)", () => {
    expect(shouldRebuild(null, "oldsha")).toBe(false);
    expect(shouldRebuild(undefined, null)).toBe(false);
  });
});
