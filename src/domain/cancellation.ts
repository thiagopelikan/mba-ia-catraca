import type { EventRecord } from "./events";

export type CancelEventResult =
  | { ok: true; event: EventRecord; refunded: number; cancelled: number }
  | { ok: false; error: "not_found" | "not_cancellable" };
