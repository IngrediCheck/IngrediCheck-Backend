import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

export async function get(ctx: Context, barcode: string) {
    const url = `https://world.openfoodfacts.org/api/v3/product/${barcode}.json`
    const response = await fetch(url)
    const data = await response.json()
    ctx.response.status = 200
    ctx.response.body = data
}
