import { createAppleVersionClient, loadIosStoreConfig } from "./ios-store.js";
import { openEventDatabase, startLocalWebhookServer } from "./ios-webhook-local.js";

const config = await loadIosStoreConfig(process.env.IOS_STORE_REVIEW_PING_CONFIG ?? "ios-store.config.json");
const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
const keyPath = process.env.APP_STORE_CONNECT_KEY_PATH;
const secret = process.env.APPLE_WEBHOOK_SECRET;
const discordWebhook = process.env[config.discordWebhookEnv];
if (!keyId || !issuerId || !keyPath || !secret || !discordWebhook) {
  throw new Error("Apple 팀 키, 웹훅 서명 비밀값 또는 Discord 웹훅 설정이 누락되었습니다.");
}
const listVersions = await createAppleVersionClient({ keyId, issuerId, keyPath });
const db = await openEventDatabase(process.env.IOS_STORE_WEBHOOK_DB ?? ".data/ios-webhook-events.sqlite");
const port = Number(process.env.IOS_STORE_WEBHOOK_PORT ?? "8787");
const server = startLocalWebhookServer({
  appStoreId: config.appStoreId,
  appName: config.appName,
  secret,
  db,
  listVersions,
  send: async (message) => {
    const url = new URL(discordWebhook);
    if (url.protocol !== "https:" || url.hostname !== "discord.com" ||
        !url.pathname.startsWith("/api/webhooks/")) throw new Error("Invalid Discord endpoint");
    url.searchParams.set("wait", "true");
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message, allowed_mentions: { parse: [] } }),
    });
    if (!response.ok) throw new Error(`Discord HTTP ${response.status}`);
  },
}, port);
server.on("listening", () => console.log(`iOS store webhook listening on 127.0.0.1:${port}`));
server.on("error", (error) => { console.error("iOS store webhook listener failed", error.message); process.exitCode = 1; });
