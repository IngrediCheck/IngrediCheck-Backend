import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts"
import * as DB from '../db.ts'
import * as GenericAgent from './genericagent.ts'
import {
    ingredientAnalyzerAgentFunctions,
    ingredientAnalyzerAgentSystemMessage
} from './ingredientanalyzeragent_types.ts'

enum SafetyRecommendation {
    MaybeUnsafe,
    DefinitelyUnsafe
}

type IngredientRecommendation = {
    ingredientName: string
    safetyRecommendation: SafetyRecommendation
    reasoning: string
    preference: string
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

    function get_ingredients_depth(ingredients?: DB.Ingredient[]): number {
        ingredients = ingredients ?? []
        let depth = 0
        for (const i of ingredients) {
            depth = Math.max(depth, get_ingredients_depth(i.ingredients) + 1)
        }
        return depth
    }

    function get_ingredients_list_depth2(ingredients?: DB.Ingredient[]) {
        ingredients = ingredients ?? []
        return ingredients
            .map((i) => {
                if (i.ingredients && i.ingredients.length > 0) {
                    return `${i.name} (${get_sub_ingredients_list(i.ingredients)})`
                } else {
                    return i.name
                }
            })
            .join(', ')
    }

    function get_ingredients_list_depth3(ingredients?: DB.Ingredient[]) {
        ingredients = ingredients ?? []
        return ingredients
            .map((i) => {
                if (i.ingredients && i.ingredients.length > 0) {
                    return `${i.name}: (${get_ingredients_list_depth2(i.ingredients)})`
                } else {
                    return i.name
                }
            })
            .join('\n')
    }

    function get_ingredients_list() {
        if (get_ingredients_depth(product.ingredients) === 3) {
            return get_ingredients_list_depth3(product.ingredients)
        } else {
            return get_ingredients_list_depth2(product.ingredients)
        }
    }

    const functionObject = {
        record_not_safe_to_eat: record_not_safe_to_eat
    }

    const userMessage = `
My dietary preferences and restrictions:
${userPreferenceText}
---------------------
Analyze this product:
Name: ${product.name}
Brand: ${product.brand}
Ingredients:
${get_ingredients_list()}
    `

    const messages: GenericAgent.ChatMessage[] = [
        {
            role: 'system',
            content: ingredientAnalyzerAgentSystemMessage
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
        ingredientAnalyzerAgentFunctions,
        GenericAgent.ModelName.IngredientAnalyzerFineTuned,
        functionObject,
        crypto.randomUUID(),
        []
    )

    return ingredientRecommendations
}