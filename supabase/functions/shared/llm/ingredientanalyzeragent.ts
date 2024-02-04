import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts"
import * as DB from '../db.ts'
import * as GenericAgent from './genericagent.ts'

enum SafetyRecommendation {
    MaybeUnsafe,
    DefinitelyUnsafe
}

type IngredientRecommendation = {
    ingredientName: string,
    safetyRecommendation: SafetyRecommendation
    reasoning: string
}

export async function ingredientAnalyzerAgent(
    ctx: Context,
    product: DB.Product,
    userPreferenceText: string)
    : Promise<IngredientRecommendation[]>
{
    let ingredientRecommendations: IngredientRecommendation[] = []

    async function record_not_safe_to_eat(parameters: { ingredients: IngredientRecommendation[] }): Promise<[any, boolean]> {

        const ingredients = parameters.ingredients
        ingredientRecommendations = ingredients
        return [ingredients, false]
    }

    function get_sub_ingredients_list(ingredients: DB.Ingredient[]): string {
        if (ingredients) {
            return ingredients.map((i) => i.name).join(', ')
        } else {
            return ''
        }
    }

    function get_ingredients_list() {
        return product.ingredients
            .map((i) => {
                return `${i.name}${get_sub_ingredients_list(i.ingredients)}`
            })
            .join(', ')
    }

    const functionObject = {
        record_not_safe_to_eat: record_not_safe_to_eat
    }

    const agentFunctions: GenericAgent.ChatFunction[] = [
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

    const systemMessage = `
        You are an expert in food and nutrition. You deeply understand the ingredients in
        packaged food items. Your task is to understand the user's dietary restrictions and
        preferences, and to analyze the ingredients in a product. You then provide a list
        of ingredients that do not agree with the user's dietary preferences, along with a
        reason for why they do not match the user's preferences. Limit recommendations to
        ingredients listed under the product.
    `

    const userMessage = `
        My dietary preferences and restrictions:
        ${userPreferenceText}

        Help me analyze this product:
        Name: ${product.name}
        Ingredients: ${get_ingredients_list()}
    `

    const messages: GenericAgent.ChatMessage[] = [
        {
            role: 'system',
            content: systemMessage
        },
        {
            role: 'user',
            content: userMessage
        }
    ]

    const _ = await GenericAgent.genericAgent(
        ctx,
        'ingredientanalyzeragent',
        messages,
        agentFunctions,
        GenericAgent.ModelName.GPT4turbo,
        functionObject,
        crypto.randomUUID(),
        []
    )

    return ingredientRecommendations
}