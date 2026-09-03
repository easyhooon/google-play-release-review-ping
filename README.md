# Play Review Ping

Google Play 앱 릴리스의 심사 상태를 감시하고 팀 채널로 알려주는 작은 알리미입니다.

Google Play Developer API의 `releaseLifecycleState`를 사용해 다음 전환을 감지합니다.

- 심사 미전송
- 심사 중
- 승인 완료, 게시 대기
- 심사 거절
- 게시 완료

## 현재 상태

MVP 구현 중입니다. 설계 범위와 검증 기준은 [`docs/MVP.md`](docs/MVP.md)를 참고하세요.

## 원칙

- Play Console 화면을 스크래핑하지 않습니다.
- 서비스 계정에는 대상 앱의 최소 읽기 권한만 부여합니다.
- 상태가 실제로 바뀌었을 때만 한 번 알립니다.
- 자격증명과 웹훅 URL은 저장소에 커밋하지 않습니다.

## License

MIT
