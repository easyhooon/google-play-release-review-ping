# 보안 기준

## 최소 권한

서비스 계정은 Play Console에서 감시 대상 앱에만 초대하고, 비재무 정보 읽기 권한처럼 조회에 필요한 최소 권한만 부여한다. 릴리스 게시, 결제, 주문 관리 권한은 이 알리미에 필요하지 않다.

## 자격증명

- 서비스 계정 JSON, `.env`, 실제 `watch.config.json`은 Git에 커밋하지 않는다.
- 로컬에서는 `GOOGLE_APPLICATION_CREDENTIALS`에 저장소 밖 JSON 파일의 절대 경로를 지정한다.
- 서버에서는 가능하면 Workload Identity나 런타임 서비스 계정을 사용해 장기 JSON 키를 만들지 않는다.
- Slack, Discord와 Teams 웹훅 URL은 비밀번호처럼 취급하고 Secret Manager 또는 실행 환경의 secret에 저장한다.
- `watch.config.json`에는 웹훅 URL 대신 URL이 저장된 환경 변수 이름만 기록한다.

## 상태 파일

`.data/state.json`에는 패키지명, 트랙, versionCode, 릴리스명과 마지막 관측 상태가 저장된다. 자격증명은 저장하지 않으며 파일 권한은 소유자만 읽고 쓸 수 있도록 생성한다.

## 로그

웹훅 URL과 Google 토큰은 출력하지 않는다. 오류 메시지에 외부 응답 본문을 그대로 포함하지 않아 비밀이나 내부 정보가 로그로 흘러가는 범위를 줄인다.
