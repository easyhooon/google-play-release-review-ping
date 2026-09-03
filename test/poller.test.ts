import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Config } from "../src/config.js";
import type { LifecycleState } from "../src/domain/lifecycle.js";
import type { ReleaseObservation } from "../src/google-play.js";
import type { NotificationEvent, Notifier } from "../src/notifier.js";
import { pollOnce } from "../src/poller.js";

test("폴링을 반복해도 상태 전환마다 한 번만 알린다", async () => {
  const directory = await mkdtemp(join(tmpdir(), "play-review-ping-"));
  const config: Config = {
    pollIntervalSeconds: 180,
    stateFile: join(directory, "state.json"),
    apps: [{ packageName: "com.example.app", tracks: ["production"] }],
  };
  let state: LifecycleState = "RELEASE_LIFECYCLE_STATE_IN_REVIEW";
  const events: NotificationEvent[] = [];
  const client = {
    async listReleases(): Promise<ReleaseObservation[]> {
      return [{
        packageName: "com.example.app",
        track: "production",
        releaseName: "2.4.0",
        versionCode: 240,
        state,
      }];
    },
  };
  const notifier: Notifier = {
    async send(event): Promise<void> {
      events.push(event);
    },
  };

  try {
    assert.equal((await pollOnce(config, client, [notifier])).notifications, 0);
    assert.equal((await pollOnce(config, client, [notifier])).notifications, 0);

    state = "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED";
    assert.equal((await pollOnce(config, client, [notifier])).notifications, 1);
    assert.equal((await pollOnce(config, client, [notifier])).notifications, 0);

    assert.equal(events.length, 1);
    assert.equal(events[0]?.kind, "approved");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
