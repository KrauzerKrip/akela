import { ArmaConnector } from "./arma_connection";
import { PlanSandbox } from "./plan/sandbox";
import { Army, ArmyComposer } from "./army";
import { Plan } from "./plan/models";
import { startServer } from "./server";

export const armaConnector = new ArmaConnector();
startServer(armaConnector);

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

        if (plan.clearGroupTasks[group.id]) {
            group.clearTasks();
        }
    }

    // Let the event loop breathe a tick so immediate tasks can establish their event listeners
    await new Promise(resolve => setTimeout(resolve, 0));
}

army.getGroups().forEach(g => { console.log(`Group ${g.getName()}: ${g.getTotalUnitCount()} units`) });
army.getGroups().forEach(g => g.subscribe((e) => {
    console.log(`Event from ${g.getName()}: ${e}`)
}));


const groups = army.getGroups();
const immediateTaskPromises = [];
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

