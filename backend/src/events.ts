import type { TacticalGroupEvent } from "./army";

export type EventSource = "GAME" | "AI" | "USER" | "SYSTEM";

export interface BaseEvent {
    source: EventSource;
    type: string;
    t: number;
    sessionId?: string;
}

export interface StateTickGroup {
    id: string;
    groupId: string;
    name: string;
    position: [number, number];
    task: unknown;
}

export interface StateTickEnemy {
    position: [number, number, number];
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

export interface InterventionRequestedEvent extends BaseEvent {
    source: "USER";
    type: "INTERVENTION_REQUESTED";
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

export type AkelaEvent =
    | StateTickEvent
    | UserCommandEvent
    | InterventionRequestedEvent
    | AgentResponseEvent
    | NewPlanEvent
    | LlmDecisionStartEvent
    | GameDomainEvent;

export function withEnvelope<T extends Omit<BaseEvent, "t">>(
    event: T,
    timestamp = Date.now()
): T & { t: number } {
    return {
        ...event,
        t: timestamp
    };
}

