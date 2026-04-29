import { eventHub, withEnvelope } from "./event";

export type CompositionPhase =
    | "STARTED"
    | "GROUP"
    | "UNIT"
    | "LOADOUT"
    | "WAYPOINTS"
    | "VEHICLES"
    | "COMPLETED"
    | "FAILED";

export interface CompositionProgressEventPayload {
    phase: CompositionPhase;
    message: string;
    index?: number;
    total?: number;
    groupId?: string;
    groupName?: string;
    unitId?: string;
    unitName?: string;
}

export interface CompositionProgressLogger {
    log(payload: CompositionProgressEventPayload): void;
}

export class EventHubCompositionProgressLogger implements CompositionProgressLogger {
    private readonly sessionId: string;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
    }

    public log(payload: CompositionProgressEventPayload): void {
        // Keep composition flow independent from event transport and subscribers.
        queueMicrotask(() => {
            try {
                eventHub.publish(withEnvelope({
                    source: "SYSTEM",
                    type: "COMPOSITION_PROGRESS",
                    sessionId: this.sessionId,
                    ...payload
                }));
            } catch (error) {
                console.warn("Failed to publish composition progress event:", error);
            }
        });
    }
}
