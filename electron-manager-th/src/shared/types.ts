export type Platform = "facebook" | "discord";
export type AdapterType = "facebook-browser" | "discord-webhook" | "discord-bot";
export type AccountStatus = "active" | "needs_login" | "paused" | "rate_limited" | "error";
export type DestinationKind = "facebook_group" | "facebook_page" | "facebook_profile" | "discord_channel" | "discord_webhook";
export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled" | "review_required" | "skipped" | "uncertain" | "pending_approval";

export interface Account {
  id: string;
  name: string;
  platform: Platform;
  adapterType: AdapterType;
  status: AccountStatus;
  browserProfilePath: string | null;
  proxyUrl: string | null;
  createdAt: string;
  updatedAt: string;
  sessionStatus?: string;
  statusMessage?: string | null;
  lastCheckedAt?: string | null;
  headless?: number;
  cookieManaged?: number;
  facebookUserId?: string | null;
  facebookName?: string | null;
  facebookPhotoUrl?: string | null;
  facebookActorType?: "profile" | "page" | "unknown";
  facebookIdentityCheckedAt?: string | null;
}

export interface Destination {
  id: string;
  accountId: string;
  kind: DestinationKind;
  name: string;
  remoteId: string | null;
  url: string | null;
  enabled: boolean;
}

export interface Job {
  submissionState?: string;
  delayMin?: number;
  delayMax?: number;
  id: string;
  accountId: string;
  destinationId: string;
  accountName: string;
  destinationName: string;
  caption: string;
  media: string[];
  runAt: string;
  recurrence: string | null;
  priority: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  publishedUrl: string | null;
}

export interface Dashboard {
  nextScheduledAt?: string | null;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  successRate: number;
  accounts: number;
  nextJobs: Job[];
}

export interface LogEntry {
  id: number;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  createdAt: string;
}

export interface FacebookGroupInfo {
  id: string;
  name: string;
  url: string;
  imageUrl: string | null;
  postPermission?: "unknown" | "allowed" | "denied";
  sharePermission?: "unknown" | "allowed" | "denied";
}

export interface CreateAccountInput {
  name: string;
  adapterType: AdapterType;
  secret?: string;
  proxyUrl?: string;
}

export interface CreateDestinationInput {
  accountId: string;
  kind: DestinationKind;
  name: string;
  remoteId?: string;
  url?: string;
}

export interface CreateJobInput {
  delayMin?: number;
  delayMax?: number;
  accountId: string;
  destinationIds: string[];
  caption: string;
  media: string[];
  runAt: string;
  recurrence?: "daily" | "weekly" | null;
  priority?: number;
  maxAttempts?: number;
}

export interface AppApi {
  listMessageProfiles(): Promise<import("./message-profiles").MessageProfile[]>;
  saveMessageProfile(id: string | null, input: import("./message-profiles").MessageProfileInput): Promise<string>;
  deleteMessageProfile(id: string): Promise<void>;
  listProfileRuns(): Promise<import("./message-profiles").ProfileRun[]>;
  createProfileRun(input: import("./message-profiles").ProfileRunInput): Promise<string>;
  stopProfileRun(id: string): Promise<void>;
  chooseImageFolder(): Promise<{ folder: string; paths: string[] } | null>;
  listOverdue(): Promise<import("../../electron/core/queue-safety").OverdueItem[]>;
  resolveOverdue(input: { items: { kind: "post" | "workflow"; id: string }[]; decision: "skip" | "reschedule" | "send"; at?: string }): Promise<boolean>;
  listSchedules(): Promise<import("../../electron/automation/schedule-manager").ScheduleSummary[]>;
  createSchedule(input: { accountId: string; name: string; startDate: string; daily: boolean; times: string[]; payloads: unknown[] }): Promise<string>;
  stopSchedule(id: string): Promise<void>;
  deleteFacebookGroup(accountId: string, groupId: string): Promise<boolean>;
  deleteQueueItem(kind: "post" | "workflow", id: string): Promise<boolean>;
  cancelPendingQueueItems(items: { kind: "post" | "workflow"; id: string }[]): Promise<number | false>;
  deletePendingQueueItems(input: { items: { kind: "post" | "workflow"; id: string }[]; scheduleId?: string }): Promise<number | false>;
  startActionWorkflow(input: { accountId: string; scheduledAt?: string; workflows: { action: "comment" | "share" | "like"; payload: unknown }[][] }): Promise<string[]>;
  startProjectPosts(input: { settings: import("../../electron/projects/project-manager").WorkspaceSettings; scheduledAt: string }): Promise<string[]>;
  listNotificationChannels(): Promise<{ id: string; name: string; type: string; accountId: string | null; projectId: string | null; enabled: number }[]>;
  probeNotificationChannel(id: string): Promise<string>;
  testNotificationDelivery(id: string): Promise<string>;
  createNotificationChannel(input: unknown): Promise<string>;
  deleteNotificationChannel(id: string): Promise<void>;
  listActions(): Promise<import("../../electron/automation/contracts").AutomationTask[]>;
  cancelAction(id: string): Promise<void>;
  startActions(input: { accountId: string; action: "post" | "comment" | "share" | "like"; payloads: unknown[]; scheduledAt?: string; projectId?: string | null }): Promise<string[]>;
  onProgress(callback: (event: import("../../electron/core/progress-bus").ProgressEvent) => void): () => void;
  listProjects(): Promise<import("../../electron/projects/project-manager").ProjectRecord[]>;
  createProject(name: string, settings?: unknown): Promise<import("../../electron/projects/project-manager").ProjectRecord>;
  saveProject(id: string, project: unknown): Promise<import("../../electron/projects/project-manager").ProjectRecord>;
  duplicateProject(id: string): Promise<import("../../electron/projects/project-manager").ProjectRecord>;
  deleteProject(id: string): Promise<void>;
  lastProject(): Promise<string | null>;
  exportProject(id: string): Promise<boolean>;
  importProject(): Promise<import("../../electron/projects/project-manager").ProjectRecord | null>;
  previewMedia(paths: string[]): Promise<{ path: string; url: string | null; kind: "image" | "video"; missing: boolean }[]>;
  openMediaFolder(path: string): Promise<void>;
  previewCookies(input: string): Promise<{ userId: string; format: string }[]>;
  importCookies(input: string, name?: string): Promise<{ accountId: string; status: string; message: string }[]>;
  importCookieForAccount(id: string, input: string): Promise<{ accountId: string; status: string; message: string }>;
  checkSession(id: string): Promise<import("../../electron/accounts/session-checker").SessionResult>;
  loginAndCheckFacebook(id: string): Promise<import("../../electron/accounts/session-checker").SessionResult>;
  createAndLoginFacebook(name: string): Promise<{ accountId: string; session: import("../../electron/accounts/session-checker").SessionResult }>;
  renameAccount(id: string, name: string): Promise<Account>;
  deleteSession(id: string): Promise<void>;
  copyCookie(id: string): Promise<void>;
  exportSession(id: string, password: string): Promise<boolean>;
  importSessionBackup(password: string): Promise<{ accountId: string; status: string; message: string }[]>;
  onSessionProgress(callback: (event: { current: number; total: number; status: string }) => void): () => void;
  setHeadless(id: string, enabled: boolean): Promise<void>;
  dashboard(): Promise<Dashboard>;
  listAccounts(): Promise<Account[]>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
  loginFacebook(id: string): Promise<void>;
  discoverFacebookGroups(id: string): Promise<FacebookGroupInfo[]>;
  listDestinations(accountId?: string): Promise<Destination[]>;
  createDestination(input: CreateDestinationInput): Promise<Destination>;
  deleteDestination(id: string): Promise<void>;
  listJobs(limit?: number): Promise<Job[]>;
  createJobs(input: CreateJobInput): Promise<Job[]>;
  createMappedJobs(input: { accountId: string; contents: { destinationId: string; caption: string; media: string[] }[]; runAt: string; recurrence: "daily" | "weekly" | null; delayMin?: number; delayMax?: number }): Promise<Job[]>;
  retryJob(id: string): Promise<void>;
  cancelJob(id: string): Promise<void>;
  listLogs(limit?: number): Promise<LogEntry[]>;
  chooseMedia(): Promise<string[]>;
  filePath(file: File): string;
  startWorker(): Promise<void>;
  stopWorker(): Promise<void>;
  workerStatus(): Promise<{ running: boolean }>;
  getAutoStart(): Promise<boolean>;
  setAutoStart(enabled: boolean): Promise<boolean>;
}
