import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { load } from "https://deno.land/std@0.224.0/dotenv/mod.ts";
import { dirname, fromFileUrl, join } from "https://deno.land/std@0.224.0/path/mod.ts";

const scriptPath = fromFileUrl(import.meta.url);
const scriptDir = dirname(scriptPath);
const envPath = join(scriptDir, ".env");

const envConfig = await load({
    envPath: envPath,
});

async function fetchPreferenceValidatorDataset() {
    const url = envConfig["SUPABASE_URL"];
    const key = envConfig["SUPABASE_ACCESS_TOKEN"];

    if (!key) {
        console.error(`'SUPABASE_ACCESS_TOKEN' not set in ${envPath}`);
        Deno.exit(1);
    }

    // --- Verification Step ---
    const tokenStart = key.slice(0, 5);
    const tokenEnd = key.slice(-5);
    console.log(`Using token from .env file: ${tokenStart}...${tokenEnd}`);
    // -------------------------

    try {
        const supabase = createClient(url, key);

        // 1. Fetch all logs for the agent.
        const { data: allLogs, error } = await supabase
            .from("log_llmcall")
            .select("conversation_id, messages")
            .eq("agent_name", "preferenceValidatorAgent");

        if (error) {
            throw error;
        }

        // 2. Create a map of user prompts from "Input Rows" for efficient lookup.
        const userPrompts = new Map<string, string>();
        for (const log of allLogs) {
            const userMessage = log.messages?.find((m: any) => m.role === 'user');
            if (userMessage && userMessage.content) {
                userPrompts.set(log.conversation_id, userMessage.content);
            }
        }

        const outputDir = "local/finetuning/preferencevalidatordataset";
        await Deno.mkdir(outputDir, { recursive: true });
        const outputFilePath = `${outputDir}/dataset.jsonl`;

        let lines = 0;
        let fileContent = "";

        // 3. Iterate through logs to find "Output Rows" and match them with inputs.
        for (const log of allLogs) {
            try {
                const assistantMessage = log.messages?.find((m: any) => m.role === 'assistant' && m.function_call);
                if (!assistantMessage) {
                    continue; // This is not an output log.
                }

                const userPrompt = userPrompts.get(log.conversation_id);
                if (!userPrompt) {
                    continue; // No matching input found for this output.
                }

                // We have a valid pair, now process it.
                const functionCall = assistantMessage.function_call;
                const args = JSON.parse(functionCall.arguments);
                let outputString = "";

                if (functionCall.name === "report_success") {
                    outputString = `report_success("${args.annotatedPreference || ""}")`;
                } else if (functionCall.name === "report_failure") {
                    outputString = `report_failure("${args.explanation || ""}")`;
                }

                if (userPrompt && outputString) {
                    const jsonLine = {
                        input: userPrompt,
                        output: outputString,
                    };
                    fileContent += JSON.stringify(jsonLine) + "\n";
                    lines++;
                }
            } catch (parseError) {
                console.warn(`Skipping record for conversation ${log.conversation_id} due to error:`, parseError.message);
            }
        }

        await Deno.writeTextFile(outputFilePath, fileContent);
        console.log(`✅ Successfully wrote ${lines} records to ${outputFilePath}`);

    } catch (e) {
        console.error("An error occurred while fetching data from Supabase.");
        console.error("Please ensure your SUPABASE_ACCESS_TOKEN is a valid service_role key with the necessary permissions.");
        console.error("Error details:", e.message);
        Deno.exit(1);
    }
}

if (import.meta.main) {
    await fetchPreferenceValidatorDataset();
}
