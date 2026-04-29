import type { TacticalGroupEvent } from "./army";
import { Point, Point3D } from "./geography";

export type EventSource = "GAME" | "AI" | "USER" | "SYSTEM";

export interface BaseEvent {
    source: EventSource;
    type: string;
    timestamp?: number;
    sessionId?: string;
}

export interface StateTickGroup {
    id: string;
    groupId: string;
    name: string;
    position: Point3D;
    task: unknown;
}

export interface StateTickEnemy {
    position: Point3D;
    kind: string;
}

export interface StateTickEvent extends BaseEvent {
    source: "GAME";
    type: "STATE_TICK";
    groups: StateTickGroup[];
    knownEnemies: StateTickEnemy[];
}

export interface UserCommandEvent extends BaseEvent {
    source: "USER";
    type: "USER_COMMAND";
    targetAgent: string;
    message: string;
}

export interface AgentResponseEvent extends BaseEvent {
    source: "AI";
    type: "AGENT_RESPONSE";
    response: string;
}

export interface NewPlanEvent extends BaseEvent {
    source: "AI";
    type: "NEW_PLAN";
    code: string;
}

export interface LlmDecisionStartEvent extends BaseEvent {
    source: "AI";
    type: "LLM_DECISION_START";
    decisionId: string;
    trigger: string;
}

export interface GameDomainEvent extends BaseEvent {
    source: "GAME";
    payload: TacticalGroupEvent | Record<string, unknown>;
}

export function withEnvelope<T extends Omit<BaseEvent, "t">>(
    event: T,
    timestamp = Date.now()
): T & { t: number } {
    return {
        ...event,
        t: timestamp
    };
}




import { EventEmitter } from "events";

type EventListener = (event: BaseEvent) => void;

class EventHub {
    private readonly emitter = new EventEmitter();

    public publish(event: BaseEvent): void {
        this.emitter.emit("event", event);
    }

    public subscribe(listener: EventListener): () => void {
        this.emitter.on("event", listener);
        return () => {
            this.emitter.off("event", listener);
        };
    }
}

export const eventHub = new EventHub();

