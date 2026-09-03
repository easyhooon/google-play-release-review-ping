# MVP 범위

## 해결하려는 문제

Google Play 심사가 끝났는데 이메일이나 모바일 알림을 놓쳐 Play Console을 반복해서 확인해야 하는 문제를 해결한다.

## 1차 성공 기준

1. 여러 패키지와 트랙을 설정할 수 있다.
2. Google Play Developer API에서 릴리스 생명주기 상태를 주기적으로 읽는다.
3. `packageName + track + versionCode`별 이전 상태를 저장한다.
4. 승인 대기, 거절, 게시 완료, 심사 미전송 전환을 중복 없이 알린다.
5. Slack과 Discord 웹훅 중 하나 이상으로 메시지를 보낼 수 있다.
6. 실제 Google 자격증명 없이 상태 전환을 검증할 수 있는 dry-run을 제공한다.

## MVP에서 제외

- Play Console 웹 화면 스크래핑
- 스토어 등록정보만 변경한 제출 묶음 감시
- 이메일 발송
- 웹 대시보드
- 알리미에서 직접 게시 실행

## 검증할 상태 모델

심사 상태 조회 결과가 다음과 같이 움직일 때 어떤 알림을 보내야 하는지 먼저 터미널 프로토타입으로 확인한다.

```text
NOT_SENT_FOR_REVIEW -> IN_REVIEW -> APPROVED_NOT_PUBLISHED -> PUBLISHED
                               \-> NOT_APPROVED
                               \-> PUBLISHED
```

핵심 질문은 `IN_REVIEW -> PUBLISHED`처럼 중간 승인 상태를 관측하지 못해도 사용자에게 의미 있는 완료 알림을 정확히 한 번 보낼 수 있는가이다.
