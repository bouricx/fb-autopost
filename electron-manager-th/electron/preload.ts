import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { AppApi } from "../src/shared/types";

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;

const api: AppApi = {
  listOverdue: () => invoke("queue:overdue"),
  resolveOverdue: input => invoke("queue:resolve-overdue", input),
  listSchedules: () => invoke("schedules:list"),
  createSchedule: input => invoke("schedules:create", input),
  stopSchedule: id => invoke("schedules:stop", id),
  deleteFacebookGroup: (accountId, groupId) => invoke("accounts:delete-group", accountId, groupId),
  deleteQueueItem: (kind, id) => invoke("queue:delete", kind, id),
  startActionWorkflow: input => invoke("actions:start-workflow", input),
  startProjectPosts: input => invoke("projects:start-posts", input),
  listNotificationChannels: () => invoke("notifications:list"),
  createNotificationChannel: input => invoke("notifications:create", input),
  deleteNotificationChannel: id => invoke("notifications:delete", id),
  listActions: () => invoke("actions:list"),
  cancelAction: id => invoke("actions:cancel", id),
  startActions: input => invoke("actions:start", input),
  onProgress: callback => {
    const listener = (_event: Electron.IpcRendererEvent, data: import("./core/progress-bus").ProgressEvent) => callback(data);
    ipcRenderer.on("automation:progress", listener);
    return () => { ipcRenderer.removeListener("automation:progress", listener); };
  },
  listProjects: () => invoke("projects:list"),
  createProject: (name, settings) => invoke("projects:create", name, settings),
  saveProject: (id, project) => invoke("projects:save", id, project),
  duplicateProject: id => invoke("projects:duplicate", id),
  deleteProject: id => invoke("projects:delete", id),
  lastProject: () => invoke("projects:last"),
  exportProject: id => invoke("projects:export", id),
  importProject: () => invoke("projects:import"),
  previewMedia: paths => invoke("media:preview", paths),
  openMediaFolder: path => invoke("media:open-folder", path),
  previewCookies: input => invoke("accounts:preview-cookies", input),
  importCookies: input => invoke("accounts:import-cookies", input),
  checkSession: id => invoke("accounts:check-session", id),
  deleteSession: id => invoke("accounts:delete-session", id),
  copyCookie: id => invoke("accounts:copy-cookie", id),
  exportSession: (id, password) => invoke("accounts:export-session", id, password),
  importSessionBackup: password => invoke("accounts:import-backup", password),
  onSessionProgress: callback => {
    const handler = (_event: Electron.IpcRendererEvent, data: { current: number; total: number; status: string }) => callback(data);
    ipcRenderer.on("accounts:session-progress", handler);
    return () => { ipcRenderer.removeListener("accounts:session-progress", handler); };
  },
  setHeadless: (id, enabled) => invoke("accounts:set-headless", id, enabled),
  dashboard: () => invoke("dashboard"),
  listAccounts: () => invoke("accounts:list"),
  createAccount: (input) => invoke("accounts:create", input),
  deleteAccount: (id) => invoke("accounts:delete", id),
  loginFacebook: (id) => invoke("accounts:login-facebook", id),
  discoverFacebookGroups: (id) => invoke("accounts:discover-groups", id),
  listDestinations: (accountId) => invoke("destinations:list", accountId),
  createDestination: (input) => invoke("destinations:create", input),
  deleteDestination: (id) => invoke("destinations:delete", id),
  listJobs: (limit) => invoke("jobs:list", limit),
  createJobs: (input) => invoke("jobs:create", input),
  createMappedJobs: input => invoke("jobs:create-mapped", input),
  retryJob: (id) => invoke("jobs:retry", id),
  cancelJob: (id) => invoke("jobs:cancel", id),
  listLogs: (limit) => invoke("logs:list", limit),
  chooseMedia: () => invoke("media:choose"),
  filePath: (file) => webUtils.getPathForFile(file),
  startWorker: () => invoke("worker:start"),
  stopWorker: () => invoke("worker:stop"),
  workerStatus: () => invoke("worker:status"),
  getAutoStart: () => invoke("settings:get-auto-start"),
  setAutoStart: (enabled) => invoke("settings:set-auto-start", enabled),
};

contextBridge.exposeInMainWorld("autopost", api);
