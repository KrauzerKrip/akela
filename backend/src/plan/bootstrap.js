// DO NOT USE THIS FILE DIRECTLY
// This file is to use with quickjs-emscripten for plan sandboxing.

global.Event = { ENEMY_CONTACT: 'ENEMY_CONTACT', KIA: 'KIA', ENGAGED_IN_COMBAT: "ENGAGED_IN_COMBAT", COMBAT_ENDED: "COMBAT_ENDED" };

class Task {
    constructor(type, name) {
        this.type = type;
        this.name = name;
        this.reactions = {};
        this.assignedTeamId = null;
        this.completionSignal = null;
    }
    on(event, callback) {
        this.reactions[event] = callback;
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
        super('ASSAULT');
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

class SyncPoint {
    constructor(name) {
        this.id = global.generateUuid();
        this.name = name;
    }
}

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

