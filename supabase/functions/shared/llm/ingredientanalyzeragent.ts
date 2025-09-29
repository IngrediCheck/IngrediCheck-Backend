import { Context } from "oak";
import * as DB from "../db.ts";
import { genericAgent } from "./genericagent.ts";
import {
  ingredientAnalyzerAgentFunctions,
} from "./ingredientanalyzeragent_types.ts";
import { createGeminiProgram } from "./programs.ts";
import { ChatMessage } from "./types.ts";

export type IngredientRecommendation = {
  ingredientName: string;
  safetyRecommendation: "MaybeUnsafe" | "DefinitelyUnsafe";
  reasoning: string;
  preference: string;
};

function getEnv(key: string): string | undefined {
  const g = globalThis as unknown as Record<string, unknown>;
  const deno = g["Deno"] as Record<string, unknown> | undefined;
  const denoEnv = deno && (deno["env"] as Record<string, unknown> | undefined);
  const denoGet = denoEnv && (denoEnv["get"] as ((k: string) => string | undefined) | undefined);
  const denoValue = denoGet ? denoGet(key) : undefined;
  if (typeof denoValue === "string") return denoValue;
  const nodeProcess = g["process"] as Record<string, unknown> | undefined;
  const nodeEnv = nodeProcess && (nodeProcess["env"] as Record<string, string | undefined> | undefined);
  const nodeValue = nodeEnv ? nodeEnv[key] : undefined;
  return typeof nodeValue === "string" ? nodeValue : undefined;
}

const geminiSystemPrompt = `Your input fields are:
1. \`dietary_preferences\` (list[str]): List of user's dietary preferences, restrictions, and ingredients to avoid
2. \`product_info\` (ProductInfo): Product information object with name, brand, and ingredients
Your output fields are:
1. \`reasoning\` (str): 
2. \`flagged_ingredients\` (list[FlaggedIngredient]): List of problematic ingredients with safety levels, matched preferences
All interactions will be structured in the following way, with the appropriate values filled in.

[[ ## dietary_preferences ## ]]
{dietary_preferences}

[[ ## product_info ## ]]
{product_info}

[[ ## reasoning ## ]]
{reasoning}

[[ ## flagged_ingredients ## ]]
{flagged_ingredients}        # note: the value you produce must adhere to the JSON schema: {"type": "array", "$defs": {"FlaggedIngredient": {"type": "object", "properties": {"name": {"type": "string", "title": "Name"}, "preference": {"type": "string", "title": "Preference"}, "safety": {"$ref": "#/$defs/SafetyLevel"}}, "required": ["name", "safety", "preference"], "title": "FlaggedIngredient"}, "SafetyLevel": {"type": "string", "enum": ["DefinitelyUnsafe", "MaybeUnsafe"], "title": "SafetyLevel"}}, "items": {"$ref": "#/$defs/FlaggedIngredient"}}

[[ ## completed ## ]]
In adhering to this structure, your objective is: 
        Analyze food products for dietary preference violations and safety concerns.

IMPORTANT: You must ALWAYS follow this exact format. Do not repeat yourself or go into loops. 
- Keep your reasoning concise and focused
- Always end with the [[ ## flagged_ingredients ## ]] section containing valid JSON
- Always end with [[ ## completed ## ]]
- Do not repeat the same analysis multiple times


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid sodium phosphate"]

[[ ## product_info ## ]]
{"name": "Example 093", "brand": null, "ingredients": "sodium phosphate, cheese"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "sodium phosphate", "safety": "DefinitelyUnsafe", "preference": "Avoid sodium phosphate", "reasoning": "Emulsifying salt."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid msg"]

[[ ## product_info ## ]]
{"name": "Tomato Soup", "brand": "CAMPBELL SOUP COMPANY", "ingredients": "tomato puree (water, tomato paste), high fructose corn syrup, wheat flour, water, contains less than 2% of (salt), potassium chloride, citric acid, natural flavoring, ascorbic acid (vitamin c), monopotassium phosphate, celery, garlic oil"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "high fructose corn syrup", "safety": "DefinitelyUnsafe", "preference": "Avoid msg", "reasoning": "High Fructose Corn Syrup can be a source of MSG."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Low FODMAP"]

[[ ## product_info ## ]]
{"name": "Vanilla Gut-Loving Prebiotic* Yoghurt", "brand": null, "ingredients": "yoghurt, live cultures, chicory root fibre, natural flavouring, madagascan vanilla bean extract"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "chicory root fibre", "safety": "DefinitelyUnsafe", "preference": "Low FODMAP", "reasoning": "Chicory root is high in FODMAPs."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid processed foods", "Avoid refined sugars", "Avoid phosphorus", "Avoid red meats", "Avoid high sodium"]

[[ ## product_info ## ]]
{"name": "Organic Light In Sodium Creamy Butternut Squash Soup", "brand": "The Hain Celestial Group, Inc.", "ingredients": "Filtered water, butternut squash, potatoes, onions, carrots, evaporated cane syrup, honey, tapioca starch, garlic, sea salt, spices, canola oil, safflower oil, sunflower oil"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "evaporated cane syrup", "safety": "DefinitelyUnsafe", "preference": "Avoid refined sugars", "reasoning": "Evaporated Cane Syrup is a form of refined sugar."}, {"name": "honey", "safety": "DefinitelyUnsafe", "preference": "Avoid refined sugars", "reasoning": "Honey is a form of refined sugar."}, {"name": "sea salt", "safety": "DefinitelyUnsafe", "preference": "Avoid high sodium", "reasoning": "Sea Salt is a source of sodium."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Lactose intolerant"]

[[ ## product_info ## ]]
{"name": "Cheddar Cheese", "brand": null, "ingredients": "Milk, salt, cultures, enzymes"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "Milk", "safety": "DefinitelyUnsafe", "preference": "Lactose intolerant", "reasoning": "Milk contains lactose."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["i don't like sugar"]

[[ ## product_info ## ]]
{"name": "Tesco Meat Free Mince", "brand": null, "ingredients": "Textured Soya Protein, Water, Salt, Cumin, Soya Bean, Wheat Flour, Glucose-Fructose Syrup, Vinegar, Black Pepper, Colour (Caramel), Thịckener (Xanthan Gum), Flavouring, Textured Soya Protein contains (Water), Soya Flour"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "Glucose-Fructose Syrup", "safety": "DefinitelyUnsafe", "preference": "i don't like sugar", "reasoning": "Glucose-Fructose Syrup is a form of sugar."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["no wheat", "no dairy", "no garlic", "no onion", "No Fodmaps for me"]

[[ ## product_info ## ]]
{"name": "Oaties", "brand": null, "ingredients": "Wholegrain Oats"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "Wholegrain Oats", "safety": "DefinitelyUnsafe", "preference": "no wheat", "reasoning": "Oats can be contaminated with wheat."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid all dairy"]

[[ ## product_info ## ]]
{"name": "Organic Plain Awesome Bagel", "brand": "Avb Corp.", "ingredients": "wheat flour, water, ancient grains blend (barley meal, dark rye flour, spelt flour, whole millet flour, quinoa flour), wheat gluten, cane sugar, thick rolled oats, canola oil, yeast, cultured wheat, vinegar, salt, rye flour, yellow cornmeal, wheat enzymes"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "cultured wheat", "safety": "MaybeUnsafe", "preference": "Avoid all dairy", "reasoning": "Cultured Wheat can sometimes refer to a product that has been cultured with dairy."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["avoid red 4", "avoid gelatin"]

[[ ## product_info ## ]]
{"name": "Chocolate Chip Chewy Granola Bar", "brand": "McKee Foods Corporation", "ingredients": "Granola (whole grain oats, sugar, palm kernel, soybean oils, corn syrup, coconut, honey, molasses, soy lecithin, salt, corn starch, peanuts, almonds, soy flour, egg whites), corn syrup, chocolate chips (sugar, chocolate, cocoa butter, dextrose, soy lecithin, vanilla, milk), crisp rice (rice flour, sugar, whey, salt, barley malt, wheat flour, dextrose), palm kernel, soybean oils, water, sorbitol, nonfat dry milk, soy lecithin, salt, sugar, carrageenan"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "carrageenan", "safety": "MaybeUnsafe", "preference": "avoid gelatin", "reasoning": "carrageenan is a gelatinous substance"}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid gluten"]

[[ ## product_info ## ]]
{"name": "Seitan Strips", "brand": null, "ingredients": "Wheat gluten, soy sauce, spices"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "Wheat gluten", "safety": "DefinitelyUnsafe", "preference": "Avoid gluten", "reasoning": "Pure gluten."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid msg"]

[[ ## product_info ## ]]
{"name": "Tomato Soup", "brand": "CAMPBELL SOUP COMPANY", "ingredients": "tomato puree (water, tomato paste), high fructose corn syrup, wheat flour, water, contains less than 2% of (salt), potassium chloride, citric acid, natural flavoring, ascorbic acid (vitamin c), monopotassium phosphate, celery, garlic oil"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "high fructose corn syrup", "safety": "DefinitelyUnsafe", "preference": "Avoid msg", "reasoning": "High Fructose Corn Syrup can be a source of MSG."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid msg"]

[[ ## product_info ## ]]
{"name": "Extra Large Shrimp", "brand": "NOT A BRANDED ITEM", "ingredients": "Shrimp, water, salt, sodium tripolyphosphate (to retain moisture)"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "sodium tripolyphosphate", "safety": "MaybeUnsafe", "preference": "Avoid msg", "reasoning": "Sodium tripolyphosphate can be a source of MSG."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid cashews"]

[[ ## product_info ## ]]
{"name": "Example 109", "brand": null, "ingredients": "cashews, sugar"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "cashews", "safety": "DefinitelyUnsafe", "preference": "Avoid cashews", "reasoning": "Tree nut present."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid disodium inosinate"]

[[ ## product_info ## ]]
{"name": "Flavor Enhancer", "brand": "Savory", "ingredients": "Salt, disodium inosinate, disodium guanylate"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "disodium inosinate", "safety": "DefinitelyUnsafe", "preference": "Avoid disodium inosinate", "reasoning": "Flavor enhancer related to MSG."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid HFCS"]

[[ ## product_info ## ]]
{"name": "Ketchup", "brand": null, "ingredients": "Tomato concentrate, high fructose corn syrup, vinegar, salt"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "high fructose corn syrup", "safety": "DefinitelyUnsafe", "preference": "Avoid HFCS", "reasoning": "Contains HFCS."}]

[[ ## completed ## ]]


User message:

This is an example of the task, though some input or output fields are not supplied.

[[ ## dietary_preferences ## ]]
["Avoid black pepper"]

[[ ## product_info ## ]]
{"name": "Pepper Sauce", "brand": "Heat", "ingredients": "Vinegar, black pepper, salt"}


Assistant message:

[[ ## reasoning ## ]]
Not supplied for this particular example. 

[[ ## flagged_ingredients ## ]]
[{"name": "black pepper", "safety": "MaybeUnsafe", "preference": "Avoid black pepper", "reasoning": "User avoids black pepper."}]

[[ ## completed ## ]]


User message:

[[ ## dietary_preferences ## ]]
["Avoid whey"]

[[ ## product_info ## ]]
{"name": "Protein Bar", "brand": null, "ingredients": "Whey protein isolate, almonds, cocoa, flavors"}
Respond with the corresponding output fields, starting with the field \`[[ ## reasoning ## ]]\`, then \`[[ ## flagged_ingredients ## ]]\` (must be formatted as a valid Python list[FlaggedIngredient]), and then ending with the marker for \`[[ ## completed ## ]]\`.


Response:

[[ ## reasoning ## ]]
The user wants to avoid whey. The product ingredients list includes "Whey protein isolate". Therefore, "Whey protein isolate" should be flagged as DefinitelyUnsafe.

[[ ## flagged_ingredients ## ]]
[{"name": "Whey protein isolate", "safety": "DefinitelyUnsafe", "preference": "Avoid whey"}]

[[ ## completed ## ]]`;

export async function ingredientAnalyzerAgent(
  ctx: Context,
  product: DB.Product,
  userPreferenceText: string,
): Promise<IngredientRecommendation[]> {
  const debug = getEnv("DEBUG_INGREDIENT_ANALYZER") === "true";
  if (debug) console.log("🥗 Starting ingredient analyzer agent...");
  if (debug) console.log("📦 Product:", product.name);
  if (debug) console.log("🏷️ Brand:", product.brand);
  if (debug) console.log("👤 User preferences:", userPreferenceText);
  if (debug) console.log("🧪 Ingredients count:", product.ingredients?.length || 0);

  let ingredientRecommendations: IngredientRecommendation[] = [];

  function record_not_safe_to_eat(
    parameters: Record<string, unknown>,
  ): [IngredientRecommendation[], boolean] {
    if (debug) console.log("🚨 Recording unsafe ingredients...");
    const raw = (parameters as { ingredients?: unknown }).ingredients;
    const ingredients = Array.isArray(raw) ? (raw as IngredientRecommendation[]) : [];
    if (debug) console.log("📊 Ingredients received:", ingredients.length);
    if (debug) {
      console.log(
        "📋 Ingredients:",
        ingredients.map((i) =>
          `${i.ingredientName} (${i.safetyRecommendation})`
        ),
      );
    }
    ingredientRecommendations = ingredients;
    if (debug) {
      console.log(
        "✅ Updated ingredient recommendations:",
        ingredientRecommendations.length,
      );
    }
    return [ingredients, false];
  }

  function get_sub_ingredients_list(ingredients: DB.Ingredient[]): string {
    if (ingredients) {
      return ingredients.map((i) => i.name).join(", ");
    } else {
      return "";
    }
  }

  function get_ingredients_depth(ingredients?: DB.Ingredient[]): number {
    ingredients = ingredients ?? [];
    let depth = 0;
    for (const i of ingredients) {
      depth = Math.max(depth, get_ingredients_depth(i.ingredients) + 1);
    }
    return depth;
  }

  function get_ingredients_list_depth2(ingredients?: DB.Ingredient[]) {
    ingredients = ingredients ?? [];
    return ingredients
      .map((i) => {
        if (i.ingredients && i.ingredients.length > 0) {
          return `${i.name} (${get_sub_ingredients_list(i.ingredients)})`;
        } else {
          return i.name;
        }
      })
      .join(", ");
  }

  function get_ingredients_list_depth3(ingredients?: DB.Ingredient[]) {
    ingredients = ingredients ?? [];
    return ingredients
      .map((i) => {
        if (i.ingredients && i.ingredients.length > 0) {
          return `${i.name}: (${get_ingredients_list_depth2(i.ingredients)})`;
        } else {
          return i.name;
        }
      })
      .join("\n");
  }

  function get_ingredients_list() {
    if (get_ingredients_depth(product.ingredients) === 3) {
      return get_ingredients_list_depth3(product.ingredients);
    } else {
      return get_ingredients_list_depth2(product.ingredients);
    }
  }

  const functionObject = {
    record_not_safe_to_eat,
  };

  const ingredientsList = get_ingredients_list();
  if (debug) console.log("📝 Generated ingredients list:", ingredientsList);

  const dietaryPreferencesJson = JSON.stringify([userPreferenceText]);
  const productInfoJson = JSON.stringify({
    name: product.name ?? null,
    brand: product.brand ?? null,
    ingredients: ingredientsList,
  });
  const userMessage = `[[ ## dietary_preferences ## ]]
${dietaryPreferencesJson}

[[ ## product_info ## ]]
${productInfoJson}`;

  if (debug) console.log("💬 User message length:", userMessage.length);
  if (debug) {
    console.log(
      "📄 User message preview:",
      userMessage.substring(0, 200) + "...",
    );
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: geminiSystemPrompt,
    },
    {
      role: "user",
      content: userMessage,
    },
  ];

  const program = createGeminiProgram({
    id: "ingredient-gemini",
    model: getEnv("INGREDIENT_ANALYZER_MODEL") ?? "gemini-2.5-flash-lite",
    stopSequences: ["[[ ## completed ## ]]"],
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_MEDIUM_AND_ABOVE",
      },
    ],
    parseFunction(content) {
      const flaggedMatch = content.match(
        /\[\[ ## flagged_ingredients ## \]\]\s*(.*?)(?=\[\[ ## completed ## \]\]|$)/s,
      );
      if (!flaggedMatch) {
        record_not_safe_to_eat({
          ingredients: [],
        });
        return;
      }
      const raw = flaggedMatch[1].trim();
      let parsed: Array<{
        name: string;
        safety: IngredientRecommendation["safetyRecommendation"];
        reasoning?: string;
        preference: string;
      }> = [];
      try {
        parsed = JSON.parse(raw) as Array<{
          name: string;
          safety: IngredientRecommendation["safetyRecommendation"];
          reasoning?: string;
          preference: string;
        }>;
      } catch (_error) {
        record_not_safe_to_eat({
          ingredients: [],
        });
        return;
      }
      const mapped: IngredientRecommendation[] = parsed.map((item) => ({
        ingredientName: item.name,
        safetyRecommendation: item.safety,
        reasoning: item.reasoning ?? "",
        preference: item.preference,
      }));
      record_not_safe_to_eat({
        ingredients: mapped,
      });
    },
  });

  if (debug) console.log("🤖 Calling genericAgent with Gemini model...");
  await genericAgent(
    ctx,
    program,
    "ingredientanalyzeragent",
    messages,
    ingredientAnalyzerAgentFunctions,
    functionObject,
    crypto.randomUUID(),
    [],
  );

  if (debug) console.log("🏁 Ingredient analyzer completed");
  if (debug) {
    console.log(
      "📊 Final recommendations count:",
      ingredientRecommendations.length,
    );
  }
  if (debug) console.log("📋 Final recommendations:", ingredientRecommendations);

  return ingredientRecommendations;
}
