import * as DB from './db.ts'

export type OpenFoodFactsResponse = {
    status: string
    product: any
}

export type SelectedImages = {
    [key: string]: {
        display: {
            [key: string]: string
        }
    }
}

export type ImageUrl = {
    url: string
}

export async function fetchOpenFoodFactsProduct(barcode: string): Promise<DB.Product> {
    const url = `https://world.openfoodfacts.org/api/v3/product/${barcode}.json`
    const response = await fetch(url)
    const data: OpenFoodFactsResponse = await response.json()

    if (data.status === 'failure') {
        throw new Error(`Product not found: ${barcode}`)
    }

    return processOpenFoodFactsProductData(barcode, data.product)
}

export function extractDisplayImageUrls(selectedImages?: SelectedImages): ImageUrl[] {
    if (selectedImages) {
        return Object.values(selectedImages).flatMap(image => {
            if (image.display?.en) {
                return [{
                    url: image.display.en
                }]
            }
            return []
        })
    }
    return []
}

export function processOpenFoodFactsProductData(barcode: string, product: any) : DB.Product {

    let brand: string | undefined = undefined
    let name: string | undefined = undefined
    let ingredients: any[] = []

    if (product.brand_owner) {
        brand = product.brand_owner
    }

    if (product.product_name) {
        name = product.product_name
    }

    if (product.ingredients) {
        ingredients =
            product.ingredients.map((i: any) => {
                return {
                    name: i.text,
                    vegan: i.vegan,
                    vegetarian: i.vegetarian,
                    ingredients: i.ingredients?.map((i2: any) => {
                        return {
                            name: i2.text,
                            vegan: i2.vegan,
                            vegetarian: i2.vegetarian,
                            ingredients: i2.ingredients?.map((i3: any) => {
                                return {
                                    name: i3.text,
                                    vegan: i3.vegan,
                                    vegetarian: i3.vegetarian,
                                    ingredients: []
                                }
                            }) ?? []
                        }
                    }) ?? []
                }
            })
    }

    const images = extractDisplayImageUrls(product.selected_images)

    // Workaround for known issues with OpenFoodFacts data
    if (barcode === '0096619362776') {
        // Label says 'Contains No Animal Rennet', but ingredient list has 'Animal Rennet'.
        ingredients = ingredients.filter((i) => i.name !== 'Animal Rennet')
    }

    return {
        brand: brand,
        name: name,
        ingredients: ingredients,
        images: images
    }
}
