import readline from "node:readline";
import {
  observeLifecycle,
  type LifecycleState,
  type ObservationResult,
} from "./lifecycle.js";

const bold = "\u001b[1m";
const dim = "\u001b[2m";
const reset = "\u001b[0m";

const keys: Record<string, LifecycleState> = {
  n: "NOT_SENT_FOR_REVIEW",
  i: "IN_REVIEW",
  a: "APPROVED_NOT_PUBLISHED",
  r: "NOT_APPROVED",
  p: "PUBLISHED",
};

let current: LifecycleState | null = null;
let lastResult: ObservationResult | null = null;
let notificationCount = 0;

function render(): void {
  console.clear();
  console.log(`${bold}Play Review Ping — 상태 모델 프로토타입${reset}`);
  console.log(`${dim}PROTOTYPE: 메모리에서만 동작하며 제품 코드가 아닙니다.${reset}\n`);
  console.log(`${bold}release${reset}`);
  console.log(`  package:       com.example.app`);
  console.log(`  track:         production`);
  console.log(`  versionCode:   240`);
  console.log(`  currentState:  ${current ?? "(아직 관측 안 됨)"}`);
  console.log(`  notifications: ${notificationCount}`);

  console.log(`\n${bold}마지막 관측 결과${reset}`);
  if (lastResult) {
    console.log(`  previous:      ${lastResult.previous ?? "null"}`);
    console.log(`  current:       ${lastResult.current}`);
    console.log(`  notification:  ${lastResult.notification ?? "없음"}`);
    console.log(`  reason:        ${lastResult.reason}`);
  } else {
    console.log(`  ${dim}아래 키로 첫 API 관측을 입력하세요.${reset}`);
  }

  console.log(`\n${bold}관측 상태 입력${reset}`);
  console.log(
    `[n] 미전송  [i] 심사 중  [a] 승인/게시 대기  [r] 거절  [p] 게시됨`,
  );
  console.log(`[x] 초기화  [q] 종료`);
}

function applyObservation(next: LifecycleState): void {
  lastResult = observeLifecycle(current, next);
  current = next;
  if (lastResult.notification) notificationCount += 1;
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);

process.stdin.on("keypress", (_input, key) => {
  if (key?.ctrl && key.name === "c") process.exit(0);
  if (key?.name === "q") process.exit(0);
  if (key?.name === "x") {
    current = null;
    lastResult = null;
    notificationCount = 0;
  } else if (key?.name && keys[key.name]) {
    applyObservation(keys[key.name]);
  }
  render();
});

render();
