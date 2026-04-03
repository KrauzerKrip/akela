import { Elysia, t } from "elysia";
import { ArmaConnector } from "./arma_connection";
import { PlanSandbox } from "./plan/sandbox";
import { Army } from "./army";

interface PendingRequest {
  id: string;
  commands: any[];
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
const requestQueue: PendingRequest[] = [];

export const armaConnector = new ArmaConnector();


let army = new Army("BLUFOR");

const planSandbox = await PlanSandbox.create();

const code = "something something";

const plan = planSandbox.makePlan(army, code);



export function sendArmaRequest(commands: any[]): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const req: PendingRequest = { id, commands, resolve, reject };
    pendingRequests.set(id, req);
    requestQueue.push(req);
  });
}

const app = new Elysia()
  .get("/", () => "Hello Elysia")
  .get("/poll", () => {
    const req = requestQueue.shift();
    if (req) {
      return { id: req.id, commands: req.commands };
    }
    return "";
  })
  .post(
    "/respond",
    ({ body }) => {
      const req = pendingRequests.get(body.id);
      if (req) {
        pendingRequests.delete(body.id);
        req.resolve(body.response);
      }
      return { status: "received" };
    },
    {
      body: t.Object({
        id: t.String(),
        response: t.Any(),
      }),
    }
  )
  .post(
    "/log",
    ({ body }) => {
      console.log("[Python Log]:", body.message);
      return { status: "received" };
    },
    {
      body: t.Object({
        message: t.String(),
      }),
    }
  )
  .post(
    "/add-request",
    async ({ body }) => {
      try {
        const result = await sendArmaRequest(body.commands);
        return { success: true, result };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    {
      body: t.Object({
        commands: t.Array(t.Any()),
      }),
    }
  )
  .post("/new-event", async ({ body }) => {
    armaConnector.processRawEvent(body.event, body.params);
    return { status: "received" };
  },
    {
      body: t.Object({
        event: t.String(),
        params: t.Any(),
      }),
    })
  .listen(3000);

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);
