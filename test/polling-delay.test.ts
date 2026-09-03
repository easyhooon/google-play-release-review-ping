import assert from "node:assert/strict";
import test from "node:test";
import { nextPollDelaySeconds } from "../src/polling-delay.js";

test("성공 후에는 설정한 폴링 주기를 사용한다", () => {
  assert.equal(nextPollDelaySeconds(900, 0), 900);
});

test("연속 실패하면 한 시간까지 재시도 간격을 늘린다", () => {
  assert.equal(nextPollDelaySeconds(900, 1), 1_800);
  assert.equal(nextPollDelaySeconds(900, 2), 3_600);
  assert.equal(nextPollDelaySeconds(900, 10), 3_600);
});

test("설정한 주기가 한 시간보다 길면 실패 후 주기를 줄이지 않는다", () => {
  assert.equal(nextPollDelaySeconds(7_200, 1), 7_200);
});
