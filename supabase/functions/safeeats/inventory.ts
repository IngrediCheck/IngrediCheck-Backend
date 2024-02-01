import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

export async function get(ctx: Context, barcode: string) {
    const url = `https://world.openfoodfacts.org/api/v3/product/${barcode}.json`
    const response = await fetch(url)
    const data = await response.json()

    console.log(`brand: ${data.product.brand_owner}`)
    console.log(`name: ${data.product.product_name}`)
    console.log(`ingredients: ${data.product.ingredients}`)
    console.log(`images: ${data.product.selected_images?.front?.display?.en}`)

    const response_json = {
        brand: data.product.brand_owner,
        name: data.product.product_name,
        ingredients: data.product.ingredients.map((i: any) => {
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
        }),
        images:
            data.product.selected_images?.front?.display?.en
            ?
            [
                {
                    url: data.product.selected_images.front.display.en
                }
            ]
            :
            []
    }

    ctx.response.status = 200
    ctx.response.body = response_json
}
