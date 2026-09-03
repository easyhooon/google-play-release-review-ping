import assert from "node:assert/strict";
import test from "node:test";
import {
  createNotifierResolver,
  formatMessage,
  notifyAll,
  type NotificationEvent,
} from "../src/notifier.js";

interface CapturedRequest {
  url: string;
  body: unknown;
}

test("앱별 채널을 분리하고 설정이 없는 앱은 전역 채널로 전송한다", async () => {
  const requests: CapturedRequest[] = [];
  const fetcher = async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) as unknown });
    return { ok: true, status: 200 };
  };
  const resolveNotifiers = createNotifierResolver(
    [
      {
        packageName: "com.example.personal",
        tracks: ["production"],
        discordWebhookEnv: "DISCORD_PERSONAL",
      },
      {
        packageName: "com.example.company",
        tracks: ["production"],
        teamsWebhookEnv: "TEAMS_COMPANY",
      },
      {
        packageName: "com.example.legacy",
        tracks: ["production"],
      },
    ],
    {
      DISCORD_WEBHOOK_URL: "https://discord.example/global",
      DISCORD_PERSONAL: "https://discord.example/webhook",
      TEAMS_COMPANY: "https://teams.example/webhook",
    },
    fetcher,
  );

  await notifyAll(
    resolveNotifiers("com.example.personal"),
    notificationEvent("com.example.personal"),
  );
  await notifyAll(
    resolveNotifiers("com.example.company"),
    notificationEvent("com.example.company"),
  );
  await notifyAll(
    resolveNotifiers("com.example.legacy"),
    notificationEvent("com.example.legacy"),
  );

  assert.equal(requests[0]?.url, "https://discord.example/webhook");
  assert.equal(
    typeof (requests[0]?.body as { content?: unknown }).content,
    "string",
  );
  assert.equal(requests[1]?.url, "https://teams.example/webhook");
  const teamsBody = requests[1]?.body as {
    type?: string;
    attachments?: Array<{ contentType?: string }>;
  };
  assert.equal(teamsBody.type, "message");
  assert.equal(
    teamsBody.attachments?.[0]?.contentType,
    "application/vnd.microsoft.card.adaptive",
  );
  assert.equal(requests[2]?.url, "https://discord.example/global");
});

test("앱별 환경 변수가 없으면 시작할 때 오류를 반환한다", () => {
  assert.throws(
    () => createNotifierResolver(
      [
        {
          packageName: "com.example.company",
          tracks: ["production"],
          teamsWebhookEnv: "TEAMS_COMPANY",
        },
      ],
      {},
    ),
    /TEAMS_COMPANY가 필요합니다/,
  );
});

test("내부 테스트 배포 메시지에 버전명과 버전코드를 표시한다", () => {
  const message = formatMessage({
    kind: "internal-deployed",
    previous: null,
    release: {
      packageName: "com.example.app",
      track: "internal",
      releaseName: "1.2.3",
      versionCode: 123,
      state: "RELEASE_LIFECYCLE_STATE_PUBLISHED",
    },
  });

  assert.match(message, /Internal Testing 새 버전 배포/);
  assert.match(message, /버전 1\.2\.3 \(123\)/);
});

function notificationEvent(packageName: string): NotificationEvent {
  return {
    kind: "approved",
    previous: "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
    release: {
      packageName,
      track: "production",
      releaseName: "1.0.0",
      versionCode: 100,
      state: "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED",
    },
  };
}
