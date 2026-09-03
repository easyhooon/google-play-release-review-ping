# 아키텍처와 결정

## 데이터 흐름

```text
watch.config.json
       |
       v
GooglePlayClient ----> applications/{package}/tracks/{track}/releases
       |
       v
observeLifecycle(previous, current)
       |
       +---- 변화 없음 / 최초 기준점 ----> 상태만 저장
       |
       +---- internal 새 versionCode ---> 배포 알림
       |
       +---- 알림 대상 전환 ----------> 앱별 채널 선택
                                         |
                                         v
                              Slack / Discord / Teams / Console
                                         |
                                         v
                                  성공 후 상태 저장
```

## 앱별 알림 라우팅

각 앱은 `slackWebhookEnv`, `discordWebhookEnv`와 `teamsWebhookEnv`로 알림 채널을 지정할 수 있다. 설정값에는 URL이 아니라 URL이 저장된 환경 변수 이름을 사용한다.

앱별 채널이 하나라도 설정되면 해당 앱은 지정 채널만 사용한다. 앱별 채널이 없으면 전역 웹훅을 사용하며, 전역 웹훅도 없으면 콘솔에 출력한다.

## 상태 키

`packageName + track + versionCode`를 하나의 감시 단위로 사용한다. 같은 릴리스가 API 응답에 반복해서 포함되어도 마지막 상태와 같으면 알림을 만들지 않는다.

## 첫 관측 정책

프로세스가 처음 시작될 때 API가 이미 오래된 `PUBLISHED` 릴리스를 반환할 수 있다. 기존 릴리스마다 게시 알림을 쏟아내지 않도록 트랙의 첫 관측은 기준점으로만 저장한다.

기준점이 생긴 뒤 `internal` 트랙에서 처음 보는 `versionCode`가 `PUBLISHED` 상태로 나타나면 내부 테스트 배포 알림을 한 번 보낸다. 알림에는 API가 제공하는 릴리스 이름과 버전코드를 포함하며 출시 노트는 포함하지 않는다.

## 승인 상태를 건너뛰는 경우

Managed publishing을 사용하지 않으면 폴링 사이에 `APPROVED_NOT_PUBLISHED`가 보이지 않고 `IN_REVIEW`에서 `PUBLISHED`로 바로 바뀔 수 있다. 이 전이도 정상 완료로 간주해 게시 알림을 만든다.

승인 완료와 실제 게시를 분리해 알림받으려면 Play Console에서 Managed publishing을 켜야 한다.

## 실패 처리

웹훅 전송이 실패하면 해당 관측 상태를 저장하지 않고 실행을 실패시킨다. 다음 폴링에서 같은 전환을 다시 시도할 수 있다.

여러 웹훅 중 일부만 성공한 뒤 나머지가 실패하면 성공한 채널에 다음 폴링에서 중복 전송될 수 있다. 채널별 전달 상태 저장은 MVP 이후 과제다.

## 프로토타입에서 채택한 결정

상태 모델은 [`prototype/state-machine`](https://github.com/easyhooon/play-review-ping/tree/prototype/state-machine) 브랜치에서 터미널로 검증했다. 검증 질문과 결과는 [GitHub Issue #1](https://github.com/easyhooon/play-review-ping/issues/1)에 남겼다.

- 첫 관측은 기준점으로만 저장한다.
- 같은 상태 반복 관측은 알림을 만들지 않는다.
- `IN_REVIEW -> PUBLISHED` 직행은 게시 알림을 만든다.
- 승인 대기와 게시 완료를 모두 관측하면 각각 알린다.
