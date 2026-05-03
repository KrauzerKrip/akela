const phaseLineBlue = new SyncPoint("objective_surrounded");

// Bravo gets shuttled to the assault line by Alpha's vehicle.
// Shuttle expands to the canonical Embark/Wait/Push/Disembark pattern across
// both groups and auto-installs a Report-on-timeout fallback for the embark.
// Vehicle-owner groups must not have movement tasks queued before the shuttle's
// Wait(embarkDone), so we call Shuttle FIRST on Alpha, then enqueue follow-ups.
const apc = groups["Alpha"].getVehiclesByName("B_LSV_01_AT_F")[0];
const shuttle = Shuttle({
    transport: groups["Alpha"],
    vehicle: apc,
    passengers: groups["Bravo"],
    route: [{ x: 15, y: 15 }],
    name: "Bravo shuttle to assault line",
});

// Alpha's post-dropoff behaviour. Once infantry is dismounted, Alpha holds
// then withdraws to rally, with a KIA reaction that retreats early on losses.
groups["Alpha"]
    .enqueue(new Wait(shuttle.dismounted, "Alpha hold until infantry off"))
    .enqueue(
        new Push([{ x: 10, y: 10 }], "Alpha advance to overwatch")
            .withCombatBehaviour("AWARE")
            .on(Event.KIA, (e, g) => { // Always use group passed in parameters in callbacks. Don't use group from global 'groups' here!!!
                if (g.getCasualties() > 0) {
                    g.executeAndClearQueue(new Retreat([{ x: 5, y: 5 }], "Retreat now").signals(phaseLineBlue));
                } else {
                    g.executeImmediately(new Report("Reporting: everything is ok, we took no casualties.", "Report everything is ok"));
                }
            })
    )
    .enqueue(new Assault([{ x: 10, y: 5 }], "Alpha attack overwatch"));

// Bravo's post-dismount behaviour: hold for the phase line signal, report, assault.
groups["Bravo"]
    .enqueue(new Wait(phaseLineBlue, "Bravo wait phase line"))
    .enqueue(new Report("Group Bravo had waited and reported!", "Bravo report"))
    .enqueue(new Assault([{ x: 20, y: 15 }], "Bravo attacking!"));
