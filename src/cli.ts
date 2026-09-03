import { loadConfig } from "./config.js";
import {
  observeLifecycle,
  type LifecycleState,
} from "./domain/lifecycle.js";
import { GooglePlayClient } from "./google-play.js";
import { createNotifiers } from "./notifier.js";
import { nextPollDelaySeconds } from "./polling-delay.js";
import { pollOnce } from "./poller.js";

const command = process.argv[2] ?? "once";
const configPath = process.env.PLAY_REVIEW_PING_CONFIG ?? "watch.config.json";

if (command === "demo") {
  runDemo();
} else if (command === "once" || command === "watch") {
  await run(command);
} else {
  throw new Error(`알 수 없는 명령: ${command}`);
}

async function run(mode: "once" | "watch"): Promise<void> {
  const config = await loadConfig(configPath);
  const client = new GooglePlayClient();
  const notifiers = createNotifiers();

  const tick = async (): Promise<boolean> => {
    const startedAt = new Date().toISOString();
    try {
      const summary = await pollOnce(config, client, notifiers);
      console.log(
        `${startedAt} checked=${summary.checked} notifications=${summary.notifications}`,
      );
      return true;
    } catch (error) {
      console.error(`${startedAt} poll failed`, error);
      if (mode === "once") process.exitCode = 1;
      return false;
    }
  };

  if (mode === "once") {
    await tick();
    return;
  }

  console.log(`${config.pollIntervalSeconds}초 간격으로 감시합니다.`);
  let consecutiveFailures = 0;

  const scheduleNext = async (): Promise<void> => {
    const succeeded = await tick();
    consecutiveFailures = succeeded ? 0 : consecutiveFailures + 1;
    const delaySeconds = nextPollDelaySeconds(
      config.pollIntervalSeconds,
      consecutiveFailures,
    );

    if (!succeeded) {
      console.error(`${delaySeconds}초 후 다시 시도합니다.`);
    }
    setTimeout(() => void scheduleNext(), delaySeconds * 1_000);
  };

  await scheduleNext();
}

function runDemo(): void {
  const sequence: LifecycleState[] = [
    "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
    "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
    "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED",
    "RELEASE_LIFECYCLE_STATE_PUBLISHED",
  ];
  let previous: LifecycleState | null = null;

  for (const current of sequence) {
    const decision = observeLifecycle(previous, current);
    console.log(
      `${short(previous)} -> ${short(current)} | ${decision.notification ?? "알림 없음"}`,
    );
    previous = current;
  }
}

function short(state: LifecycleState | null): string {
  return state?.replace("RELEASE_LIFECYCLE_STATE_", "") ?? "첫 관측";
}
