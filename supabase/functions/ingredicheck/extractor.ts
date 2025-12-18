/**
 * @deprecated This module is part of the legacy image extraction system.
 *
 * SUPERSEDED BY: The new v2 Scan API photo scan flow
 * - Submit images: POST /ingredicheck/v2/scan/{id}/image
 * - Extraction runs automatically via Python AI API
 * - Results stored in: scan_images.extraction_result + scans.product_info
 *
 * This legacy module:
 * - Extracts product info from images via extractorAgent
 * - Logs to legacy tables via background functions:
 *   - background/log_images (image metadata)
 *   - background/log_extract (extraction results)
 * - Uses client_activity_id for tracking (legacy system)
 * - Returns extraction inline, not stored for later retrieval
 *
 * The new scan system:
 * - Uploads images to scan_images table with status lifecycle
 * - Processes images asynchronously via Python AI API
 * - Stores extraction results in scan_images.extraction_result
 * - Accumulates product_info in scans table across multiple images
 *
 * DO NOT use this for new development.
 */
import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as DB from '../shared/db.ts'
import { extractorAgent } from '../shared/llm/extractoragent.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const MB = 1024 * 1024

export async function extract(ctx: Context) {
    
    const startTime = new Date()
    let requestBody: any = {}
    let product = DB.defaultProduct()

    try {
        const body = ctx.request.body({ type: "form-data" })
        const formData = await body.value.read({ maxSize: 10 * MB })

        requestBody = {
            clientActivityId: formData.fields['clientActivityId'],
            productImages: JSON.parse(formData.fields['productImages'])
        }

        ctx.state.clientActivityId = requestBody.clientActivityId

        const productImagesOCR = requestBody.productImages.map((i: any) => {
            return i.imageOCRText
        })

        const result = await extractorAgent(ctx, productImagesOCR)
        product = result as DB.Product
        product.barcode = requestBody.productImages.find((i: any) => {
            return i.barcode !== undefined
        })?.barcode
        product.images = requestBody.productImages.map((i: any) => {
            return {
                imageFileHash: i.imageFileHash,
            }
        })

        ctx.response.status = 200
        ctx.response.body = product
    } catch (error) {
        console.log(`Error extracting product: ${error.message}`)
        ctx.response.status = 500
        ctx.response.body = error
    }

    const endTime = new Date()

    EdgeRuntime.waitUntil(
        ctx.state.supabaseClient.functions.invoke('background/log_images', {
            body: {
                activity_id: ctx.state.activityId,
                client_activity_id: ctx.state.clientActivityId,
                product_images: requestBody.productImages
            },
            method: 'POST'
        })
    )

    await    ctx.state.supabaseClient.functions.invoke('background/log_extract', {
            body: {
                activity_id: ctx.state.activityId,
                client_activity_id: ctx.state.clientActivityId,
                start_time: startTime,
                end_time: endTime,
                response_status: ctx.response.status,
                barcode: product.barcode,
                brand: product.brand,
                name: product.name,
                ingredients: product.ingredients,
                images: product.images.map((i: any) => i.imageFileHash)
            },
            method: 'POST'
        })
}