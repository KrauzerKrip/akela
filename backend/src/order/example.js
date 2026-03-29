
// agent writes
const taskA = new Push([{ x: 23.2, y: 52.8 }])
const taskB = new Assault([{ x: 25.3, y: 53.3 }, { x: 26.4, y: 54.8 }])

taskA.addReaction(Event.NEW_CONTACT, (event, team) => {
    return new Action.Retreat();
});
taskA.addReaction(Event.KIA, (event, team) => {
    if (team.getCasualtyRatio() > 0.5) {
        return new Action.Retreat();
    } else if (team.getCasualties() > 1) {
        return new Action.Report({ message: "Team Alpha is taking casualites!" });
    }
});

const teamA = teams["Alpha"];
const teamB = teams["Bravo"];

teamA.assignTask(taskA)
teamB.assignTask(taskB)

addTaskToQueue(taskA);
executeImmediately(taskB);