// Phase 8B (N+1 collapse): the Community-tab proposal list previously ran 2×
// vote.count PER proposal (1 + 2N queries). It now tallies ALL proposals in ONE
// vote.groupBy. These tests prove the batched path issues a single query and is
// behaviour-equivalent to the per-proposal counts.
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ groupBy: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { vote: { groupBy: h.groupBy } } }));

import { countVotesForProposals, tallyProposals } from "@/lib/governance-service";

beforeEach(() => {
  h.groupBy.mockReset();
});

describe("batched proposal tally (N+1 collapse)", () => {
  it("derives YES/NO per proposal from ONE groupBy, defaulting absent proposals to 0/0", async () => {
    h.groupBy.mockResolvedValueOnce([
      { proposalId: "a", choice: "YES", _count: { _all: 7 } },
      { proposalId: "a", choice: "NO", _count: { _all: 3 } },
      { proposalId: "b", choice: "YES", _count: { _all: 2 } },
      // "c" has no votes at all
    ]);
    const counts = await countVotesForProposals(["a", "b", "c"]);
    expect(h.groupBy).toHaveBeenCalledTimes(1); // ONE query — not 2N
    expect(counts.get("a")).toEqual({ yes: 7, no: 3 });
    expect(counts.get("b")).toEqual({ yes: 2, no: 0 });
    expect(counts.get("c")).toEqual({ yes: 0, no: 0 });
  });

  it("issues NO query for an empty proposal set", async () => {
    const counts = await countVotesForProposals([]);
    expect(counts.size).toBe(0);
    expect(h.groupBy).not.toHaveBeenCalled();
  });

  it("tallyProposals applies each proposal's own threshold/quorum", async () => {
    h.groupBy.mockResolvedValueOnce([
      { proposalId: "p1", choice: "YES", _count: { _all: 7 } },
      { proposalId: "p1", choice: "NO", _count: { _all: 3 } },
    ]);
    const map = await tallyProposals([{ id: "p1", thresholdPct: 70, quorum: 10 }]);
    const t = map.get("p1")!;
    expect(t).toMatchObject({ yes: 7, no: 3, total: 10, yesPct: 70, passing: true });
  });
});
