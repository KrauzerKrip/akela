// DO NOT USE THIS FILE DIRECTLY
// This file is to use with isolated-vm for plan sandboxing.

global.Event = { NEW_CONTACT: 'NEW_CONTACT', KIA: 'KIA' };

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
    }
};

global.Assault = class extends Task {
    constructor(waypoints, name) {
        super('ASSAULT');
        this.waypoints = waypoints;
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

