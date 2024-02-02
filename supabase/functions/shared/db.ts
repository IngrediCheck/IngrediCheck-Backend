
export type Ingredient = {
    name: string,
    vegan: boolean,
    vegetarian: boolean,
    ingredients: Ingredient[],
}

export type Image = {
    url: string,
}

export type Product = {
    barcode: string,
    data_source: string,
    brand?: string,
    name: string,
    ingredients: Ingredient[],
    images: Image[],
}