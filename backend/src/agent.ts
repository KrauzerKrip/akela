import { FunctionTool, InvocationContext, LlmAgent, Context, InMemoryRunner } from '@google/adk';
import { createUserContent } from '@google/genai';
import { z } from 'zod';

/* Mock tool implementation */
const getCurrentTime = new FunctionTool({
    name: 'get_current_time',
    description: 'Returns the current time in a specified city.',
    parameters: z.object({
        city: z.string().describe("The name of the city for which to retrieve the current time."),
    }),
    execute: ({ city }) => {
        return { status: 'success', report: `The current time in ${city} is 10:30 AM` };
    },
});

export const rootAgent = new LlmAgent({
    name: 'hello_time_agent',
    model: 'gemini-2.5-flash',
    description: 'Tells the current time in a specified city.',
    instruction: `You are a helpful assistant that tells the current time in a city.
                Use the 'getCurrentTime' tool for this purpose.`,
    tools: [getCurrentTime],
});

const runner = new InMemoryRunner({
    agent: rootAgent,
})

const session = await runner.sessionService.createSession({
    appName: "test_app",
    userId: "test_user"
})

const n = runner.runAsync({
    sessionId: session.id,
    userId: session.userId,
    newMessage: 
})

const newMessage = runner.runAsync({
    sessionId: session.id,
    userId: session.userId,
    newMessage: {
        role: "user",
        parts: [
            { text: "Test" },
            {
                inlineData: {

                }
            }
        ]
    }
})

rootAgent.runAsync(InvocationContext.)