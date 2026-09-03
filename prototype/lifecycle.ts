export const lifecycleStates = [
  "NOT_SENT_FOR_REVIEW",
  "IN_REVIEW",
  "APPROVED_NOT_PUBLISHED",
  "NOT_APPROVED",
  "PUBLISHED",
] as const;

export type LifecycleState = (typeof lifecycleStates)[number];

export type NotificationKind =
  | "action-required"
  | "approved"
  | "rejected"
  | "published";

export interface ObservationResult {
  previous: LifecycleState | null;
  current: LifecycleState;
  notification: NotificationKind | null;
  reason: string;
}

const notifications: Partial<Record<LifecycleState, NotificationKind>> = {
  NOT_SENT_FOR_REVIEW: "action-required",
  APPROVED_NOT_PUBLISHED: "approved",
  NOT_APPROVED: "rejected",
  PUBLISHED: "published",
};

export function observeLifecycle(
  previous: LifecycleState | null,
  current: LifecycleState,
): ObservationResult {
  if (previous === null) {
    return {
      previous,
      current,
      notification: null,
      reason: "첫 관측은 오래된 릴리스 알림 폭주를 막기 위해 기준점으로만 저장",
    };
  }

  if (previous === current) {
    return {
      previous,
      current,
      notification: null,
      reason: "상태가 같으므로 중복 알림 억제",
    };
  }

  const notification = notifications[current] ?? null;
  return {
    previous,
    current,
    notification,
    reason: notification
      ? `${previous} -> ${current} 전환을 알림`
      : `${previous} -> ${current} 전환은 기록만 갱신`,
  };
}
