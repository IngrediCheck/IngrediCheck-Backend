
import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as DB from '../shared/db.ts'
import { ingredientAnalyzerAgent } from '../shared/llm/ingredientanalyzeragent.ts'
import { fetchOpenFoodFactsProduct } from '../shared/openfoodfacts.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const MB = 1024 * 1024

export async function analyze(ctx: Context) {

    const startTime = new Date()
    let requestBody: Record<string, unknown> = {}
    let product = DB.defaultProduct()

    try {
        const body = ctx.request.body({ type: "form-data" })
        const formData = await body.value.read({ maxSize: 10 * MB })

        requestBody = {
            barcode: formData.fields['barcode'] as string | undefined,
            userPreferenceText: formData.fields['userPreferenceText'] as string | undefined,
            clientActivityId: formData.fields['clientActivityId'] as string | undefined
        }

        ctx.state.clientActivityId = requestBody.clientActivityId

        if (requestBody.barcode !== undefined) {
            product = await fetchOpenFoodFactsProduct(requestBody.barcode as string)
        } else {
            const result = await ctx.state.supabaseClient
                .from('log_extract')
                .select()
                .eq('client_activity_id', ctx.state.clientActivityId)
                .order('created_at', { ascending: false })
                .limit(1)
                .single()
            
            if (result.error) {
                throw result.error
            }

            product = {
                barcode: result.data.barcode,
                brand: result.data.brand,
                name: result.data.name,
                ingredients: result.data.ingredients ?? [],
                images: []
            }
        }

        // Skip analyzer agent if user has no preferences set
        const userPreferenceText = requestBody.userPreferenceText as string | undefined
        const hasValidPreferences = userPreferenceText && 
                                    userPreferenceText.trim() !== "" && 
                                    userPreferenceText.trim().toLowerCase() !== "none"
        
        const ingredientRecommendations =
            product.ingredients && product.ingredients.length !== 0 && hasValidPreferences
                ? await ingredientAnalyzerAgent(ctx, product, userPreferenceText!)
                : []

        ctx.response.status = 200
        ctx.response.body = ingredientRecommendations
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        
        // Check if it's a "Product not found" error (404)
        if (errorMessage.includes('Product not found')) {
            ctx.response.status = 404
        } else {
            ctx.response.status = 500
        }
        
        ctx.response.body = { error: errorMessage }
    }

    const endTime = new Date()

    EdgeRuntime.waitUntil(
        ctx.state.supabaseClient.functions.invoke('background/log_analyzebarcode', {
            body: {
                activity_id: ctx.state.activityId,
                client_activity_id: ctx.state.clientActivityId,
                start_time: startTime,
                end_time: endTime,
                request_body: requestBody,
                response_status: ctx.response.status,
                response_body: ctx.response.body
            },
            method: 'POST'
        })
    )
}