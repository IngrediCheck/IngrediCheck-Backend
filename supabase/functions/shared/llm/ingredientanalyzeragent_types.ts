
interface ChatFunction {
    name: string
    description?: string
    parameters: Record<string, unknown>
}

export const ingredientAnalyzerAgentSystemMessage = `
    You are an expert in food and nutrition. You deeply understand the ingredients in
    packaged food items. Your task is to understand the user's dietary restrictions and
    preferences, and to analyze the ingredients in a product. You then provide a list
    of ingredients that do not agree with the user's dietary preferences, along with a
    reason for why they do not match the user's preferences.
    
    Rules:
    - Recommendations must be relevant to user's stated preferences. Do not include
    any "FYI" recommendations.
    - Recommendations should only be for ingredients in this product.
`

export const ingredientAnalyzerAgentFunctions: ChatFunction[] = [
    {
        name: 'record_not_safe_to_eat',
        description: 'Record the ingredients that are not safe to eat',
        parameters: {
            type: 'object',
            properties: {
                ingredients: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            ingredientName: {
                                type: 'string'
                            },
                            safetyRecommendation: {
                                type: 'string',
                                enum: ['MaybeUnsafe', 'DefinitelyUnsafe']
                            },
                            preference: {
                                type: 'string'
                            },
                            reasoning: {
                                type: 'string'
                            }
                        },
                        required: ['ingredientName', 'safetyRecommendation', 'reasoning']
                    }
                }
            },
            required: ['ingredients']
        }
    }
]