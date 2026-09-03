# PROTOTYPE — 상태 전이 검증

> 이 디렉터리는 아이디어 검증용이며 제품 코드로 배포하지 않는다.

## 질문

Google Play API에서 같은 릴리스가 반복 조회되거나 승인 대기 상태를 건너뛰고 곧바로 게시 상태가 관측될 때, 알림 상태 모델이 중복 없이 의미 있는 알림을 정확히 한 번 만들 수 있는가?

프로토타입은 상태를 메모리에만 저장한다. 첫 관측은 기준점으로만 기록하고, 그 뒤 `NOT_SENT_FOR_REVIEW`, `APPROVED_NOT_PUBLISHED`, `NOT_APPROVED`, `PUBLISHED`로 상태가 바뀔 때만 알림 이벤트를 만든다.

## 실행

```bash
pnpm install
pnpm prototype
```

화면 아래의 키를 눌러 API 관측 상태를 바꿔볼 수 있다. 같은 키를 여러 번 눌러도 알림 수가 늘지 않는지, `IN_REVIEW`에서 곧바로 `PUBLISHED`로 이동해도 게시 알림이 생기는지 확인한다.
