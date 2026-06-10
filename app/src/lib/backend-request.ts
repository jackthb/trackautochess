import type { TrackerEvent } from "../types";
import type { BackendCommand as GeneratedBackendCommand } from "../backend-events.generated";

const DEFAULT_TIMEOUT_MS = 15_000;

export type BackendCommand = GeneratedBackendCommand extends infer Command
  ? Command extends { request_id: string }
    ? Omit<Command, "request_id">
    : Command
  : never;

export type BackendResponseMatcher<TResponse extends TrackerEvent> = (
  event: TrackerEvent,
  requestId: string,
) => event is TResponse;

export interface BackendRequestOptions<TResponse extends TrackerEvent> {
  timeoutMs?: number;
  signal?: AbortSignal;
  matches?: BackendResponseMatcher<TResponse>;
}

type RequestTaggedEvent = TrackerEvent & {
  request_id?: unknown;
};

function defaultMatches<TResponse extends TrackerEvent>(
  event: TrackerEvent,
  requestId: string,
): event is TResponse {
  return (event as RequestTaggedEvent).request_id === requestId;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function describeCommand(command: BackendCommand): string {
  const cmd = command.cmd;
  return typeof cmd === "string" && cmd.length > 0 ? cmd : "backend command";
}

export function sendBackendRequest<TResponse extends TrackerEvent = TrackerEvent>(
  command: BackendCommand,
  options: BackendRequestOptions<TResponse> = {},
): Promise<TResponse> {
  if (!window.tracker) {
    return Promise.reject(new Error("window.tracker is not available"));
  }

  const requestId = createRequestId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const matches = options.matches ?? defaultMatches<TResponse>;

  if (options.signal?.aborted) {
    return Promise.reject(new DOMException("Backend request was aborted", "AbortError"));
  }

  return new Promise<TResponse>((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      options.signal?.removeEventListener("abort", onAbort);
    };

    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    const onAbort = () => {
      settle(() => reject(new DOMException("Backend request was aborted", "AbortError")));
    };

    unsubscribe = window.tracker.onEvent((event) => {
      if (!matches(event, requestId)) return;

      if (event.type === "error") {
        settle(() => reject(new Error(event.message)));
        return;
      }

      settle(() => resolve(event));
    });

    options.signal?.addEventListener("abort", onAbort, { once: true });

    timeoutId = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Timed out waiting for ${describeCommand(command)} response (${requestId})`,
          ),
        ),
      );
    }, timeoutMs);

    try {
      window.tracker.sendCommand({
        ...command,
        request_id: requestId,
      } as GeneratedBackendCommand);
    } catch (error) {
      settle(() => reject(error));
    }
  });
}
