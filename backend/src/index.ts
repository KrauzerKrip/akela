import { Elysia, t } from "elysia";
import { ArmaConnector } from "./arma_connection";
import { PlanSandbox } from "./plan/sandbox";
import { Army, ArmyComposer } from "./army";
import { Plan } from "./plan/models";

interface PendingRequest {
    id: string;
    commands: any[];
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
}

const pendingRequests = new Map<string, PendingRequest>();
const requestQueue: PendingRequest[] = [];

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

export const armaConnector = new ArmaConnector();

const armyComposer = new ArmyComposer(armaConnector, armaConnector);
console.log("Trying to compose...");
const army = await armyComposer.composeArmyOfSide("BLUFOR");
console.log("Composed army!");

const planSandbox = await PlanSandbox.create();

const code = "something something";

// const plan = await planSandbox.makePlan(army, code);

async function actAccordingToPlan(plan: Plan, army: Army) {
    const groups = army.getGroups();
    const immediateTaskPromises = [];
    for (const group of groups) {
        if (plan.queuedTasks[group.id]) {
            plan.queuedTasks[group.id].forEach((task) => {
                // This naturally triggers group.executeNext() in the background
                group.addTaskToQueue(task);
            });
        }
        if (plan.immediateTasks[group.id]) {
            immediateTaskPromises.push(group.executeImmediately(plan.immediateTasks[group.id]));
        }
    }

    // Let the event loop breathe a tick so immediate tasks can establish their event listeners
    await new Promise(resolve => setTimeout(resolve, 0));
}

army.getGroups().forEach(g => { console.log(`Group ${g.getName()}: ${g.getTotalUnitCount()} units`) });
army.getGroups().forEach(g => g.subscribe((e) => {
    console.log(`Event from ${g.getName()}: ${e.type}`)
}));


// const groups = army.getGroups();
// const immediateTaskPromises = [];
// for (const group of groups) {
//     plan.queuedTasks[group.id].forEach((task, index, tasks) => {
//         group.addTaskToQueue(task);
//     });
//     immediateTaskPromises.push(group.executeImmediately(plan.immediateTasks[group.id]));
// }

// await Promise.all(immediateTaskPromises);

// for (const group of groups) {
//     group.subscribe((event) => {
//         if (event.type === "UNIT_KILLED")
//   });
// }

export function sendArmaRequest(commands: any[]): Promise<any> {
    return new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const req: PendingRequest = { id, commands, resolve, reject };
        pendingRequests.set(id, req);
        requestQueue.push(req);
    });
}
