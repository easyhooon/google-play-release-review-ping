import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  handleLocalAppleWebhook, openEventDatabase, startLocalWebhookServer,
  type LocalWebhookDependencies,
} from "../src/ios-webhook-local.js";

const event = {
  data: {
    type: "appStoreVersionAppVersionStateUpdated",
    id: "7c813492-9516-4c79-903e-224effdd57ac",
    attributes: { oldValue: "WAITING_FOR_REVIEW", newValue: "IN_REVIEW",
      timestamp: "2026-10-13T02:31:00.000Z" },
    relationships: { instance: { data: { type: "appStoreVersions", id: "version-1" } } },
  },
};

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "ios-webhook-local-"));
  const dbPath = join(dir, "events.sqlite");
  const db = await openEventDatabase(dbPath);
  const sent: string[] = [];
  const deps: LocalWebhookDependencies = {
    appStoreId: "6743101965", appName: "반다라트", secret: "test-secret", db,
    listVersions: async (appId) => {
      assert.equal(appId, "6743101965");
      return [{ id: "version-1", version: "1.5.0", state: "READY_FOR_SALE" }];
    },
    send: async (message) => { sent.push(message); },
  };
  const body = Buffer.from(JSON.stringify(event));
  const signature = createHmac("sha256", deps.secret).update(body).digest("hex");
  return { dir, dbPath, deps, body, sent, signature: `hmacsha256=${signature}`,
    async close() { deps.db.close(); await rm(dir, { recursive: true, force: true }); } };
}

test("서명된 이벤트를 전송하고 SQLite 재시작 후에도 중복을 억제한다", async () => {
  const f = await fixture();
  try {
    assert.equal((await stat(f.dbPath)).mode & 0o777, 0o600);
    assert.equal((await handleLocalAppleWebhook(f.body, f.signature, f.deps)).status, 200);
    assert.match(f.sent[0]!, /버전 1\.5\.0/);
    assert.match(f.sent[0]!, /심사 대기 → 심사 중/);
    f.deps.db.close();
    f.deps.db = await openEventDatabase(f.dbPath);
    assert.equal((await handleLocalAppleWebhook(f.body, f.signature, f.deps)).message, "Duplicate");
    assert.equal(f.sent.length, 1);
  } finally { await f.close(); }
});

test("잘못된 서명·다른 앱 버전·ping은 Discord 메시지를 만들지 않는다", async () => {
  const f = await fixture();
  try {
    assert.equal((await handleLocalAppleWebhook(f.body, "hmacsha256=" + "0".repeat(64), f.deps)).status, 401);
    f.deps.listVersions = async () => [];
    assert.equal((await handleLocalAppleWebhook(f.body, f.signature, f.deps)).status, 503);
    const ping = Buffer.from(JSON.stringify({ data: { type: "webhookPings" } }));
    const pingSignature = "hmacsha256=" + createHmac("sha256", f.deps.secret).update(ping).digest("hex");
    assert.equal((await handleLocalAppleWebhook(ping, pingSignature, f.deps)).status, 204);
    assert.equal(f.sent.length, 0);
  } finally { await f.close(); }
});

test("Discord 실패를 기록하지 않고 같은 이벤트를 재처리한다", async () => {
  const f = await fixture();
  try {
    f.deps.send = async () => { throw new Error("Discord HTTP 500"); };
    assert.equal((await handleLocalAppleWebhook(f.body, f.signature, f.deps)).status, 503);
    f.deps.send = async (message) => { f.sent.push(message); };
    assert.equal((await handleLocalAppleWebhook(f.body, f.signature, f.deps)).status, 200);
    assert.equal(f.sent.length, 1);
  } finally { await f.close(); }
});

test("HTTP 수신기는 loopback에만 바인딩하고 올바른 경로만 처리한다", async () => {
  const f = await fixture();
  const server = startLocalWebhookServer(f.deps, 0);
  try {
    await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    assert.equal(address.address, "127.0.0.1");
    const wrong = await fetch(`http://127.0.0.1:${address.port}/wrong`, { method: "POST", body: f.body });
    assert.equal(wrong.status, 404);
    const response = await fetch(`http://127.0.0.1:${address.port}/apple/app-store-version`, {
      method: "POST", body: f.body, headers: { "x-apple-signature": f.signature },
    });
    assert.equal(response.status, 200);
    assert.equal(f.sent.length, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});
