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

export async function fetchProduct(
  options: InventoryFetchOptions,
): Promise<InventoryFetchResult> {
  const { supabaseClient, barcode, clientActivityId } = options;

  let product: DB.Product | null = null;
  let errorMessage: string | undefined;

  const log_json: Record<string, unknown> = {
    start_time: new Date(),
    barcode: barcode,
    data_source: "openfoodfacts/v3",
    client_activity_id: clientActivityId,
  };

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
      Object.assign(log_json, product);
    }
  } catch (error) {
    status = 500;
    errorMessage = (error as Error).message;
    console.error(`Failed to fetch product ${barcode}: ${errorMessage}`);
  }

  log_json.end_time = new Date();
  log_json.response_status = status;
  if (errorMessage) {
    log_json.error = errorMessage;
  }

  await supabaseClient.functions.invoke("background/log_inventory", {
    body: log_json,
    method: "POST",
  });

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
  const result = await fetchProduct({
    supabaseClient: ctx.state.supabaseClient,
    barcode,
    clientActivityId,
  });

  ctx.response.status = result.status;
  if (result.status === 200 && result.product) {
    ctx.response.body = result.product;
  } else {
    ctx.response.body = {
      error: result.error ?? "Unexpected inventory error.",
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
