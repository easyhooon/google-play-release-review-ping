import type { Config } from "./config.js";
import {
  observeLifecycle,
  type LifecycleState,
} from "./domain/lifecycle.js";
import type { GooglePlayClient, ReleaseObservation } from "./google-play.js";
import {
  notifyAll,
  type Notifier,
  type NotifierResolver,
} from "./notifier.js";
import { FileStateStore } from "./state-store.js";

export interface PollSummary {
  checked: number;
  notifications: number;
}

export async function pollOnce(
  config: Config,
  client: Pick<GooglePlayClient, "listReleases">,
  resolveNotifiers: NotifierResolver,
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

  const trackBaselines = new Map<string, boolean>();
  for (const observation of observations) {
    const key = trackKey(observation);
    if (!trackBaselines.has(key)) {
      trackBaselines.set(key, store.hasTrack(observation));
    }
  }

  let notifications = 0;
  for (const observation of observations) {
    notifications += await processObservation(
      store,
      observation,
      resolveNotifiers(observation.packageName),
      trackBaselines.get(trackKey(observation)) ?? false,
    );
  }

  await store.save();
  return { checked: observations.length, notifications };
}

async function processObservation(
  store: FileStateStore,
  observation: ReleaseObservation,
  notifiers: Notifier[],
  trackHasBaseline: boolean,
): Promise<number> {
  const previous = store.get(observation)?.state ?? null;
  const decision = observeLifecycle(previous, observation.state);
  const notification = isNewInternalDeployment(
    observation,
    previous,
    trackHasBaseline,
  )
    ? "internal-deployed"
    : decision.notification;

  if (notification) {
    await notifyAll(notifiers, {
      kind: notification,
      previous,
      release: observation,
    });
  }

  store.set(observation);
  return notification ? 1 : 0;
}

function isNewInternalDeployment(
  observation: ReleaseObservation,
  previous: LifecycleState | null,
  trackHasBaseline: boolean,
): boolean {
  return previous === null &&
    trackHasBaseline &&
    observation.track === "internal" &&
    observation.state === "RELEASE_LIFECYCLE_STATE_PUBLISHED";
}

function trackKey(observation: ReleaseObservation): string {
  return `${observation.packageName}\0${observation.track}`;
}
