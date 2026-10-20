import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_PRICING, calculateCost, getModelName, normalizeModelId } from "../src/lib/pricing";
import { calculateSnapshot, extractSessionData } from "../src/lib/usage-collector";

test("the active MiniMax catalog lists Flash first and M3 only", () => {
  const models = MODEL_PRICING.filter((model) => model.id.startsWith("minimax/"));
  assert.deepEqual(models.map((model) => model.id), [
    "minimax/MiniMax-M3.1-Flash", "minimax/MiniMax-M3",
  ]);
  assert.equal(normalizeModelId("minimax"), models[0].id);
  assert.deepEqual(models.map((model) => model.contextWindow), [1000000, 1000000]);
  assert.deepEqual(models.map((model) => model.cacheReadPricePerMillion), [0.015, 0.06]);
  assert.ok(models.every((model) => model.cacheWritePricePerMillion === undefined));
});

test("current MiniMax IDs resolve without falling back to default pricing", () => {
  for (const [model, cost, name] of [
    ["MiniMax-M3.1-Flash", 0.75, "MiniMax M3.1 Flash"],
    ["MiniMax-M3", 1.5, "MiniMax M3"],
  ] as const) {
    for (const id of [model, model.toLowerCase(), `minimax/${model}`, `minimax/${model.toLowerCase()}`]) {
      assert.equal(normalizeModelId(id), `minimax/${model}`);
      assert.equal(calculateCost(id, 1000000, 1000000), cost);
      assert.equal(getModelName(id), name);
    }
  }
  assert.equal(calculateCost("minimax", 1000000, 1000000), 0.75);
});

test("explicit legacy sessions retain their IDs and historical estimates", () => {
  for (const [model, canonical, cost] of [
    ["MiniMax-M2.5", "minimax/minimax-m2.5", 1.4],
    ["MiniMax-M2.7", "minimax/MiniMax-M2.7", 1.5],
  ] as const) {
    for (const id of [model, model.toLowerCase(), `minimax/${model}`, `minimax/${model.toLowerCase()}`]) {
      assert.equal(normalizeModelId(id), canonical);
      assert.ok(Math.abs(calculateCost(id, 1000000, 1000000) - cost) < 1e-10);
    }
  }
});

test("custom and gateway IDs are not rewritten to a direct MiniMax model", () => {
  for (const id of ["custom-model", "minimax/custom", "openrouter/minimax/minimax-m3.1-flash:free", "speech-2.8-hd"]) {
    assert.equal(normalizeModelId(id), id);
    assert.equal(getModelName(id), id);
  }
  assert.equal(calculateCost("sonnet", 1000000, 1000000), 18);
  assert.equal(calculateCost("gemini-flash", 1000000, 1000000), 0.75);
});

test("the collector normalizes session IDs and costs aggregates without mutating status", () => {
  const status = {
    sessions: { byAgent: [{ agentId: "fixture", recent: [
      { key: "a", sessionId: "a", model: "MiniMax-M3.1-Flash", inputTokens: 600000, outputTokens: 100000, totalTokens: 700000, updatedAt: 1 },
      { key: "b", sessionId: "b", model: "minimax", inputTokens: 600000, outputTokens: 100000, totalTokens: 700000, updatedAt: 1 },
      { key: "c", sessionId: "c", model: "MiniMax-M3", inputTokens: 1000000, outputTokens: 1000000, totalTokens: 2000000, updatedAt: 1 },
      { key: "d", sessionId: "d", model: "minimax-m2.5", inputTokens: 1000000, outputTokens: 1000000, totalTokens: 2000000, updatedAt: 1 },
    ] }] },
  };
  const original = structuredClone(status);
  const snapshots = calculateSnapshot(extractSessionData(status), Date.UTC(2026, 9, 20));
  assert.equal(snapshots.length, 3);
  assert.equal(snapshots[0].model, "minimax/MiniMax-M3.1-Flash");
  assert.equal(snapshots[0].inputTokens, 1200000);
  assert.ok(Math.abs(snapshots[0].cost - 0.30) < 1e-10);
  // These are aggregate session totals, not the context length of one request.
  assert.equal(snapshots[1].cost, 1.5);
  assert.equal(snapshots[2].model, "minimax/minimax-m2.5");
  assert.ok(Math.abs(snapshots[2].cost - 1.4) < 1e-10);
  assert.deepEqual(status, original);
});
