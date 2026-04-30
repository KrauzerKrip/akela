import type { Elysia } from "elysia";

/** When false (default), successful empty `/poll` responses skip access logs (high frequency). */
const LOG_POLL_EMPTY = process.env.AKELA_LOG_POLL_EMPTY === "true";

function pathname(request: Request): string {
  return new URL(request.url).pathname;
}

function safeSearch(search: string): string {
  if (!search || search.length <= 256) {
    return search;
  }
  return `${search.slice(0, 256)}...[truncated]`;
}

function summarizeResponse(response: unknown): string {
  if (response === undefined) {
    return "undefined";
  }
  if (response === null) {
    return "null";
  }
  if (typeof response === "string") {
    if (response.length === 0) {
      return '""';
    }
    return response.length > 180 ? `string(${response.length}b)` : JSON.stringify(response.slice(0, 180));
  }
  const ctor = (response as { constructor?: { name?: string } }).constructor?.name;
  if (ctor === "File" || ctor === "Blob" || ctor === "ReadableStream") {
    return `[${ctor}]`;
  }
  if (typeof response === "object") {
    try {
      const s = JSON.stringify(response);
      return s.length > 220 ? `json(~${s.length}b)` : s;
    } catch {
      return "[object]";
    }
  }
  return String(response);
}

function statusFromSet(set: { status?: number | string }): number {
  const raw = set.status;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const n = Number(raw);
    if (Number.isFinite(n)) {
      return n;
    }
  }
  return 200;
}

export function logRouteException(
  route: string,
  context: Record<string, unknown>,
  error: unknown,
): void {
  const detail =
    Object.keys(context).length > 0 ? ` ${JSON.stringify(context)}` : "";
  if (error instanceof Error) {
    console.error(`[route-error] ${route}${detail}`, error.message);
    console.error(error.stack ?? "(no stack)");
    return;
  }
  console.error(`[route-error] ${route}${detail}`, error);
}

/** Attach to the same `Elysia()` instance that declares routes (not via a nested `.use()` plugin). */
export function registerHttpAccessHooks(app: Elysia): Elysia {
  return app
    .onBeforeHandle((ctx) => {
      const request = ctx.request;
      const id = (ctx as { _accessId?: string })._accessId ?? "??????????";
      const path = pathname(request);
      if (path === "/poll" && !LOG_POLL_EMPTY) {
        return;
      }
      const url = new URL(request.url);
      const len = request.headers.get("content-length");
      const meta = [
        `${request.method}`,
        `${path}${safeSearch(url.search)}`,
        len ? `bodyLen=${len}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      console.log(`[HTTP ${id}] --> ${meta}`);
    })
    .onAfterHandle((ctx) => {
      const request = ctx.request;
      const set = ctx.set as { status?: number | string };
      const response = ctx.response as unknown;
      const id = (ctx as { _accessId?: string })._accessId ?? "??????????";
      const started = (ctx as { _accessStartedAt?: number })._accessStartedAt;
      const path = pathname(request);
      if (path === "/poll" && !LOG_POLL_EMPTY) {
        const hasWork =
          response !== null &&
          response !== undefined &&
          response !== "" &&
          typeof response === "object" &&
          "id" in (response as object) &&
          "commands" in (response as object);
        if (!hasWork) {
          return;
        }
      }

      const ms = Math.round(
        performance.now() - (started ?? performance.now()),
      );
      const status = statusFromSet(set);
      const summary = summarizeResponse(response);
      console.log(
        `[HTTP ${id}] <-- ${request.method} ${path} ${status} ${ms}ms ${summary}`,
      );
    })
    .onError((ctx) => {
      const request = ctx.request;
      const set = ctx.set as { status?: number | string };
      const error = ctx.error;
      const code = ctx.code;
      const path = pathname(request);
      const id = (ctx as { _accessId?: string })._accessId ?? "??????????";
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(
        `[HTTP ${id}] ERROR ${request.method} ${path} type=${String(code)} msg=${err.message}`,
      );
      if (err.stack) {
        console.error(err.stack);
      }
      console.error(`[HTTP ${id}] failing status=${statusFromSet(set)}`);
    });
}
