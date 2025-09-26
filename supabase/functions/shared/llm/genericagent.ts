
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

function parseGeminiStructuredOutput(content: string, functionObject: any): any {
    console.log('🔍 Parsing Gemini structured output...')
    console.log('📝 Content length:', content.length)
    console.log('📄 Content preview:', content.substring(0, 200) + '...')
    
    // Check for repetitive content (looping issue)
    const contentLines = content.split('\n')
    const uniqueLines = new Set(contentLines)
    const repetitionRatio = uniqueLines.size / contentLines.length
    console.log('🔄 Content repetition ratio:', repetitionRatio.toFixed(2))
    
    if (repetitionRatio < 0.3) {
        console.warn('⚠️ Detected potential looping in Gemini response')
        console.log('📄 Content sample:', content.substring(0, 1000) + '...')
    }
    
    // Parse the structured output format for Gemini
    const reasoningMatch = content.match(/\[\[ ## reasoning ## \]\]\s*(.*?)(?=\[\[ ## flagged_ingredients ## \]\]|$)/s)
    const flaggedIngredientsMatch = content.match(/\[\[ ## flagged_ingredients ## \]\]\s*(.*?)(?=\[\[ ## completed ## \]\]|$)/s)
    
    console.log('🧠 Reasoning match found:', !!reasoningMatch)
    console.log('🏷️ Flagged ingredients match found:', !!flaggedIngredientsMatch)
    
    if (!flaggedIngredientsMatch) {
        console.error('❌ Could not find flagged_ingredients section in response')
        console.error('📄 Full content length:', content.length)
        console.error('📄 Content preview (first 1000 chars):', content.substring(0, 1000))
        console.error('📄 Content preview (last 1000 chars):', content.substring(Math.max(0, content.length - 1000)))
        
        // Check if content is too long (potential loop)
        if (content.length > 10000) {
            console.error('⚠️ Content is very long, likely due to looping')
            throw new Error('Gemini model entered a reasoning loop and failed to produce structured output')
        }
        
        throw new Error('Could not parse structured output - missing flagged_ingredients section')
    }
    
    const flaggedIngredientsJson = flaggedIngredientsMatch[1].trim()
    console.log('📋 Flagged ingredients JSON:', flaggedIngredientsJson)
    
    try {
        const flaggedIngredients = JSON.parse(flaggedIngredientsJson)
        console.log('✅ Successfully parsed flagged ingredients:', flaggedIngredients.length, 'items')
        
        // Map Gemini response format to expected IngredientRecommendation format
        const mappedIngredients = flaggedIngredients.map((item: any) => ({
            ingredientName: item.name,
            safetyRecommendation: item.safety, // Keep as string: 'DefinitelyUnsafe' or 'MaybeUnsafe'
            reasoning: item.reasoning || '',
            preference: item.preference
        }))
        
        console.log('🔄 Mapped ingredients:', mappedIngredients.length, 'items')
        return functionObject.record_not_safe_to_eat({ ingredients: mappedIngredients })
    } catch (error) {
        console.error('❌ JSON parsing error:', error)
        console.error('📄 Raw JSON string:', flaggedIngredientsJson)
        throw new Error('Could not parse flagged ingredients JSON: ' + (error instanceof Error ? error.message : String(error)))
    }
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
    IngredientAnalyzerGemini = 'gemini-2.5-flash-lite',
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
                : modelName === ModelName.IngredientAnalyzerGemini
                    ? 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent'
                    : 'https://api.openai.com/v1/chat/completions'

    const apiKey =
        modelName.startsWith('mistralai')
            ? Deno.env.get("ANYSCALE_API_KEY")
            : modelName.startsWith('mixtral-8x7b-32768') || modelName === ModelName.PreferenceValidatorGroq
                ? Deno.env.get("GROQ_API_KEY")
                : modelName === ModelName.IngredientAnalyzerGemini
                    ? Deno.env.get("GEMINI_API_KEY")
                    : Deno.env.get("OPENAI_API_KEY")

    const modelProvider =
        modelName.startsWith('mistralai')
            ? 'anyscale'
            : modelName.startsWith('mixtral-8x7b-32768') || modelName === ModelName.PreferenceValidatorGroq
                ? 'groq'
                : modelName === ModelName.IngredientAnalyzerGemini
                    ? 'gemini'
                    : 'openai'

    const tools = functions.map((f) => ({
        type: 'function',
        function: f
    }))

    const temperature = 0.0
    const tool_choice = (modelName === ModelName.PreferenceValidatorGroq || modelName === ModelName.IngredientAnalyzerGemini) ? 'none' : 'auto'
    
    // For Groq and Gemini models, don't include tools at all to prevent tool calling
    const shouldIncludeTools = modelName !== ModelName.PreferenceValidatorGroq && modelName !== ModelName.IngredientAnalyzerGemini

    const logs: any[] = []
    const messages: ChatMessage[] = []

    let done = false

    while (!done) {

        let startTime = new Date()
        let response = new Response()
        let response_json: any = {}

        try {

            messages.push(...newMessages)

            let requestBody: any
            let headers: any

            if (modelName === ModelName.IngredientAnalyzerGemini) {
                console.log('🤖 Using Gemini API for ingredient analysis...')
                console.log('🔑 API Key present:', !!apiKey)
                console.log('📊 Messages count:', messages.length)
                
                // Gemini API format
                const systemMessage = messages.find(m => m.role === 'system')
                const userMessages = messages.filter(m => m.role === 'user' || m.role === 'assistant')
                
                console.log('📝 System message present:', !!systemMessage)
                console.log('💬 User/Assistant messages:', userMessages.length)
                
                const parts = []
                if (systemMessage) {
                    parts.push({ text: systemMessage.content })
                    console.log('📋 System prompt length:', systemMessage.content?.length || 0)
                }
                for (const msg of userMessages) {
                    parts.push({ text: msg.content })
                    console.log('📝 Message role:', msg.role, 'length:', msg.content?.length || 0)
                }

                requestBody = {
                    contents: [{
                        parts: parts
                    }],
                    generationConfig: {
                        temperature: temperature,
                        maxOutputTokens: 4000,  // Limit response length to prevent loops
                        topP: 0.8,             // Reduce randomness to prevent repetitive patterns
                        topK: 40,              // Limit vocabulary choices
                        candidateCount: 1,     // Only generate one response
                        stopSequences: ["[[ ## completed ## ]]"]  // Stop at completion marker
                    },
                    safetySettings: [
                        {
                            category: "HARM_CATEGORY_HARASSMENT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        },
                        {
                            category: "HARM_CATEGORY_HATE_SPEECH", 
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        },
                        {
                            category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        },
                        {
                            category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                            threshold: "BLOCK_MEDIUM_AND_ABOVE"
                        }
                    ]
                }
                headers = {
                    'Content-Type': 'application/json',
                    'X-goog-api-key': apiKey
                }
                
                console.log('📤 Request body size:', JSON.stringify(requestBody).length)
                console.log('🌐 Endpoint:', endpoint)
                console.log('⚙️ Generation config:', JSON.stringify(requestBody.generationConfig))
                console.log('🛡️ Safety settings:', requestBody.safetySettings.length, 'categories')
            } else {
                // OpenAI/Groq/AnyScale API format
                requestBody = {
                    model: modelName,
                    temperature: temperature,
                    messages: messages
                }

                // Only add tools and tool_choice for non-Groq/Gemini models
                if (shouldIncludeTools) {
                    requestBody.tools = tools
                    requestBody.tool_choice = tool_choice
                    requestBody.store = true
                    requestBody.metadata = { agent_name: agentName }
                }

                headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                }
            }

            response = await fetch(endpoint, {
                method: 'POST',
                headers: headers,
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

        let assistantMessage: any
        if (modelName === ModelName.IngredientAnalyzerGemini) {
            console.log('📥 Processing Gemini response...')
            console.log('📊 Response status:', response.status)
            console.log('📋 Response keys:', Object.keys(response_json))
            
            if (response_json.candidates) {
                console.log('🎯 Candidates found:', response_json.candidates.length)
                if (response_json.candidates[0]) {
                    console.log('📝 First candidate keys:', Object.keys(response_json.candidates[0]))
                    if (response_json.candidates[0].content) {
                        console.log('📄 Content keys:', Object.keys(response_json.candidates[0].content))
                        if (response_json.candidates[0].content.parts) {
                            console.log('🧩 Parts count:', response_json.candidates[0].content.parts.length)
                        }
                    }
                }
            }
            
            // Parse Gemini response format
            let content = response_json.candidates?.[0]?.content?.parts?.[0]?.text || ''
            console.log('📄 Extracted content length:', content.length)
            console.log('📄 Content preview:', content.substring(0, 200) + '...')
            
            // Check for excessive content length (potential loop)
            if (content.length > 15000) {
                console.warn('⚠️ Content is very long, truncating to prevent loops')
                content = content.substring(0, 15000) + '\n\n[Content truncated due to length]'
            }
            
            assistantMessage = {
                role: 'assistant',
                content: content
            }
        } else {
            // Parse OpenAI/Groq/AnyScale response format
            assistantMessage = response_json.choices[0].message
        }
        
        newMessages = [assistantMessage]
        messages.push(assistantMessage)

        const finishReason = modelName === ModelName.IngredientAnalyzerGemini 
            ? response_json.candidates?.[0]?.finishReason || 'stop'
            : response_json.choices[0].finish_reason

        switch (finishReason) {
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
                // For Gemini model, handle structured output parsing
                else if (modelName === ModelName.IngredientAnalyzerGemini) {
                    console.log('🔍 Processing Gemini structured output...')
                    try {
                        const content = assistantMessage.content || ''
                        console.log('📄 Content to parse length:', content.length)
                        const result = parseGeminiStructuredOutput(content, functionObject)
                        console.log('✅ Structured output parsing successful')
                        if (result) {
                            console.log('📊 Result type:', typeof result)
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
                        console.error('❌ Gemini structured output parsing failed:', error)
                        
                        // Fallback: return empty array if parsing fails due to looping
                        if (error.message.includes('reasoning loop') || error.message.includes('missing flagged_ingredients section')) {
                            console.log('🔄 Using fallback: returning empty recommendations due to model looping')
                            const fallbackResult = functionObject.record_not_safe_to_eat({ ingredients: [] })
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
                                fallbackResult
                            ))
                        } else {
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