import { Context } from "oak";

import { AgentProgram, ConversationState } from "./programs.ts";
import { ChatFunction, ChatMessage, FunctionObject } from "./types.ts";

function buildConversationState(
  agentName: string,
  temperature: number,
  messages: ChatMessage[],
  functions: ConversationState["functions"],
  functionObject: ConversationState["functionObject"],
): ConversationState {
  return {
    messages,
    agentName,
    temperature,
    functions,
    functionObject,
  };
}

export async function genericAgent(
  ctx: Context,
  program: AgentProgram,
  agentName: string,
  initialMessages: ChatMessage[],
  functions: ChatFunction[],
  functionObject: FunctionObject,
  conversationId: string,
  parentConversationIds: string[],
): Promise<ChatMessage[]> {
  const temperature = 0.0;

  const logs: Array<Record<string, unknown>> = [];
  const messages: ChatMessage[] = [...initialMessages];

  const conversationState = buildConversationState(
    agentName,
    temperature,
    messages,
    functions,
    functionObject,
  );

  let continueLoop = true;

  while (continueLoop) {
    const startTime = new Date();

    const { endpoint, init } = await program.buildPayload(
      ctx,
      conversationId,
      parentConversationIds,
      conversationState,
    );

    const response = await fetch(endpoint, init);
    const responseJson = await response.json();

    const { message: assistantMessage, finishReason } = program
      .parseAssistantMessage(responseJson);
    messages.push(assistantMessage);

    logs.push({
      id: crypto.randomUUID(),
      client_activity_id: ctx.state.clientActivityId,
      activity_id: ctx.state.activityId,
      conversation_id: conversationId,
      parentconversation_ids: parentConversationIds,
      start_time: startTime,
      end_time: new Date(),
      agent_name: agentName,
      model_provider: program.provider,
      model_name: program.model,
      temperature,
      function_call: finishReason,
      functions: functions.map((fn) => fn.name),
      messages,
      response: responseJson,
    });

    const toolCall = assistantMessage.tool_calls?.[0] ??
      (assistantMessage.function_call
        ? { function: assistantMessage.function_call }
        : undefined);

    if (finishReason === "tool_calls" && toolCall) {
      const functionName = toolCall.function.name;
      const args = toolCall.function.arguments;
      const handler = functionObject[functionName];

      if (!handler) {
        continueLoop = false;
        break;
      }

      let parsedArgs: Record<string, unknown> = {};
      if (args) {
        try {
          const maybeParsed = JSON.parse(args);
          if (
            maybeParsed &&
            typeof maybeParsed === "object" &&
            !Array.isArray(maybeParsed)
          ) {
            parsedArgs = maybeParsed as Record<string, unknown>;
          }
        } catch (_error) {
          // If arguments are not valid JSON, default to empty object to avoid crashing
        }
      }

      const functionResult = await handler(parsedArgs);

      let resultPayload: unknown;
      let shouldContinueFlag = false as boolean;

      if (Array.isArray(functionResult)) {
        const [payload, continueFlag] = functionResult;
        resultPayload = payload;
        shouldContinueFlag = typeof continueFlag === "boolean"
          ? continueFlag
          : false;
      } else {
        resultPayload = functionResult;
      }

      const functionMessage: ChatMessage = {
        role: "function",
        name: functionName,
        content: JSON.stringify(resultPayload),
      };

      messages.push(functionMessage);
      continueLoop = shouldContinueFlag;
    } else {
      if (program.finalize) {
        await program.finalize(
          ctx,
          conversationId,
          parentConversationIds,
          conversationState,
          assistantMessage,
        );
      }
      continueLoop = false;
    }
  }

  ctx.state.supabaseClient.functions.invoke("background/log_llmcalls", {
    body: logs,
    method: "POST",
  });

  return conversationState.messages;
}
