import { PlanSandbox } from "./sandbox";
import { Army, Group, GameExecutor, Waypoint, Unit, Loadout } from "../army";
import { strict as assert } from "assert";

class DummyExecutor implements GameExecutor {
    getGroupBuilders(side: string): Promise<Group[]> {
        throw new Error("Method not implemented.");
    }
    getGroupUnits(group: Group): Promise<Unit[]> {
        throw new Error("Method not implemented.");
    }
    getUnitLoadout(unit: Unit): Promise<Loadout> {
        throw new Error("Method not implemented.");
    }
    getWaypoints(group: Group): Promise<Waypoint[]> {
        throw new Error("Method not implemented.");
    }
    addGroupEventHandlers(group: Group): Promise<void> {
        throw new Error("Method not implemented.");
    }
    async addWaypoint(group: Group, waypoint: Waypoint) {
        console.log(`[Executor] addWaypoint to ${group.getName()}: (${waypoint.position.x}, ${waypoint.position.y})`);
    }
    async getGroupAssignedVehicles(group: Group) { return []; }
    async setCombatMode(group: Group, mode: string) {
        console.log(`[Executor] setCombatMode for ${group.getName()}: ${mode}`);
    }
    async setCombatBehaviour(group: Group, behaviour: string) { }
    async setGroupId(group: Group, name: string) { }
    async setFormation(group: Group, formation: string) { }
}

async function setupArmy() {
    const executor = new DummyExecutor();
    const army = new Army("BLUFOR");
    const alpha = new Group("alpha-id", "Alpha", executor);
    const bravo = new Group("bravo-id", "Bravo", executor);

    for (let i = 0; i < 4; i++) {
        const unitA = new Unit(`unitA_${i}_id`, `Unit Alpha ${i}`, {
            weapons: {
                primary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
                secondary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
            }
        }, []);
        const unitB = new Unit(`unitB_${i}_id`, `Unit Bravo ${i}`, {
            weapons: {
                primary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
                secondary: { ammo: { type: "cool ammo", quantity: 30 }, base: "base", description: "cool weapon", sight: "cool sight" },
            }
        }, []);
        alpha.addUnit(unitA);
        bravo.addUnit(unitB);
    }

    army.addGroup(alpha);
    army.addGroup(bravo);
    return { army, alpha, bravo };
}

function getTaskNameForGroup(plan: any, groupId: string): string | undefined {
    return plan?.immediateTasks?.[groupId]?.name;
}

async function testIdleGroupReaction() {
    const { army, alpha } = await setupArmy();
    const sandbox = await PlanSandbox.create();
    const code = `
groups["Alpha"]
  .on(Event.KIA, (event, group) => {
    group.executeImmediately(new Report("group idle reaction", "group_idle_kia"));
  });
`;
    const plan = await sandbox.makePlan(army, code);
    assert.ok(plan.groupReactions[alpha.id]?.KIA, "KIA should be persisted as group reaction");

    const reactionPlan = sandbox.handlePlanEvent(alpha, { type: "KIA" });
    assert.ok(reactionPlan, "Group-level reaction should execute without current task");
    assert.equal(getTaskNameForGroup(reactionPlan, alpha.id), "group_idle_kia");
    sandbox.dispose();
}

async function testTaskOverridesGroupReaction() {
    const { army, alpha } = await setupArmy();
    const sandbox = await PlanSandbox.create();
    const code = `
groups["Alpha"]
  .on(Event.KIA, (event, group) => {
    group.executeImmediately(new Report("group reaction", "group_kia"));
  })
  .executeImmediately(
    new Wait(new SyncPoint("never"), "hold_position")
      .on(Event.KIA, (event, group) => {
        group.executeImmediately(new Report("task reaction", "task_kia"));
      })
  );
`;
    const initialPlan = await sandbox.makePlan(army, code);
    await alpha.executeImmediately(initialPlan.immediateTasks[alpha.id]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reactionPlan = sandbox.handlePlanEvent(alpha, { type: "KIA" });
    assert.ok(reactionPlan, "Task-level reaction should execute");
    assert.equal(getTaskNameForGroup(reactionPlan, alpha.id), "task_kia");
    sandbox.dispose();
}

async function testGroupFallbackWhenTaskHasNoEventReaction() {
    const { army, alpha } = await setupArmy();
    const sandbox = await PlanSandbox.create();
    const code = `
groups["Alpha"]
  .on(Event.KIA, (event, group) => {
    group.executeImmediately(new Report("group fallback", "group_fallback_kia"));
  })
  .executeImmediately(
    new Wait(new SyncPoint("never"), "hold_position")
      .on(Event.ENEMY_CONTACT, (event, group) => {
        group.executeImmediately(new Report("task contact", "task_contact"));
      })
  );
`;
    const initialPlan = await sandbox.makePlan(army, code);
    await alpha.executeImmediately(initialPlan.immediateTasks[alpha.id]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reactionPlan = sandbox.handlePlanEvent(alpha, { type: "KIA" });
    assert.ok(reactionPlan, "Group reaction should still execute when task has no matching callback");
    assert.equal(getTaskNameForGroup(reactionPlan, alpha.id), "group_fallback_kia");
    sandbox.dispose();
}

async function testAdditionalPlanReplacesOverlappingGroupReactionOnly() {
    const { army, alpha } = await setupArmy();
    const sandbox = await PlanSandbox.create();
    const initialCode = `
groups["Alpha"]
  .on(Event.KIA, (event, group) => {
    group.executeImmediately(new Report("old kia", "old_group_kia"));
  })
  .on(Event.ENEMY_CONTACT, (event, group) => {
    group.executeImmediately(new Report("old contact", "old_group_contact"));
  });
`;
    await sandbox.makePlan(army, initialCode);

    const additionalCode = `
groups["Alpha"]
  .on(Event.KIA, (event, group) => {
    group.executeImmediately(new Report("new kia", "new_group_kia"));
  });
`;
    await sandbox.makePlan(army, additionalCode, { resetMode: "preserveReactions" });

    const kiaReactionPlan = sandbox.handlePlanEvent(alpha, { type: "KIA" });
    assert.ok(kiaReactionPlan, "Overlapping KIA group reaction should still exist");
    assert.equal(getTaskNameForGroup(kiaReactionPlan, alpha.id), "new_group_kia");

    const contactReactionPlan = sandbox.handlePlanEvent(alpha, { type: "ENEMY_CONTACT", kind: "soldier", count: 2 });
    assert.ok(contactReactionPlan, "Non-overlapping ENEMY_CONTACT group reaction should be preserved");
    assert.equal(getTaskNameForGroup(contactReactionPlan, alpha.id), "old_group_contact");
    sandbox.dispose();
}

async function testAdditionalPlanKeepsTaskReactions() {
    const { army, alpha } = await setupArmy();
    const sandbox = await PlanSandbox.create();
    const initialCode = `
groups["Alpha"]
  .executeImmediately(
    new Wait(new SyncPoint("never"), "hold_position")
      .on(Event.KIA, (event, group) => {
        group.executeImmediately(new Report("task kia", "task_kia_persisted"));
      })
  );
`;
    const initialPlan = await sandbox.makePlan(army, initialCode);
    await alpha.executeImmediately(initialPlan.immediateTasks[alpha.id]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const additionalCode = `
groups["Alpha"]
  .on(Event.ENEMY_CONTACT, (event, group) => {
    group.executeImmediately(new Report("contact", "group_contact_new"));
  });
`;
    await sandbox.makePlan(army, additionalCode, { resetMode: "preserveReactions" });

    const reactionPlan = sandbox.handlePlanEvent(alpha, { type: "KIA" });
    assert.ok(reactionPlan, "Task reaction from previous plan should persist for additional plans");
    assert.equal(getTaskNameForGroup(reactionPlan, alpha.id), "task_kia_persisted");
    sandbox.dispose();
}

async function test() {
    await testIdleGroupReaction();
    await testTaskOverridesGroupReaction();
    await testGroupFallbackWhenTaskHasNoEventReaction();
    await testAdditionalPlanReplacesOverlappingGroupReactionOnly();
    await testAdditionalPlanKeepsTaskReactions();
    console.log("All sandbox reaction tests passed.");
}

test().catch((err) => {
    console.error("Sandbox reaction tests failed:", err);
    process.exit(1);
});
