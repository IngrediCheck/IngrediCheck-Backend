/**
 * @deprecated This module is part of the legacy inventory lookup system.
 *
 * SUPERSEDED BY: The new v2 Scan API barcode scan flow
 * - Barcode scan: POST /ingredicheck/v2/scan/barcode (SSE stream via Python AI API)
 * - Product info stored in: scans.product_info with product_info_source
 *
 * This legacy module:
 * - Looks up barcodes directly from OpenFoodFacts
 * - Logs to log_inventory table via background/log_inventory function
 * - Uses client_activity_id for tracking (legacy system)
 * - Returns product inline, not linked to any scan record
 *
 * The new scan system:
 * - Creates a scan record with the barcode
 * - Stores product_info in the scan with source tracking
 * - Automatically runs analysis and stores in scan_analyses
 * - Supports favorites, feedback, and re-analysis
 *
 * DO NOT use this for new development.
 */
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
