import type { Config } from "./config.js";
import { observeLifecycle } from "./domain/lifecycle.js";
import type { GooglePlayClient, ReleaseObservation } from "./google-play.js";
import { notifyAll, type Notifier } from "./notifier.js";
import { FileStateStore } from "./state-store.js";

export interface PollSummary {
  checked: number;
  notifications: number;
}

export async function pollOnce(
  config: Config,
  client: Pick<GooglePlayClient, "listReleases">,
  notifiers: Notifier[],
): Promise<PollSummary> {
  const store = new FileStateStore(config.stateFile);
  await store.load();

  const observations = (
    await Promise.all(
      config.apps.flatMap((app) =>
        app.tracks.map((track) => client.listReleases(app.packageName, track)),
      ),
    )
  ).flat();

  let notifications = 0;
  for (const observation of observations) {
    notifications += await processObservation(store, observation, notifiers);
  }

  await store.save();
  return { checked: observations.length, notifications };
}

async function processObservation(
  store: FileStateStore,
  observation: ReleaseObservation,
  notifiers: Notifier[],
): Promise<number> {
  const previous = store.get(observation)?.state ?? null;
  const decision = observeLifecycle(previous, observation.state);

  if (decision.notification && previous) {
    await notifyAll(notifiers, {
      kind: decision.notification,
      previous,
      release: observation,
    });
  }

  store.set(observation);
  return decision.notification ? 1 : 0;
}
