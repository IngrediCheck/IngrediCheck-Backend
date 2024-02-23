import { Context } from "https://deno.land/x/oak@v12.6.0/mod.ts"
import * as DB from '../db.ts'
import * as GenericAgent from './genericagent.ts'
import { extractorAgentSystemMessage, extractorAgentFunctions } from './extractoragent_types.ts'

export async function extractorAgent(
    ctx: Context,
    productImagesOCR: string[])
    : Promise<DB.Product>
{
    let extractedProduct = DB.defaultProduct()

    async function record_product_details(parameters: { product: DB.Product }): Promise<[any, boolean]> {
        extractedProduct = parameters.product
        return [parameters.product, false]
    }

    const functionObject = {
        record_product_details: record_product_details
    }

    const userMessage = productImagesOCR.join('\n---------------\n')

    const messages: GenericAgent.ChatMessage[] = [
        {
            role: 'system',
            content: extractorAgentSystemMessage
        },
        {
            role: 'user',
            content: userMessage
        }
    ]

    const _ = await GenericAgent.genericAgent(
        ctx,
        'extractoragent',
        messages,
        extractorAgentFunctions,
        GenericAgent.ModelName.ExtractorFineTuned,
        functionObject,
        crypto.randomUUID(),
        []
    )

    return extractedProduct
}