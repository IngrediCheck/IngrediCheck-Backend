export type ChatRole = "system" | "user" | "assistant" | "function";

export interface ChatFunctionCall {
  name: string;
  arguments: string;
}

export interface ToolCall {
  id?: string;
  type?: string;
  function: ChatFunctionCall;
}

export interface ChatMessage {
  role: ChatRole;
  content?: string;
  name?: string;
  function_call?: ChatFunctionCall;
  tool_calls?: ToolCall[];
}

export interface ChatFunction {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

export type FunctionCallResult = [unknown, boolean] | unknown;

export type FunctionHandler = (
  parameters: Record<string, unknown>,
) => FunctionCallResult | Promise<FunctionCallResult>;

export type FunctionObject = Record<string, FunctionHandler>;
