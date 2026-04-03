// DO NOT USE THIS FILE DIRECTLY
// This file is to use with isolated-vm for order sandboxing.

global.Event = { NEW_CONTACT: 'NEW_CONTACT', KIA: 'KIA' };

class Task {
    constructor(type) {
        this.type = type;
        this.reactions = {};
        this.assignedTeamId = null;
        this.syncSiganl = null;
        this.syncWait = null;
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
        this.syncSiganl = syncPoint.id;
        return this;
    }
    waitFor(syncPoint) {
        this.syncWait = syncPoint.id;
        return this;
    }
}

global.Push = class extends Task {
    constructor(waypoints) {
        super('PUSH');
        this.waypoints = waypoints;
    }
};

global.Assault = class extends Task {
    constructor(waypoints) {
        super('ASSAULT');
        this.waypoints = waypoints;
    }
};

global.Retreat = class extends Task {
    constructor() {
        super('RETREAT');
    }
};

global.Report = class extends Task {
    constructor(data) {
        super('REPORT');
        this.msg = data.message;
    }
};

global.Sequence = class extends Task {
    constructor(tasks) {
        super("SEQEUNCE");
        this.tasks = tasks;
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

