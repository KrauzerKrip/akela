import { FunctionTool, InvocationContext, LlmAgent, Context, InMemoryRunner, BaseSessionService, Runner, isFinalResponse } from '@google/adk';
import { createUserContent } from '@google/genai';
import { z } from 'zod';
import * as fs from 'fs';
import path from 'path';
import { IntelPromptFormatter } from './format';

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

    public async analyze(intel: Intel): Promise<string> {
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
