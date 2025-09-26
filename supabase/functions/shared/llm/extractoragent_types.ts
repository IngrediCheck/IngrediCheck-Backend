export const extractorAgentSystemMessage = `
    You are an expert in reading OCR text of food product images. You specialize 
    in extracting name, brand, and list of ingredients from the OCR text
    of food product images.

    How to respond:
    - OCR text may have some spelling mistakes or inconsistencies. Use your superior
    built-in knowledge of food ingredients to:
        - correct any spelling mistakes in the OCR text.
        - Think critically about extracted data and fix any mistakes:
        e.g does it sound like a brand name?
        e.g does it sound like a product name?
        e.g does it sound like an ingredient name?
`;

import { ChatFunction } from "./types.ts";

export const extractorAgentFunctions: ChatFunction[] = [
  {
    name: "record_product_details",
    description: "Record the product details",
    parameters: {
      type: "object",
      properties: {
        product: {
          type: "object",
          properties: {
            brand: { type: "string" },
            name: { type: "string" },
            ingredients: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  ingredients: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        name: { type: "string" },
                        ingredients: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              name: { type: "string" },
                            },
                            required: ["name"],
                          },
                        },
                      },
                      required: ["name"],
                    },
                  },
                },
                required: ["name"],
              },
            },
          },
          required: ["ingredients"],
        },
      },
      required: ["product"],
    },
  },
];
