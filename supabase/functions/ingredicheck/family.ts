import { Router, RouterContext } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

type FamilyContext = RouterContext<string>

interface CreateFamilyMemberPayload {
    id: string
    name: string
    color: string
    imageFileHash?: string
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

interface SetFoodNotePayload {
    content: Record<string, unknown>
    version: number
}

export function registerFamilyRoutes(router: Router) {
    router
        .post('/ingredicheck/family', createFamily)
        .get('/ingredicheck/family', getFamily)
        .post('/ingredicheck/family/personal', initPersonalFamily)
        .post('/ingredicheck/family/invite', createInvite)
        .post('/ingredicheck/family/join', joinFamily)
        .post('/ingredicheck/family/leave', leaveFamily)
        .post('/ingredicheck/family/members', addMember)
        .patch('/ingredicheck/family/members/:id', editMember)
        .delete('/ingredicheck/family/members/:id', deleteMember)
        // Food notes routes
        .get('/ingredicheck/family/food-notes/all', getAllFoodNotes)
        .get('/ingredicheck/family/food-notes/history', getFoodNoteHistory)
        .get('/ingredicheck/family/food-notes', getFoodNote)
        .put('/ingredicheck/family/food-notes', setFoodNote)
        .get('/ingredicheck/family/members/:id/food-notes/history', getMemberFoodNoteHistory)
        .get('/ingredicheck/family/members/:id/food-notes', getMemberFoodNote)
        .put('/ingredicheck/family/members/:id/food-notes', setMemberFoodNote)

    return router
}

function isValidUuid(value: unknown): boolean {
    if (typeof value !== 'string') return false
    return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
}

function isValidName(value: unknown, { min = 1, max = 100 }: { min?: number; max?: number } = {}): boolean {
    if (typeof value !== 'string') return false
    const trimmed = value.trim()
    return trimmed.length >= min && trimmed.length <= max
}

function validateMemberInput(member: Partial<CreateFamilyMemberPayload>): { ok: true } | { ok: false; error: string } {
    if (!isValidUuid(member.id)) {
        return { ok: false, error: 'Invalid member id format' }
    }
    if (!isValidName(member.name)) {
        return { ok: false, error: 'Invalid member name (1-100 non-whitespace chars required)' }
    }
    if (member.imageFileHash !== undefined && typeof member.imageFileHash !== 'string') {
        return { ok: false, error: 'imageFileHash must be a string when provided' }
    }
    return { ok: true }
}

async function createFamily(ctx: FamilyContext) {
    try {
        const body = await ctx.request.body({ type: 'json' }).value as CreateFamilyPayload

        if (!isValidName(body.name)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid family name (1-100 non-whitespace chars required)' }
            return
        }

        const selfCheck = validateMemberInput(body.selfMember)
        if (!selfCheck.ok) {
            ctx.response.status = 400
            ctx.response.body = { error: selfCheck.error }
            return
        }

        if (Array.isArray(body.otherMembers)) {
            for (const m of body.otherMembers) {
                const check = validateMemberInput(m)
                if (!check.ok) {
                    ctx.response.status = 400
                    ctx.response.body = { error: check.error }
                    return
                }
            }
        }

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

        if (!isValidUuid(body.memberID)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid memberID format' }
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

        const check = validateMemberInput(member)
        if (!check.ok) {
            ctx.response.status = 400
            ctx.response.body = { error: check.error }
            return
        }

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

        if (!isValidUuid(memberId)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid member id format' }
            return
        }

        const member = await ctx.request.body({ type: 'json' }).value as MemberPayload

        const payload = { ...member, id: member.id ?? memberId }

        // If body.id exists, validate it as well
        if (member.id && !isValidUuid(member.id)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid member id format' }
            return
        }

        if (!isValidName(payload.name)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid member name (1-100 non-whitespace chars required)' }
            return
        }

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

        if (!isValidUuid(memberId)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid member id format' }
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

// Food Notes Handlers

async function initPersonalFamily(ctx: FamilyContext) {
    try {
        const body = await ctx.request.body({ type: 'json' }).value as CreateFamilyMemberPayload

        const check = validateMemberInput(body)
        if (!check.ok) {
            ctx.response.status = 400
            ctx.response.body = { error: check.error }
            return
        }

        const { data, error } = await ctx.state.supabaseClient.rpc('init_personal_family', {
            self_member: body
        })

        if (error) throw error

        ctx.response.status = 201
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error creating personal family', error)
    }
}

async function getAllFoodNotes(ctx: FamilyContext) {
    try {
        const { data, error } = await ctx.state.supabaseClient.rpc('get_all_food_notes')

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error fetching food notes', error)
    }
}

async function getFoodNote(ctx: FamilyContext) {
    try {
        const { data, error } = await ctx.state.supabaseClient.rpc('get_food_note', {
            target_member_id: null
        })

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error fetching food note', error)
    }
}

async function setFoodNote(ctx: FamilyContext) {
    try {
        const body = await ctx.request.body({ type: 'json' }).value as SetFoodNotePayload

        if (typeof body.content !== 'object' || body.content === null) {
            ctx.response.status = 400
            ctx.response.body = { error: 'content must be a JSON object' }
            return
        }

        if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0) {
            ctx.response.status = 400
            ctx.response.body = { error: 'version must be a non-negative integer' }
            return
        }

        const { data, error } = await ctx.state.supabaseClient.rpc('set_food_note', {
            target_member_id: null,
            content: body.content,
            expected_version: body.version
        })

        if (error) throw error

        // Check for version mismatch (optimistic locking conflict)
        if (data?.success === false) {
            ctx.response.status = 409
            ctx.response.body = {
                error: data.error,
                currentNote: data.currentNote
            }
            return
        }

        ctx.response.status = 200
        ctx.response.body = data.note
    } catch (error) {
        handleError(ctx, 'Error setting food note', error)
    }
}

async function getFoodNoteHistory(ctx: FamilyContext) {
    try {
        const url = new URL(ctx.request.url)
        const limit = parseInt(url.searchParams.get('limit') ?? '10', 10)
        const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)

        const { data, error } = await ctx.state.supabaseClient.rpc('get_food_note_history', {
            target_member_id: null,
            history_limit: limit,
            history_offset: offset
        })

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error fetching food note history', error)
    }
}

async function getMemberFoodNote(ctx: FamilyContext) {
    try {
        const memberId = ctx.params.id

        if (!memberId) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Member id is required' }
            return
        }

        if (!isValidUuid(memberId)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid member id format' }
            return
        }

        const { data, error } = await ctx.state.supabaseClient.rpc('get_food_note', {
            target_member_id: memberId
        })

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error fetching member food note', error)
    }
}

async function setMemberFoodNote(ctx: FamilyContext) {
    try {
        const memberId = ctx.params.id

        if (!memberId) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Member id is required' }
            return
        }

        if (!isValidUuid(memberId)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid member id format' }
            return
        }

        const body = await ctx.request.body({ type: 'json' }).value as SetFoodNotePayload

        if (typeof body.content !== 'object' || body.content === null) {
            ctx.response.status = 400
            ctx.response.body = { error: 'content must be a JSON object' }
            return
        }

        if (typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0) {
            ctx.response.status = 400
            ctx.response.body = { error: 'version must be a non-negative integer' }
            return
        }

        const { data, error } = await ctx.state.supabaseClient.rpc('set_food_note', {
            target_member_id: memberId,
            content: body.content,
            expected_version: body.version
        })

        if (error) throw error

        // Check for version mismatch (optimistic locking conflict)
        if (data?.success === false) {
            ctx.response.status = 409
            ctx.response.body = {
                error: data.error,
                currentNote: data.currentNote
            }
            return
        }

        ctx.response.status = 200
        ctx.response.body = data.note
    } catch (error) {
        handleError(ctx, 'Error setting member food note', error)
    }
}

async function getMemberFoodNoteHistory(ctx: FamilyContext) {
    try {
        const memberId = ctx.params.id

        if (!memberId) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Member id is required' }
            return
        }

        if (!isValidUuid(memberId)) {
            ctx.response.status = 400
            ctx.response.body = { error: 'Invalid member id format' }
            return
        }

        const url = new URL(ctx.request.url)
        const limit = parseInt(url.searchParams.get('limit') ?? '10', 10)
        const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)

        const { data, error } = await ctx.state.supabaseClient.rpc('get_food_note_history', {
            target_member_id: memberId,
            history_limit: limit,
            history_offset: offset
        })

        if (error) throw error

        ctx.response.status = 200
        ctx.response.body = data
    } catch (error) {
        handleError(ctx, 'Error fetching member food note history', error)
    }
}

