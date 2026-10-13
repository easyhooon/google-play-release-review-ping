import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { formatIosStoreMessage, type AppStoreVersion } from "./ios-store.js";

const maxBodyBytes = 64 * 1024;
const route = "/apple/app-store-version";

interface Event {
  data?: {
    type?: string;
    id?: string;
    attributes?: { oldValue?: string; newValue?: string; timestamp?: string };
    relationships?: { instance?: { data?: { type?: string; id?: string } } };
  };
}

export interface LocalWebhookDependencies {
  appStoreId: string;
  appName: string;
  secret: string;
  db: DatabaseSync;
  listVersions: (appStoreId: string) => Promise<AppStoreVersion[]>;
  send: (message: string) => Promise<void>;
}

export async function openEventDatabase(path: string): Promise<DatabaseSync> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const oldMask = process.umask(0o077);
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } finally {
    process.umask(oldMask);
  }
  await chmod(path, 0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; " +
    "CREATE TABLE IF NOT EXISTS webhook_events (" +
    "id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('pending', 'delivered')), " +
    "lease_until INTEGER NOT NULL, lease_token TEXT NOT NULL)");
  return db;
}

export async function handleLocalAppleWebhook(
  body: Buffer, signature: string | undefined, deps: LocalWebhookDependencies,
): Promise<{ status: number; message: string }> {
  if (body.length > maxBodyBytes) return { status: 413, message: "Body too large" };
  if (!deps.secret || !validSignature(body, signature, deps.secret)) {
    return { status: 401, message: "Invalid signature" };
  }
  let event: Event;
  try {
    event = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as Event;
  } catch {
    return { status: 400, message: "Invalid JSON" };
  }
  if (event.data?.type !== "appStoreVersionAppVersionStateUpdated") {
    return { status: 204, message: "" };
  }
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
    return { status: 400, message: "Invalid event" };
  }
  try {
    const versions = await deps.listVersions(deps.appStoreId);
    const version = versions.find((item) => item.id === versionId);
    if (!version) return { status: 503, message: "Version not available for app" };
    const now = Date.now();
    const lease = randomUUID();
    deps.db.prepare("INSERT OR IGNORE INTO webhook_events VALUES (?, 'pending', 0, '')").run(eventId);
    const claimed = deps.db.prepare("UPDATE webhook_events SET lease_until=?, lease_token=? " +
      "WHERE id=? AND status='pending' AND lease_until < ?")
      .run(now + 120_000, lease, eventId, now);
    if (claimed.changes === 0) {
      const row = deps.db.prepare("SELECT status FROM webhook_events WHERE id=?").get(eventId) as
        { status: string } | undefined;
      return row?.status === "delivered" ?
        { status: 200, message: "Duplicate" } : { status: 503, message: "Processing" };
    }
    try {
      await deps.send(formatIosStoreMessage(deps.appName,
        { ...version, state: newValue }, oldValue));
    } catch (error) {
      deps.db.prepare("UPDATE webhook_events SET lease_until=0, lease_token='' " +
        "WHERE id=? AND lease_token=? AND status='pending'").run(eventId, lease);
      console.error("iOS webhook delivery failed", error instanceof Error ? error.message : "unknown");
      return { status: 503, message: "Delivery failed" };
    }
    const saved = deps.db.prepare("UPDATE webhook_events SET status='delivered', " +
      "lease_until=0, lease_token='' WHERE id=? AND lease_token=?").run(eventId, lease);
    if (saved.changes !== 1) throw new Error("Event delivery record was not saved");
    return { status: 200, message: "Delivered" };
  } catch (error) {
    console.error("iOS webhook processing failed", error instanceof Error ? error.message : "unknown");
    return { status: 503, message: "Processing failed" };
  }
}

function validSignature(body: Buffer, header: string | undefined, secret: string): boolean {
  const match = /^hmacsha256=([a-fA-F0-9]{64})$/.exec(header ?? "");
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(body).digest();
  const supplied = Buffer.from(match[1]!, "hex");
  return timingSafeEqual(expected, supplied);
}

export function startLocalWebhookServer(deps: LocalWebhookDependencies, port: number) {
  if (!Number.isInteger(port) || (port !== 0 && port < 1024) || port > 65535) {
    throw new Error("IOS_STORE_WEBHOOK_PORT must be an unprivileged TCP port");
  }
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== route) {
      respond(response, 404, "Not found");
      return;
    }
    try {
      const body = await readBody(request);
      const result = await handleLocalAppleWebhook(body,
        request.headers["x-apple-signature"] as string | undefined, deps);
      respond(response, result.status, result.message);
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === "Body too large";
      respond(response, tooLarge ? 413 : 500, tooLarge ? "Body too large" : "Internal error");
    }
  });
  server.listen(port, "127.0.0.1");
  return server;
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("Body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function respond(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}
