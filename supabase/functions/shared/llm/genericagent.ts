
import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts"

function parseGroqStructuredOutput(content: string, functionObject: any): any {
    // Parse the structured output format
    const reasoningMatch = content.match(/\[\[ ## reasoning ## \]\]\s*(.*?)(?=\[\[ ## output ## \]\]|$)/s)
    const outputMatch = content.match(/\[\[ ## output ## \]\]\s*(.*?)(?=\[\[ ## completed ## \]\]|$)/s)
    
    if (!outputMatch) {
        throw new Error('Could not parse structured output')
    }
    
    const output = outputMatch[1].trim()
    
    // Check if it's a success or failure
    if (output.startsWith('report_success(')) {
        const annotatedPreference = output.match(/report_success\("(.*)"\)/)?.[1]
        if (annotatedPreference) {
            return functionObject.report_success({ annotatedPreference })
        }
    } else if (output.startsWith('report_failure(')) {
        const explanation = output.match(/report_failure\("(.*)"\)/)?.[1]
        if (explanation) {
            return functionObject.report_failure({ explanation })
        }
    }
    
    throw new Error('Could not parse report function call')
}

export enum ModelName {
    GPT4 = 'gpt-4-1106-preview',
    GPT4turbo = 'gpt-4-0125-preview',
    GPT3dot5 = 'gpt-3.5-turbo-0125',
    ExtractorFineTuned = 'ft:gpt-4o-mini-2024-07-18:personal:extractor:9ob7B1Fq',
    IngredientAnalyzerFineTuned = 'ft:gpt-4o-mini-2024-07-18:personal:ingredientanalyzer:9ob52Sqn',
    // IngredientAnalyzerFineTuned = 'mixtral-8x7b-32768',
    // IngredientAnalyzerFineTuned = 'llama3-70b-8192',
    PreferenceValidatorFineTuned = 'ft:gpt-4o-mini-2024-07-18:personal:preferencevalidato:9obfhqlA',
    PreferenceValidatorGroq = 'openai/gpt-oss-20b',
    Mistral = 'mistralai/Mistral-7B-Instruct-v0.1',
    Mixtral = 'mistralai/Mixtral-8x7B-Instruct-v0.1'
}

export interface ChatFunctionCall {
    name: string
    arguments: string // JSON string
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant' | 'function'
    content: string | undefined
    function_call?: ChatFunctionCall
    name?: string
}

export interface ChatFunction {
    name: string
    description?: string
    parameters: Record<string, unknown>
}

function log_llmcall(
    ctx: Context,
    conversationId: string,
    parentConversationIds: string[],
    startTime: Date,
    agentName: string,
    temperature: number,
    functionCall: string,
    modelName: ModelName,
    modelProvider: string,
    messages: ChatMessage[],
    functions: ChatFunction[],
    response_json: any
) {
    return {
        id: crypto.randomUUID(),
        client_activity_id: ctx.state.clientActivityId,
        activity_id: ctx.state.activityId,
        conversation_id: conversationId,
        parentconversation_ids: parentConversationIds,
        start_time: startTime,
        end_time: new Date(),
        agent_name: agentName,
        model_provider: modelProvider,
        model_name: modelName,
        temperature: temperature,
        function_call: functionCall,
        functions: functions.map((f) => f.name),
        messages: messages,
        response: response_json,
    }
}

export async function genericAgent(
    ctx: Context,
    agentName: string,
    newMessages: ChatMessage[],
    functions: ChatFunction[],
    modelName: ModelName,
    functionObject: any,
    conversationId: string,
    parentConversationIds: string[]
): Promise<ChatMessage[]> {

    const endpoint =
        modelName.startsWith('mistralai')
            ? 'https://api.endpoints.anyscale.com/v1/chat/completions'
            : modelName.startsWith('mixtral-8x7b-32768') || modelName === ModelName.PreferenceValidatorGroq
                ? 'https://api.groq.com/openai/v1/chat/completions'
                : 'https://api.openai.com/v1/chat/completions'

    const apiKey =
        modelName.startsWith('mistralai')
            ? Deno.env.get("ANYSCALE_API_KEY")
            : modelName.startsWith('mixtral-8x7b-32768') || modelName === ModelName.PreferenceValidatorGroq
                ? Deno.env.get("GROQ_API_KEY")
                : Deno.env.get("OPENAI_API_KEY")

    const modelProvider =
        modelName.startsWith('mistralai')
            ? 'anyscale'
            : modelName.startsWith('mixtral-8x7b-32768') || modelName === ModelName.PreferenceValidatorGroq
                ? 'groq'
                : 'openai'

    const tools = functions.map((f) => ({
        type: 'function',
        function: f
    }))

    const temperature = 0.0
    const tool_choice = modelName === ModelName.PreferenceValidatorGroq ? 'none' : 'auto'

    const logs: any[] = []
    const messages: ChatMessage[] = []

    let done = false

    while (!done) {

        let startTime = new Date()
        let response = new Response()
        let response_json: any = {}

        try {

            messages.push(...newMessages)

            const requestBody: any = {
                model: modelName,
                temperature: temperature,
                messages: messages,
                tools: tools,
                tool_choice: tool_choice,
                store: true
            }

            // Only add metadata for non-Groq models
            if (modelName !== ModelName.PreferenceValidatorGroq) {
                requestBody.metadata = { agent_name: agentName }
            }

            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                body: JSON.stringify(requestBody)
            })

            response_json = await response.json()

            logs.push(log_llmcall(
                ctx,
                conversationId,
                parentConversationIds,
                startTime,
                agentName,
                temperature,
                tool_choice,
                modelName,
                modelProvider,
                newMessages,
                functions,
                response_json
            ))

        } catch(error) {
            logs.push(log_llmcall(
                ctx,
                conversationId,
                parentConversationIds,
                startTime,
                agentName,
                temperature,
                tool_choice,
                modelName,
                modelProvider,
                newMessages,
                functions,
                error
            ))
            break
        }

        if (response_json.error) {
            break
        }

        const assistantMessage = response_json.choices[0].message
        newMessages = [assistantMessage]
        messages.push(assistantMessage)

        switch (response_json.choices[0].finish_reason) {
            case 'tool_calls': {
                startTime = new Date()

                try {
                    const functionName = assistantMessage.tool_calls[0].function.name
                    const functionParameters = assistantMessage.tool_calls[0].function.arguments
                    // console.log(`Calling function ${functionName} with parameters ${functionParameters}`)
                    const functionResult = await functionObject[functionName](JSON.parse(functionParameters))

                    let actualResult: any
                    if (Array.isArray(functionResult) && functionResult.length === 2 && typeof functionResult[1] === 'boolean') {
                        actualResult = functionResult[0]
                        done = true
                    } else {
                        actualResult = functionResult
                    }

                    logs.push(log_llmcall(
                        ctx,
                        conversationId,
                        parentConversationIds,
                        startTime,
                        agentName,
                        temperature,
                        tool_choice,
                        modelName,
                        modelProvider,
                        [assistantMessage],
                        [],
                        actualResult
                    ))

                    newMessages = [{
                        role: 'function',
                        name: functionName,
                        content: JSON.stringify(actualResult),
                        function_call: undefined
                    }]
                    messages.push(...newMessages)

                } catch (error) {

                    logs.push(log_llmcall(
                        ctx,
                        conversationId,
                        parentConversationIds,
                        startTime,
                        agentName,
                        temperature,
                        tool_choice,
                        modelName,
                        modelProvider,
                        [assistantMessage],
                        [],
                        error
                    ))
                    done = true
                }
                break
            }
            case 'content_filter':
            case 'length':
            case 'stop':
            default: {
                // For Groq model, handle structured output parsing
                if (modelName === ModelName.PreferenceValidatorGroq) {
                    try {
                        const content = assistantMessage.content || ''
                        const result = parseGroqStructuredOutput(content, functionObject)
                        if (result) {
                            logs.push(log_llmcall(
                                ctx,
                                conversationId,
                                parentConversationIds,
                                startTime,
                                agentName,
                                temperature,
                                tool_choice,
                                modelName,
                                modelProvider,
                                [assistantMessage],
                                [],
                                result
                            ))
                        }
                    } catch (error) {
                        logs.push(log_llmcall(
                            ctx,
                            conversationId,
                            parentConversationIds,
                            startTime,
                            agentName,
                            temperature,
                            tool_choice,
                            modelName,
                            modelProvider,
                            [assistantMessage],
                            [],
                            error
                        ))
                    }
                }
                done = true
            }
        }
    }

    ctx.state.supabaseClient.functions.invoke('background/log_llmcalls', {
        body: logs,
        method: 'POST'
    })

    return messages
}