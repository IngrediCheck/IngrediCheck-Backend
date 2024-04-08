
import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts"
import * as GenericAgent from './genericagent.ts'
import {
    preferenceValidatorAgentSystemMessage,
    preferenceValidatorAgentFunctions
} from './preferencevalidatoragent_types.ts'

type PreferenceValidationResultSuccess = {
    result: "success"
    annotatedText: string
}

type PreferenceValidationResultFailure = {
    result: "failure"
    explanation: string
}

type PreferenceValidationResult =
    PreferenceValidationResultSuccess |
    PreferenceValidationResultFailure

export async function preferenceValidatorAgent(
    ctx: Context,
    userPreferenceText: string)
    : Promise<PreferenceValidationResult>
{
    let result: PreferenceValidationResult = {
        result: "success",
        annotatedText: userPreferenceText
    }

    async function report_success(parameters: { annotatedPreference: string }): Promise<[any, boolean]> {
        result = {
            result: "success",
            annotatedText: parameters.annotatedPreference
        }
        return [
            parameters.annotatedPreference,
            false
        ]
    }

    async function report_failure(parameters: { explanation: string }): Promise<[any, boolean]> {
        result = {
            result: "failure",
            explanation: parameters.explanation
        }
        return [
            parameters.explanation,
            false
        ]
    }

    const functionObject = {
        report_success: report_success,
        report_failure: report_failure
    }

    const messages: GenericAgent.ChatMessage[] = [
        {
            role: 'system',
            content: preferenceValidatorAgentSystemMessage
        },
        {
            role: 'user',
            content: userPreferenceText
        }
    ]

    const _ = await GenericAgent.genericAgent(
        ctx,
        'preferenceValidatorAgent',
        messages,
        preferenceValidatorAgentFunctions,
        GenericAgent.ModelName.PreferenceValidatorFineTuned,
        functionObject,
        crypto.randomUUID(),
        []
    )

    return result
}