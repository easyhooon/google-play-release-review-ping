# Google Play API 할당량 초과에 대응하기

이 문서는 폴링 워커의 요청량을 계산하고, `Listing releases quota exceeded` 오류가 발생했을 때 워커를 복구하는 절차를 설명합니다. Google Cloud 콘솔에 표시되는 프로젝트별 한도를 최종 기준으로 사용합니다.

## 공개된 할당량

Google Play Developer API는 API를 여러 할당량 버킷으로 나눕니다. 이 워커가 호출하는 `applications.tracks.releases.list`는 Publishing API이므로 `Publishing, Monetization, and Reply to Reviews APIs` 버킷을 사용합니다.

Google이 공개한 기본 한도는 버킷당 분당 3,000회입니다. 이 값은 기본값이며 프로젝트의 실제 한도, 관리자 오버라이드, Google이 별도로 적용하는 시스템 제한과 다를 수 있습니다.

할당량은 Google Cloud 프로젝트 단위로 계산됩니다. 같은 프로젝트의 지속적 통합(CI), Gradle Play Publisher, 배포 스크립트와 다른 워커가 호출한 Publishing API 요청도 같은 버킷을 함께 사용합니다.

## 사용량 계산하기

현재 워커는 한 주기마다 앱과 트랙의 모든 조합을 한 번씩 조회합니다. 예상 요청량은 다음 식으로 계산합니다:

```text
주기당 요청 수 = 앱 수 × 앱별 트랙 수
분당 평균 요청 수 = 주기당 요청 수 × 60 ÷ pollIntervalSeconds
```

앱 한 개에서 `internal`과 `production`을 조회하면 다음 요청량이 발생합니다:

| 폴링 주기 | 시간당 요청 | 하루 요청 | 용도 |
|---|---:|---:|---|
| 180초 | 40회 | 960회 | 짧은 연동 테스트 |
| 900초 | 8회 | 192회 | 권장 운영값 |
| 1,800초 | 4회 | 96회 | 보수적인 운영값 |

워커가 두 개 실행되면 요청량도 두 배가 됩니다. 운영 환경에서는 같은 설정을 사용하는 워커를 한 개만 실행합니다.

## 할당량은 언제 초기화되는가

공개된 Publishing 버킷 한도는 분당 속도 할당량입니다. Google Cloud는 분당 할당량을 자동으로 복구하며, 일반적인 롤링 윈도에서는 첫 요청으로부터 1분 뒤 해당 구간이 초기화됩니다.

사용한 할당량을 콘솔에서 수동으로 지우는 기능은 없습니다. 콘솔의 **Reset value**는 사용량을 초기화하지 않고 관리자가 설정한 할당량 오버라이드를 기본값으로 되돌립니다.

현재 Google Play Developer API 문서는 Publishing 버킷의 일일 한도를 공개하지 않습니다. 따라서 이 오류가 발생했을 때 자정까지 기다려야 한다고 가정하지 않습니다. 1분 후에도 오류가 계속되면 Google Cloud 콘솔의 실제 프로젝트 한도와 다른 호출 주체를 확인합니다.

## Google Cloud 콘솔에서 실제값 확인하기

프로젝트의 실제 한도는 Google Cloud 콘솔에서 확인합니다:

1. 워커 자격증명이 속한 Google Cloud 프로젝트를 선택합니다.
2. **IAM & Admin > Quotas & System Limits**를 엽니다.
3. 서비스를 Google Play Android Developer API로 필터링합니다.
4. `androidpublisher.googleapis.com`의 Publishing 관련 분당 한도와 현재 사용량을 확인합니다.
5. 오버라이드가 있으면 기본값과 설정값을 비교합니다.

콘솔의 값이 공개 기본값과 다르면 콘솔 값을 따릅니다. 한도를 늘려야 하면 같은 화면에서 할당량 조정을 요청할 수 있지만, 승인 여부와 적용 시점은 Google이 결정합니다.

## 403 오류에서 복구하기

워커는 조회에 실패하면 재시도 간격을 두 배로 늘립니다. 운영 주기가 900초라면 첫 실패 후 1,800초, 두 번째 연속 실패 후 3,600초를 기다리며 이후에는 3,600초를 유지합니다.

403 오류가 반복되면 다음 순서로 복구합니다:

1. 실행 중인 워커에서 `Ctrl+C`를 눌러 재시도를 중지합니다.
2. 마지막 요청 후 최소 60초 동안 추가 요청을 보내지 않습니다.
3. `pnpm once`를 한 번 실행합니다.
4. 성공하면 `pollIntervalSeconds`가 900 이상인지 확인하고 `pnpm watch`를 다시 시작합니다.
5. 같은 403 오류가 계속되면 반복 실행을 중지하고 Google Cloud 콘솔을 확인합니다.

오류가 지속되면 다음 항목을 확인합니다:

- 같은 랩탑, 홈서버, CI에서 중복 워커가 실행 중인지 확인
- 같은 Google Cloud 프로젝트를 사용하는 배포 작업이 실행 중인지 확인
- Google Cloud 콘솔에서 Google Play Android Developer API의 현재 사용량과 한도 확인
- 프로젝트에 낮은 오버라이드가 설정되어 있는지 확인
- 확인된 요청량이 한도보다 낮은데 오류가 반복되면 할당량 조정 요청 또는 Google 지원 문의

Google Cloud 콘솔의 분당 현재 사용량은 최근 10분 평균으로 표시될 수 있습니다. 짧은 요청 급증은 그래프에서 완화되어 보일 수 있으므로 워커 로그와 함께 판단합니다.

## 이번에 관측한 사례

2026년 9월 3일, 앱 한 개의 `internal`과 `production` 트랙을 180초 간격으로 조회하던 워커에서 다음 오류를 확인했습니다:

```text
403 Listing releases quota exceeded
```

이 설정이 만드는 평균 요청량은 분당 약 0.67회로 공개 기본값보다 낮습니다. 공개된 분당 한도만으로 원인을 확정할 수 없으므로 워커를 중지했으며, 중복 실행과 프로젝트별 실제 한도를 먼저 확인해야 합니다.

## 운영 권장값

연동을 확인할 때만 180초 주기를 짧게 사용합니다. 상시 운영에서는 `pollIntervalSeconds`를 900으로 설정하고, 더 느린 알림을 허용할 수 있으면 1,800초를 사용합니다.

```json
{
  "pollIntervalSeconds": 900
}
```

심사 상태는 수초 단위 응답이 필요하지 않습니다. 15분 주기는 앱 한 개와 트랙 두 개를 기준으로 하루 요청량을 192회까지 줄입니다.

## 공식 문서

- [Google Play Developer API 할당량](https://developers.google.com/android-publisher/quotas)
- [`applications.tracks.releases.list` 명세](https://developers.google.com/android-publisher/api-ref/rest/v3/applications.tracks.releases/list)
- [Google Cloud 할당량 개요](https://cloud.google.com/docs/quotas/overview)
- [Google Cloud에서 할당량 확인 및 관리](https://cloud.google.com/docs/quotas/view-manage)
