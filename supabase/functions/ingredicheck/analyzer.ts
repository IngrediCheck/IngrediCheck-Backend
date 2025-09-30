import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts";
import * as DB from "../shared/db.ts";
import {
  ingredientAnalyzerAgent,
  IngredientRecommendation,
} from "../shared/llm/ingredientanalyzeragent.ts";
import * as Inventory from "./inventory.ts";

const MB = 1024 * 1024;

export type AnalysisRequest = {
  barcode?: string;
  userPreferenceText?: string;
  clientActivityId?: string;
};

export async function analyze(ctx: Context) {
  const startTime = new Date();
  let requestBody: AnalysisRequest = {};
  let responseBody: unknown = [];
  let responseStatus = 200;

  try {
    const body = ctx.request.body({ type: "form-data" });
    const formData = await body.value.read({ maxSize: 10 * MB });

    requestBody = {
      barcode: formData.fields["barcode"],
      userPreferenceText: formData.fields["userPreferenceText"],
      clientActivityId: formData.fields["clientActivityId"],
    };

    const result = await performAnalysis({
      ctx,
      requestBody,
    });

    responseStatus = 200;
    responseBody = result.recommendations;
  } catch (error) {
    responseStatus = 500;
    responseBody = error;
  }

  ctx.response.status = responseStatus;
  ctx.response.body = responseBody;

  await logAnalysisResult(
    ctx,
    startTime,
    requestBody,
    responseStatus,
    responseBody,
  );
}

export async function streamInventoryAndAnalysis(ctx: Context) {
  const barcode = ctx.params.barcode;
  const clientActivityId =
    ctx.request.url.searchParams.get("clientActivityId") ?? undefined;
  const userPreferenceText =
    ctx.request.url.searchParams.get("userPreferenceText") ?? undefined;

  const sse = ctx.sendEvents();

  if (!barcode) {
    sse.dispatchMessage({
      event: "error",
      data: JSON.stringify({ message: "Barcode is required." }),
    });
    sse.close();
    return;
  }

  const inventoryResult = await Inventory.fetchProduct({
    supabaseClient: ctx.state.supabaseClient,
    barcode,
    clientActivityId,
  });

  if (inventoryResult.status !== 200 || !inventoryResult.product) {
    const errorPayload = {
      message: inventoryResult.error ?? "Product not found.",
      status: inventoryResult.status,
    };
    sse.dispatchMessage({
      event: "error",
      data: JSON.stringify(errorPayload),
    });
    sse.close();
    return;
  }

  sse.dispatchMessage({
    event: "product",
    data: JSON.stringify(inventoryResult.product),
  });

  const analysisStartTime = new Date();

  const analysisRequest: AnalysisRequest = {
    barcode,
    userPreferenceText,
    clientActivityId,
  };

  try {
    const analysisResult = await performAnalysis({
      ctx,
      requestBody: analysisRequest,
      productOverride: inventoryResult.product,
    });

    sse.dispatchMessage({
      event: "analysis",
      data: JSON.stringify(analysisResult.recommendations),
    });

    await logAnalysisResult(
      ctx,
      analysisStartTime,
      analysisRequest,
      200,
      analysisResult.recommendations,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed.";

    sse.dispatchMessage({
      event: "error",
      data: JSON.stringify({ message }),
    });

    await logAnalysisResult(
      ctx,
      analysisStartTime,
      analysisRequest,
      500,
      { message },
    );
  } finally {
    sse.dispatchComment("done");
    sse.close();
  }
}

type PerformAnalysisOptions = {
  ctx: Context;
  requestBody: AnalysisRequest;
  productOverride?: DB.Product;
};

type PerformAnalysisResult = {
  product: DB.Product;
  recommendations: IngredientRecommendation[];
};

export async function performAnalysis(
  options: PerformAnalysisOptions,
): Promise<PerformAnalysisResult> {
  const { ctx, requestBody, productOverride } = options;

  ctx.state.clientActivityId = requestBody.clientActivityId;

  const product = productOverride ?? await lookupProduct(ctx, requestBody);

  const hasValidPreferences = requestBody.userPreferenceText &&
    requestBody.userPreferenceText.trim() !== "" &&
    requestBody.userPreferenceText.trim().toLowerCase() !== "none";

  const hasIngredients = Array.isArray(product.ingredients) &&
    product.ingredients.length > 0;

  const recommendations = hasValidPreferences && hasIngredients
    ? await ingredientAnalyzerAgent(
      ctx,
      product,
      requestBody.userPreferenceText!,
    )
    : [];

  return {
    product,
    recommendations,
  };
}

export async function logAnalysisResult(
  ctx: Context,
  startTime: Date,
  requestBody: AnalysisRequest,
  responseStatus: number,
  responseBody: unknown,
) {
  const endTime = new Date();

  try {
    await ctx.state.supabaseClient.functions.invoke(
      "background/log_analyzebarcode",
      {
        body: {
          activity_id: ctx.state.activityId,
          client_activity_id: ctx.state.clientActivityId,
          start_time: startTime,
          end_time: endTime,
          request_body: requestBody,
          response_status: responseStatus,
          response_body: responseBody,
        },
        method: "POST",
      },
    );
  } catch (error) {
    console.error("Failed to log analyze barcode event", error);
  }
}

async function lookupProduct(
  ctx: Context,
  requestBody: AnalysisRequest,
): Promise<DB.Product> {
  if (requestBody.barcode !== undefined) {
    const result = await ctx.state.supabaseClient
      .from("log_inventory")
      .select()
      .eq("barcode", requestBody.barcode)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (result.error) {
      throw result.error;
    }

    return result.data as DB.Product;
  }

  const result = await ctx.state.supabaseClient
    .from("log_extract")
    .select()
    .eq("client_activity_id", ctx.state.clientActivityId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (result.error) {
    throw result.error;
  }

  return {
    barcode: result.data.barcode,
    brand: result.data.brand,
    name: result.data.name,
    ingredients: result.data.ingredients ?? [],
    images: [],
  };
}
