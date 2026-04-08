import { describe, expect, it } from "bun:test";
import { clusterContacts } from "./sitrep";
import { TrackedEnemy } from "./combat";
import { Point } from "./geography";

describe("clusterContacts", () => {
    it("should return empty array when no enemies are provided", () => {
        const result = clusterContacts([]);
        expect(result).toEqual([]);
    });

    it("should return a lone unit (noise) if only one enemy is provided", () => {
        const enemies: TrackedEnemy[] = [
            { position: { x: 10, y: 20, z: 0 }, kind: "infantry" }
        ];
        const result = clusterContacts(enemies, 100, 2);

        expect(result.length).toBe(1);
        expect(result[0].count).toBe(1);
        expect(result[0].kind).toBe("infantry");
        expect(result[0].position).toEqual({ x: 10, y: 20 });
    });

    it("should cluster two enemies of the same kind that are close (distance <= eps)", () => {
        const enemies: TrackedEnemy[] = [
            { position: { x: 0, y: 0, z: 0 }, kind: "infantry" },
            { position: { x: 50, y: 0, z: 0 }, kind: "infantry" } // Distance is 50 <= 100
        ];
        const result = clusterContacts(enemies, 100, 2);

        expect(result.length).toBe(1);
        expect(result[0].count).toBe(2);
        expect(result[0].kind).toBe("infantry");
        // Centroid of (0,0) and (50,0) is (25,0)
        expect(result[0].position).toEqual({ x: 25, y: 0 });
    });

    it("should not cluster two enemies of different kinds even if they are close", () => {
        const enemies: TrackedEnemy[] = [
            { position: { x: 0, y: 0, z: 0 }, kind: "infantry" },
            { position: { x: 10, y: 10, z: 0 }, kind: "vehicle" }
        ];
        // They are close, but different kinds
        const result = clusterContacts(enemies, 100, 2);

        expect(result.length).toBe(2);

        // Sorting or order might matter, current implementation pushes clusters then lone units.
        // Let's just check the counts and kinds ignoring order.
        const kinds = result.map(c => c.kind).sort();
        expect(kinds).toEqual(["infantry", "vehicle"]);

        const counts = result.map(c => c.count);
        expect(counts).toEqual([1, 1]);
    });

    it("should separate enemies farther than eps", () => {
        const enemies: TrackedEnemy[] = [
            { position: { x: 0, y: 0, z: 0 }, kind: "infantry" },
            { position: { x: 200, y: 0, z: 0 }, kind: "infantry" } // Distance is 200 > 100
        ];
        const result = clusterContacts(enemies, 100, 2);

        expect(result.length).toBe(2);
        expect(result[0].count).toBe(1);
        expect(result[1].count).toBe(1);
    });

    it("should chain neighbors to form a larger cluster", () => {
        const enemies: TrackedEnemy[] = [
            { position: { x: 0, y: 0, z: 0 }, kind: "infantry" },
            { position: { x: 90, y: 0, z: 0 }, kind: "infantry" }, // close to 0
            { position: { x: 180, y: 0, z: 0 }, kind: "infantry" } // close to 90
        ];
        // 0 and 180 are distance 180 apart, but 90 connects them.
        const result = clusterContacts(enemies, 100, 2);

        expect(result.length).toBe(1);
        expect(result[0].count).toBe(3);
        expect(result[0].kind).toBe("infantry");
        // Centroid of (0,0), (90,0), (180,0) is (90,0)
        expect(result[0].position).toEqual({ x: 90, y: 0 });
    });
});
