import { ArmaConnector } from "../arma_connection";
import { ArmyComposer } from "../army";
import { serializeArmy } from "./serialization";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from 'dotenv'
import { startServer } from "../server";
import { Session as AkelaSession } from "../session";

dotenv.config()

async function run() {
    const armaConnector = new ArmaConnector();
    const app = startServer(armaConnector, { port: 3000 });
    const armyComposer = new ArmyComposer(armaConnector, armaConnector);

    console.log("Connecting to Arma and fetching BLUFOR army...");
    const army = await armyComposer.composeArmyForSession(new AkelaSession("BLUFOR"), "BLUFOR");

    // Group positions must be fetched for the state
    for (const group of army.getGroups()) {
        try {
            await group.updateSituationalData();
        } catch (e) {
            console.error(`Warning: Couldn't fetch position for group ${group.getName()}`);
        }
    }

    const dataDirPath = path.join(process.cwd(), ".data", "test", "army");
    if (!fs.existsSync(dataDirPath)) {
        fs.mkdirSync(dataDirPath, { recursive: true });
    }

    let nextIndex = 1;
    let fallbackToSessionIndexOrJustIndex = false;

    // The user's prompt specifically mentions saving it in `.data/test/army/<incremental index>`.
    // It's possible the user wanted it to be a file `.data/test/army/1.json` 
    // or a directory `.data/test/army/1/army.json`. 
    // "serialized to JSON and saved in .data/test/army/<incremental index>."
    // Let's create a file `<incremental index>.json`.
    if (fs.existsSync(dataDirPath)) {
        const files = fs.readdirSync(dataDirPath);
        for (const f of files) {
            if (f.endsWith(".json")) {
                const match = f.match(/^(\d+)\.json$/);
                if (match) {
                    const idx = parseInt(match[1]);
                    if (idx >= nextIndex) {
                        nextIndex = idx + 1;
                    }
                }
            }
        }
    }

    const outFile = path.join(dataDirPath, `${nextIndex}.json`);
    const serialized = serializeArmy(army);
    fs.writeFileSync(outFile, JSON.stringify(serialized, null, 2));

    console.log(`Saved serialized army to ${outFile}`);
    process.exit(0);
}

run().catch(e => {
    console.error("Error creating test data:", e);
    process.exit(1);
});
