
// agent writes
// const taskA_ = new Push("Push", [{ x: 23.2, y: 52.8 }])
// const taskB_ = new Assault("Assault on fortification", [{ x: 25.3, y: 53.3 }, { x: 26.4, y: 54.8 }])

// taskA.addReaction(Event.KIA, (event, team) => {
//     if (team.getCasualties > 2) {
//         return new Retreat();
//     }
// });

// const teamA = teams["Alpha"];
// const teamB = teams["Bravo"];

// teamA.assignTask(taskA_)
// teamB.assignTask(taskB_)

// addTaskToQueue(taskA_);
// executeImmediately(taskB_);

const taskA = new Push([{ x: 10, y: 10 }])
    .assign(groups["Alpha"])
    .on(Event.KIA, (e, g) => g.getCasualties() > 0 ? new Retreat() : null);

addTaskToQueue(taskA);

// // new
// // Create a shared gate
// const phaseLineBlue = new SyncPoint("objective_surrounded");

// // Alpha moves to position and "signals" the gate when done
// const taskA = new Push([{ x: 10, y: 10 }])
//     .assign(groups["Alpha"])
//     .signals(phaseLineBlue);

// // Bravo moves to position but "waits" for the gate before the final assault
// const taskB = new Sequence()
//     .then(new Push([{ x: 12, y: 15 }]))
//     .waitFor(phaseLineBlue)
//     .then(new Assault([{ x: 15, y: 15 }]).assign(groups["Bravo"]).on(Event.KIA, (e, g) => g.getCasualties() > 2 ? new Retreat() : null));

// executeImmediately(taskA);
// executeImmediately(taskB);