import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import { fetchOpenFoodFactsProduct } from '../shared/openfoodfacts.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

export async function get(ctx: Context, barcode: string, clientActivityId: string | null) {

    let result_json: Record<string, unknown> = {}
    let log_json: Record<string, unknown> = {
        start_time: new Date(),
        barcode: barcode,
        data_source: 'openfoodfacts/v3',
        client_activity_id: clientActivityId,
    }

    try {
        result_json = await fetchOpenFoodFactsProduct(barcode)
        log_json = {
            ...log_json,
            ...result_json
        }
        ctx.response.status = 200
    } catch (error) {
        console.log(`Unexpected product details: ${error instanceof Error ? error.message : String(error)}`)
        ctx.response.status = 404
    }

    log_json.end_time = new Date()

    EdgeRuntime.waitUntil(
        ctx.state.supabaseClient.functions.invoke('background/log_inventory', {
            body: log_json,
            method: 'POST'
        })
    )

    ctx.response.body = result_json
}
