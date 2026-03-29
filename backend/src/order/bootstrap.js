// DO NOT USE THIS FILE DIRECTLY
// This file is to use with isolated-vm for order sandboxing.

global.Event = { NEW_CONTACT: 'NEW_CONTACT', KIA: 'KIA' };

global.Push = class {
    constructor(waypoints) {
        this.type = 'PUSH';
        this.waypoints = waypoints;
        this.reactions = {};
    }
    addReaction(event, cb) {
        // We store the callback as a reference to be called later
        this.reactions[event] = new ivm.Reference(cb);
    }
    assign(team) {
        this.assignedTeamId = team.id;
    }
};

global.Assault = class {
    constructor(waypoints) {
        this.type = 'ASSAULT';
        this.waypoints = waypoints;
        this.reactions = {};
    }
    addReaction(event, cb) {
        this.reactions[event] = new ivm.Reference(cb);
    }
    assign(team) {
        this.assignedTeamId = team.id;
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
        global._addTaskCallback.applySync(undefined, [new ivm.Reference(task)]);
    }
};

global.executeImmediately = function (task) {
    if (global._executeCallback) {
        global._executeCallback.applySync(undefined, [new ivm.Reference(task)]);
    }
};

global.Action = {
    Retreat: class { constructor() { this.type = 'RETREAT'; } },
    Report: class { constructor(data) { this.type = 'REPORT'; this.msg = data.message; } }
};