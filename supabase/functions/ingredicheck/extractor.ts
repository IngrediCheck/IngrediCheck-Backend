
import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as DB from '../shared/db.ts'
import { extractorAgent } from '../shared/llm/extractoragent.ts'

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

    await ctx.state.supabaseClient.functions.invoke('background/log_images', {
        body: {
            activity_id: ctx.state.activityId,
            client_activity_id: requestBody.clientActivityId,
            product_images: requestBody.productImages
        },
        method: 'POST'
    })

    await ctx.state.supabaseClient.functions.invoke('background/log_extract', {
        body: {
            activity_id: ctx.state.activityId,
            client_activity_id: requestBody.clientActivityId,
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