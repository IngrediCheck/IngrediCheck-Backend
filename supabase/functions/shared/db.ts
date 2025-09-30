
export type Ingredient = {
    name: string
    note: string
    vegan?: boolean
    vegetarian?: boolean
    ingredients?: Ingredient[]
}

export type Image = {
    url: string
}

export type Product = {
    barcode?: string
    data_source?: string
    brand?: string
    name?: string
    ingredients?: Ingredient[]
    images: Image[]
}

export function defaultProduct(): Product {
    return {
        barcode: undefined,
        data_source: undefined,
        brand: undefined,
        name: undefined,
        ingredients: [],
        images: [],
    }
}