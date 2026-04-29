import { describe, expect, it } from "vitest";
import { projectStateAtTime } from "./selectors";
import type { AkelaEvent } from "../types/events";

function tick(t: number, x: number, y: number): AkelaEvent {
  return {
    t,
    type: "STATE_TICK",
    source: "GAME",
    payload: {
      groups: [{ id: "g1", groupId: "g1", name: "Alpha", position: [x, y], task: null }],
      knownEnemies: [],
    },
  };
}

describe("projectStateAtTime", () => {
  it("interpolates between neighbor ticks", () => {
    const state = projectStateAtTime([tick(0, 0, 0), tick(1000, 100, 100)], 500);
    expect(state.groups[0]?.position[0]).toBe(50);
    expect(state.groups[0]?.position[1]).toBe(50);
  });
});
