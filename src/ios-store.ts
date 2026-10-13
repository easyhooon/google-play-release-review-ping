import { sign } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { formatIosStoreMessage } from "./ios-store-message.js";

export { formatIosStoreMessage } from "./ios-store-message.js";

export interface IosStoreConfig {
  appStoreId: string;
  appName: string;
  pollIntervalSeconds: number;
  stateFile: string;
  discordWebhookEnv: string;
}

export interface AppStoreVersion {
  id: string;
  version: string;
  state: string;
}

interface VersionPage {
  data?: Array<{
    id?: string;
    attributes?: { platform?: string; versionString?: string; appStoreState?: string };
  }>;
  links?: { next?: string | null };
}

interface State {
  version: 1;
  initialized: boolean;
  versions: Record<string, { version: string; state: string }>;
}

export async function loadIosStoreConfig(path: string): Promise<IosStoreConfig> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  if (typeof raw.appStoreId !== "string" || !/^\d+$/.test(raw.appStoreId)) {
    throw new Error("appStoreId는 숫자 문자열이어야 합니다.");
  }
  if (typeof raw.appName !== "string" || !raw.appName.trim()) {
    throw new Error("appName이 필요합니다.");
  }
  if (typeof raw.stateFile !== "string" || !raw.stateFile.trim()) {
    throw new Error("stateFile이 필요합니다.");
  }
  if (typeof raw.discordWebhookEnv !== "string" ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw.discordWebhookEnv)) {
    throw new Error("discordWebhookEnv가 올바른 환경 변수 이름이 아닙니다.");
  }
  const interval = raw.pollIntervalSeconds ?? 900;
  if (!Number.isInteger(interval) || (interval as number) < 300) {
    throw new Error("pollIntervalSeconds는 300 이상의 정수여야 합니다.");
  }
  return {
    appStoreId: raw.appStoreId,
    appName: raw.appName,
    stateFile: raw.stateFile,
    discordWebhookEnv: raw.discordWebhookEnv,
    pollIntervalSeconds: interval as number,
  };
}

export async function createAppleVersionClient(
  credentials: { keyId: string; issuerId: string; keyPath: string },
  fetcher: typeof fetch = fetch,
): Promise<(appStoreId: string) => Promise<AppStoreVersion[]>> {
  if (!/^[A-Za-z0-9]+$/.test(credentials.keyId) ||
      !/^[0-9a-fA-F-]{36}$/.test(credentials.issuerId)) {
    throw new Error("Apple 팀 키 ID 또는 Issuer ID가 올바르지 않습니다.");
  }
  const privateKey = await readFile(credentials.keyPath, "utf8");
  return async (appStoreId) => {
    const initial = new URL(`https://api.appstoreconnect.apple.com/v1/apps/${appStoreId}/appStoreVersions`);
    initial.searchParams.set("filter[platform]", "IOS");
    initial.searchParams.set("fields[appStoreVersions]", "platform,versionString,appStoreState");
    initial.searchParams.set("limit", "200");
    const versions = new Map<string, AppStoreVersion>();
    const visited = new Set<string>();
    let next: string | undefined = initial.toString();
    while (next) {
      const url = new URL(next);
      if (url.origin !== initial.origin ||
          url.pathname !== initial.pathname || visited.has(url.toString())) {
        throw new Error("App Store 버전 페이지네이션 링크가 올바르지 않습니다.");
      }
      visited.add(url.toString());
      const token = appleTeamToken(credentials.keyId, credentials.issuerId, privateKey);
      const response = await fetcher(url, {
        headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`App Store Connect 버전 조회 실패: HTTP ${response.status}`);
      }
      const page = await response.json() as VersionPage;
      if (!Array.isArray(page.data)) throw new Error("App Store 버전 응답에 data 배열이 없습니다.");
      for (const item of page.data) {
        if (!item.id || item.attributes?.platform !== "IOS" ||
            !item.attributes.versionString || !item.attributes.appStoreState) {
          throw new Error("App Store 버전 응답에 필수 필드가 없습니다.");
        }
        versions.set(item.id, {
          id: item.id,
          version: item.attributes.versionString,
          state: item.attributes.appStoreState,
        });
      }
      next = page.links?.next || undefined;
    }
    if (versions.size === 0) throw new Error("App Store iOS 버전이 조회되지 않았습니다.");
    return [...versions.values()];
  };
}

function appleTeamToken(keyId: string, issuerId: string, privateKey: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issued = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "ES256", kid: keyId, typ: "JWT" })}.${encode({
    iss: issuerId, iat: issued, exp: issued + 1200, aud: "appstoreconnect-v1",
  })}`;
  const signature = sign("sha256", Buffer.from(unsigned), {
    key: privateKey, dsaEncoding: "ieee-p1363",
  }).toString("base64url");
  return `${unsigned}.${signature}`;
}

export async function pollIosStoreOnce(
  config: IosStoreConfig,
  listVersions: (appStoreId: string) => Promise<AppStoreVersion[]>,
  send: (message: string) => Promise<void>,
): Promise<{ checked: number; notifications: number; baseline: boolean }> {
  const versions = await listVersions(config.appStoreId);
  if (versions.length === 0) throw new Error("App Store iOS 버전이 조회되지 않았습니다.");
  const state = await readState(config.stateFile);
  if (!state.initialized) {
    for (const version of versions) {
      state.versions[version.id] = { version: version.version, state: version.state };
    }
    state.initialized = true;
    await saveState(config.stateFile, state);
    return { checked: versions.length, notifications: 0, baseline: true };
  }
  let notifications = 0;
  for (const version of versions) {
    const previous = state.versions[version.id];
    if (previous?.state === version.state) continue;
    const notifyNew = !previous && newVersionNotificationStates.has(version.state);
    if (previous || notifyNew) {
      await send(formatIosStoreMessage(config.appName, version, previous?.state ?? null));
      notifications++;
    }
    state.versions[version.id] = { version: version.version, state: version.state };
    await saveState(config.stateFile, state);
  }
  return { checked: versions.length, notifications, baseline: false };
}

const newVersionNotificationStates = new Set([
  "WAITING_FOR_REVIEW", "IN_REVIEW", "PENDING_DEVELOPER_RELEASE",
  "PENDING_APPLE_RELEASE", "READY_FOR_DISTRIBUTION", "READY_FOR_SALE",
  "REJECTED", "METADATA_REJECTED", "DEVELOPER_REJECTED",
]);

async function readState(path: string): Promise<State> {
  try {
    const state = JSON.parse(await readFile(path, "utf8")) as State;
    if (state.version !== 1 || typeof state.initialized !== "boolean" ||
        !state.versions || typeof state.versions !== "object") {
      throw new Error("iOS 상태 파일 형식이 올바르지 않습니다.");
    }
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, initialized: false, versions: {} };
    }
    throw error;
  }
}

async function saveState(path: string, state: State): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}
