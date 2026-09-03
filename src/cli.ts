import { loadConfig } from "./config.js";
import {
  observeLifecycle,
  type LifecycleState,
} from "./domain/lifecycle.js";
import { GooglePlayClient } from "./google-play.js";
import { createNotifiers } from "./notifier.js";
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

  const tick = async (): Promise<void> => {
    const startedAt = new Date().toISOString();
    try {
      const summary = await pollOnce(config, client, notifiers);
      console.log(
        `${startedAt} checked=${summary.checked} notifications=${summary.notifications}`,
      );
    } catch (error) {
      console.error(`${startedAt} poll failed`, error);
      if (mode === "once") process.exitCode = 1;
    }
  };

  await tick();
  if (mode === "watch") {
    console.log(`${config.pollIntervalSeconds}초 간격으로 감시합니다.`);
    setInterval(() => void tick(), config.pollIntervalSeconds * 1_000);
  }
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
