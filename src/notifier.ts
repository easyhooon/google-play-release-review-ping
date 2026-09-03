import type {
  LifecycleState,
  NotificationKind,
} from "./domain/lifecycle.js";
import type { ReleaseObservation } from "./google-play.js";

export interface NotificationEvent {
  kind: NotificationKind;
  previous: LifecycleState;
  release: ReleaseObservation;
}

export interface Notifier {
  send(event: NotificationEvent): Promise<void>;
}

const titles: Record<NotificationKind, string> = {
  "action-required": "⚠️ 심사 전송 필요",
  approved: "✅ 심사 승인 완료 — 게시 대기",
  rejected: "🚨 심사 거절",
  published: "🚀 Google Play 게시 완료",
};

export class ConsoleNotifier implements Notifier {
  async send(event: NotificationEvent): Promise<void> {
    console.log(formatMessage(event));
  }
}

export class WebhookNotifier implements Notifier {
  constructor(
    private readonly url: string,
    private readonly platform: "slack" | "discord",
  ) {}

  async send(event: NotificationEvent): Promise<void> {
    const message = formatMessage(event);
    const body = this.platform === "slack" ? { text: message } : { content: message };
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`${this.platform} 웹훅 전송 실패: HTTP ${response.status}`);
    }
  }
}

export function createNotifiers(environment = process.env): Notifier[] {
  const notifiers: Notifier[] = [];
  if (environment.SLACK_WEBHOOK_URL) {
    notifiers.push(new WebhookNotifier(environment.SLACK_WEBHOOK_URL, "slack"));
  }
  if (environment.DISCORD_WEBHOOK_URL) {
    notifiers.push(
      new WebhookNotifier(environment.DISCORD_WEBHOOK_URL, "discord"),
    );
  }
  return notifiers.length > 0 ? notifiers : [new ConsoleNotifier()];
}

export async function notifyAll(
  notifiers: Notifier[],
  event: NotificationEvent,
): Promise<void> {
  await Promise.all(notifiers.map((notifier) => notifier.send(event)));
}

export function formatMessage(event: NotificationEvent): string {
  const release = event.release;
  return [
    `[Play Review Ping] ${titles[event.kind]}`,
    `${release.packageName} · ${release.track} · versionCode ${release.versionCode}`,
    `${release.releaseName}`,
    `${shortState(event.previous)} → ${shortState(release.state)}`,
  ].join("\n");
}

function shortState(state: LifecycleState): string {
  return state.replace("RELEASE_LIFECYCLE_STATE_", "");
}
