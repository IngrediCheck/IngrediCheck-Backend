import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts";
import * as DB from "../shared/db.ts";

type InventoryFetchOptions = {
  supabaseClient: any;
  barcode: string;
  clientActivityId?: string | null;
};

type InventoryFetchResult = {
  status: number;
  product: DB.Product | null;
  error?: string;
};

type InventoryCacheOptions = {
  supabaseClient: any;
  barcode?: string;
  clientActivityId?: string;
};

type InventoryCacheResult = {
  status: number;
  product: DB.Product | null;
  error?: string;
};

/**
 * Queries the inventory_cache for a product by barcode.
 * If no barcode is provided, falls back to log_extract by clientActivityId.
 */
export async function getProductFromCache(
  options: InventoryCacheOptions,
): Promise<InventoryCacheResult> {
  const { supabaseClient, barcode, clientActivityId } = options;

  // Query inventory_cache if barcode is provided
  if (barcode !== undefined) {
    const result = await supabaseClient
      .from("inventory_cache")
      .select()
      .eq("barcode", barcode)
      .single();

    if (result.error) {
      return {
        status: 404,
        product: null,
        error: result.error.message ?? "Product not found in cache.",
      };
    }

    return {
      status: 200,
      product: result.data as DB.Product,
    };
  }

  // Fallback to log_extract if no barcode provided
  if (clientActivityId !== undefined) {
    const result = await supabaseClient
      .from("log_extract")
      .select()
      .eq("client_activity_id", clientActivityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (result.error) {
      return {
        status: 404,
        product: null,
        error: result.error.message ?? "Product not found in extract log.",
      };
    }

    return {
      status: 200,
      product: {
        barcode: result.data.barcode,
        brand: result.data.brand,
        name: result.data.name,
        ingredients: result.data.ingredients ?? [],
        images: [],
      },
    };
  }

  return {
    status: 400,
    product: null,
    error: "Either barcode or clientActivityId must be provided.",
  };
}

export async function fetchProduct(
  options: InventoryFetchOptions,
): Promise<InventoryFetchResult> {
  const { barcode } = options;

  let product: DB.Product | null = null;
  let errorMessage: string | undefined;
  let status = 200;

  try {
    const url =
      `https://world.openfoodfacts.org/api/v3/product/${barcode}.json`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.status === "failure") {
      console.log(
        `Unexpected product details: ${JSON.stringify(data, null, 2)}`,
      );
      status = 404;
      errorMessage = data.status_verbose || "Product not found.";
    } else {
      product = processOpenFoodFactsProductData(barcode, data.product);
    }
  } catch (error) {
    status = 500;
    errorMessage = (error as Error).message;
    console.error(`Failed to fetch product ${barcode}: ${errorMessage}`);
  }

  return {
    status,
    product,
    error: errorMessage,
  };
}

export async function get(
  ctx: Context,
  barcode: string,
  clientActivityId: string | null,
) {
  // First, try to get product from cache
  const cacheResult = await getProductFromCache({
    supabaseClient: ctx.state.supabaseClient,
    barcode,
    clientActivityId: clientActivityId ?? undefined,
  });

  // If found in cache, return it
  if (cacheResult.status === 200 && cacheResult.product) {
    ctx.response.status = 200;
    ctx.response.body = cacheResult.product;
    return;
  }

  // If not in cache, fetch from OpenFoodFacts (fetchProduct is still available as fallback)
  const fetchResult = await fetchProduct({
    supabaseClient: ctx.state.supabaseClient,
    barcode,
    clientActivityId,
  });

  ctx.response.status = fetchResult.status;
  if (fetchResult.status === 200 && fetchResult.product) {
    ctx.response.body = fetchResult.product;
  } else {
    ctx.response.body = {
      error: fetchResult.error ?? "Unexpected inventory error.",
    };
  }
}

type SelectedImages = {
  [key: string]: {
    display: {
      [key: string]: string;
    };
  };
};

type ImageUrl = {
  url: string;
};

function extractDisplayImageUrls(selectedImages?: SelectedImages): ImageUrl[] {
  if (selectedImages) {
    return Object.values(selectedImages).flatMap((image) => {
      if (image.display?.en) {
        return [{
          url: image.display.en,
        }];
      }
      return [];
    });
  }
  return [];
}

function processOpenFoodFactsProductData(
  barcode: string,
  product: any,
): DB.Product {
  let brand: string | undefined = undefined;
  let name: string | undefined = undefined;
  let ingredients: any[] = [];

  if (product.brand_owner) {
    brand = product.brand_owner;
  }

  if (product.product_name) {
    name = product.product_name;
  }

  if (product.ingredients) {
    ingredients = product.ingredients.map((i: any) => {
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
                ingredients: [],
              };
            }) ?? [],
          };
        }) ?? [],
      };
    });
  }

  const images = extractDisplayImageUrls(product.selected_images);

  // Workaround for known issues with OpenFoodFacts data
  if (barcode === "0096619362776") {
    // Label says 'Contains No Animal Rennet', but ingredient list has 'Animal Rennet'.
    ingredients = ingredients.filter((i) => i.name !== "Animal Rennet");
  }

  return {
    barcode: barcode,
    brand: brand,
    name: name,
    ingredients: ingredients,
    images: images,
  };
}
