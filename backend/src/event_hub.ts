import { EventEmitter } from "events";
import type { AkelaEvent } from "./events";

type AkelaEventListener = (event: AkelaEvent) => void;

class AkelaEventHub {
    private readonly emitter = new EventEmitter();

    public publish(event: AkelaEvent): void {
        this.emitter.emit("event", event);
    }

    public subscribe(listener: AkelaEventListener): () => void {
        this.emitter.on("event", listener);
        return () => {
            this.emitter.off("event", listener);
        };
    }
}

export const eventHub = new AkelaEventHub();

