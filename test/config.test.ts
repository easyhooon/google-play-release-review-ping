import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("앱별 웹훅 환경 변수 이름을 읽는다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "play-review-ping-config-"));
  const path = join(directory, "watch.config.json");
  await writeFile(path, JSON.stringify({
    apps: [
      {
        packageName: "com.example.app",
        tracks: ["production"],
        discordWebhookEnv: "DISCORD_WEBHOOK_URL_EXAMPLE",
        teamsWebhookEnv: "TEAMS_WEBHOOK_URL_EXAMPLE",
      },
    ],
  }));

  try {
    const config = await loadConfig(path);
    assert.equal(config.pollIntervalSeconds, 900);
    assert.equal(
      config.apps[0]?.discordWebhookEnv,
      "DISCORD_WEBHOOK_URL_EXAMPLE",
    );
    assert.equal(
      config.apps[0]?.teamsWebhookEnv,
      "TEAMS_WEBHOOK_URL_EXAMPLE",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("잘못된 웹훅 환경 변수 이름을 거부한다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "play-review-ping-config-"));
  const path = join(directory, "watch.config.json");
  await writeFile(path, JSON.stringify({
    apps: [
      {
        packageName: "com.example.app",
        tracks: ["production"],
        teamsWebhookEnv: "not-valid-name",
      },
    ],
  }));

  try {
    await assert.rejects(loadConfig(path), /올바른 환경 변수 이름/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
