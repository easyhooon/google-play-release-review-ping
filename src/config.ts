import { readFile } from "node:fs/promises";

export interface AppConfig {
  packageName: string;
  tracks: string[];
}

export interface Config {
  pollIntervalSeconds: number;
  stateFile: string;
  apps: AppConfig[];
}

interface RawConfig {
  pollIntervalSeconds?: unknown;
  stateFile?: unknown;
  apps?: unknown;
}

export async function loadConfig(path: string): Promise<Config> {
  const raw = JSON.parse(await readFile(path, "utf8")) as RawConfig;

  if (!Array.isArray(raw.apps) || raw.apps.length === 0) {
    throw new Error("설정 파일의 apps에는 앱이 하나 이상 필요합니다.");
  }

  const apps = raw.apps.map((value, index) => parseApp(value, index));
  const pollIntervalSeconds = raw.pollIntervalSeconds ?? 180;
  const stateFile = raw.stateFile ?? ".data/state.json";

  if (
    typeof pollIntervalSeconds !== "number" ||
    !Number.isInteger(pollIntervalSeconds) ||
    pollIntervalSeconds < 30
  ) {
    throw new Error("pollIntervalSeconds는 30 이상의 정수여야 합니다.");
  }
  if (typeof stateFile !== "string" || stateFile.trim() === "") {
    throw new Error("stateFile은 비어 있지 않은 문자열이어야 합니다.");
  }

  return { pollIntervalSeconds, stateFile, apps };
}

function parseApp(value: unknown, index: number): AppConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`apps[${index}]가 객체가 아닙니다.`);
  }

  const app = value as Record<string, unknown>;
  if (typeof app.packageName !== "string" || app.packageName.trim() === "") {
    throw new Error(`apps[${index}].packageName이 필요합니다.`);
  }
  if (
    !Array.isArray(app.tracks) ||
    app.tracks.length === 0 ||
    !app.tracks.every((track) => typeof track === "string" && track.length > 0)
  ) {
    throw new Error(`apps[${index}].tracks에는 트랙이 하나 이상 필요합니다.`);
  }

  return {
    packageName: app.packageName,
    tracks: [...new Set(app.tracks as string[])],
  };
}
