import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

declare const EdgeRuntime: {
  waitUntil(promise: Promise<any>): void;
};

const MB = 1024 * 1024

export async function submitFeedback(ctx: Context) {

    try {
        const body = ctx.request.body({ type: "form-data" })
        const formData = await body.value.read({ maxSize: 10 * MB })

        const clientActivityId = formData.fields['clientActivityId']
        const feedback = JSON.parse(formData.fields['feedback'])

        if (feedback.images) {
            EdgeRuntime.waitUntil(
                ctx.state.supabaseClient.functions.invoke('background/log_images', {
                    body: {
                        activity_id: ctx.state.activityId,
                        client_activity_id: clientActivityId,
                        product_images: feedback.images
                    },
                    method: 'POST'
                })
            )
        }

        const result = await ctx.state.supabaseClient
            .from('log_feedback')
            .upsert({
                user_id: ctx.state.userId,
                activity_id: ctx.state.activityId,
                client_activity_id: clientActivityId,
                rating: feedback.rating,
                reasons: feedback.reasons,
                note: feedback.note,
                images: feedback.images?.map((i: any) => i.imageFileHash)
            }, {
                onConflict: ['client_activity_id']
            })
        if (result.error) {
            console.log('supabaseClient.from(log_feedback).insert() failed: ', result.error)
            ctx.response.status = 500
            ctx.response.body = result.error
            return
        }

        ctx.response.status = 201
    } catch (error) {
        console.log(`Error submitting feedback: ${error.message}`)
        ctx.response.status = 500
        ctx.response.body = error
    }
}