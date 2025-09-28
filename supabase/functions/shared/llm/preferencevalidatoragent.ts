import { Context } from "oak";
import { genericAgent } from "./genericagent.ts";
import {
  preferenceValidatorAgentFunctions,
} from "./preferencevalidatoragent_types.ts";
import { createStructuredOutputProgram } from "./programs.ts";
import { ChatMessage } from "./types.ts";

const groqSystemPrompt = `Your input fields are:
1. \`input\` (str): User's ingredient preference. Can be in English, Spanish, Portuguese or Italian.
Your output fields are:
1. \`reasoning\` (str):
2. \`output\` (str):
        Analyze the input and determine if it represents a valid dietary preference that can be mapped to ingredients with the entire input statements and always return the output in English.
All interactions will be structured in the following way, with the appropriate values filled in.
[[ ## input ## ]]
{input}
[[ ## reasoning ## ]]
{reasoning}
[[ ## output ## ]]
{output}
[[ ## completed ## ]]
In adhering to this structure, your objective is:
        Analyze food products for dietary preference violations and safety concerns.
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Avoid carrageenan
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("Avoid **carrageenan**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Bajo en azúcar
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("**low sugar**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
I avoid meda and play oli
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("I avoid **maida** and **palm oil**.")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Only halal certified meat
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("Only **halal** certified **meat**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
More magnesium
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_failure("I cannot flag ingredients based on quantity yet")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Oats should be organic
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("**Oats** should be **organic**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Avoid added sugar
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("Avoid added **sugar**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Fuente de fibra
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("**source of fiber**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Less fat more protein
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_failure("I cannot flag ingredients based on quantity yet.")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Rico en antioxidantes
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("**rich in antioxidants**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Senza glutine
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("**no gluten**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
No alliums
Assistant message:
[[ ## reasoning ## ]]
Not supplied for this particular example.
[[ ## output ## ]]
report_success("No **alliums**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
A basso contenuto calorico
Assistant message:
[[ ## reasoning ## ]]
The phrase "A basso contenuto calorico" is Italian for "low calorie," which is a clear dietary preference that can be mapped to ingredients. Therefore it is a valid preference.
[[ ## output ## ]]
report_success("Low calorie")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
I avoid fat
Assistant message:
[[ ## reasoning ## ]]
The user states a clear dietary preference: "I avoid fat." This is a valid restriction that can be mapped to ingredient choices (e.g., avoiding high-fat foods, oils, and fatty cuts of meat). Therefore, we can acknowledge it as a successful preference.
[[ ## output ## ]]
report_success("I avoid **fat**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
No pickled vegetables
Assistant message:
[[ ## reasoning ## ]]
The user's statement "No pickled vegetables" is a clear dietary preference that can be mapped to ingredients (i.e., the user wants to avoid pickled vegetables). Therefore it is a valid preference and should be reported as a success.
[[ ## output ## ]]
report_success("No **pickled vegetables**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Rico em antioxidantes
Assistant message:
[[ ## reasoning ## ]]
The input "Rico em antioxidantes" is a dietary preference expressed in Portuguese. It translates to "Rich in antioxidants" in English. This is a valid preference that can be mapped to ingredients (foods high in antioxidants). Therefore, we should acknowledge it as a valid preference and format the response in English, highlighting the key term "antioxidants".
[[ ## output ## ]]
report_success("Rich in **antioxidants**")
[[ ## completed ## ]]
User message:
This is an example of the task, though some input or output fields are not supplied.
[[ ## input ## ]]
Low in added sugar
Respond with the corresponding output fields, starting with the field \`[[ ## reasoning ## ]]\`, then \`[[ ## output ## ]]\`, and then ending with the marker for \`[[ ## completed ## ]]\`.
Response:
[[ ## reasoning ## ]]
The phrase "Low in added sugar" is a clear dietary preference that can be mapped to ingredient choices (e.g., avoiding foods with added sugar). Therefore it is a valid preference.
[[ ## output ## ]]
report_success("Low added sugar")
[[ ## completed ## ]]`;

type PreferenceValidationResultSuccess = {
  result: "success";
  annotatedText: string;
};

type PreferenceValidationResultFailure = {
  result: "failure";
  explanation: string;
};

type PreferenceValidationResult =
  | PreferenceValidationResultSuccess
  | PreferenceValidationResultFailure;

export async function preferenceValidatorAgent(
  ctx: Context,
  userPreferenceText: string,
): Promise<PreferenceValidationResult> {
  let result: PreferenceValidationResult = {
    result: "success",
    annotatedText: userPreferenceText,
  };

  function report_success(
    parameters: { annotatedPreference: string },
  ): [string, boolean] {
    result = {
      result: "success",
      annotatedText: parameters.annotatedPreference,
    };
    return [
      parameters.annotatedPreference,
      false,
    ];
  }

  function report_failure(
    parameters: { explanation: string },
  ): [string, boolean] {
    result = {
      result: "failure",
      explanation: parameters.explanation,
    };
    return [
      parameters.explanation,
      false,
    ];
  }

  const functionObject = {
    report_success,
    report_failure,
  };

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: groqSystemPrompt,
    },
    {
      role: "user",
      content: userPreferenceText,
    },
  ];

  const model = Deno.env.get("PREFERENCE_VALIDATOR_MODEL") ?? "openai/gpt-oss-20b";
  const program = createStructuredOutputProgram({
    id: "preference-groq",
    provider: "groq",
    model,
    buildPayload: (_ctx, _conversationId, _parent, conversation) => {
      const apiKey = Deno.env.get("GROQ_API_KEY");
      return {
        endpoint: "https://api.groq.com/openai/v1/chat/completions",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey ?? ""}`,
          },
          body: JSON.stringify({
            model,
            temperature: conversation.temperature,
            messages: conversation.messages,
          }),
        },
      };
    },
    parseFunction: (content, conversation) => {
      const outputMatch = content.match(
        /\[\[ ## output ## \]\]\s*(.*?)(?=\[\[ ## completed ## \]\]|$)/s,
      );
      if (!outputMatch) {
        return conversation.functionObject.report_failure({
          explanation: "Could not parse structured output",
        });
      }
      const output = outputMatch[1].trim();
      if (output.startsWith("report_success(")) {
        const annotatedPreference =
          output.match(/^report_success\(\s*(["'])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)\s*$/)?.[2] ?? "";
        return conversation.functionObject.report_success({
          annotatedPreference,
        });
      }
      if (output.startsWith("report_failure(")) {
        const explanation =
          output.match(/^report_failure\(\s*(["'])((?:\\.|(?!\1)[\s\S])*?)\1\s*\)\s*$/)?.[2] ?? "";
        return conversation.functionObject.report_failure({ explanation });
      }
      return conversation.functionObject.report_failure({
        explanation: "Unknown structured output",
      });
    },
  });

  await genericAgent(
    ctx,
    program,
    "preferenceValidatorAgent",
    messages,
    preferenceValidatorAgentFunctions,
    functionObject,
    crypto.randomUUID(),
    [],
  );

  return result;
}
