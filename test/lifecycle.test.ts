import assert from "node:assert/strict";
import test from "node:test";
import { observeLifecycle } from "../src/domain/lifecycle.js";

test("첫 관측은 기준점으로만 기록한다", () => {
  const result = observeLifecycle(
    null,
    "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED",
  );
  assert.equal(result.notification, null);
});

test("같은 상태 반복 관측은 중복 알림을 만들지 않는다", () => {
  const result = observeLifecycle(
    "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
    "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
  );
  assert.equal(result.notification, null);
});

test("승인 대기 상태로 바뀌면 승인 알림을 만든다", () => {
  const result = observeLifecycle(
    "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
    "RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED",
  );
  assert.equal(result.notification, "approved");
});

test("승인 대기를 관측하지 못하고 게시 상태로 바뀌어도 게시 알림을 만든다", () => {
  const result = observeLifecycle(
    "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
    "RELEASE_LIFECYCLE_STATE_PUBLISHED",
  );
  assert.equal(result.notification, "published");
});

test("거절 상태로 바뀌면 거절 알림을 만든다", () => {
  const result = observeLifecycle(
    "RELEASE_LIFECYCLE_STATE_IN_REVIEW",
    "RELEASE_LIFECYCLE_STATE_NOT_APPROVED",
  );
  assert.equal(result.notification, "rejected");
});
