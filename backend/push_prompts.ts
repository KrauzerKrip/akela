import { LangfuseClient } from '@langfuse/client';
import * as fs from 'fs';
import * as path from 'path';

const langfuse = new LangfuseClient();

const promptsDir = path.join(__dirname, 'src', 'prompts');

async function main() {
    const readPrompt = (name: string) => fs.readFileSync(path.join(promptsDir, name + '.md'), 'utf-8');

    const tasks = [
        {
            name: "intel_prompt",
            sys: "intel_system_prompt",
            user: "intel_user_prompt"
        },
        {
            name: "plan_prompt",
            sys: "plan_system_prompt",
            user: "plan_user_prompt"
        },
        {
            name: "execution_plan_prompt",
            sys: "execution_system_prompt",
            user: "execution_user_plan_prompt"
        },
        {
            name: "execution_report_prompt",
            sys: "execution_system_prompt",
            user: "execution_user_report_prompt"
        }
    ];

    for (const task of tasks) {
        try {
            const sysContent = readPrompt(task.sys);
            const userContent = readPrompt(task.user);

            await langfuse.prompt.create({
                name: task.name,
                type: "chat",
                prompt: [
                    { role: "system", content: sysContent },
                    { role: "user", content: userContent }
                ],
                labels: ["production"]
            });
            console.log(`Created chat prompt: ${task.name}`);
        } catch (e) {
            console.error(`Failed to create chat prompt ${task.name}:`, e);
        }
    }
}

main().catch(console.error);
