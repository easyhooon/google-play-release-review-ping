import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAppleVersionClient, formatIosStoreMessage, pollIosStoreOnce,
  type AppStoreVersion, type IosStoreConfig,
} from "../src/ios-store.js";

test("첫 조회는 기준점만 저장하고 이후 상태 전환마다 한 번 전송한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ios-store-ping-"));
  const config: IosStoreConfig = {
    appStoreId: "6743101965", appName: "반다라트", pollIntervalSeconds: 900,
    stateFile: join(dir, "state.json"), discordWebhookEnv: "DISCORD_WEBHOOK_URL",
  };
  let state = "WAITING_FOR_REVIEW";
  const sent: string[] = [];
  const list = async (): Promise<AppStoreVersion[]> => [{ id: "version-1", version: "1.5.0", state }];
  try {
    assert.deepEqual(await pollIosStoreOnce(config, list, async (m) => { sent.push(m); }),
      { checked: 1, notifications: 0, baseline: true });
    state = "IN_REVIEW";
    assert.equal((await pollIosStoreOnce(config, list, async (m) => { sent.push(m); })).notifications, 1);
    assert.equal((await pollIosStoreOnce(config, list, async (m) => { sent.push(m); })).notifications, 0);
    state = "READY_FOR_DISTRIBUTION";
    assert.equal((await pollIosStoreOnce(config, list, async (m) => { sent.push(m); })).notifications, 1);
    assert.equal(sent.length, 2);
    assert.match(sent[1]!, /배포 준비 완료/);
    assert.equal(JSON.parse(await readFile(config.stateFile, "utf8")).versions["version-1"].state,
      "READY_FOR_DISTRIBUTION");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("전송 실패 시 상태를 저장하지 않아 다음 조회에서 재시도한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ios-store-ping-"));
  const config: IosStoreConfig = {
    appStoreId: "6743101965", appName: "반다라트", pollIntervalSeconds: 900,
    stateFile: join(dir, "state.json"), discordWebhookEnv: "DISCORD_WEBHOOK_URL",
  };
  let state = "IN_REVIEW";
  const list = async (): Promise<AppStoreVersion[]> => [{ id: "version-1", version: "1.5.0", state }];
  try {
    await pollIosStoreOnce(config, list, async () => { throw Error("must not send baseline"); });
    state = "REJECTED";
    await assert.rejects(pollIosStoreOnce(config, list, async () => { throw Error("HTTP 500"); }), /HTTP 500/);
    assert.equal(JSON.parse(await readFile(config.stateFile, "utf8")).versions["version-1"].state,
      "IN_REVIEW");
    let count = 0;
    await pollIosStoreOnce(config, list, async () => { count++; });
    assert.equal(count, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("조회 실패와 빈 결과는 기준점을 만들지 않고 새 심사 버전은 알린다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ios-store-ping-"));
  const config: IosStoreConfig = {
    appStoreId: "6743101965", appName: "반다라트", pollIntervalSeconds: 900,
    stateFile: join(dir, "state.json"), discordWebhookEnv: "DISCORD_WEBHOOK_URL",
  };
  try {
    await assert.rejects(pollIosStoreOnce(config, async () => { throw Error("HTTP 403"); }, async () => {}), /HTTP 403/);
    await assert.rejects(pollIosStoreOnce(config, async () => [], async () => {}), /조회되지/);
    await assert.rejects(readFile(config.stateFile), { code: "ENOENT" });
    await pollIosStoreOnce(config, async () => [{ id: "1", version: "1.5.0", state: "READY_FOR_DISTRIBUTION" }], async () => {});
    let count = 0;
    await pollIosStoreOnce(config, async () => [
      { id: "1", version: "1.5.0", state: "READY_FOR_DISTRIBUTION" },
      { id: "2", version: "1.6.0", state: "WAITING_FOR_REVIEW" },
    ], async () => { count++; });
    assert.equal(count, 1);
    assert.equal((await pollIosStoreOnce(config, async () => [
      { id: "1", version: "1.5.0", state: "READY_FOR_DISTRIBUTION" },
      { id: "2", version: "1.6.0", state: "WAITING_FOR_REVIEW" },
    ], async () => { count++; })).notifications, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("형식이 잘못된 Apple 응답은 실패 처리하고 외부 페이지네이션 링크를 차단한다", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ios-store-ping-"));
  const key = join(dir, "key.p8");
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  await writeFile(key, privateKey.export({ format: "pem", type: "pkcs8" }));
  try {
    const credentials = {
      keyId: "ABC123", issuerId: "00000000-0000-0000-0000-000000000000", keyPath: key,
    };
    const malformed = await createAppleVersionClient(credentials,
      async () => ({ ok: true, json: async () => ({ data: [{}] }) }) as Response);
    await assert.rejects(malformed("6743101965"), /필수 필드/);
    const malicious = await createAppleVersionClient(credentials,
      async () => ({ ok: true, json: async () => ({ data: [{
        id: "1", attributes: { platform: "IOS", versionString: "1.5.0", appStoreState: "IN_REVIEW" },
      }], links: { next: "https://example.com/steal" } }) }) as Response);
    await assert.rejects(malicious("6743101965"), /페이지네이션/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("알 수 없는 Apple 상태는 원문을 유지한다", () => {
  assert.match(formatIosStoreMessage("반다라트", { id: "1", version: "1.5.0", state: "FUTURE_STATE" }, "IN_REVIEW"), /FUTURE_STATE/);
});
