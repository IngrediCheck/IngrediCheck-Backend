import { Router, RouterContext } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

type FamilyContext = RouterContext<string>

interface CreateFamilyMemberPayload {
    id: string
    name: string
    nicknames?: string[]
    info?: string
    color: string
}

interface CreateFamilyPayload {
    name: string
    selfMember: CreateFamilyMemberPayload
    otherMembers?: CreateFamilyMemberPayload[]
}

interface InvitePayload {
    memberID?: string
}

interface JoinFamilyPayload {
    inviteCode?: string
}

interface MemberPayload extends CreateFamilyMemberPayload {}

export function registerFamilyRoutes(router: Router) {
    router
        .post('/ingredicheck/family', createFamily)
        .get('/ingredicheck/family', getFamily)
        .post('/ingredicheck/family/invite', createInvite)
        .post('/ingredicheck/family/join', joinFamily)
        .post('/ingredicheck/family/leave', leaveFamily)
        .post('/ingredicheck/family/members', addMember)
        .patch('/ingredicheck/family/members/:id', editMember)
        .delete('/ingredicheck/family/members/:id', deleteMember)

    return router
}

async function createFamily(ctx: FamilyContext) {
    try {
        const body = await ctx.request.body({ type: 'json' }).value as CreateFamilyPayload

        const { error } = await ctx.state.supabaseClient.rpc('create_family', {
            family_name: body.name,
            self_member: body.selfMember,
            other_members: body.otherMembers ?? []
        })

        if (error) throw error

        ctx.response.status = 201
    } catch (error) {
        handleError(ctx, 'Error creating family', error)
    }
}

async function getFamily(ctx: FamilyContext) {
    try {
        const { data, error } = await ctx.state.supabaseClient.rpc('get_family')

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error fetching family', error)
    }
}

async function createInvite(ctx: FamilyContext) {
    try {
        const body = await ctx.request.body({ type: 'json' }).value as InvitePayload

        if (!body.memberID) {
            ctx.response.status = 400
            ctx.response.body = { error: 'memberID is required' }
            return
        }

        const { data, error } = await ctx.state.supabaseClient.rpc('create_invite', {
            for_member_id: body.memberID
        })

        if (error) throw error

        ctx.response.status = 201
        ctx.response.body = { inviteCode: data }
    } catch (error) {
        handleError(ctx, 'Error creating invite', error)
    }
}

async function joinFamily(ctx: FamilyContext) {
    try {
        const body = await ctx.request.body({ type: 'json' }).value as JoinFamilyPayload

        if (!body.inviteCode) {
            ctx.response.status = 400
            ctx.response.body = { error: 'inviteCode is required' }
            return
        }

        const { data, error } = await ctx.state.supabaseClient.rpc('join_family', {
            invite_code_text: body.inviteCode
        })

        if (error) throw error

        ctx.response.status = 201
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error joining family', error)
    }
}

async function leaveFamily(ctx: FamilyContext) {
    try {
        const { error } = await ctx.state.supabaseClient.rpc('leave_family')

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = { message: 'Successfully left the family' }
    } catch (error) {
        handleError(ctx, 'Error leaving family', error)
    }
}

async function addMember(ctx: FamilyContext) {
    try {
        const member = await ctx.request.body({ type: 'json' }).value as MemberPayload

        const { data, error } = await ctx.state.supabaseClient.rpc('add_member', {
            member_data: member
        })

        if (error) throw error

        ctx.response.status = 201
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error adding member', error)
    }
}

async function editMember(ctx: FamilyContext) {
    try {
        const memberId = ctx.params.id

        if (!memberId) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Member id is required' }
            return
        }

        const member = await ctx.request.body({ type: 'json' }).value as MemberPayload

        const payload = { ...member, id: member.id ?? memberId }

        const { data, error } = await ctx.state.supabaseClient.rpc('edit_member', {
            member_data: payload
        })

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error editing member', error)
    }
}

async function deleteMember(ctx: FamilyContext) {
    try {
        const memberId = ctx.params.id

        if (!memberId) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Member id is required' }
            return
        }

        const { data, error } = await ctx.state.supabaseClient.rpc('delete_member', {
            member_id: memberId
        })

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error deleting member', error)
    }
}

function handleError(ctx: FamilyContext, message: string, error: unknown) {
    console.error(message, error)

    if (isSupabaseError(error)) {
        ctx.response.status = 400
        ctx.response.body = { error: error.message ?? message }
        return
    }

    ctx.response.status = 500
    ctx.response.body = { error: message }
}

function isSupabaseError(error: unknown): error is { message?: string } {
    return Boolean(error && typeof error === 'object' && 'message' in error)
}

