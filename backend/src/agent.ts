import { FunctionTool, InvocationContext, LlmAgent, Context, InMemoryRunner, BaseSessionService, Runner, isFinalResponse } from '@google/adk';
import { createUserContent } from '@google/genai';
import { z } from 'zod';
import * as fs from 'fs';
import path from 'path';
import { IntelPromptFormatter, PlanPromptFormatter } from './format';
import { Sitrep } from './sitrep';
import { GameMapArea, Point } from './geography';
import { PlanVisualization, PlanVisualizer } from './plan/visualization';
import { PlanSandbox } from './plan/sandbox';
import { Army } from './army';

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