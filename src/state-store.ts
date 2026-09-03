import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LifecycleState } from "./domain/lifecycle.js";
import type { ReleaseObservation } from "./google-play.js";

export interface StoredObservation {
  state: LifecycleState;
  releaseName: string;
  observedAt: string;
}

interface StateDocument {
  version: 1;
  observations: Record<string, StoredObservation>;
}

export class FileStateStore {
  private state: StateDocument = { version: 1, observations: {} };

  constructor(private readonly path: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8")) as StateDocument;
      if (parsed.version === 1 && parsed.observations) this.state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  get(observation: ReleaseObservation): StoredObservation | undefined {
    return this.state.observations[observationKey(observation)];
  }

  set(observation: ReleaseObservation): void {
    this.state.observations[observationKey(observation)] = {
      state: observation.state,
      releaseName: observation.releaseName,
      observedAt: new Date().toISOString(),
    };
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporaryPath = `${this.path}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(this.state, null, 2)}\n`, {
      mode: 0o600,
    });
    await rename(temporaryPath, this.path);
  }
}

function observationKey(observation: ReleaseObservation): string {
  return [observation.packageName, observation.track, observation.versionCode]
    .map(encodeURIComponent)
    .join("|");
}
