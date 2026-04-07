const phaseLineBlue = new SyncPoint("objective_surrounded");

const taskA = new Push([{ x: 10, y: 10 }], "Push forward")
    .withCombatBehaviour("AWARE")
    .on(Event.KIA, (e, g) => { // Always use group passed in parameters in callbacks. Don't use group from global 'groups' here!!!
        if (g.getCasualties() > 0) {
            g.executeAndClearQueue(new Retreat([{ x: 5, y: 5 }], "Retreat now").signals(phaseLineBlue));
        } else {
            g.executeImmediately(new Report("Reporting: everything is ok, we took no casualties.", "Report everything is ok"));
        }
    });
const taskA2 = new Report("it should not be executed or be in the queue if casualities > 0", "Name: test report");

const taskB = new Sequence("Wait and Report").then(new Wait(phaseLineBlue)).then(new Report("Group Bravo had waited and reported!", "Bravo report"));

groups["Alpha"].enqueue(taskA);
groups["Alpha"].enqueue(taskA2);
groups["Bravo"].executeImmediately(taskB);
