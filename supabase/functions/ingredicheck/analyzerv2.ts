import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as DB from '../shared/db.ts'
import { extractorAgent } from '../shared/llm/extractoragent.ts'
import { ingredientAnalyzerAgent } from '../shared/llm/ingredientanalyzeragent.ts'
import { fetchOpenFoodFactsProduct } from '../shared/openfoodfacts.ts'

declare const EdgeRuntime: {
    waitUntil(promise: Promise<unknown>): void;
};

const MB = 1024 * 1024
const encoder = new TextEncoder()

type ProductImagesPayload = Array<Record<string, unknown>>

function formatSseEvent(event: string, data: unknown): Uint8Array {
    const payload = typeof data === 'string' ? data : JSON.stringify(data)
    return encoder.encode(`event: ${event}\ndata: ${payload}\n\n`)
}

function hasValidPreferences(preferences: string | undefined): boolean {
    if (!preferences) return false
    const normalized = preferences.trim()
    if (normalized === '') return false
    return normalized.toLowerCase() !== 'none'
}

export async function analyzeV2(ctx: Context) {
    const supabaseClient = ctx.state.supabaseClient
    const analyzeStartTime = new Date()

    let requestBody: Record<string, unknown> = {}

    try {
        const body = ctx.request.body({ type: 'form-data' })
        const formData = await body.value.read({ maxSize: 10 * MB })

        const rawBarcode = formData.fields['barcode']
        const rawProductImages = formData.fields['productImages']
        const rawUserPreferenceText = formData.fields['userPreferenceText']
        const rawClientActivityId = formData.fields['clientActivityId']

        const userPreferenceText = typeof rawUserPreferenceText === 'string' ? rawUserPreferenceText : undefined
        const clientActivityId = typeof rawClientActivityId === 'string' && rawClientActivityId.length > 0
            ? rawClientActivityId
            : undefined
        ctx.state.clientActivityId = clientActivityId

        const hasBarcode = typeof rawBarcode === 'string' && rawBarcode.trim() !== ''
        const hasProductImages = typeof rawProductImages === 'string' && rawProductImages.trim() !== ''

        if (!userPreferenceText) {
            ctx.response.status = 400
            ctx.response.body = { error: 'userPreferenceText is required' }
            return
        }

        if ((hasBarcode && hasProductImages) || (!hasBarcode && !hasProductImages)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Provide either barcode or productImages, but not both' }
            return
        }

        let productImages: ProductImagesPayload = []
        if (hasProductImages) {
            try {
                const parsed = JSON.parse(rawProductImages as string)
                if (!Array.isArray(parsed)) {
                    throw new Error('productImages must be a JSON array')
                }
                productImages = parsed
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                ctx.response.status = 400
                ctx.response.body = { error: `Invalid productImages payload: ${message}` }
                return
            }
        }

        requestBody = {
            barcode: hasBarcode ? rawBarcode : undefined,
            productImages: hasProductImages ? productImages : undefined,
            userPreferenceText,
            clientActivityId
        }

        let product: DB.Product = DB.defaultProduct()

        if (hasBarcode) {
            const inventoryLog: Record<string, unknown> = {
                start_time: new Date(),
                barcode: rawBarcode,
                data_source: 'openfoodfacts/v3',
                client_activity_id: clientActivityId
            }

            try {
                product = await fetchOpenFoodFactsProduct(rawBarcode as string)
                Object.assign(inventoryLog, product, { end_time: new Date() })
                EdgeRuntime.waitUntil(
                    supabaseClient.functions.invoke('background/log_inventory', {
                        body: inventoryLog,
                        method: 'POST'
                    })
                )
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                ctx.response.status = message.includes('Product not found') ? 404 : 500
                ctx.response.body = { error: message }
                inventoryLog.end_time = new Date()
                EdgeRuntime.waitUntil(
                    supabaseClient.functions.invoke('background/log_inventory', {
                        body: inventoryLog,
                        method: 'POST'
                    })
                )
                return
            }
        } else {
            const productImagesOCR = productImages.map((image) => image?.['imageOCRText'])
            const extractorResult = await extractorAgent(ctx, productImagesOCR)

            product = {
                ...(extractorResult as DB.Product),
                barcode: productImages.find((image) => image?.['barcode'] !== undefined)?.['barcode'] as string | undefined,
                images: productImages.map((image) => ({
                    imageFileHash: image?.['imageFileHash'],
                })) as DB.Image[]
            }

            EdgeRuntime.waitUntil(
                supabaseClient.functions.invoke('background/log_images', {
                    body: {
                        activity_id: ctx.state.activityId,
                        client_activity_id: clientActivityId,
                        product_images: productImages
                    },
                    method: 'POST'
                })
            )

            EdgeRuntime.waitUntil(
                supabaseClient.functions.invoke('background/log_extract', {
                    body: {
                        activity_id: ctx.state.activityId,
                        client_activity_id: clientActivityId,
                        start_time: analyzeStartTime,
                        end_time: new Date(),
                        response_status: 200,
                        barcode: product.barcode,
                        brand: product.brand,
                        name: product.name,
                        ingredients: product.ingredients,
                        images: product.images?.map((image: unknown) => {
                            if (typeof image === 'object' && image !== null && 'imageFileHash' in image) {
                                return (image as Record<string, unknown>)['imageFileHash']
                            }
                            return image
                        })
                    },
                    method: 'POST'
                })
            )
        }

        const stream = new ReadableStream({
            async start(controller) {
                let analysisResponse: unknown = []
                let responseStatus = 200
                const analysisStartTime = new Date()

                try {
                    controller.enqueue(formatSseEvent('product', product))

                    if (product.ingredients && product.ingredients.length !== 0 && hasValidPreferences(userPreferenceText)) {
                        analysisResponse = await ingredientAnalyzerAgent(ctx, product, userPreferenceText)
                    } else {
                        analysisResponse = []
                    }

                    controller.enqueue(formatSseEvent('analysis', analysisResponse))
                    controller.close()
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error)
                    responseStatus = message.includes('Product not found') ? 404 : 500
                    analysisResponse = { error: message }
                    ctx.response.status = responseStatus
                    controller.enqueue(formatSseEvent('error', analysisResponse))
                    controller.close()
                } finally {
                    const analysisEndTime = new Date()
                    EdgeRuntime.waitUntil(
                        supabaseClient.functions.invoke('background/log_analyzebarcode', {
                            body: {
                                activity_id: ctx.state.activityId,
                                client_activity_id: clientActivityId,
                                start_time: analysisStartTime,
                                end_time: analysisEndTime,
                                request_body: requestBody,
                                response_status: ctx.response.status ?? responseStatus,
                                response_body: analysisResponse
                            },
                            method: 'POST'
                        })
                    )
                }
            }
        })

        ctx.response.status = 200
        ctx.response.headers.set('Content-Type', 'text/event-stream')
        ctx.response.headers.set('Cache-Control', 'no-cache')
        ctx.response.headers.set('Connection', 'keep-alive')
        ctx.response.headers.set('X-Accel-Buffering', 'no')
        ctx.response.body = stream
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.response.status = 500
        ctx.response.body = { error: message }
        EdgeRuntime.waitUntil(
            supabaseClient.functions.invoke('background/log_analyzebarcode', {
                body: {
                    activity_id: ctx.state.activityId,
                    client_activity_id: ctx.state.clientActivityId,
                    start_time: analyzeStartTime,
                    end_time: new Date(),
                    request_body: requestBody,
                    response_status: ctx.response.status,
                    response_body: { error: message }
                },
                method: 'POST'
            })
        )
    }
}
