
import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as DB from '../shared/db.ts'
import { structuredAnalyzerAgent } from '../shared/llm/structuredanalyzeragent.ts'

const MB = 1024 * 1024

export async function analyze(ctx: Context) {

    const startTime = new Date()
    let requestBody: any = {}

    try {
        const body = ctx.request.body({ type: "form-data" })
        const formData = await body.value.read({ maxSize: 10 * MB })

        requestBody = {
            barcode: formData.fields['barcode'],
            userPreferenceText: formData.fields['userPreferenceText'],
            clientActivityId: formData.fields['clientActivityId']
        }

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

        const product = result.data as DB.Product

        const ingredientRecommendations =
            product.ingredients.length === 0
                ? []
                : await structuredAnalyzerAgent(ctx, product, requestBody.userPreferenceText)

        ctx.response.status = 200
        ctx.response.body = ingredientRecommendations
    } catch (error) {
        console.log(`Error analyzing barcode: ${error.message}`)
        ctx.response.status = 500
        ctx.response.body = error
    }

    const endTime = new Date()

    ctx.state.supabaseClient.functions.invoke('background/log_analyzebarcode', {
        body: {
            activity_id: ctx.state.activityId,
            client_activity_id: requestBody.clientActivityId,
            start_time: startTime,
            end_time: endTime,
            request_body: requestBody,
            response_status: ctx.response.status,
            response_body: ctx.response.body
        },
        method: 'POST'
    })
}

export async function rate(ctx: Context) {

    const body = ctx.request.body({ type: "form-data" })
    const formData = await body.value.read({ maxSize: 10 * MB })

    const requestBody = {
        clientActivityId: formData.fields['clientActivityId'],
        rating: formData.fields['rating']
    }

    const result = await ctx.state.supabaseClient
        .from('log_analyzebarcode')
        .update({
            feedback_rating: requestBody.rating
        })
        .match({
            client_activity_id: requestBody.clientActivityId
        })

    if (result.error) {
        console.log(`Error rating barcode: ${result.error.message}`)
        ctx.response.status = 500
        ctx.response.body = result.error
    }

    ctx.response.status = 200
}