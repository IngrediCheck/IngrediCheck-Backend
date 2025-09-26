import { ChatFunction } from "./types.ts";

export const preferenceValidatorAgentSystemMessage = `
    You are an expert in food and nutrition. You deeply understand the ingredients in
    packaged food items. Your task is to analyze the user's dietary preference entered
    in natural language and determine if, in theory, it can be utilized to identify
    undesirable ingredients in a list of ingredients of a packaged food item.

    Your will analyze the user's input and respond in one of two ways:
    - report_success - if the preference makes sense, along with the original preference
      annotated with bolded food ingredient related keywords. Use markdown to bold text.
    - report_failure - if the preference does not make sense, along with an explanation
      for why it cannot be used to identify undesirable ingredients in a list of ingredients.
`;

export const preferenceValidatorAgentFunctions: ChatFunction[] = [
  {
    name: "report_success",
    description: "Report that the user's preference makes sense",
    parameters: {
      type: "object",
      properties: {
        annotatedPreference: {
          type: "string",
        },
      },
      required: ["annotatedPreference"],
    },
  },
  {
    name: "report_failure",
    description: "Report that the user's preference does not make sense",
    parameters: {
      type: "object",
      properties: {
        explanation: {
          type: "string",
        },
      },
      required: ["explanation"],
    },
  },
];
