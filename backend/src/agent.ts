import { BaseContextCompactor, FunctionTool, InvocationContext, LlmAgent, Context, InMemoryRunner, BaseSessionService, Runner, isFinalResponse, Session, BaseSummarizer, Event, CompactedEvent, stringifyContent, createEvent } from '@google/adk';
import { createUserContent } from '@google/genai';
import { int, z } from 'zod';
import * as fs from 'fs';
import path from 'path';
import { ExecutionPromptFormatter, IntelPromptFormatter, PlanPromptFormatter, SitrepFormatter } from './format';
import { createSitrep, Sitrep } from './sitrep';
import { GameMapArea, Point } from './geography';
import { PlanVisualization, PlanVisualizer } from './plan/visualization';
import { PlanSandbox } from './plan/sandbox';
import { Army, TacticalReportEvent } from './army';
import { Plan } from './plan/models';
import { ArmyCombatMonitor } from './combat';

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
    private agent: LlmAgent;
    private runner: Runner;

    constructor(formatter: IntelPromptFormatter, sessionService: BaseSessionService) {
        this.formatter = formatter;
        this.sessionService = sessionService;
        const systemPrompt = this.formatter.formatSystemPrompt();

        this.agent = new LlmAgent({
            name: "intel_agnet",
            model: "gemini-3.1-pro-preview",
            description: "Analyzes intelligence observations and images.",
            instruction: systemPrompt,
        });
        this.runner = new Runner({
            agent: this.agent,
            sessionService: sessionService,
            appName: "intel-akela"
        });
    }

    public async analyze(intel: Intel, maps: Maps): Promise<string> {
        const userPrompt = this.formatter.formatUserPrompt(intel.observations);

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

        let finalResponseText = "Agent did not produce a final response.";

        const eventStream = this.runner.runAsync({
            sessionId: session.id,
            userId: session.userId,
            newMessage: {
                role: 'user',
                parts: parts
            }
        });

        for await (const event of eventStream) {
            if (isFinalResponse(event)) {
                if (event.content && event.content.parts && event.content.parts.length > 0) {
                    finalResponseText = event.content.parts[0].text || "";
                } else if (event.actions && (event.actions as any).escalate) {
                    finalResponseText = `Agent escalated: ${(event as any).errorMessage || 'No specific message.'}`;
                }
                break;
            }
        }

        return finalResponseText;
    }
}

export interface PlanningResult {
    code: string;
    description: string;
}

export class PlanAgent {
    private formatter: PlanPromptFormatter;
    private sessionService: BaseSessionService;
    private planVisualizer: PlanVisualizer;
    private planSandbox: PlanSandbox;

    constructor(formatter: PlanPromptFormatter, sessionService: BaseSessionService, planSandbox: PlanSandbox, planVisualizer: PlanVisualizer) {
        this.formatter = formatter;
        this.sessionService = sessionService;
        this.planVisualizer = planVisualizer;
        this.planSandbox = planSandbox;
    }

    public async plan(army: Army, sitreps: Sitrep[], intelResult: string, gameMapArea: GameMapArea): Promise<PlanningResult> {
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
                const plan = await this.planSandbox.makePlan(army, code);
                const viz = await this.planVisualizer.visualize(gameMapArea, plan, groupPositions);

                return {
                    primitives_path: viz.getImagePath('primitives'),
                    satellite_path: viz.getImagePath('satellite')
                };
            },
        });

        const commitToPlan = new FunctionTool({
            name: "commit_to_plan",
            description: "Saves the plan code to be included in PlanningResult.",
            parameters: z.object({
                code: z.string().describe("The final confirmed JS code of the plan."),
            }),
            execute: async ({ code }) => {
                finalPlanCode = code;
                return { success: true };
            },
        });

        const systemPrompt = this.formatter.formatSystemPrompt();

        const agent = new LlmAgent({
            name: "plan_agent",
            model: "gemini-3.1-pro-preview",
            description: "Plans operations.",
            instruction: systemPrompt,
            tools: [visualizePlan, commitToPlan],
            beforeModelCallback: async ({ request }) => {
                for (const content of request.contents || []) {
                    if (!content.parts) continue;
                    const modifiedParts: any[] = [];
                    for (const part of content.parts) {
                        modifiedParts.push(part);

                        if (part.functionResponse && part.functionResponse.name === 'visualize_plan') {
                            const response = part.functionResponse.response as any;
                            if (response.primitives_path) {
                                modifiedParts.push({
                                    text: `[Tool Response Artifact] Visualized map with primitives:`
                                });
                                modifiedParts.push({
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: fs.readFileSync(response.primitives_path).toString('base64')
                                    }
                                });
                            }
                            if (response.satellite_path) {
                                modifiedParts.push({
                                    text: `[Tool Response Artifact] Visualized map with satellite layer:`
                                });
                                modifiedParts.push({
                                    inlineData: {
                                        mimeType: 'image/png',
                                        data: fs.readFileSync(response.satellite_path).toString('base64')
                                    }
                                });
                            }
                        }
                    }
                    content.parts = modifiedParts;
                }
                return undefined;
            }
        });

        const runner = new Runner({
            agent: agent,
            sessionService: this.sessionService,
            appName: "plan-akela"
        });

        const userPrompt = this.formatter.formatUserPrompt(sitreps, intelResult);

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

        let finalResponseText = "Agent did not produce a final response.";

        const eventStream = runner.runAsync({
            sessionId: session.id,
            userId: session.userId,
            newMessage: {
                role: 'user',
                parts: parts
            }
        });

        for await (const event of eventStream) {
            if (isFinalResponse(event)) {
                if (event.content && event.content.parts && event.content.parts.length > 0) {
                    finalResponseText = event.content.parts[0].text || "";
                } else if (event.actions && (event.actions as any).escalate) {
                    finalResponseText = `Agent escalated: ${(event as any).errorMessage || 'No specific message.'}`;
                }
                break;
            }
        }

        return {
            code: finalPlanCode,
            description: finalResponseText
        };
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

export class ExecutionAgent {
    private promptFormatter: ExecutionPromptFormatter;
    private sessionService: BaseSessionService;
    private planSandbox: PlanSandbox;
    private sitrepFormatter: SitrepFormatter;
    private sessionService: BaseSessionService;

    constructor(promptFormatter: ExecutionPromptFormatter, sitrepFormatter: SitrepFormatter, sessionService: BaseSessionService, planSandbox: PlanSandbox) {
        this.promptFormatter = promptFormatter;
        this.sessionService = sessionService;
        this.planSandbox = planSandbox;
        this.sitrepFormatter = sitrepFormatter;
        this.sessionService = sessionService;
    }

    public async *execute(army: Army, armyCombatMonitor: ArmyCombatMonitor, planning: PlanningResult): AsyncGenerator<ExecutionEvent> {
        let executionCode = "";

        const executePlan = new FunctionTool({
            name: "executePlan",
            description: "Executes the new plan in the sandbox",
            parameters: z.object({
                code: z.string().describe("The JS code of the plan."),
            }),
            execute: async ({ code }) => {
                executionCode = code;
                return { success: true };
            },
        });

        const agent = new LlmAgent({
            name: "execution_agnet",
            model: "gemini-3.1-pro-preview",
            description: "Executes the operation.",
            instruction: this.promptFormatter.formatSystemPrompt(),
            contextCompactors: [new SitrepReducingCompactor({ recentEventsToKeep: 2, preserveLeadingEvents: 1 })],
            tools: [executePlan]
        });
        const runner = new Runner({
            agent: agent,
            sessionService: this.sessionService,
            appName: "execution-akela"
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

        const session = await this.sessionService.createSession({
            appName: "execution-akela",
            userId: process.env.SESSION_USER_ID || "akela_user",
        });

        const userMessage = this.promptFormatter.formatUserPlanPrompt(getSitreps(), planning.description, planning.code);

        let finalResponseText = "Agent did not produce a final response.";

        const runPrompt = async (prompt: string) => {
            const eventStream = runner.runAsync({
                sessionId: session.id,
                userId: session.userId,
                newMessage: {
                    role: "user",
                    parts: [{ text: prompt }]
                }
            });

            for await (const event of eventStream) {
                if (isFinalResponse(event)) {
                    if (event.content && event.content.parts && event.content.parts.length > 0) {
                        finalResponseText = event.content.parts[0].text || "";
                    } else if (event.actions && (event.actions as any).escalate) {
                        finalResponseText = `Agent escalated: ${(event as any).errorMessage || "No specific message."}`;
                    }
                    break;
                }
            }
        };

        await runPrompt(userMessage);

        if (executionCode) {
            const plan = await this.planSandbox.makePlan(army, executionCode);
            yield {
                type: "NEW_PLAN",
                code: executionCode,
                plan: plan
            } as NewPlanEvent;
            executionCode = "";
        }

        let resolveNextReport: ((val: TacticalReportEvent) => void) | null = null;
        const reportQueue: TacticalReportEvent[] = [];

        armyCombatMonitor.subscribe(event => {
            if (event.type == "TACTICAL_REPORT") {
                const e = event as TacticalReportEvent;
                if (resolveNextReport) {
                    resolveNextReport(e);
                    resolveNextReport = null;
                } else {
                    reportQueue.push(e);
                }
            }
        });

        while (true) {
            let nextReport: TacticalReportEvent;
            if (reportQueue.length > 0) {
                nextReport = reportQueue.shift()!;
            } else {
                nextReport = await new Promise<TacticalReportEvent>(resolve => {
                    resolveNextReport = resolve;
                });
            }

            const prompt = this.promptFormatter.formatUserReportPrompt(getSitreps(), nextReport.message);
            await runPrompt(prompt);

            yield {
                type: "AGENT_RESPONSE",
                response: finalResponseText
            } as AgentResponseEvent;

            if (executionCode) {
                const plan = await this.planSandbox.makePlan(army, executionCode);
                yield {
                    type: "NEW_PLAN",
                    code: executionCode,
                    plan: plan
                } as NewPlanEvent;
                executionCode = "";
            }
        }
    }


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