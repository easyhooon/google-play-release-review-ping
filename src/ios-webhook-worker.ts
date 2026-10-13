import { formatIosStoreMessage } from "./ios-store.js";

interface Statement {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

interface Database {
  prepare(sql: string): Statement;
}

export interface WebhookEnv {
  EVENTS: Database;
  APPLE_WEBHOOK_SECRET: string;
  APP_STORE_CONNECT_KEY_ID: string;
  APP_STORE_CONNECT_ISSUER_ID: string;
  APP_STORE_CONNECT_PRIVATE_KEY: string;
  DISCORD_WEBHOOK_URL: string;
}

interface AppleEvent {
  data?: {
    type?: string;
    id?: string;
    attributes?: { oldValue?: string; newValue?: string; timestamp?: string };
    relationships?: { instance?: { data?: { type?: string; id?: string } } };
  };
}

const appId = "6743101965";
const appName = "반다라트";
const eventType = "appStoreVersionAppVersionStateUpdated";
const maxBodyBytes = 64 * 1024;

export async function handleAppleWebhook(
  request: Request, env: WebhookEnv, fetcher: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.APPLE_WEBHOOK_SECRET || !env.DISCORD_WEBHOOK_URL ||
      !env.APP_STORE_CONNECT_KEY_ID || !env.APP_STORE_CONNECT_ISSUER_ID ||
      !env.APP_STORE_CONNECT_PRIVATE_KEY || !env.EVENTS) {
    return new Response("Service unavailable", { status: 503 });
  }
  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return new Response("Invalid body", { status: 400 });
  }
  if (body.byteLength > maxBodyBytes) return new Response("Body too large", { status: 413 });
  if (!(await validSignature(body, request.headers.get("x-apple-signature"), env.APPLE_WEBHOOK_SECRET))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let event: AppleEvent;
  try {
    event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as AppleEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (event.data?.type !== eventType) return new Response(null, { status: 204 });
  const data = event.data;
  const eventId = data.id;
  const versionId = data.relationships?.instance?.data?.id;
  const oldValue = data.attributes?.oldValue;
  const newValue = data.attributes?.newValue;
  if (!eventId || !/^[A-Za-z0-9-]{1,128}$/.test(eventId) ||
      !versionId || !/^[A-Za-z0-9-]{1,128}$/.test(versionId) ||
      data.relationships?.instance?.data?.type !== "appStoreVersions" ||
      !oldValue || !newValue || !/^[A-Z_]{1,80}$/.test(oldValue) ||
      !/^[A-Z_]{1,80}$/.test(newValue) ||
      !data.attributes?.timestamp || Number.isNaN(Date.parse(data.attributes.timestamp))) {
    return new Response("Invalid event", { status: 400 });
  }
  try {
    // Resolve against the app-scoped API. A signed event for a different app cannot be forwarded.
    const version = await resolveVersion(versionId, env, fetcher);
    if (!version) return new Response("Version not available for app", { status: 503 });

    const lease = crypto.randomUUID();
    const now = Date.now();
    await env.EVENTS.prepare(
      "INSERT OR IGNORE INTO webhook_events (id, status, lease_until, lease_token) VALUES (?, 'pending', 0, '')",
    ).bind(eventId).run();
    const claimed = await env.EVENTS.prepare(
      "UPDATE webhook_events SET lease_until = ?, lease_token = ? WHERE id = ? AND status = 'pending' AND lease_until < ?",
    ).bind(now + 120_000, lease, eventId, now).run();
    if (claimed.meta.changes === 0) {
      const existing = await env.EVENTS.prepare(
        "SELECT status FROM webhook_events WHERE id = ?",
      ).bind(eventId).first<{ status: string }>();
      return new Response(existing?.status === "delivered" ? "Duplicate" : "Processing", {
        status: existing?.status === "delivered" ? 200 : 503,
      });
    }
    const message = formatIosStoreMessage(appName, {
      id: versionId, version, state: newValue,
    }, oldValue);
    let discord: Response;
    try {
      const url = new URL(env.DISCORD_WEBHOOK_URL);
      if (url.protocol !== "https:" || url.hostname !== "discord.com" ||
          !url.pathname.startsWith("/api/webhooks/")) throw new Error("Invalid Discord endpoint");
      url.searchParams.set("wait", "true");
      discord = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
      });
      if (!discord.ok) throw new Error(`Discord HTTP ${discord.status}`);
    } catch (error) {
      await env.EVENTS.prepare(
        "UPDATE webhook_events SET lease_until = 0, lease_token = '' WHERE id = ? AND lease_token = ? AND status = 'pending'",
      ).bind(eventId, lease).run();
      console.error("iOS webhook delivery failed", error instanceof Error ? error.message : "unknown");
      return new Response("Delivery failed", { status: 503 });
    }
    const saved = await env.EVENTS.prepare(
      "UPDATE webhook_events SET status = 'delivered', lease_until = 0, lease_token = '' WHERE id = ? AND lease_token = ?",
    ).bind(eventId, lease).run();
    if (saved.meta.changes !== 1) throw new Error("Event delivery record was not saved");
    return new Response("Delivered", { status: 200 });
  } catch (error) {
    console.error("iOS webhook processing failed", error instanceof Error ? error.message : "unknown");
    return new Response("Processing failed", { status: 503 });
  }
}

async function validSignature(body: ArrayBuffer, header: string | null, secret: string): Promise<boolean> {
  const match = /^hmacsha256=([a-fA-F0-9]{64})$/.exec(header ?? "");
  if (!match) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, body));
  const supplied = Uint8Array.from(match[1]!.match(/../g)!, (pair) => Number.parseInt(pair, 16));
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= expected[i]! ^ supplied[i]!;
  return difference === 0;
}

async function resolveVersion(versionId: string, env: WebhookEnv, fetcher: typeof fetch): Promise<string | null> {
  const token = await appleToken(env);
  const url = new URL(`https://api.appstoreconnect.apple.com/v1/apps/${appId}/appStoreVersions`);
  url.searchParams.set("filter[platform]", "IOS");
  url.searchParams.set("fields[appStoreVersions]", "platform,versionString");
  url.searchParams.set("limit", "200");
  for (let page = 0; page < 20; page++) {
    const response = await fetcher(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Apple API HTTP ${response.status}`);
    const payload = await response.json() as {
      data?: Array<{ id?: string; attributes?: { platform?: string; versionString?: string } }>;
      links?: { next?: string | null };
    };
    if (!Array.isArray(payload.data)) throw new Error("Invalid Apple API response");
    const match = payload.data.find((item) => item.id === versionId && item.attributes?.platform === "IOS");
    if (match?.attributes?.versionString) return match.attributes.versionString;
    if (!payload.links?.next) return null;
    const next = new URL(payload.links.next);
    if (next.origin !== url.origin || next.pathname !== url.pathname) throw new Error("Invalid Apple page URL");
    url.search = next.search;
  }
  throw new Error("Apple API page limit exceeded");
}

async function appleToken(env: WebhookEnv): Promise<string> {
  const encode = (value: unknown) => btoa(JSON.stringify(value))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const issued = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "ES256", kid: env.APP_STORE_CONNECT_KEY_ID, typ: "JWT" })}.${encode({
    iss: env.APP_STORE_CONNECT_ISSUER_ID, iat: issued, exp: issued + 1200, aud: "appstoreconnect-v1",
  })}`;
  const pem = env.APP_STORE_CONNECT_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bytes, { name: "ECDSA", namedCurve: "P-256" },
    false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned),
  ));
  const encoded = btoa(String.fromCharCode(...signature)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${unsigned}.${encoded}`;
}

export default {
  fetch(request: Request, env: WebhookEnv): Promise<Response> {
    return handleAppleWebhook(request, env);
  },
};
