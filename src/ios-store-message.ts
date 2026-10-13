export interface AppStoreVersionSummary {
  id: string;
  version: string;
  state: string;
}

const stateNames: Record<string, string> = {
  WAITING_FOR_REVIEW: "심사 대기",
  IN_REVIEW: "심사 중",
  PENDING_DEVELOPER_RELEASE: "심사 승인, 수동 게시 대기",
  PENDING_APPLE_RELEASE: "심사 승인, Apple 게시 대기",
  READY_FOR_DISTRIBUTION: "배포 준비 완료",
  READY_FOR_SALE: "배포 준비 완료",
  REJECTED: "심사 거절",
  METADATA_REJECTED: "메타데이터 거절",
  DEVELOPER_REJECTED: "개발자 거절",
};

export function formatIosStoreMessage(
  appName: string, version: AppStoreVersionSummary, previous: string | null,
): string {
  const label = (state: string) => stateNames[state] ?? state;
  return [
    `[App Store Release Review Ping] ${appName} iOS 심사 상태 변경`,
    `버전 ${version.version}`,
    `${previous ? label(previous) : "새 버전 첫 관측"} → ${label(version.state)}`,
  ].join("\n");
}
