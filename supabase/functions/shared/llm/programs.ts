import { Context } from "oak";

import { ChatFunction, ChatMessage, FunctionObject } from "./types.ts";

export type ModelProvider = "openai" | "gemini" | "groq" | "anyscale";

export interface ConversationState {
  messages: ChatMessage[];
  agentName: string;
  temperature: number;
  functions: ChatFunction[];
  functionObject: FunctionObject;
}

export interface AgentProgram {
  id: string;
  provider: ModelProvider;
  model: string;
  buildPayload(
    ctx: Context,
    conversationId: string,
    parentConversationIds: string[],
    conversation: ConversationState,
  ): Promise<{ endpoint: string; init: RequestInit }>;
  parseAssistantMessage(rawResponse: unknown): {
    message: ChatMessage;
    finishReason: string;
    responseJson: Record<string, unknown>;
  };
  finalize?(
    ctx: Context,
    conversationId: string,
    parentConversationIds: string[],
    conversation: ConversationState,
    assistantMessage: ChatMessage,
  ): Promise<unknown>;
  supportsTools?: boolean;
}

interface OpenAIProgramConfig {
  id: string;
  model: string;
  defaultTemperature?: number;
}

export function createOpenAIProgram(config: OpenAIProgramConfig): AgentProgram {
  return {
    id: config.id,
    provider: "openai",
    model: config.model,
    supportsTools: true,
    buildPayload(
      _ctx: Context,
      _conversationId: string,
      _parentConversationIds: string[],
      conversation: ConversationState,
    ) {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      const { messages, temperature, functions } = conversation;

      const requestBody: Record<string, unknown> = {
        model: config.model,
        temperature: (temperature ?? config.defaultTemperature ?? 0),
        messages,
      };

      if (functions.length > 0) {
        requestBody.tools = functions.map((fn) => ({
          type: "function",
          function: fn,
        }));
        requestBody.tool_choice = "auto";
      }

      return {
        endpoint: "https://api.openai.com/v1/chat/completions",
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
          },
          body: JSON.stringify(requestBody),
        },
      };
    },
    parseAssistantMessage(rawResponse: unknown) {
      const responseJson = rawResponse as Record<string, unknown>;
      const choices = responseJson.choices as
        | Array<Record<string, unknown>>
        | undefined;
      const firstChoice = choices?.[0] ?? {};
      const message = firstChoice.message as ChatMessage | undefined;
      const assistantMessage = message ?? {
        role: "assistant" as const,
        content: "",
      };

      const finishReason = (firstChoice.finish_reason as string | undefined) ??
        "stop";

      return {
        message: assistantMessage,
        finishReason,
        responseJson,
      };
    },
  };
}

export interface StructuredOutputProgramConfig {
  id: string;
  provider: ModelProvider;
  model: string;
  parseFunction: (
    content: string,
    conversation: ConversationState,
  ) => Promise<void> | void;
  buildPayload: (
    ctx: Context,
    conversationId: string,
    parentConversationIds: string[],
    conversation: ConversationState,
  ) => Promise<{ endpoint: string; init: RequestInit }>;
}

export function createStructuredOutputProgram(
  config: StructuredOutputProgramConfig,
): AgentProgram {
  return {
    id: config.id,
    provider: config.provider,
    model: config.model,
    buildPayload(
      _ctx: Context,
      _conversationId: string,
      _parentConversationIds: string[],
      conversation: ConversationState,
    ) {
      return config.buildPayload(
        _ctx,
        _conversationId,
        _parentConversationIds,
        conversation,
      );
    },
    parseAssistantMessage(rawResponse: unknown) {
      const responseJson = rawResponse as Record<string, unknown>;
      let content = "";
      let finishReason = "stop";

      if (config.provider === "gemini") {
        const candidates = responseJson.candidates as
          | Array<Record<string, unknown>>
          | undefined;
        const firstCandidate = candidates?.[0];
        const candidateContent = firstCandidate?.content as
          | Record<string, unknown>
          | undefined;
        const parts = candidateContent?.parts as
          | Array<Record<string, unknown>>
          | undefined;
        content = (parts?.[0]?.text as string | undefined) ?? "";
        finishReason = (firstCandidate?.finishReason as string | undefined) ??
          "stop";
      } else {
        const choices = responseJson.choices as
          | Array<Record<string, unknown>>
          | undefined;
        const choice = choices?.[0];
        const message = choice?.message as Record<string, unknown> | undefined;
        content = (message?.content as string | undefined) ?? "";
        finishReason = (choice?.finish_reason as string | undefined) ?? "stop";
      }

      const assistantMessage = {
        role: "assistant" as const,
        content,
      };

      return {
        message: assistantMessage,
        finishReason,
        responseJson,
      };
    },
    finalize(
      _ctx: Context,
      _conversationId: string,
      _parentConversationIds: string[],
      conversation: ConversationState,
      assistantMessage: ChatMessage,
    ) {
      const content = assistantMessage.content ?? "";
      return config.parseFunction(content, conversation);
    },
  };
}

export interface GeminiProgramConfig {
  id: string;
  model: string;
  stopSequences?: string[];
  safetySettings?: Array<Record<string, unknown>>;
  parseFunction: (
    content: string,
    conversation: ConversationState,
  ) => Promise<void> | void;
}

export function createGeminiProgram(
  config: GeminiProgramConfig,
): AgentProgram {
  return {
    id: config.id,
    provider: "gemini",
    model: config.model,
    supportsTools: false,
    async buildPayload(
      _ctx: Context,
      _conversationId: string,
      _parentConversationIds: string[],
      conversation: ConversationState,
    ) {
      const apiKey = Deno.env.get("GEMINI_API_KEY");

      const systemMessage = conversation.messages.find((message) =>
        message.role === "system"
      );
      const dialogMessages = conversation.messages.filter((message) =>
        message.role !== "system"
      );

      const parts: Array<{ text: string }> = [];
      if (systemMessage?.content) {
        parts.push({ text: systemMessage.content });
      }
      for (const message of dialogMessages) {
        if (message.content) {
          parts.push({ text: message.content });
        }
      }

      const body: Record<string, unknown> = {
        contents: [{ parts }],
        generationConfig: {
          temperature: conversation.temperature,
          maxOutputTokens: 4000,
          topP: 0.8,
          topK: 40,
          candidateCount: 1,
          stopSequences: config.stopSequences ?? ["[[ ## completed ## ]]"],
        },
      };

      if (config.safetySettings) {
        body.safetySettings = config.safetySettings;
      }

      return {
        endpoint:
          `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`,
        init: {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-goog-api-key": apiKey ?? "",
          },
          body: JSON.stringify(body),
        },
      };
    },
    parseAssistantMessage(rawResponse: unknown) {
      const responseJson = rawResponse as Record<string, unknown>;
      const candidates = responseJson.candidates as
        | Array<Record<string, unknown>>
        | undefined;
      const firstCandidate = candidates?.[0];
      const contentObj = firstCandidate?.content as
        | Record<string, unknown>
        | undefined;
      const parts = contentObj?.parts as Array<Record<string, unknown>> | undefined;
      const textParts = parts
        ?.map((part) => part.text as string | undefined)
        .filter((value): value is string => Boolean(value)) ?? [];

      const content = textParts.join("\n");
      const finishReason = (firstCandidate?.finishReason as string | undefined) ??
        "stop";

      return {
        message: {
          role: "assistant" as const,
          content,
        },
        finishReason,
        responseJson,
      };
    },
    finalize(
      ctx: Context,
      conversationId: string,
      parentConversationIds: string[],
      conversation: ConversationState,
      assistantMessage: ChatMessage,
    ) {
      const content = assistantMessage.content ?? "";
      return config.parseFunction(content, conversation);
    },
  };
}
