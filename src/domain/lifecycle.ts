export const lifecycleStates = [
  "RELEASE_LIFECYCLE_STATE_UNSPECIFIED",
  "RELEASE_LIFECYCLE_STATE_DRAFT",
  "RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW",
  "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
  "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED",
  "RELEASE_LIFECYCLE_STATE_NOT_APPROVED",
  "RELEASE_LIFECYCLE_STATE_PUBLISHED",
] as const;

export type LifecycleState = (typeof lifecycleStates)[number];

export type NotificationKind =
  | "action-required"
  | "approved"
  | "rejected"
  | "published";

export interface LifecycleDecision {
  previous: LifecycleState | null;
  current: LifecycleState;
  notification: NotificationKind | null;
}

const lifecycleStateSet = new Set<string>(lifecycleStates);

const notifications: Partial<Record<LifecycleState, NotificationKind>> = {
  RELEASE_LIFECYCLE_STATE_NOT_SENT_FOR_REVIEW: "action-required",
  RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED: "approved",
  RELEASE_LIFECYCLE_STATE_NOT_APPROVED: "rejected",
  RELEASE_LIFECYCLE_STATE_PUBLISHED: "published",
};

export function isLifecycleState(value: unknown): value is LifecycleState {
  return typeof value === "string" && lifecycleStateSet.has(value);
}

export function observeLifecycle(
  previous: LifecycleState | null,
  current: LifecycleState,
): LifecycleDecision {
  if (previous === null || previous === current) {
    return { previous, current, notification: null };
  }

  return {
    previous,
    current,
    notification: notifications[current] ?? null,
  };
}
