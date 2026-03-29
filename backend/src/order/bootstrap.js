// DO NOT USE THIS FILE DIRECTLY
// This file is to use with isolated-vm for order sandboxing.

global.Event = { NEW_CONTACT: 'NEW_CONTACT', KIA: 'KIA' };

class Task {
    constructor(type) {
        this.type = type;
        this.reactions = {};
    }
    addReaction(event, cb) {
        this.reactions[event] = cb;
    }
    assign(team) {
        this.assignedTeamId = team.id;
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

global.Team = class {
    constructor(id, name) {
        this.id = id;
        this.name = name;
    }
    assignTask(task) {
        task.assign(this);
    }
};

global.teams = {};

global.addTaskToQueue = function (task) {
    if (global._addTaskCallback) {
        global._addTaskCallback(task);
    }
};

global.executeImmediately = function (task) {
    if (global._executeCallback) {
        global._executeCallback(task);
    }
};
