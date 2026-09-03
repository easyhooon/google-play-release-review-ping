import { GoogleAuth } from "google-auth-library";
import {
  isLifecycleState,
  type LifecycleState,
} from "./domain/lifecycle.js";

export interface ReleaseObservation {
  packageName: string;
  track: string;
  releaseName: string;
  versionCode: number;
  state: LifecycleState;
}

interface ReleaseListResponse {
  releases?: Array<{
    releaseName?: string;
    track?: string;
    activeArtifacts?: Array<{ versionCode?: number }>;
    releaseLifecycleState?: unknown;
  }>;
}

export class GooglePlayClient {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });

  async listReleases(
    packageName: string,
    track: string,
  ): Promise<ReleaseObservation[]> {
    const client = await this.auth.getClient();
    const url =
      "https://androidpublisher.googleapis.com/androidpublisher/v3/" +
      `applications/${encodeURIComponent(packageName)}/` +
      `tracks/${encodeURIComponent(track)}/releases`;
    const response = await client.request<ReleaseListResponse>({ url });

    return (response.data.releases ?? []).flatMap((release) => {
      if (!isLifecycleState(release.releaseLifecycleState)) return [];
      const state = release.releaseLifecycleState;

      return (release.activeArtifacts ?? []).flatMap((artifact) => {
        if (!Number.isInteger(artifact.versionCode)) return [];

        return [
          {
            packageName,
            track: release.track ?? track,
            releaseName: release.releaseName ?? "이름 없음",
            versionCode: artifact.versionCode as number,
            state,
          },
        ];
      });
    });
  }
}
