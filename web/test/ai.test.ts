import assert from "node:assert/strict";
import test from "node:test";
import { checkCodexBridge } from "../src/ai/client";

const bridgeUrl = "http://127.0.0.1:8787";

test("Codexブリッジのヘルスチェックは正しいサービスを受け入れる", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, `${bridgeUrl}/healthz`);
    assert.ok(init?.signal);
    return new Response(JSON.stringify({ ok: true, service: "reqgame-codex-bridge" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await checkCodexBridge(bridgeUrl);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Codexブリッジのヘルスチェックは別サービスの200応答を拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, service: "another-service" }), { status: 200 });
  try {
    await assert.rejects(checkCodexBridge(bridgeUrl), /Codexブリッジではない応答/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Codexブリッジのヘルスチェックは異常なHTTP応答を拒否する", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("down", { status: 503 });
  try {
    await assert.rejects(checkCodexBridge(bridgeUrl), /応答が異常です\(503\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
