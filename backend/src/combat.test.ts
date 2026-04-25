import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { GroupCombatMonitor } from "./combat";
import { Group, GameExecutor, EnemyDetectedEvent, CombatModeChangedEvent } from "./army";

describe("GroupCombatMonitor", () => {
    let mockExecutor: GameExecutor;
    let group: Group;
    let monitor: GroupCombatMonitor;

    let originalSetTimeout: typeof global.setTimeout;
    let originalClearTimeout: typeof global.clearTimeout;
    let originalDateNow: typeof Date.now;

    let timeouts: any[] = [];
    let currentTime = 10000;

    beforeEach(() => {
        currentTime = 10000;
        timeouts = [];

        originalSetTimeout = global.setTimeout;
        originalClearTimeout = global.clearTimeout;
        originalDateNow = Date.now;

        global.setTimeout = ((cb: Function, ms: number) => {
            const id = { cb, triggerTime: currentTime + ms, executed: false };
            timeouts.push(id);
            return id as any;
        }) as any;

        global.clearTimeout = ((id: any) => {
            if (!id) return;
            const index = timeouts.findIndex(t => t === id);
            if (index > -1) {
                timeouts.splice(index, 1);
            }
        }) as any;

        global.Date.now = () => currentTime;

        mockExecutor = {} as unknown as GameExecutor;
        group = new Group("g1", "Alpha", mockExecutor);
        monitor = new GroupCombatMonitor(group);
    });

    afterEach(() => {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
        global.Date.now = originalDateNow;
    });

    function advanceTime(ms: number) {
        currentTime += ms;
        // execute all timeouts that are due
        let toExecute = timeouts.filter(t => !t.executed && t.triggerTime <= currentTime);
        while (toExecute.length > 0) {
            toExecute.forEach(t => {
                t.executed = true;
                t.cb();
            });
            timeouts = timeouts.filter(t => !t.executed);
            toExecute = timeouts.filter(t => !t.executed && t.triggerTime <= currentTime);
        }
    }

    it("should batch ENEMY_DETECTED events and emit ENEMY_CONTACT after BATCH_WINDOW_MS", () => {
        const events: any[] = [];
        monitor.subscribe((e) => events.push(e));

        // Send first detection
        group.emitDomainEvent({
            type: "ENEMY_DETECTED",
            groupId: "g1",
            newTargetId: "t1"
        } as EnemyDetectedEvent);

        expect(events.length).toBe(0);

        // Send second detection well within the 2000ms batch window
        advanceTime(1000);
        group.emitDomainEvent({
            type: "ENEMY_DETECTED",
            groupId: "g1",
            newTargetId: "t2"
        } as EnemyDetectedEvent);

        // Wait for batch window to complete (2000ms after first detection)
        advanceTime(1001);

        expect(events.length).toBe(1);
        expect(events[0].type).toBe("ENEMY_CONTACT");
        // Count should correctly accumulate both event target occurrences
        expect(events[0].contactCount).toBe(2);
        expect(events[0].targetIds.length).toBe(2);
        expect(events[0].targetIds).toContain("t1");
        expect(events[0].targetIds).toContain("t2");
    });

    it("should fire COMBAT_ENDED after combat cooldown passes", () => {
        const events: any[] = [];
        monitor.subscribe((e) => events.push(e));

        group.emitDomainEvent({
            type: "ENEMY_DETECTED",
            groupId: "g1",
            newTargetId: "t1"
        } as EnemyDetectedEvent);

        advanceTime(2001); // Batch ends -> ENEMY_CONTACT
        expect(events[0].type).toBe("ENEMY_CONTACT");
        events.length = 0; // Clear events array

        // Currently, cooldown is set to 30000ms from last detection.
        // It started at t=0, so at t=30000 we should see COMBAT_ENDED.
        // We already advanced 2001, so we need to advance ~28000 more.
        advanceTime(27998); // At t=29999, should be no event
        expect(events.length).toBe(0);

        advanceTime(2); // At t=30001
        expect(events.length).toBe(1);
        expect(events[0].type).toBe("COMBAT_ENDED");
    });

    it("should forget known enemies after FORGET_TIME_MS has elapsed", () => {
        group.emitDomainEvent({
            type: "ENEMY_DETECTED",
            groupId: "g1",
            newTargetId: "t1"
        } as EnemyDetectedEvent);

        // Verify property exists via type bypass
        const knownEnemiesMap = (monitor as any).knownEnemies as Map<string, any>;
        expect(knownEnemiesMap.has("t1")).toBe(true);

        // Advance beyond batch window
        advanceTime(2500);

        // Advance slightly below FORGET_TIME_MS (60000ms)
        advanceTime(50000);
        expect(knownEnemiesMap.has("t1")).toBe(true);

        // Advance to hit forget time 
        advanceTime(8000); // 2500 + 50000 + 8000 = 60500 ms since detection
        expect(knownEnemiesMap.has("t1")).toBe(false);
    });

    it("should handle CombatModeChangedEvent to COMBAT properly", () => {
        const events: any[] = [];
        monitor.subscribe((e) => events.push(e));

        group.emitDomainEvent({
            type: "COMBAT_MODE_CHANGED",
            groupId: "g1",
            newMode: "COMBAT"
        } as CombatModeChangedEvent);

        expect(events.length).toBe(1);
        expect(events[0].type).toBe("ENGAGED_IN_COMBAT");
    });
});
