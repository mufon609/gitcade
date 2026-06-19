import type { SystemFn } from "@gitcade/sdk";
import { str } from "@gitcade/sdk";

/** A pending purchase request set on `world.state[requestKey]` by a part/UI. */
interface TxnRequest {
  /** Caller-defined id of the thing being bought (echoed on the outcome event). */
  id?: string;
  /** Explicit cost; if omitted, resolved from the `costs` id→cost param map. */
  cost?: number;
}

/**
 * Generic economy transaction: afford → deduct → emit. The "buy-and-place-a-thing"
 * primitive that `currency` (a passive accumulator) and `upgrade-tree` (fixed
 * catalog) don't cover. A part/UI sets `world.state[requestKey]` to a `{ id, cost }`
 * (or an `{ id }` resolved against the `costs` param map); each tick this system
 * checks the balance via the SDK `world.canAfford`/`world.spend` assist, and:
 *   - affordable → `world.spend` deducts and it emits `onOk` (default `"purchased"`)
 *     with `{ id, cost }`;
 *   - not → it emits `onDenied` (default `"purchase-denied"`, reason
 *     `"insufficient-funds"`).
 * The request is consumed either way (UI sets it once per click), so the placement
 * step keys off the `purchased` event — affordability lives in one audited part.
 *
 * Params:
 *  - `currencyKey`: balance key to spend from (default `"currency"`)
 *  - `requestKey`: `world.state` key holding the pending request (default `"purchaseRequest"`)
 *  - `onOk`: event emitted on success (default `"purchased"`)
 *  - `onDenied`: event emitted on failure (default `"purchase-denied"`)
 *  - `costs`: optional `id → cost` map for fixed-price catalogs (structural)
 */
export const transaction: SystemFn = (world, params) => {
  const currencyKey = str(params, "currencyKey", "currency");
  const requestKey = str(params, "requestKey", "purchaseRequest");
  const onOk = str(params, "onOk", "purchased");
  const onDenied = str(params, "onDenied", "purchase-denied");
  const costs = (params.costs && typeof params.costs === "object" ? params.costs : {}) as Record<string, number>;

  const raw = world.state[requestKey];
  if (raw == null || raw === "") return;

  // Accept either a structured { id, cost } or a bare id string (cost via `costs`).
  const req: TxnRequest = typeof raw === "string" ? { id: raw } : (raw as TxnRequest);
  const id = req.id;
  const cost = typeof req.cost === "number" ? req.cost : id != null ? costs[id] : undefined;

  // Consume the request regardless of outcome (UI sets it once per click).
  world.state[requestKey] = "";

  if (typeof cost !== "number") {
    world.events.emit(onDenied, { id, reason: "unknown-cost" });
    return;
  }
  if (!world.spend(currencyKey, cost)) {
    world.events.emit(onDenied, { id, cost, reason: "insufficient-funds" });
    return;
  }
  world.audio.play("collect");
  world.events.emit(onOk, { id, cost });
};
