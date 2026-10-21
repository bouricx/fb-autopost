import type { Account, Destination, FacebookGroupInfo, Job } from "../../src/shared/types";

export interface PublishContext {
  account: Account;
  destination: Destination;
  job: Job;
  secret: string | null;
  screenshotsDir: string;
  requirePermalink?: boolean;
  onSubmitting?: () => void;
}

export interface PublishResult {
  publishedUrl?: string;
  remoteId?: string;
}

export interface PlatformAdapter {
  readonly type: Account["adapterType"];
  publish(context: PublishContext): Promise<PublishResult>;
  openLogin?(account: Account): Promise<void>;
  discoverGroups?(account: Account): Promise<FacebookGroupInfo[]>;
  close?(): Promise<void>;
}
