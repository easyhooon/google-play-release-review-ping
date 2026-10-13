import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, verify } from "node:crypto";
import test from "node:test";
import { handleAppleWebhook, type WebhookEnv } from "../src/ios-webhook-worker.js";

const payload = {
  data: {
    type: "appStoreVersionAppVersionStateUpdated",
    id: "7c813492-9516-4c79-903e-224effdd57ac",
    version: 1,
    attributes: {
      oldValue: "WAITING_FOR_REVIEW", newValue: "IN_REVIEW",
      timestamp: "2026-10-13T02:31:00.000Z",
    },
    relationships: { instance: { data: { type: "appStoreVersions", id: "version-1" } } },
  },
};

function fixture() {
  const rows = new Map<string, { status: string; lease: number; token: string }>();
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const env: WebhookEnv = {
    APPLE_WEBHOOK_SECRET: "test-shared-secret",
    APP_STORE_CONNECT_KEY_ID: "TESTKEY123",
    APP_STORE_CONNECT_ISSUER_ID: "00000000-0000-0000-0000-000000000000",
    APP_STORE_CONNECT_PRIVATE_KEY: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/123/test",
    EVENTS: {
      prepare(sql) {
        let args: unknown[] = [];
        return {
          bind(...values) { args = values; return this; },
          async first<T>() {
            assert.match(sql, /^SELECT status/);
            return (rows.get(args[0] as string) ?? null) as T | null;
          },
          async run() {
            const id = sql.startsWith("INSERT") ? args[0] as string :
              sql.includes("SET lease_until = ?") ? args[2] as string : args[0] as string;
            if (sql.startsWith("INSERT")) {
              if (rows.has(id)) return { meta: { changes: 0 } };
              rows.set(id, { status: "pending", lease: 0, token: "" });
              return { meta: { changes: 1 } };
            }
            const row = rows.get(id);
            if (!row) return { meta: { changes: 0 } };
            if (sql.includes("SET lease_until = ?")) {
              if (row.status !== "pending" || row.lease >= (args[3] as number)) {
                return { meta: { changes: 0 } };
              }
              row.lease = args[0] as number;
              row.token = args[1] as string;
            } else if (sql.includes("SET status = 'delivered'")) {
              if (row.token !== args[1]) return { meta: { changes: 0 } };
              row.status = "delivered";
              row.lease = 0;
              row.token = "";
            } else {
              if (row.token !== args[1]) return { meta: { changes: 0 } };
              row.lease = 0;
              row.token = "";
            }
            return { meta: { changes: 1 } };
          },
        };
      },
    },
  };
  function request(event: unknown = payload, secret = env.APPLE_WEBHOOK_SECRET): Request {
    const body = JSON.stringify(event);
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    return new Request("https://worker.example/webhook", {
      method: "POST", body, headers: { "x-apple-signature": `hmacsha256=${signature}` },
    });
  }
  let discordCount = 0;
  let discordStatus = 200;
  let appVersionId = "version-1";
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    if (url.hostname === "api.appstoreconnect.apple.com") {
      const authorization = String((init?.headers as Record<string, string>).authorization);
      assert.match(authorization, /^Bearer [A-Za-z0-9_.-]+$/);
      const [header, claims, signature] = authorization.slice(7).split(".");
      assert.equal(JSON.parse(Buffer.from(header!, "base64url").toString()).alg, "ES256");
      assert.equal(JSON.parse(Buffer.from(claims!, "base64url").toString()).iss,
        env.APP_STORE_CONNECT_ISSUER_ID);
      assert.ok(verify("sha256", Buffer.from(`${header}.${claims}`),
        { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature!, "base64url")));
      return Response.json({ data: [{ id: appVersionId,
        attributes: { platform: "IOS", versionString: "1.5.0" } }] });
    }
    assert.equal(url.hostname, "discord.com");
    assert.equal(url.searchParams.get("wait"), "true");
    const message = JSON.parse(String(init?.body)) as { content: string; allowed_mentions: unknown };
    assert.match(message.content, /반다라트 iOS 심사 상태 변경/);
    assert.match(message.content, /버전 1\.5\.0/);
    assert.deepEqual(message.allowed_mentions, { parse: [] });
    discordCount++;
    return new Response(null, { status: discordStatus });
  };
  return { env, rows, request, fetcher, get discordCount() { return discordCount; },
    set discordStatus(value: number) { discordStatus = value; },
    set appVersionId(value: string) { appVersionId = value; } };
}

test("서명된 iOS 상태 이벤트를 한 번 전송하고 이벤트 ID로 중복을 억제한다", async () => {
  const f = fixture();
  assert.equal((await handleAppleWebhook(f.request(), f.env, f.fetcher)).status, 200);
  assert.equal((await handleAppleWebhook(f.request(), f.env, f.fetcher)).status, 200);
  assert.equal(f.discordCount, 1);
  assert.equal(f.rows.get(payload.data.id)?.status, "delivered");
});

test("서명 실패와 다른 앱의 버전은 Discord로 전달하지 않는다", async () => {
  const f = fixture();
  assert.equal((await handleAppleWebhook(f.request(payload, "wrong"), f.env, f.fetcher)).status, 401);
  f.appVersionId = "another-version";
  assert.equal((await handleAppleWebhook(f.request(), f.env, f.fetcher)).status, 503);
  assert.equal(f.discordCount, 0);
});

test("Discord 실패 시 503을 반환하고 동일 이벤트를 다시 처리할 수 있다", async () => {
  const f = fixture();
  f.discordStatus = 500;
  assert.equal((await handleAppleWebhook(f.request(), f.env, f.fetcher)).status, 503);
  assert.equal(f.rows.get(payload.data.id)?.status, "pending");
  f.discordStatus = 200;
  assert.equal((await handleAppleWebhook(f.request(), f.env, f.fetcher)).status, 200);
  assert.equal(f.discordCount, 2);
});

test("잘못된 이벤트 본문과 다른 이벤트 종류를 구분한다", async () => {
  const f = fixture();
  assert.equal((await handleAppleWebhook(f.request({ data: { type: payload.data.type } }), f.env, f.fetcher)).status, 400);
  assert.equal((await handleAppleWebhook(f.request({ data: { type: "webhookPings" } }), f.env, f.fetcher)).status, 204);
  assert.equal(f.discordCount, 0);
});
