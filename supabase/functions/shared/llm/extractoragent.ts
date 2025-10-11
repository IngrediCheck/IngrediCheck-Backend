import { Context } from "oak";
import * as DB from "../db.ts";
import { genericAgent } from "./genericagent.ts";
import {
  extractorAgentFunctions,
  extractorAgentSystemMessage,
} from "./extractoragent_types.ts";
import { createOpenAIProgram } from "./programs.ts";
import { ChatMessage } from "./types.ts";

export async function extractorAgent(
  ctx: Context,
  productImagesOCR: string[],
): Promise<DB.Product> {
  let extractedProduct = DB.defaultProduct();

  async function record_product_details(
    parameters: { product: DB.Product },
  ): Promise<[any, boolean]> {
    extractedProduct = parameters.product;
    return [parameters.product, false];
  }

  const functionObject = {
    record_product_details: record_product_details,
  };

  const userMessage = productImagesOCR.join("\n---------------\n");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: extractorAgentSystemMessage,
    },
    {
      role: "user",
      content: userMessage,
    },
  ];

  const program = createOpenAIProgram({
    id: "extractor-openai-ft",
    model: "ft:gpt-4o-mini-2024-07-18:personal:extractor:9ob7B1Fq",
  });

  await genericAgent(
    ctx,
    program,
    "extractoragent",
    messages,
    extractorAgentFunctions,
    functionObject,
    crypto.randomUUID(),
    [],
  );

  return extractedProduct;
}
