import { createAppleVersionClient, loadIosStoreConfig, pollIosStoreOnce } from "./ios-store.js";
import { nextPollDelaySeconds } from "./polling-delay.js";

const mode = process.argv[2];
if (mode !== "once" && mode !== "watch") throw new Error("사용법: ios-store-cli.ts once|watch");
const config = await loadIosStoreConfig(process.env.IOS_STORE_REVIEW_PING_CONFIG ?? "ios-store.config.json");
const keyId = process.env.APP_STORE_CONNECT_KEY_ID;
const issuerId = process.env.APP_STORE_CONNECT_ISSUER_ID;
const keyPath = process.env.APP_STORE_CONNECT_KEY_PATH;
const webhook = process.env[config.discordWebhookEnv];
if (!keyId || !issuerId || !keyPath || !webhook) {
  throw new Error("Apple 팀 키 또는 Discord 웹훅 설정이 누락되었습니다.");
}
const listVersions = await createAppleVersionClient({ keyId, issuerId, keyPath });
const send = async (message: string) => {
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: message }),
  });
  if (!response.ok) throw new Error(`Discord 웹훅 전송 실패: HTTP ${response.status}`);
};

let failures = 0;
async function tick(): Promise<void> {
  const started = new Date().toISOString();
  try {
    const result = await pollIosStoreOnce(config, listVersions, send);
    failures = 0;
    console.log(`${started} checked=${result.checked} notifications=${result.notifications} baseline=${result.baseline}`);
  } catch (error) {
    failures++;
    console.error(`${started} iOS store poll failed`, error);
    if (mode === "once") process.exitCode = 1;
  }
}

if (mode === "once") {
  await tick();
} else {
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve,
      nextPollDelaySeconds(config.pollIntervalSeconds, failures) * 1000));
  }
}
