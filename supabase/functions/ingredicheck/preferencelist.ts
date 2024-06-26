import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as KitchenSink from '../shared/kitchensink.ts'
import { preferenceValidatorAgent } from '../shared/llm/preferencevalidatoragent.ts'

const MB = 1024 * 1024

export async function getItems(ctx: Context) {
    const result = await ctx.state.supabaseClient
        .from('dietary_preferences')
        .select('id, text, annotated_text')
        .is('deleted_at', null)
        .order('id', { ascending: false })
    if (result.error) {
        console.log('supabaseClient.from(dietary_preferences).select() failed: ', result.error)
        ctx.response.status = 500
        ctx.response.body = result.error
        return
    }
    ctx.response.status = 200
    ctx.response.body = result.data.map((item: any) => {
        return {
            id: item.id,
            text: item.text,
            annotatedText: item.annotated_text
        }
    })
}

export async function grandfather(ctx: Context) {
    const body = ctx.request.body({ type: "json" })
    const requestBody = await body.value
    const userId = await KitchenSink.getUserId(ctx)
    const entries = requestBody.map((text: string) => {
        return {
            user_id: userId,
            text: text,
            annotated_text: text
        }
    })
    const result = await ctx.state.supabaseClient
        .from('dietary_preferences')
        .insert(entries)
    if (result.error) {
        console.log('supabaseClient.from(dietary_preferences).insert() failed: ', result.error)
        ctx.response.status = 500
        ctx.response.body = result.error
        return
    }
    ctx.response.status = 201
}

export async function addItem(ctx: Context) {
    
    const body = ctx.request.body({ type: "form-data" })
    const formData = await body.value.read({ maxSize: 10 * MB })
    const preferenceText = formData.fields['preference']
    ctx.state.clientActivityId = formData.fields['clientActivityId']
    const userId = await KitchenSink.getUserId(ctx)

    const validationResult = await preferenceValidatorAgent(ctx, preferenceText)
    if (validationResult.result === 'failure') {
        ctx.response.status = 422
        ctx.response.body = validationResult
        return
    }

    const dbResult = await ctx.state.supabaseClient
        .from('dietary_preferences')
        .insert({
            user_id: userId,
            text: preferenceText,
            annotated_text: validationResult.annotatedText
        })
        .select('id, text, annotated_text')
        .single()
    if (dbResult.error) {
        console.log('supabaseClient.from(dietary_preferences).insert() failed: ', dbResult.error)
        ctx.response.status = 500
        ctx.response.body = dbResult.error
        return
    }
    ctx.response.status = 201
    ctx.response.body = {
        result: 'success',
        id: dbResult.data.id,
        text: dbResult.data.text,
        annotatedText: dbResult.data.annotated_text
    }
}

export async function updateItem(ctx: Context, id: number) {
    
    const body = ctx.request.body({ type: "form-data" })
    const formData = await body.value.read({ maxSize: 10 * MB })
    const newPreferenceText = formData.fields['preference']
    ctx.state.clientActivityId = formData.fields['clientActivityId']

    const validationResult = await preferenceValidatorAgent(ctx, newPreferenceText)
    if (validationResult.result === 'failure') {
        ctx.response.status = 422
        ctx.response.body = validationResult
        return
    }

    const dbResult = await ctx.state.supabaseClient
        .from('dietary_preferences')
        .update({
            text: newPreferenceText,
            annotated_text: validationResult.annotatedText,
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select('id, text, annotated_text')
        .single()
    if (dbResult.error) {
        console.log('supabaseClient.from(dietary_preferences).update() failed: ', dbResult.error)
        ctx.response.status = 500
        ctx.response.body = dbResult.error
        return
    }
    ctx.response.status = 200
    ctx.response.body = {
        result: 'success',
        id: dbResult.data.id,
        text: dbResult.data.text,
        annotatedText: dbResult.data.annotated_text
    }
}

export async function deleteItem(ctx: Context, id: number) {
    const result = await ctx.state.supabaseClient
        .from('dietary_preferences')
        .update({
            deleted_at: new Date().toISOString()
        })
        .eq('id', id)
    if (result.error) {
        console.log('supabaseClient.from(dietary_preferences).delete() failed: ', result.error)
        ctx.response.status = 500
        ctx.response.body = result.error
        return
    }
    ctx.response.status = 204
}