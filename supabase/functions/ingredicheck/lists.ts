import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'
import * as KitchenSink from '../shared/kitchensink.ts'

const MB = 1024 * 1024

export async function createList(ctx: Context) {
    ctx.response.status = 501
}

export async function deleteList(ctx: Context, listId: string) {
    ctx.response.status = 501
}

export async function getLists(ctx: Context) {
    ctx.response.status = 501
}

export async function addListItem(ctx: Context, listId: string) {
    const body = ctx.request.body({ type: "form-data" })
    const formData = await body.value.read({ maxSize: 10 * MB })
    ctx.state.clientActivityId = formData.fields['clientActivityId']
    const userId = await KitchenSink.getUserId(ctx)
    const result = await ctx.state.supabaseClient
        .from('user_list_items')
        .insert({
            user_id: userId,
            list_id: listId,
            list_item_id: ctx.state.clientActivityId
        })
    if (result.error) {
        console.log('supabaseClient.from(user_list_items).insert() failed: ', result.error)
        ctx.response.status = 500
        ctx.response.body = result.error
        return
    }
    ctx.response.body = { list_item_id: ctx.state.clientActivityId }
    ctx.response.status = 201
}

export async function getListItems(ctx: Context, listId: string, searchText: string | null) {
    const result = await ctx.state.supabaseClient.rpc(
        'get_list_items',
        {
            input_list_id: listId,
            search_query: searchText
        }
    )
    if (result.error) {
        console.log('supabaseClient.rpc(get_list_items) failed: ', result.error)
        ctx.response.status = 500
        ctx.response.body = result.error
        return
    }
    ctx.response.body = result.data
    ctx.response.status = 200
}

export async function deleteListItem(ctx: Context, listId: string, listItemId: string) {

    const result = await ctx.state.supabaseClient
        .from('user_list_items')
        .delete()
        .eq('list_item_id', listItemId)
        .match({
            list_id: listId,
            list_item_id: listItemId
        })

    if (result.error) {
        console.log('supabaseClient.from(user_list_items).delete() failed: ', result.error)
        ctx.response.status = 500
        ctx.response.body = result.error
        return
    }
    ctx.response.status = 200
}