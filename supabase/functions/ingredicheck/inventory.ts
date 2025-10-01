import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts";
import * as DB from "../shared/db.ts";

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

export async function get(
  ctx: Context,
  barcode: string,
  clientActivityId: string | null,
) {
  const result = await getProductFromCache({
    supabaseClient: ctx.state.supabaseClient,
    barcode,
    clientActivityId: clientActivityId ?? undefined,
  });

  ctx.response.status = result.status;
  if (result.status === 200 && result.product) {
    ctx.response.body = result.product;
  } else {
    ctx.response.body = {
      error: result.error ?? "Product not found in cache.",
    };
  }
}
