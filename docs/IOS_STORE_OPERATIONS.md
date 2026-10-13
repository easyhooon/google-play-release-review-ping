# iOS App Store 심사 상태 알림

`ios:watch`는 App Store Connect의 `GET /v1/apps/{id}/appStoreVersions`를 15분마다 읽고, iOS 버전 리소스의 `appStoreState` 변화를 Discord에 알립니다. 별도 상태 파일을 사용하므로 Google Play 릴리스 감시와 App Store 고객 리뷰 감시에 영향을 주지 않습니다. Apple의 Xcode Cloud 웹훅은 App Store 버전 심사 상태 이벤트를 제공하는 것으로 확인되지 않아 이 조회 방식을 사용합니다.

## 설정

- `IOS_STORE_REVIEW_PING_CONFIG`: `ios-store.config.example.json` 형식의 운영 설정 파일 경로
- `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_PATH`: 기존 App Store Connect **팀 키**
- 설정 파일의 `discordWebhookEnv`: 스토어 심사 Discord 웹훅이 저장된 환경 변수 이름

`node --import tsx src/ios-store-cli.ts once`는 한 번 조회합니다. 상태 파일이 없으면 현재 버전 전체를 기준점으로 저장하고 알림은 보내지 않습니다. 이후 버전 ID별 상태가 바뀌면 전송 후 상태를 저장합니다. 같은 상태는 다시 보내지 않으며, 전송 실패 시 해당 상태는 저장하지 않아 다음 조회에서 재시도합니다. 새 버전이 처음 관측될 때 이미 심사 대기 이상의 상태라면 알리고, 제출 전 상태라면 기준점만 기록합니다. 연속 조회 실패 시 간격은 최대 한 시간까지 늘어납니다.

운영 상태 파일을 지우면 다음 실행에서 현재 상태를 다시 기준점으로 잡아 진행 중인 전환을 놓칠 수 있습니다. 상태 파일과 Apple 키 경로, 웹훅 URL은 저장소에 커밋하지 마세요.

Apple API: [버전 목록](https://developer.apple.com/documentation/appstoreconnectapi/get-v1-apps-_id_-appstoreversions), [버전 리소스](https://developer.apple.com/documentation/appstoreconnectapi/appstoreversion).
