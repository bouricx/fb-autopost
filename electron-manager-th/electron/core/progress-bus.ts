import { EventEmitter } from "node:events";

export interface ProgressEvent {
  type: "job.started" | "target.progress" | "target.succeeded" | "target.failed" | "job.completed" | "worker.changed";
  accountId?: string;
  jobId?: string;
  destinationId?: string;
  percent?: number;
  message: string;
  at: string;
}

export class ProgressBus {
  private events = new EventEmitter();
  publish(event: Omit<ProgressEvent, "at">) {
    const payload: ProgressEvent = { ...event, at: new Date().toISOString() };
    // A renderer closing between isDestroyed/send must not change job outcomes.
    for (const listener of this.events.listeners("progress")) {
      try { listener(payload); } catch { /* Observers cannot abort the worker. */ }
    }
  }
  subscribe(listener: (event: ProgressEvent) => void) {
    this.events.on("progress", listener);
    return () => { this.events.off("progress", listener); };
  }
}
