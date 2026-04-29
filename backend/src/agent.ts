import "./instrumentation";
import { BaseContextCompactor, FunctionTool, InvocationContext, LlmAgent, Context, InMemoryRunner, BaseSessionService, Runner, isFinalResponse, Session as ADKSession, BaseSummarizer, Event, CompactedEvent, stringifyContent, createEvent } from '@google/adk';
import { startActiveObservation, startObservation, propagateAttributes } from '@langfuse/tracing';
import { createUserContent } from '@google/genai';
import { LangfuseMedia } from "@langfuse/core";
import { int, z } from 'zod';
import * as fs from 'fs';
import path from 'path';
import { ExecutionPromptFormatter, IntelPromptFormatter, PlanPromptFormatter, SitrepFormatter } from './format';
import { createSitrep, Sitrep } from './sitrep';
import { GameMapArea, Point } from './geography';
import { PlanVisualization, PlanVisualizer } from './plan/visualization';
import { PlanSandbox, PlanSandboxResetMode } from './plan/sandbox';
import { Army, TacticalReportEvent } from './army';
import { Plan } from './plan/models';
import { ArmyCombatMonitor } from './combat';
import { Session } from './session';
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';
import { runtimeState, InterventionCommand } from './runtime_state';
import { eventHub } from './event';
import { withEnvelope } from './event';

export class Image {
    private readonly path: string;

    constructor(path: string) {
        this.path = path;
    }

    public getBase64(): string {
        return fs.readFileSync(this.path).toString('base64');
    }
}

export interface Intel {
    images: Image[];
    observations: string[];
}

export interface Maps {
    sattelite: Image;
    primitives: Image;
}

export class IntelAgent {
    private formatter: IntelPromptFormatter;
    private sessionService: BaseSessionService;
    private session: Session;
    private model: string;

    constructor(formatter: IntelPromptFormatter, sessionService: BaseSessionService, session: Session) {
        this.formatter = formatter;
        this.sessionService = sessionService;
        this.session = session;
        this.model = "gemini-3-flash-preview";
    }

    public async analyze(intel: Intel, gameMapArea: GameMapArea): Promise<string> {
        // To save tokens.
        // @TODO remove
        return "**INTELLIGENCE CONCLUSION REPORT**\n\n**TO:** Planning Agent\n**FROM:** Tactical Intelligence Agent\n**SUBJECT:** CSAT Forward Operating Base (FOB) Analysis\n\n---\n\n### **1. Forces Overview**\nBased on visual evidence from the MQ-4A Greyhawk UAV and text-based observations, the following enemy assets are confirmed at the target location:\n\n* **Infantry:** Multiple dismounted CSAT personnel observed. They are concentrated strictly within the perimeter walls of the FOB and immediately around adjacent fortified structures. No widespread patrols detected in the extended surrounding area.\n* **Vehicles:** Several unarmored transport/cargo trucks are parked within the FOB walls and adjacent to the main buildings. \n* **Air Assets:** 1x Active Cargo Helicopter (coaxial rotor design, consistent with CSAT logistics) observed in flight at low altitude directly above the northern sector of the FOB.\n* **Emplacements / Heavy Weapons:** Intelligence reports confirm Anti-Tank (AT) capabilities at the FOB. UAV footage identifies an elevated, heavily fortified HESCO watchtower/platform positioned just outside the main walls. This is the highly probable location of the reported AT element, providing it with superior fields of fire. \n* **Electronic Warfare (EW):** A large white radome/observatory structure is present inside the compound. However, signals intelligence indicates little-to-no electromagnetic radiation, suggesting this facility is either inactive, a decoy, or strictly structural rather than an active radar threat.\n\n### **2. Positions & Grid Analysis**\n*(Note: UAV coordinates provided on imagery represent the drone's position, not the target's. Target coordinates are derived from the tactical map overlay.)*\n\n* **Primary Target (Main FOB Compound):** Centered at **Grid 209 192**. The compound is a large, irregularly shaped (roughly pentagonal) walled enclosure containing barracks, storage structures, and the large white dome (located in the southeast corner of the enclosure).\n* **Elevated HESCO Watchtower (Suspected AT Position):** Located immediately northwest of the main compound, near **Grid 209 193**, guarding the northern road approach.\n* **Helicopter Position:** Last spotted hovering in the vicinity of **Grid 209 193**, just east of the HESCO watchtower.\n\n### **3. Terrain Context**\n* **Immediate Surroundings:** The FOB is situated in relatively flat, open agricultural terrain (elevation ~20m). There is minimal natural concealment (forest/brush) directly surrounding the base, providing the enemy with excellent 360-degree lines of sight.\n* **Northern Barrier (The Lake):** The light-gray area dominating the northern sector of the map (Northing 196 to 200, Easting 202 to 210) is a confirmed body of water. This creates a natural, impassable barrier for ground vehicles and infantry attempting a northern approach.\n* **Elevated Terrain:** There is a notable hill to the west/northwest of the FOB, peaking around **Grid 203 188** (elevation rising above 40m).\n* **Road Networks:** A prominent road network intersects at the FOB, with primary paved/dirt tracks leading from the south, east, and west, converging at the installation.\n\n### **4. Overall Assessment**\n* **Critical Threats:** The reported AT capability, likely stationed at the elevated northern HESCO tower, is the primary threat to any mechanized or motorized assault. The open terrain surrounding the FOB acts as a massive kill zone for advancing vehicles.\n* **Opportunities:** The lack of enemy presence beyond the close vicinity of the FOB allows friendly forces to maneuver freely through the surrounding grid squares to establish advantageous positions. The elevated terrain to the west (Grid 203 188) offers a commanding overwatch position to provide fire support or snipe the AT emplacement prior to an assault. \n* **Tactical Recommendation:** Avoid a direct vehicular assault across the open fields or via the main roads. A waterborne or northern land approach is blocked by the lake. Consider utilizing the western elevation for heavy fire support to neutralize the AT threat, followed by a dismounted infantry assault utilizing smoke for concealment across the open ground. The cargo helicopter should be monitored; if it is grounded, it presents an immediate high-value target for destruction to cripple enemy logistics. **SUPPLEMENTAL TACTICAL SUGGESTION**\n\n**TO:** Planning Agent\n**FROM:** Tactical Intelligence Agent\n**SUBJECT:** Dismount Thresholds and Danger Zone Designation\n\nBased on the confirmed **Anti-Tank (AT) threat** at the northern HESCO tower (**Grid 209 193**) and the high-caliber small arms/HMG potential from the FOB walls, I recommend the following dismount protocols and spatial constraints to mitigate catastrophic loss of transport assets.\n\n### **1. Danger Zone Coordinates (The \"Kill Zone\")**\nThe \"Danger Zone\" is defined as the area where enemy AT assets have clear line-of-sight and high hit probability.\n* **Northern Boundary:** Grid Northing **196** (The Lake Shore).\n* **Southern Boundary:** Grid Northing **189**.\n* **Western Boundary:** Grid Easting **205**.\n* **Eastern Boundary:** Grid Easting **212**.\n**Assessment:** Vehicles entering this box (approximately 700m radius from center) are at extreme risk of static or moving target interception by CSAT Titan or Metis-equivalent AT systems.\n\n### **2. Suggested Dismount Distances**\n* **Unprotected Vehicles (Transport Trucks/Quads):**\n    * **Safe Distance:** 1,200m+ from the FOB perimeter.\n    * **Recommended Dismount Point:** **Grid 197 192** (West) or **Grid 209 180** (South).\n    * **Rationale:** Unprotected vehicles are vulnerable to even general small arms and have zero survivability against AT. Troops should dismount behind natural terrain features (like the western ridge) before entering visual range.\n\n* **IFVs (Armored Personnel Carriers/Striders):**\n    * **Safe Distance:** 800m from the FOB perimeter.\n    * **Recommended Dismount Point:** **Grid 203 192** (utilizing the western elevation for initial hull-down positioning).\n    * **Rationale:** While IFVs can withstand small arms, the confirmed AT at the FOB makes any closer approach a gamble. Dismounting at 800m allows the IFV to provide suppressive autocannon/HMG fire while troops advance using the terrain.\n\n### **3. Intelligence-Based Suggestion for Planning**\n\"Direct vehicular insertion into **Grid 209 192** is **PROHIBITED** until the northern HESCO tower is neutralized. Recommend the Planning Agent route all motorized elements to the western ridge (**Grid 203 188**). Troopers should dismount at this high-ground position to initiate a suppressed bounding overwatch. Utilize the elevation to maintain 'hull-down' positions for IFVs, exposing only turrets to the target while infantry clears the open ground under the cover of smoke and indirect fire.";
        return startActiveObservation("IntelAgent", async (span) => {
            const { system: systemPrompt, user: userPrompt, prompt: promptObj } = await this.formatter.formatPrompt(intel.observations);

            span.update({
                input: { observations: intel.observations }
            });

            return await propagateAttributes({ sessionId: this.session.getId() }, async () => {
                const agent = new LlmAgent({
                    name: "intel_agent",
                    model: this.model,
                    description: "Analyzes intelligence observations and images.",
                    instruction: systemPrompt,
                });
                const runner = new Runner({
                    agent: agent,
                    sessionService: this.sessionService,
                    appName: "intel-akela"
                });

                const session = await this.sessionService.createSession({
                    appName: "intel-akela",
                    userId: process.env.SESSION_USER_ID || "akela_user",
                });

                const parts: any[] = [{ text: userPrompt }];
                for (const image of intel.images) {
                    parts.push({
                        inlineData: {
                            mimeType: 'image/jpeg',
                            data: image.getBase64()
                        }
                    });
                }
                parts.push({
                    inlineData: {
                        mimeType: 'image/jpeg',
                        data: gameMapArea.getBase64Image('frame_satellite')
                    }
                });

                const wrappedImages = intel.images.map(img => new LangfuseMedia({
                    source: "bytes",
                    contentBytes: Buffer.from(img.getBase64(), 'base64'),
                    contentType: "image/jpeg"
                }));
                wrappedImages.push(new LangfuseMedia({
                    source: "bytes",
                    contentBytes: Buffer.from(gameMapArea.getBase64Image('frame_satellite'), 'base64'),
                    contentType: "image/jpeg"
                }));

                let finalResponseText = "Agent did not produce a final response.";

                const generation = startObservation(
                    "IntelAgent-LLM",
                    {
                        model: this.model,
                        input: { observations: intel.observations, images: wrappedImages }
                    },
                    { asType: "generation" }
                );

                let sessionPromptTokens = 0;
                let sessionCandidatesTokens = 0;
                let sessionTotalTokens = 0;

                const eventStream = runner.runAsync({
                    sessionId: session.id,
                    userId: session.userId,
                    newMessage: {
                        role: 'user',
                        parts: parts
                    }
                });

                for await (const event of eventStream) {
                    if (event.usageMetadata) {
                        sessionPromptTokens += event.usageMetadata.promptTokenCount || 0;
                        sessionCandidatesTokens += event.usageMetadata.candidatesTokenCount || 0;
                        sessionTotalTokens += event.usageMetadata.totalTokenCount || 0;
                    }
                    console.log("DEBUG EVENT:", JSON.stringify(event, (k, v) => (k === 'data' && typeof v === 'string' && v.length > 200) ? '<base64 image removed>' : v, 2));

                    if (isFinalResponse(event)) {
                        if (event.content && event.content.parts && event.content.parts.length > 0) {
                            finalResponseText = event.content.parts[0].text || "";
                        } else if (event.actions && (event.actions as any).escalate) {
                            finalResponseText = `Agent escalated: ${(event as any).errorMessage || 'No specific message.'}`;
                        }
                        break;
                    }
                }

                generation.update({
                    prompt: promptObj,
                    usageDetails: {
                        input: sessionPromptTokens,
                        output: sessionCandidatesTokens,
                        total: sessionTotalTokens
                    },
                    output: { content: finalResponseText }
                });
                generation.end();

                span.update({
                    output: { response: finalResponseText }
                });
                return finalResponseText;
            });
        });
    }
}

export interface PlanningResult {
    code: string;
    description: string;
}

export class PlanAgent {
    private formatter: PlanPromptFormatter;
    private sessionService: BaseSessionService;
    private session: Session;
    private planVisualizer: PlanVisualizer;
    private planSandbox: PlanSandbox;

    constructor(formatter: PlanPromptFormatter, sessionService: BaseSessionService, session: Session, planSandbox: PlanSandbox, planVisualizer: PlanVisualizer) {
        this.formatter = formatter;
        this.sessionService = sessionService;
        this.session = session;
        this.planVisualizer = planVisualizer;
        this.planSandbox = planSandbox;
    }

    public async plan(army: Army, sitreps: Sitrep[], intelResult: string, gameMapArea: GameMapArea): Promise<PlanningResult> {
        // To save tokens.
        // @TODO remove
        // return {
        //     "code": "// Define SyncPoints for coordination\nconst checkpointClear = new SyncPoint(\"Checkpoint Clear\");\nconst overwatchSet = new SyncPoint(\"Overwatch Set\");\nconst assaultReady = new SyncPoint(\"Assault Ready\");\n\n// Define basic casualty reaction for all groups\nconst setStandardReactions = (group) => {\n    group.on(Event.KIA, (event, g) => {\n        if (g.getCasualtyRatio() > 0.35) {\n            g.executeImmediately(new Report(\"Critical casualties sustained! Pulling back to Rally Point.\", \"Status Update\"));\n            g.executeImmediately(new Retreat({ x: 20700, y: 17500 }, \"Fall back to Rally Point\"));\n        }\n    });\n    group.on(Event.ENEMY_CONTACT, (event, g) => {\n        g.executeImmediately(new Report(`Contact: ${event.count} ${event.kind}(s) detected.`, \"Contact Report\"));\n    });\n};\n\n// Apply standard reactions to all available groups\nObject.values(groups).forEach(setStandardReactions);\n\n// --- Phase 1: Neutralize Secondary Checkpoint ---\n// Delta 1-1 clears the remote roadblock at 210 177 to secure our rear.\nconst deltaGroup = groups[\"Delta 1-1\"];\ndeltaGroup.enqueue(new Assault([{ x: 21000, y: 17700 }], \"Clear Secondary Checkpoint\")\n    .withCombatBehaviour(\"AWARE\")\n    .signals(checkpointClear));\n\n// --- Phase 2: Overwatch and Containment ---\n\n// Charlie AT Groups - Flank East to cut off road access and monitor the heavy heli.\nconst charlie1 = groups[\"Charlie 1-1 AT\"];\nconst charlie2 = groups[\"Charlie 1-2 AT\"];\n\ncharlie1.enqueue(new Push([{ x: 21300, y: 18500 }, { x: 21300, y: 19200 }], \"East Flank Containment\")\n    .withCombatBehaviour(\"STEALTH\"));\ncharlie2.enqueue(new Push([{ x: 21400, y: 18500 }, { x: 21400, y: 19300 }], \"East Flank Containment (Depth)\")\n    .withCombatBehaviour(\"STEALTH\"));\n\n// Bravo GMG Groups - Move to high ground / line of sight South-West of FOB.\nconst bravo1 = groups[\"Bravo 1-1\"];\nconst bravo2 = groups[\"Bravo 1-2\"];\n\nbravo1.enqueue(new Wait(checkpointClear, \"Wait for checkpoint clear\"));\nbravo1.enqueue(new Push([{ x: 20750, y: 18800 }], \"South-West Overwatch\")\n    .withCombatBehaviour(\"AWARE\")\n    .signals(overwatchSet));\n\nbravo2.enqueue(new Wait(checkpointClear, \"Wait for checkpoint clear\"));\nbravo2.enqueue(new Push([{ x: 20850, y: 18800 }], \"South Overwatch\")\n    .withCombatBehaviour(\"AWARE\"));\n\n// Echo IFV - Deploy to West to provide suppressive fire and handle enemy MRAPs.\nconst echoIFV = groups[\"Echo 1-1 IFV\"];\nconst echoAssault = groups[\"Echo 1-2 Assault\"];\n\n// Embark Echo Assault squad into the IFV for transport\nechoAssault.enqueue(new Embark(echoIFV.getVehiclesByName(\"B_APC_Tracked_01_rcws_F\")[0], \"Mounting IFV\"));\nechoIFV.enqueue(new Wait(checkpointClear, \"Wait for checkpoint clear\"));\nechoIFV.enqueue(new Push([{ x: 20500, y: 19200 }], \"West Support Position\")\n    .withCombatBehaviour(\"AWARE\"));\n\n// --- Phase 3: Main Assault (The Lake-side Approach) ---\n\nconst alpha1Troops = groups[\"Alpha 1-1 Troops\"];\nconst alpha1Truck = groups[\"Alpha 1-2 Truck\"];\nconst alpha2Troops = groups[\"Alpha 2-1 Troops\"];\nconst alpha2Truck = groups[\"Alpha 2-2 Truck\"];\n\n// Alpha 1 & 2 - Flank far West then North to approach from the lake-side.\n// This bypasses the open fields and the watchtower's primary fire sector.\nalpha1Troops.enqueue(new Embark(alpha1Truck.getVehiclesByName(\"B_Truck_01_transport_F\")[0], \"Mounting Truck 1\"));\nalpha1Truck.enqueue(new Push([{ x: 20300, y: 18500 }, { x: 20300, y: 19500 }, { x: 20850, y: 19500 }], \"Lake-side Infiltration\")\n    .withCombatBehaviour(\"CARELESS\")); \nalpha1Truck.enqueue(new Disembark(\"Disembark North for Assault\").signals(assaultReady));\n\nalpha2Troops.enqueue(new Embark(alpha2Truck.getVehiclesByName(\"B_Truck_01_transport_F\")[0], \"Mounting Truck 2\"));\nalpha2Truck.enqueue(new Push([{ x: 20200, y: 18500 }, { x: 20200, y: 19600 }, { x: 20950, y: 19500 }], \"Lake-side Infiltration 2\")\n    .withCombatBehaviour(\"CARELESS\"));\nalpha2Truck.enqueue(new Disembark(\"Disembark North-East for Assault\"));\n\n// Final Breach - Synchronized push from North, supported by South/West fire.\nalpha1Troops.enqueue(new Wait(assaultReady, \"Ready to breach\"));\nalpha1Troops.enqueue(new Wait(overwatchSet, \"Wait for support fire\"));\nalpha1Troops.enqueue(new Assault([{ x: 20900, y: 19250 }, { x: 20900, y: 19200 }], \"Breach FOB Perimeter (North)\")\n    .withCombatBehaviour(\"COMBAT\"));\n\nalpha2Troops.enqueue(new Wait(assaultReady, \"Ready to breach\"));\nalpha2Troops.enqueue(new Wait(overwatchSet, \"Wait for support fire\"));\nalpha2Troops.enqueue(new Assault([{ x: 20950, y: 19250 }, { x: 20950, y: 19200 }], \"Breach FOB Perimeter (North-East)\")\n    .withCombatBehaviour(\"COMBAT\"));\n\n// Delta supports main assault from the South after clearing their initial objective.\ndeltaGroup.enqueue(new Push([{ x: 20900, y: 18500 }], \"Move to Support South\"));\ndeltaGroup.enqueue(new Wait(assaultReady, \"Wait for breach\"));\ndeltaGroup.enqueue(new Assault([{ x: 20900, y: 19150 }], \"Assault FOB from South\")\n    .withCombatBehaviour(\"COMBAT\"));\n",
        //     "description": "**OPERATION NEPTUNE'S BREATH**\n\n**1. Mission Objective**\nThe objective of this operation is to neutralize the CSAT Forward Operating Base (FOB) at **Grid 209 192**. We will achieve this by isolating the base, establishing suppressive overwatch, and executing a synchronized multi-axis assault, with the primary breach occurring from the \"lake-side\" (North) to bypass the enemy's optimal fields of fire.\n\n**2. Execution Plan**\n\n**Phase 1: Rear Security & Checkpoint Clearance**\n*   **Delta 1-1** will immediately move to and neutralize the secondary checkpoint at **Grid 210 177**. This ensures our rear is secure and prevents early warning or reinforcements from that sector. Completion of this task signals the start of Phase 2.\n\n**Phase 2: Isolation and Suppression**\n*   **Containment (East Flank):** **Charlie 1-1 AT** and **Charlie 1-2 AT** will execute a wide flank to the East (**Grid 213 192**). Their priority is to cut the primary road network and monitor the heavy cargo helicopter. They are to engage any vehicles attempting to enter or leave the FOB.\n*   **Overwatch (South-West):** **Bravo 1-1** and **Bravo 1-2** will move to high ground southwest of the FOB (**Grid 207 188**) to provide suppressive fire with their GMGs.\n*   **Support (West):** **Echo 1-1 (IFV)**, carrying the **Echo 1-2 Assault** squad, will take position West of the base (**Grid 205 192**) to provide heavy fire support and neutralize enemy MRAPs or the watchtower.\n\n**Phase 3: The Main Assault (Lake-side Breach)**\n*   **Alpha 1-1/2-1 (Infantry)** will embark on **Alpha 1-2/2-2 Trucks**. They will execute a deep western bypass to reach the northern side of the base (between the lake and the FOB perimeter at **Grid 208 195**).\n*   Once **Alpha** has disembarked and **Bravo/Echo** have established overwatch, a synchronized breach will occur. **Alpha** will assault from the North/North-East while **Delta 1-1** provides a secondary push from the South to fix the enemy defenders in place.\n\n**3. Coordination & Synchronization**\n*   **SyncPoint \"Checkpoint Clear\":** Triggers the movement of all support and transport groups.\n*   **SyncPoint \"Overwatch Set\":** Confirms suppressive fire is ready before the final breach.\n*   **SyncPoint \"Assault Ready\":** Signals that Alpha infantry have disembarked and are in position to start the assault.\n\n**4. Contingencies & Tactical Rules**\n*   **Casualty Protocol:** If any group sustains more than **35% casualties**, they are ordered to immediately break contact and retreat to the Rally Point at **Grid 207 175**.\n*   **Anti-Tank Threat:** If heavy armor or unforeseen AT threats are encountered, groups are instructed to report immediately. **Echo 1-1 (IFV)** is the primary counter to armored threats.\n*   **Aerial Extraction:** If the enemy helicopter attempts to take off, **Charlie AT** units are cleared to engage immediately.\n*   **Stealth:** The infiltration phase (Alpha and Charlie) will be conducted under **STEALTH** or **AWARE** behaviors to maximize the element of surprise."
        // }

        return startActiveObservation("PlanAgent", async (span) => {
            span.update({ input: { sitreps, intelResult } });

            return await propagateAttributes({ sessionId: this.session.getId() }, async () => {
                const groupPositions = new Map<string, Point>();
                for (const sitrep of sitreps) {
                    groupPositions.set(sitrep.groupId, sitrep.position);
                }

                let finalPlanCode = "";

                const visualizePlan = new FunctionTool({
                    name: "visualize_plan",
                    description: "Draws the plan on a map for visual evaluation.",
                    parameters: z.object({
                        code: z.string().describe("The JS code of the plan."),
                    }),
                    execute: async ({ code }) => {
                        return startActiveObservation("visualize_plan", async (toolSpan) => {
                            toolSpan.update({ input: { code } });
                            try {
                                const plan = await this.planSandbox.makePlan(army, code);
                                const viz = await this.planVisualizer.visualize(gameMapArea, plan, groupPositions);

                                const res = {
                                    primitives_path: viz.getImagePath('primitives'),
                                    satellite_path: viz.getImagePath('satellite')
                                };
                                toolSpan.update({
                                    output: {
                                        ...res,
                                        primitives_image: new LangfuseMedia({
                                            source: "bytes",
                                            contentBytes: fs.readFileSync(res.primitives_path),
                                            contentType: "image/png"
                                        }),
                                        satellite_image: new LangfuseMedia({
                                            source: "bytes",
                                            contentBytes: fs.readFileSync(res.satellite_path),
                                            contentType: "image/png"
                                        })
                                    }
                                });
                                return res;
                            } catch (e: any) {
                                const err = {
                                    error: e.message || String(e),
                                    name: e.name,
                                    stack: e.stack
                                };
                                toolSpan.update({ output: err });
                                return err;
                            }
                        }, { asType: "tool" });
                    },
                });

                const commitToPlan = new FunctionTool({
                    name: "commit_to_plan",
                    description: "Saves the plan code to be included in PlanningResult.",
                    parameters: z.object({
                        code: z.string().describe("The final confirmed JS code of the plan."),
                    }),
                    execute: async ({ code }) => {
                        return startActiveObservation("commit_to_plan", async (toolSpan) => {
                            toolSpan.update({ input: { code } });
                            try {
                                await this.planSandbox.makePlan(army, code);
                                finalPlanCode = code;
                                toolSpan.update({ output: { success: true } });
                                return { success: true };
                            } catch (e: any) {
                                const err = {
                                    error: e.message || String(e),
                                    name: e.name,
                                    stack: e.stack
                                };
                                toolSpan.update({ output: err });
                                return err;
                            }
                        }, { asType: "tool" });
                    },
                });

                const { system: systemPrompt, user: userPrompt, prompt: promptObj } = await this.formatter.formatPrompt(sitreps, intelResult);

                const agent = new LlmAgent({
                    name: "plan_agent",
                    model: "gemini-3-flash-preview",
                    description: "Plans operations.",
                    instruction: systemPrompt,
                    tools: [visualizePlan, commitToPlan],
                    beforeModelCallback: async ({ request }) => {
                        console.log(`\n--- [Callback Start: ${new Date().toISOString()}] ---`);

                        for (const content of request.contents || []) {
                            if (!content.parts) continue;
                            const modifiedParts: any[] = [];

                            for (const part of content.parts) {
                                modifiedParts.push(part);

                                if (part.functionResponse && part.functionResponse.name === 'visualize_plan') {
                                    const response = part.functionResponse.response as any;

                                    if (response.primitives_path) {
                                        console.log(`[Injecting Image] Primitives: ${response.primitives_path}`);
                                        modifiedParts.push({ text: `[Tool Response Artifact] Visualized map with primitives:` });
                                        modifiedParts.push({
                                            inlineData: {
                                                mimeType: 'image/png',
                                                data: fs.readFileSync(response.primitives_path).toString('base64')
                                            }
                                        });
                                    }

                                    if (response.satellite_path) {
                                        console.log(`[Injecting Image] Satellite: ${response.satellite_path}`);
                                        modifiedParts.push({ text: `[Tool Response Artifact] Visualized map with satellite layer:` });
                                        modifiedParts.push({
                                            inlineData: {
                                                mimeType: 'image/png',
                                                data: fs.readFileSync(response.satellite_path).toString('base64')
                                            }
                                        });
                                    }

                                    if (response.error) {
                                        console.log(`[Injecting Error] sandbox error: ${response.error}`);
                                        modifiedParts.push({ text: `[Tool Response Artifact] Tool execution failed! The sandbox encountered an error while evaluating your code:\n${response.error}\n${response.stack || ''}` });
                                    }
                                }
                            }
                            content.parts = modifiedParts;

                            // DETAILED LOGGING OF PARTS
                            console.log("MODIFIED PARTS STRUCTURE:");
                            content.parts.forEach((part, index) => {
                                const summary = summarizePart(part);
                                console.log(`  Part [${index}]: ${util.inspect(summary, { colors: true, depth: 3 })}`);
                            });
                        }

                        console.log(`--- [Callback End] ---\n`);
                        return undefined;
                    }
                });

                const runner = new Runner({
                    agent: agent,
                    sessionService: this.sessionService,
                    appName: "plan-akela"
                });



                const session = await this.sessionService.createSession({
                    appName: "plan-akela",
                    userId: process.env.SESSION_USER_ID || "akela_user",
                });

                const parts: any[] = [{ text: userPrompt }];
                parts.push({
                    inlineData: {
                        mimeType: 'image/png',
                        data: gameMapArea.getBase64Image('primitives')
                    }
                });
                parts.push({
                    inlineData: {
                        mimeType: 'image/png',
                        data: gameMapArea.getBase64Image('satellite')
                    }
                });

                const wrappedImages = [
                    new LangfuseMedia({
                        source: "bytes",
                        contentBytes: Buffer.from(gameMapArea.getBase64Image('primitives'), 'base64'),
                        contentType: "image/png"
                    }),
                    new LangfuseMedia({
                        source: "bytes",
                        contentBytes: Buffer.from(gameMapArea.getBase64Image('satellite'), 'base64'),
                        contentType: "image/png"
                    })
                ];

                let finalResponseText = "Agent did not produce a final response.";

                const generation = startObservation(
                    "PlanAgent-LLM",
                    {
                        model: "gemini-3-flash-preview",
                        input: { sitreps, intelResult, images: wrappedImages }
                    },
                    { asType: "generation" }
                );

                let sessionPromptTokens = 0;
                let sessionCandidatesTokens = 0;
                let sessionTotalTokens = 0;

                const eventStream = runner.runAsync({
                    sessionId: session.id,
                    userId: session.userId,
                    newMessage: {
                        role: 'user',
                        parts: parts
                    }
                });

                for await (const event of eventStream) {
                    if (event.usageMetadata) {
                        sessionPromptTokens += event.usageMetadata.promptTokenCount || 0;
                        sessionCandidatesTokens += event.usageMetadata.candidatesTokenCount || 0;
                        sessionTotalTokens += event.usageMetadata.totalTokenCount || 0;
                    }

                    console.log("DEBUG EVENT:", JSON.stringify(event, (k, v) => (k === 'data' && typeof v === 'string' && v.length > 200) ? '<base64 image removed>' : v, 2));

                    if (isFinalResponse(event)) {
                        if (event.content && event.content.parts && event.content.parts.length > 0) {
                            finalResponseText = event.content.parts[0].text || "";
                        } else if (event.actions && (event.actions as any).escalate) {
                            finalResponseText = `Agent escalated: ${(event as any).errorMessage || 'No specific message.'}`;
                        }
                        break;
                    }
                }

                generation.update({
                    prompt: promptObj,
                    usageDetails: {
                        input: sessionPromptTokens,
                        output: sessionCandidatesTokens,
                        total: sessionTotalTokens
                    },
                    output: { content: finalResponseText }
                });
                generation.end();

                span.update({
                    output: { code: finalPlanCode, description: finalResponseText }
                });

                return {
                    code: finalPlanCode,
                    description: finalResponseText
                };
            });
        });
    }
}

export interface ExecutionEvent {
    type: string;
}

export interface NewMessageToAgentEvent extends ExecutionEvent {
    type: "NEW_MESSAGE_TO_AGENT";
    message: string;
}

export interface AgentResponseEvent extends ExecutionEvent {
    type: "AGENT_RESPONSE";
    response: string;
}

export interface NewPlanEvent extends ExecutionEvent {
    type: "NEW_PLAN";
    code: string;
    plan: Plan;
}

type ExecutionSignal = TacticalReportEvent | InterventionCommand;

interface NextExecutionSignal {
    intervention?: InterventionCommand;
    report?: TacticalReportEvent;
}

const isInterventionCommand = (signal: ExecutionSignal): signal is InterventionCommand => {
    return (signal as InterventionCommand).targetAgent !== undefined
        && (signal as InterventionCommand).message !== undefined;
};

class ReportCollector {
    private readonly sessionId: string;
    private readonly batchDelayMs: number;
    private readonly interventionQueue: InterventionCommand[];
    private readonly reportQueue: TacticalReportEvent[] = [];
    private readonly getWaitResolver: () => ((val: ExecutionSignal) => void) | null;
    private readonly setWaitResolver: (resolver: ((val: ExecutionSignal) => void) | null) => void;

    constructor(opts: {
        sessionId: string;
        batchDelayMs: number;
        interventionQueue: InterventionCommand[];
        getWaitResolver: () => ((val: ExecutionSignal) => void) | null;
        setWaitResolver: (resolver: ((val: ExecutionSignal) => void) | null) => void;
    }) {
        this.sessionId = opts.sessionId;
        this.batchDelayMs = opts.batchDelayMs;
        this.interventionQueue = opts.interventionQueue;
        this.getWaitResolver = opts.getWaitResolver;
        this.setWaitResolver = opts.setWaitResolver;
    }

    public onIntervention(command: InterventionCommand): void {
        if (command.sessionId !== this.sessionId) {
            return;
        }
        const resolver = this.getWaitResolver();
        if (resolver) {
            this.setWaitResolver(null);
            resolver(command);
            return;
        }
        this.interventionQueue.push(command);
    }

    public onReport(report: TacticalReportEvent): void {
        const resolver = this.getWaitResolver();
        if (resolver) {
            this.setWaitResolver(null);
            resolver(report);
            return;
        }
        this.reportQueue.push(report);
    }

    public async collectNext(): Promise<NextExecutionSignal> {
        if (this.interventionQueue.length > 0) {
            return { intervention: this.interventionQueue.shift()! };
        }

        const firstSignal = this.reportQueue.length > 0
            ? this.reportQueue.shift()!
            : await this.waitForSignal();

        if (!firstSignal) {
            return {};
        }
        if (isInterventionCommand(firstSignal)) {
            return { intervention: firstSignal };
        }
        return await this.collectReportBatch(firstSignal);
    }

    public clearWaitResolver(): void {
        this.setWaitResolver(null);
    }

    private async collectReportBatch(firstReport: TacticalReportEvent): Promise<NextExecutionSignal> {
        const batchedReports: TacticalReportEvent[] = [firstReport];
        if (this.batchDelayMs <= 0) {
            return { report: firstReport };
        }

        const batchDeadline = Date.now() + this.batchDelayMs;
        while (Date.now() < batchDeadline) {
            if (this.interventionQueue.length > 0) {
                const intervention = this.interventionQueue.shift()!;
                this.reportQueue.unshift(...batchedReports);
                return { intervention };
            }

            const nextSignal = await this.waitForSignal(batchDeadline - Date.now());
            if (!nextSignal) {
                break;
            }
            if (isInterventionCommand(nextSignal)) {
                this.reportQueue.unshift(...batchedReports);
                return { intervention: nextSignal };
            }
            batchedReports.push(nextSignal);
        }

        const mergedMessage = batchedReports
            .map((report, idx) => `${idx + 1}. ${report.message}`)
            .join("\n");
        return {
            report: {
                ...batchedReports[batchedReports.length - 1],
                message: mergedMessage
            }
        };
    }

    private async waitForSignal(timeoutMs?: number): Promise<ExecutionSignal | undefined> {
        if (timeoutMs !== undefined && timeoutMs <= 0) {
            return undefined;
        }

        return await new Promise<ExecutionSignal | undefined>((resolve) => {
            let settled = false;
            let timeout: NodeJS.Timeout | undefined;

            this.setWaitResolver((signal) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (timeout) {
                    clearTimeout(timeout);
                }
                this.setWaitResolver(null);
                resolve(signal);
            });

            if (timeoutMs !== undefined) {
                timeout = setTimeout(() => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    this.setWaitResolver(null);
                    resolve(undefined);
                }, timeoutMs);
            }
        });
    }
}

export class ExecutionAgent {
    private promptFormatter: ExecutionPromptFormatter;
    private sessionService: BaseSessionService;
    private session: Session;
    private planSandbox: PlanSandbox;
    private sitrepFormatter: SitrepFormatter;
    private pendingInterventions: InterventionCommand[] = [];
    private waitForSignalResolver: ((val: TacticalReportEvent | InterventionCommand) => void) | null = null;

    constructor(promptFormatter: ExecutionPromptFormatter, sitrepFormatter: SitrepFormatter, sessionService: BaseSessionService, session: Session, planSandbox: PlanSandbox) {
        this.promptFormatter = promptFormatter;
        this.sessionService = sessionService;
        this.session = session;
        this.planSandbox = planSandbox;
        this.sitrepFormatter = sitrepFormatter;
    }

    public async *execute(army: Army, armyCombatMonitor: ArmyCombatMonitor, planning: PlanningResult): AsyncGenerator<ExecutionEvent> {
        let executionCode = "";
        let currentPlanResetMode: PlanSandboxResetMode = "full";

        const executePlan = new FunctionTool({
            name: "executePlan",
            description: "Executes the new plan in the sandbox",
            parameters: z.object({
                code: z.string().describe("The JS code of the plan."),
            }),
            execute: async ({ code }) => {
                return startActiveObservation("executePlan", async (toolSpan) => {
                    toolSpan.update({ input: { code } });
                    try {
                        // Try parsing code in sandbox to catch errors early
                        await this.planSandbox.makePlan(army, code, { resetMode: currentPlanResetMode });
                        executionCode = code;
                        toolSpan.update({ output: { success: true } });
                        return { success: true };
                    } catch (e: any) {
                        const err = {
                            error: e.message || String(e),
                            name: e.name,
                            stack: e.stack
                        };
                        toolSpan.update({ output: err });
                        return err;
                    }
                }, { asType: "tool" });
            },
        });

        const getSitreps = () => {
            const sitreps = [];
            for (const g of army.getGroups()) {
                const monitor = armyCombatMonitor.getGroupMonitor(g.id);
                if (monitor) {
                    sitreps.push(createSitrep(g, monitor));
                } else {
                    console.log(`ERROR: Couldn't format SITREP for group ${g.getName()} (id: ${g.id}): no combat monitor for this group.`);
                }
            }
            return sitreps;
        };

        const { system: systemPrompt, user: userMessage, prompt: promptObj } = await this.promptFormatter.formatPlanPrompt(getSitreps(), planning.description, planning.code);

        const agent = new LlmAgent({
            name: "execution_agnet",
            model: "gemini-3-flash-preview",
            description: "Executes the operation.",
            instruction: systemPrompt,
            contextCompactors: [new SitrepReducingCompactor({ recentEventsToKeep: 2, preserveLeadingEvents: 1 })],
            tools: [executePlan]
        });
        const runner = new Runner({
            agent: agent,
            sessionService: this.sessionService,
            appName: "execution-akela"
        });

        const session = await this.sessionService.createSession({
            appName: "execution-akela",
            userId: process.env.SESSION_USER_ID || "akela_user",
        });

        const decisionId = uuidv4();
        eventHub.publish(withEnvelope({
            source: "AI",
            type: "LLM_DECISION_START",
            decisionId: decisionId,
            trigger: "Initial Execution",
            sessionId: this.session.getId()
        }));

        const finalResponseText = await this.runPrompt(runner, session, userMessage, promptObj, decisionId);
        yield {
            type: "AGENT_RESPONSE",
            response: finalResponseText
        } as AgentResponseEvent;
        if (executionCode) {
            const plan = await this.planSandbox.makePlan(army, executionCode, { resetMode: currentPlanResetMode });
            yield {
                type: "NEW_PLAN",
                code: executionCode,
                plan: plan
            } as NewPlanEvent;
            executionCode = "";
        }

        const reportBatchDelaySecondsRaw = Number(process.env.EXECUTION_REPORT_BATCH_SECONDS ?? "0");
        const reportBatchDelayMs = Number.isFinite(reportBatchDelaySecondsRaw) && reportBatchDelaySecondsRaw > 0
            ? reportBatchDelaySecondsRaw * 1000
            : 0;
        const collector = new ReportCollector({
            sessionId: this.session.getId(),
            batchDelayMs: reportBatchDelayMs,
            interventionQueue: this.pendingInterventions,
            getWaitResolver: () => this.waitForSignalResolver,
            setWaitResolver: (resolver) => {
                this.waitForSignalResolver = resolver;
            },
        });

        const unsubscribeInterventions = runtimeState.subscribeInterventions((command) => {
            collector.onIntervention(command);
        });

        armyCombatMonitor.subscribe(event => {
            if (event.type == "TACTICAL_REPORT") {
                collector.onReport(event as TacticalReportEvent);
            }
        });

        try {
            while (true) {
                currentPlanResetMode = "preserveReactions";
                const { intervention: nextIntervention, report: nextReport } = await collector.collectNext();

                const sitreps = getSitreps();
                let userPrompt: string;
                let promptObj: any;
                let triggerText: string;

                if (nextIntervention) {
                    const interventionPrompt = await this.promptFormatter.formatInterventionPrompt(
                        sitreps,
                        nextIntervention.message,
                        nextIntervention.targetAgent
                    );
                    userPrompt = interventionPrompt.user;
                    promptObj = interventionPrompt.prompt;
                    triggerText = `Commander intervention: ${nextIntervention.message}`;
                } else if (nextReport) {
                    const reportPrompt = await this.promptFormatter.formatReportPrompt(sitreps, nextReport.message);
                    userPrompt = reportPrompt.user;
                    promptObj = reportPrompt.prompt;
                    triggerText = nextReport.message;
                } else {
                    // This should never be reached since one will have been set.
                    throw new Error("No signal received for agent step.");
                }
     

                const decisionId = uuidv4();
                eventHub.publish(withEnvelope({
                    source: "AI",
                    type: "LLM_DECISION_START",
                    decisionId: decisionId,
                    trigger: triggerText,
                    sessionId: this.session.getId()
                }));
                const finalResponseText = await this.runPrompt(runner, session, userPrompt, promptObj, decisionId);

                yield {
                    type: "AGENT_RESPONSE",
                    response: finalResponseText
                } as AgentResponseEvent;

                if (executionCode) {
                    const plan = await this.planSandbox.makePlan(army, executionCode, { resetMode: currentPlanResetMode });
                    yield {
                        type: "NEW_PLAN",
                        code: executionCode,
                        plan: plan
                    } as NewPlanEvent;
                    executionCode = "";
                }
            }
        } finally {
            collector.clearWaitResolver();
            unsubscribeInterventions();
        }
    }

    private async runPrompt(runner: Runner, session: ADKSession, prompt: string, promptObj: any, decisionId?: string): Promise<string> {
        return startActiveObservation("ExecutionAgentPrompt", async (span) => {
            span.update({ input: { prompt } });

            const attributes: any = { sessionId: this.session.getId() };
            if (decisionId) {
                attributes.tags = [`decision_id:${decisionId}`];
            }

            return await propagateAttributes(attributes, async () => {
                let finalResponseText = "Agent did not produce a final response.";
                const generation = startObservation(
                    "ExecutionAgent-LLM",
                    {
                        model: "gemini-3-flash-preview",
                        input: { prompt }
                    },
                    { asType: "generation" }
                );

                let sessionPromptTokens = 0;
                let sessionCandidatesTokens = 0;
                let sessionTotalTokens = 0;

                const eventStream = runner.runAsync({
                    sessionId: session.id,
                    userId: session.userId,
                    newMessage: {
                        role: "user",
                        parts: [{ text: prompt }]
                    }
                });

                for await (const event of eventStream) {
                    if (event.usageMetadata) {
                        sessionPromptTokens += event.usageMetadata.promptTokenCount || 0;
                        sessionCandidatesTokens += event.usageMetadata.candidatesTokenCount || 0;
                        sessionTotalTokens += event.usageMetadata.totalTokenCount || 0;
                    }

                    if (isFinalResponse(event)) {
                        if (event.content && event.content.parts && event.content.parts.length > 0) {
                            finalResponseText = event.content.parts[0].text || "";
                        } else if (event.actions && (event.actions as any).escalate) {
                            finalResponseText = `Agent escalated: ${(event as any).errorMessage || "No specific message."}`;
                        }
                        break;
                    }
                }

                generation.update({
                    prompt: promptObj,
                    usageDetails: {
                        input: sessionPromptTokens,
                        output: sessionCandidatesTokens,
                        total: sessionTotalTokens
                    },
                    output: { content: finalResponseText }
                });
                generation.end();

                span.update({
                    output: { response: finalResponseText }
                });
                return finalResponseText;
            });
        });
    };

}



export interface SitrepReducingCompactorOptions {
    /** * How many of the most recent messages should remain completely untouched?
     * (e.g., set to 2 to keep the current interaction full-detail)
     */
    recentEventsToKeep: number;
    /** * Keep the first X events in history untouched (initial grounding/instructions). 
     */
    preserveLeadingEvents?: number;
}

/**
 * A context compactor that removes SITREP_BLOCKs from older messages 
 * to reduce token count without losing the conversation history.
 */
export class SitrepReducingCompactor implements BaseContextCompactor {
    private readonly recentEventsToKeep: number;
    private readonly preserveLeadingEvents: number;
    private readonly sitrepRegex = /\[SITREP_BLOCK\][\s\S]*?\[\/SITREP_BLOCK\]/g;

    constructor(options: SitrepReducingCompactorOptions) {
        this.recentEventsToKeep = options.recentEventsToKeep;
        this.preserveLeadingEvents = options.preserveLeadingEvents ?? 0;
    }

    /**
     * Triggers if there are messages sitting between the "Leading" and "Recent" windows.
     */
    shouldCompact(invocationContext: InvocationContext): boolean {
        const eventsLength = invocationContext.session.events.length;
        // Compact only if there is a "middle" section to clean
        return eventsLength > (this.preserveLeadingEvents + this.recentEventsToKeep);
    }

    compact(invocationContext: InvocationContext): void {
        const events = invocationContext.session.events;

        // Determine the range of "middle" events that are candidates for stripping
        const startIndex = this.preserveLeadingEvents;
        const endIndex = events.length - this.recentEventsToKeep;

        for (let i = startIndex; i < endIndex; i++) {
            const event = events[i];

            // In ADK, event.content is an object { role: string, parts: Part[] }
            if (event.content && Array.isArray(event.content.parts)) {
                for (const part of event.content.parts) {
                    // Check if the part actually contains text before trying to replace
                    if (part.text) {
                        if (this.sitrepRegex.test(part.text)) {
                            part.text = part.text.replace(
                                this.sitrepRegex,
                                "[Old SITREP removed]"
                            );
                        }
                    }
                }
            }
        }
    }
}

function summarizePart(part: any) {
    if (part.text) return { type: 'text', content: part.text.substring(0, 50) + (part.text.length > 50 ? '...' : '') };
    if (part.functionCall) return { type: 'functionCall', name: part.functionCall.name };
    if (part.functionResponse) {
        const hasError = part.functionResponse.response && !!part.functionResponse.response.error;
        return {
            type: 'functionResponse',
            name: part.functionResponse.name,
            status: hasError ? 'error' : 'complete',
            error: hasError ? part.functionResponse.response.error : undefined
        };
    }
    if (part.inlineData) {
        return {
            type: 'inlineData',
            mimeType: part.inlineData.mimeType,
            data_size: `${(part.inlineData.data.length / 1024).toFixed(2)} KB`,
            preview: part.inlineData.data.substring(0, 20) + "..."
        };
    }
    return { type: 'unknown', keys: Object.keys(part) };
}