// DO NOT USE THIS FILE DIRECTLY
// This file is to use with quickjs-emscripten for plan sandboxing.

global.Event = { ENEMY_CONTACT: 'ENEMY_CONTACT', KIA: 'KIA', ENGAGED_IN_COMBAT: "ENGAGED_IN_COMBAT", COMBAT_ENDED: "COMBAT_ENDED", TIMEOUT: "TIMEOUT" };

class Task {
    constructor(type, name) {
        this.type = type;
        this.name = name;
        this.reactions = {};
        this.assignedTeamId = null;
        this.completionSignal = null;
    }
    on(event, callback) {
        this.reactions[event] = {
            callback,
            __source: typeof callback === "function" ? callback.toString() : null
        };
        return this;
    }
    assign(group) {
        this.assignedGroupId = group.id;
        return this;
    }
    signals(syncPoint) {
        this.completionSignal = syncPoint;
        return this;
    }
}

global.Push = class extends Task {
    constructor(waypoints, name) {
        super('PUSH', name);
        this.waypoints = waypoints;
        this.behaviourChangeTo = null;
    }

    withCombatBehaviour(behaviour) {
        this.behaviourChangeTo = behaviour;
        return this;
    }
};

global.Assault = class extends Task {
    constructor(waypoints, name) {
        super('ASSAULT', name);
        this.waypoints = waypoints;
        this.behaviourChangeTo = null;
    }

    withCombatBehaviour(behaviour) {
        this.behaviourChangeTo = behaviour;
        return this;
    }
};

global.Retreat = class extends Task {
    constructor(waypoints, name) {
        super('RETREAT', name);
        this.waypoints = waypoints
    }
};

global.Report = class extends Task {
    constructor(message, name) {
        super('REPORT', name);
        this.message = message;
    }
};

global.Wait = class extends Task {
    constructor(signalToWaitFor, name) {
        super('WAIT', name);
        this.signalToWaitFor = signalToWaitFor;
        this.behaviourChangeTo = null;
    }

    withCombatBehaviour(behaviour) {
        this.behaviourChangeTo = behaviour;
        return this;
    }
}

global.Sequence = class extends Task {
    constructor(name) {
        super("SEQUENCE", name);
        this.tasks = [];
    }

    then(task) {
        this.tasks.push(task);
        return this;
    }
}

global.Embark = class extends Task {
    constructor(vehicle, name) {
        super('EMBARK', name);
        this.vehicle = vehicle;
    }
}

global.Disembark = class extends Task {
    constructor(name) {
        super('DISEMBARK', name);
    }
}


class SyncPoint {
    constructor(name) {
        this.id = global.generateUuid();
        this.name = name;
    }
}

global.Shuttle = function ({ transport, vehicle, passengers, route, name, onEmbarkTimeout }) {
    if (!transport || !vehicle || !passengers || !Array.isArray(route) || route.length === 0) {
        throw new Error("Shuttle: transport, vehicle, passengers, and non-empty route are required");
    }
    const label = name || "Shuttle";
    const embarkDone = new SyncPoint(label + "__embark_done");
    const dropoffReady = new SyncPoint(label + "__dropoff_ready");
    const dismounted = new SyncPoint(label + "__dismounted");

    const embark = new Embark(vehicle, label + " embark").signals(embarkDone);
    let timeoutCb;
    if (typeof onEmbarkTimeout === "function") {
        timeoutCb = onEmbarkTimeout;
    } else {
        // Bake the label into the source string so the callback stays correct
        // after sandbox rehydration (preserveReactions mode disposes the arena
        // and re-evals the function from `__source`, dropping any closure vars).
        const labelLiteral = JSON.stringify(label);
        timeoutCb = (0, eval)(
            "(event, g) => { g.executeImmediately(new Report(\"Embark timed out for \" + " + labelLiteral
            + ", " + labelLiteral + " + \" embark timeout\")); }"
        );
    }
    embark.on(Event.TIMEOUT, timeoutCb);

    passengers
        .enqueue(embark)
        .enqueue(new Wait(dropoffReady, label + " wait dropoff"))
        .enqueue(new Disembark(label + " dismount").signals(dismounted));

    transport
        .enqueue(new Wait(embarkDone, label + " wait embark"))
        .enqueue(new Push(route, label + " transport push").signals(dropoffReady));

    return { embarkDone, dropoffReady, dismounted };
};

// global.Group = class {
//     constructor(id, name) {
//         this.id = id;
//         this.name = name;
//     }
//     assignTask(task) {
//         task.assign(this);
//     }
// };

//global.groups = {};

