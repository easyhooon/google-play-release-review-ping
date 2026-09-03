# Play Review Ping

Google Play 앱 릴리스의 심사 상태를 감시하고 Slack 또는 Discord로 알려주는 작은 알리미입니다.

Play Console 화면을 긁지 않고 공식 Google Play Developer API의 `releaseLifecycleState`를 사용합니다.

```text
Google Play API ──> 상태 비교 ──> Slack / Discord
                         └──────> .data/state.json
```

## 감지하는 이벤트

| API 상태 | 알림 |
|---|---|
| `NOT_SENT_FOR_REVIEW` | 심사 전송 필요 |
| `IN_REVIEW` | 기록만 갱신 |
| `APPROVED_NOT_PUBLISHED` | 심사 승인 완료, 게시 대기 |
| `NOT_APPROVED` | 심사 거절 |
| `PUBLISHED` | 게시 완료 |

첫 실행에서는 현재 상태를 기준점으로만 저장합니다. 이후 같은 상태가 반복 조회되면 알리지 않고, 상태가 실제로 바뀌었을 때만 알립니다.

## 1분 체험

Google 계정 없이 상태 모델을 확인할 수 있습니다.

```bash
pnpm install
pnpm demo
```

예상 출력:

```text
첫 관측 -> IN_REVIEW | 알림 없음
IN_REVIEW -> IN_REVIEW | 알림 없음
IN_REVIEW -> APPROVED_NOT_PUBLISHED | approved
APPROVED_NOT_PUBLISHED -> PUBLISHED | published
```

## 설치

Node.js 22 이상과 pnpm이 필요합니다.

```bash
pnpm install
cp watch.config.example.json watch.config.json
cp .env.example .env
```

`watch.config.json`에 패키지명과 감시할 트랙을 적습니다.

```json
{
  "pollIntervalSeconds": 180,
  "stateFile": ".data/state.json",
  "apps": [
    {
      "packageName": "com.yourcompany.app",
      "tracks": ["production", "beta"]
    }
  ]
}
```

## Google Play API 준비

1. Google Cloud 프로젝트에서 Google Play Developer API를 활성화합니다.
2. 서비스 계정을 만듭니다.
3. Play Console의 **Users and permissions**에서 서비스 계정 이메일을 초대합니다.
4. 대상 앱의 비재무 정보 읽기 권한만 부여합니다.
5. 서비스 계정 JSON의 절대 경로를 `.env`의 `GOOGLE_APPLICATION_CREDENTIALS`에 적습니다.

서버에서 실행할 때는 JSON 파일 대신 Workload Identity 같은 키 없는 인증을 권장합니다. 자세한 기준은 [`docs/SECURITY.md`](docs/SECURITY.md)를 참고하세요.

## 알림 채널

`.env`에 하나 이상 설정합니다. 둘 다 있으면 두 채널로 전송합니다.

```dotenv
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

아무것도 설정하지 않으면 콘솔에 메시지를 출력합니다.

## 실행

한 번만 조회:

```bash
pnpm once
```

설정한 간격으로 계속 감시:

```bash
pnpm watch
```

다른 설정 파일은 환경 변수로 지정할 수 있습니다.

```bash
PLAY_REVIEW_PING_CONFIG=/path/to/team.config.json pnpm watch
```

상태 파일을 유지할 수 있는 VM, NAS 또는 작은 서버에서 장기 프로세스로 실행하는 것이 현재 MVP에 가장 단순합니다.

## 검증

```bash
pnpm check
```

## 현재 한계

- 트랙의 AAB/APK 릴리스 상태만 감시합니다. 스토어 등록정보만 바꾼 제출 전체의 상태는 공개 API로 완전히 조회할 수 없습니다.
- Google은 릴리스 심사 웹훅을 제공하지 않으므로 폴링합니다.
- 상태 저장은 로컬 JSON 파일입니다. Cloud Run처럼 파일이 영속적이지 않은 환경에는 아직 바로 배포할 수 없습니다.
- 웹훅 채널별 재시도와 이메일은 다음 버전 범위입니다.

구체적인 범위는 [`docs/MVP.md`](docs/MVP.md), 구조와 결정은 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)에서 확인할 수 있습니다.

## License

MIT
