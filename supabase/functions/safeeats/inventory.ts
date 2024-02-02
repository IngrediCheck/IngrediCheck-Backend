import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

export async function get(ctx: Context, barcode: string) {
    const url = `https://world.openfoodfacts.org/api/v3/product/${barcode}.json`
    const response = await fetch(url)
    const data = await response.json()

    let brand: string | undefined = undefined
    let name: string | undefined = undefined
    let ingredients: any[] = []
    let images: any[] = []

    let result_json: any = {}
    let log_json: any = {
        barcode: barcode,
        data_source: 'openfoodfacts/v3',
    }

    if (data.status === 'failure') {
        console.log(`Unexpected product details: ${JSON.stringify(data, null, 2)}`)
        ctx.response.status = 404
    } else {
        // console.log(`brand: ${data.product.brand_owner}`)
        // console.log(`name: ${data.product.product_name}`)
        // console.log(`ingredients: ${data.product.ingredients}`)
        // console.log(`images: ${data.product.selected_images?.front?.display?.en}`)

        if (data.product.brand_owner) {
            brand = data.product.brand_owner
        }

        if (data.product.product_name) {
            name = data.product.product_name
        }

        if (data.product.ingredients) {
            ingredients =
                data.product.ingredients.map((i: any) => {
                    return {
                        name: i.text,
                        vegan: i.vegan,
                        vegetarian: i.vegetarian,
                        ingredients: i.ingredients?.map((i2: any) => {
                            return {
                                name: i2.text,
                                vegan: i2.vegan,
                                vegetarian: i2.vegetarian,
                                ingredients: []
                            }
                        })
                    }
                })
        }

        if (data.product.selected_images?.front?.display?.en) {
            images = [
                {
                    url: data.product.selected_images.front.display.en
                }
            ]
        }

        result_json = {
            brand: brand,
            name: name,
            ingredients: ingredients,
            images: images
        }

        log_json = {
            ...log_json,
            brand: brand,
            name: name,
            ingredients: ingredients,
            images: images
        }

        ctx.response.status = 200
    }

    ctx.state.supabaseClient.functions.invoke('background/log_inventory', {
        body: log_json,
        method: 'POST'
    })

    ctx.response.body = result_json
}
