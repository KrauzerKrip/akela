import { FunctionTool, InvocationContext, LlmAgent, Context, InMemoryRunner, BaseSessionService, Runner, isFinalResponse } from '@google/adk';
import { createUserContent } from '@google/genai';
import { z } from 'zod';
import * as fs from 'fs';
import path from 'path';
import { IntelPromptFormatter, PlanPromptFormatter } from './format';
import { Sitrep } from './sitrep';

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



export class PlanAgent {
    private formatter: PlanPromptFormatter;
    private sessionService: BaseSessionService;
    private agent: LlmAgent;
    private runner: Runner;

    constructor(formatter: PlanPromptFormatter, sessionService: BaseSessionService) {
        this.formatter = formatter;
        this.sessionService = sessionService;
        const systemPrompt = this.formatter.formatSystemPrompt();

        this.agent = new LlmAgent({
            name: "intel_agnet",
            model: "gemini-3.1-pro-preview",
            description: "Plans operations.",
            instruction: systemPrompt,
        });
        this.runner = new Runner({
            agent: this.agent,
            sessionService: sessionService,
            appName: "plan-akela"
        });

        const visualizePlan = new FunctionTool({
            name: "visualize_plan",
            description: "Draws the plan on a map for visual evaluation.",
            parameters: z.object({
                code: z.string().describe("The JS code of the plan."),
            }),
            execute: ({ code }) => {

            },
        });
    }

    public async plan(sitreps: Sitrep[], maps: Maps): Promise<string> {
        const userPrompt = this.formatter.formatUserPrompt(sitreps);

        const session = await this.sessionService.createSession({
            appName: "plan-akela",
            userId: process.env.SESSION_USER_ID || "akela_user",
        });

        const parts: any[] = [{ text: userPrompt }];
        parts.push({
            inlineData: {
                mimeType: 'image/png',
                data: maps.primitives.getBase64()
            }
        });
        parts.push({
            inlineData: {
                mimeType: 'image/png',
                data: maps.sattelite.getBase64()
            }
        });

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