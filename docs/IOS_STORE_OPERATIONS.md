# iOS App Store 심사 상태 알림

`ios:watch`는 App Store Connect의 `GET /v1/apps/{id}/appStoreVersions`를 15분마다 읽고, iOS 버전 리소스의 `appStoreState` 변화를 Discord에 알립니다. 별도 상태 파일을 사용하므로 Google Play 릴리스 감시와 App Store 고객 리뷰 감시에 영향을 주지 않습니다. 이 조회는 이벤트 수신용 서버가 없는 현재 환경의 임시 운영 방식입니다.

## 설정

- `IOS_STORE_REVIEW_PING_CONFIG`: `ios-store.config.example.json` 형식의 운영 설정 파일 경로
- `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_PATH`: 기존 App Store Connect **팀 키**
- 설정 파일의 `discordWebhookEnv`: 스토어 심사 Discord 웹훅이 저장된 환경 변수 이름

`node --import tsx src/ios-store-cli.ts once`는 한 번 조회합니다. 상태 파일이 없으면 현재 버전 전체를 기준점으로 저장하고 알림은 보내지 않습니다. 이후 버전 ID별 상태가 바뀌면 전송 후 상태를 저장합니다. 같은 상태는 다시 보내지 않으며, 전송 실패 시 해당 상태는 저장하지 않아 다음 조회에서 재시도합니다. 새 버전이 처음 관측될 때 이미 심사 대기 이상의 상태라면 알리고, 제출 전 상태라면 기준점만 기록합니다. 연속 조회 실패 시 간격은 최대 한 시간까지 늘어납니다.

운영 상태 파일을 지우면 다음 실행에서 현재 상태를 다시 기준점으로 잡아 진행 중인 전환을 놓칠 수 있습니다. 상태 파일과 Apple 키 경로, 웹훅 URL은 저장소에 커밋하지 마세요.

Apple API: [버전 목록](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions), [버전 리소스](https://developer.apple.com/documentation/appstoreconnectapi/appstoreversion).

## 폴링 없는 이벤트 방식으로 전환

App Store Connect는 앱 상태 변경 이벤트 `APP_STORE_VERSION_APP_VERSION_STATE_UPDATED`를 지원합니다. 이벤트에는 `oldValue`, `newValue`, `timestamp`와 App Store 버전 ID가 포함됩니다. [Apple 웹훅 이벤트 문서](https://developer.apple.com/documentation/appstoreconnectapi/webhook-events)를 참고하세요.

`src/ios-webhook-worker.ts`는 Cloudflare Worker용 수신기입니다. 원문 본문의 HMAC-SHA256 서명을 검사하고, Apple API에서 앱 `6743101965`에 속한 iOS 버전 ID와 버전 문자열을 확인합니다. D1의 `webhook_events.id` 고유 키와 2분 처리 임대로 중복·동시 수신을 억제합니다. Discord 전송에는 `wait=true`를 사용하며, 전송 실패에는 HTTP 503을 반환하고 처리 임대를 해제합니다. Apple ping 등 다른 이벤트는 Discord로 전달하지 않습니다.

배포 준비 시 `wrangler.example.jsonc`를 `wrangler.jsonc`로 복사하고 새 D1 데이터베이스 ID를 넣은 뒤 `migrations/0001_webhook_events.sql`을 적용합니다. Worker에는 다음 **비밀 환경 변수**가 필요합니다. 값은 저장소에 넣지 말고 운영자가 배포 서비스에 직접 입력해야 합니다.

- `APPLE_WEBHOOK_SECRET`: 새로 만든 강한 공유 비밀값. Apple 웹훅 등록에도 동일한 값을 입력합니다.
- `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_PRIVATE_KEY`: 기존 App Store Connect 팀 키의 ID, Issuer ID, `.p8` 내용. Worker는 앱의 버전 ID를 안전하게 확인하고 버전 문자열을 표시하는 데 사용합니다.
- `DISCORD_WEBHOOK_URL`: 현재 `#스토어-심사` 채널의 기존 Discord 웹훅 URL.

Apple 웹훅은 앱 `6743101965`에 `APP_STORE_VERSION_APP_VERSION_STATE_UPDATED` 하나만 등록합니다. 등록 직후 Apple의 `POST /v1/webhookPings`로 수신·서명 검증을 확인할 수 있습니다. Ping은 Discord 메시지를 보내지 않습니다. 실제 Discord 전달은 향후 진짜 상태 전환 또는 별도 승인받은 테스트 이벤트로 확인해야 합니다. 그때까지 `ios:watch`를 실행한 채로 둡니다. Apple의 [전달 기록 API](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-webhooks-_id_-deliveries)와 Worker 로그·D1 전달 상태로 결과를 대조한 뒤에만 15분 폴러를 중단합니다. Android Google Play 조회 감시와 iOS 고객 후기 감시는 별도입니다.

Discord에서 성공 응답이 나온 직후 D1 기록에 실패하는 매우 드문 경우에는 재전송으로 중복 메시지가 생길 수 있습니다. 상태 전환 감시 자체가 실패하지 않도록 재시도를 우선합니다. Apple API, D1 또는 Discord 오류는 HTTP 503으로 드러나며, Apple 전달 기록에서 실패 이벤트를 찾아 재전달할 수 있습니다. [Apple 구성·검증 문서](https://developer.apple.com/documentation/appstoreconnectapi/configuring-webhook-notifications).

Google Play의 [릴리스 심사 상태 API](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list)는 조회 API입니다. 공개된 [Real-time Developer Notifications](https://developer.android.com/google/play/billing/rtdn-reference)는 구매·구독 이벤트용이므로 현재 Android 심사 감시는 조회 방식을 유지합니다.
