import type {
  LifecycleState,
  NotificationKind,
} from "./domain/lifecycle.js";
import type { AppConfig } from "./config.js";
import type { ReleaseObservation } from "./google-play.js";

export interface NotificationEvent {
  kind: NotificationKind;
  previous: LifecycleState | null;
  release: ReleaseObservation;
}

export interface Notifier {
  send(event: NotificationEvent): Promise<void>;
}

export type NotifierResolver = (packageName: string) => Notifier[];

type WebhookPlatform = "slack" | "discord" | "teams";
type WebhookFetch = (
  url: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number }>;

const titles: Record<NotificationKind, string> = {
  "internal-deployed": "🧪 Internal Testing 새 버전 배포",
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
    private readonly platform: WebhookPlatform,
    private readonly fetcher: WebhookFetch = fetch,
  ) {}

  async send(event: NotificationEvent): Promise<void> {
    const message = formatMessage(event);
    const response = await this.fetcher(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(webhookBody(this.platform, message)),
    });

    if (!response.ok) {
      throw new Error(`${this.platform} 웹훅 전송 실패: HTTP ${response.status}`);
    }
  }
}

export function createNotifiers(
  environment = process.env,
  fetcher: WebhookFetch = fetch,
): Notifier[] {
  const notifiers: Notifier[] = [];
  if (environment.SLACK_WEBHOOK_URL) {
    notifiers.push(
      new WebhookNotifier(environment.SLACK_WEBHOOK_URL, "slack", fetcher),
    );
  }
  if (environment.DISCORD_WEBHOOK_URL) {
    notifiers.push(
      new WebhookNotifier(environment.DISCORD_WEBHOOK_URL, "discord", fetcher),
    );
  }
  if (environment.TEAMS_WEBHOOK_URL) {
    notifiers.push(
      new WebhookNotifier(environment.TEAMS_WEBHOOK_URL, "teams", fetcher),
    );
  }
  return notifiers.length > 0 ? notifiers : [new ConsoleNotifier()];
}

export function createNotifierResolver(
  apps: AppConfig[],
  environment = process.env,
  fetcher: WebhookFetch = fetch,
): NotifierResolver {
  const defaultNotifiers = createNotifiers(environment, fetcher);
  const notifiersByPackage = new Map(
    apps.map((app) => [
      app.packageName,
      createAppNotifiers(app, environment, fetcher, defaultNotifiers),
    ]),
  );

  return (packageName) => notifiersByPackage.get(packageName) ?? defaultNotifiers;
}

export async function notifyAll(
  notifiers: Notifier[],
  event: NotificationEvent,
): Promise<void> {
  await Promise.all(notifiers.map((notifier) => notifier.send(event)));
}

export function formatMessage(event: NotificationEvent): string {
  const release = event.release;
  const lines = [
    `[Google Play Release Review Ping] ${titles[event.kind]}`,
    `${release.packageName} · ${release.track}`,
    `버전 ${release.releaseName} (${release.versionCode})`,
  ];
  if (event.previous) {
    lines.push(`${shortState(event.previous)} → ${shortState(release.state)}`);
  }
  return lines.join("\n");
}

function createAppNotifiers(
  app: AppConfig,
  environment: NodeJS.ProcessEnv,
  fetcher: WebhookFetch,
  defaultNotifiers: Notifier[],
): Notifier[] {
  const routes = [
    [app.slackWebhookEnv, "slack"],
    [app.discordWebhookEnv, "discord"],
    [app.teamsWebhookEnv, "teams"],
  ] as const;
  const configuredRoutes = routes.filter(
    (route): route is readonly [string, WebhookPlatform] => Boolean(route[0]),
  );
  if (configuredRoutes.length === 0) return defaultNotifiers;

  return configuredRoutes.map(([environmentName, platform]) => {
    const url = environment[environmentName];
    if (!url) {
      throw new Error(
        `${app.packageName} 알림 환경 변수 ${environmentName}가 필요합니다.`,
      );
    }
    return new WebhookNotifier(url, platform, fetcher);
  });
}

function webhookBody(platform: WebhookPlatform, message: string): unknown {
  if (platform === "slack") return { text: message };
  if (platform === "discord") return { content: message };

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.2",
          body: [{ type: "TextBlock", text: message, wrap: true }],
        },
      },
    ],
  };
}

function shortState(state: LifecycleState): string {
  return state.replace("RELEASE_LIFECYCLE_STATE_", "");
}
