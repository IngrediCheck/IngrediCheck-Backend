
import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as DB from '../shared/db.ts'
import { ingredientAnalyzerAgent } from '../shared/llm/ingredientanalyzeragent.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const MB = 1024 * 1024

export async function analyze(ctx: Context) {

    const startTime = new Date()
    let requestBody: any = {}
    let product = DB.defaultProduct()

    try {
        const body = ctx.request.body({ type: "form-data" })
        const formData = await body.value.read({ maxSize: 10 * MB })

        requestBody = {
            barcode: formData.fields['barcode'],
            userPreferenceText: formData.fields['userPreferenceText'],
            clientActivityId: formData.fields['clientActivityId']
        }

        ctx.state.clientActivityId = requestBody.clientActivityId

        if (requestBody.barcode !== undefined) {
            const result = await ctx.state.supabaseClient
                .from('log_inventory')
                .select()
                .eq('barcode', requestBody.barcode)
                .order('created_at', { ascending: false })
                .limit(1)
                .single()

            if (result.error) {
                throw result.error
            }

            product = result.data as DB.Product
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
        const hasValidPreferences = requestBody.userPreferenceText && 
                                    requestBody.userPreferenceText.trim() !== "" && 
                                    requestBody.userPreferenceText.trim().toLowerCase() !== "none"
        
        const ingredientRecommendations =
            product.ingredients && product.ingredients.length !== 0 && hasValidPreferences
                ? await ingredientAnalyzerAgent(ctx, product, requestBody.userPreferenceText)
                : []

        ctx.response.status = 200
        ctx.response.body = ingredientRecommendations
    } catch (error) {
        ctx.response.status = 500
        ctx.response.body = error instanceof Error ? error.message : String(error)
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