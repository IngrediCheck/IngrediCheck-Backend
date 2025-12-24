import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

// V1 Types (snake_case for backward compatibility)
interface ScanRow {
    id: string
    scan_type: string
    barcode: string | null
    product_info_source: string | null
    product_info: Record<string, unknown>
    images_processed: number
    status: string
    analysis_status: string | null
    analysis_started_at: string | null
    analysis_completed_at: string | null
    analysis_result: Record<string, unknown> | null
    latest_guidance: string | null
    latest_error_message: string | null
    created_at: string
    last_activity_at: string
    total_count: number
}

interface ImageRow {
    id: string
    scan_id: string
    content_hash: string
    status: string
    storage_path: string | null
    extraction_result: Record<string, unknown> | null
    extraction_error: string | null
    queued_at: string
    processed_at: string | null
}

interface InventoryImage {
    type: 'inventory'
    url: string
}

interface UserImage {
    type: 'user'
    content_hash: string
    storage_path: string | null
    status: string
    extraction_error: string | null
}

type ScanImage = InventoryImage | UserImage

interface ScanResponse {
    id: string
    scan_type: string
    barcode: string | null
    status: string
    product_info: Record<string, unknown>
    product_info_source: string | null
    analysis_status: string | null
    analysis_result: Record<string, unknown> | null
    images: ScanImage[]
    latest_guidance: string | null
    created_at: string
    last_activity_at: string
}

// V1: Original getHistory (snake_case response with images)
export async function getHistory(ctx: Context) {
    const limitParam = ctx.request.url.searchParams.get('limit')
    const offsetParam = ctx.request.url.searchParams.get('offset')

    const limit = limitParam ? parseInt(limitParam, 10) : 20
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0

    if (isNaN(limit) || limit < 1 || limit > 100) {
        ctx.response.status = 400
        ctx.response.body = { error: 'limit must be between 1 and 100' }
        return
    }

    if (isNaN(offset) || offset < 0) {
        ctx.response.status = 400
        ctx.response.body = { error: 'offset must be non-negative' }
        return
    }

    // Fetch scans using V1 RPC
    const scansResult = await ctx.state.supabaseClient.rpc('get_scans', {
        p_limit: limit,
        p_offset: offset
    })

    if (scansResult.error) {
        console.error('[scan#getHistory] rpc error', scansResult.error)
        ctx.response.status = 500
        ctx.response.body = scansResult.error.message ?? String(scansResult.error)
        return
    }

    const scansData: ScanRow[] = scansResult.data ?? []
    const total = scansData.length > 0 ? scansData[0].total_count : 0

    // Fetch images for all scans
    const scanIds = scansData.map(s => s.id)
    let imagesData: ImageRow[] = []

    if (scanIds.length > 0) {
        const imagesResult = await ctx.state.supabaseClient.rpc('get_scan_images', {
            p_scan_ids: scanIds
        })

        if (imagesResult.error) {
            console.error('[scan#getHistory] images rpc error', imagesResult.error)
        } else {
            imagesData = imagesResult.data ?? []
        }
    }

    // Group images by scan_id
    const imagesByScanId = new Map<string, ImageRow[]>()
    for (const img of imagesData) {
        const existing = imagesByScanId.get(img.scan_id) ?? []
        existing.push(img)
        imagesByScanId.set(img.scan_id, existing)
    }

    // Build scan responses
    const scans: ScanResponse[] = scansData.map(row => {
        const images: ScanImage[] = []

        // Add inventory images from product_info (OpenFoodFacts images)
        const productInfo = row.product_info ?? {}
        const offImages = (productInfo.images as Array<{ url: string }>) ?? []
        for (const img of offImages) {
            if (img?.url) {
                images.push({ type: 'inventory', url: img.url })
            }
        }

        // Add user images
        const userImages = imagesByScanId.get(row.id) ?? []
        for (const img of userImages) {
            images.push({
                type: 'user',
                content_hash: img.content_hash,
                storage_path: img.storage_path,
                status: img.status,
                extraction_error: img.extraction_error
            })
        }

        return {
            id: row.id,
            scan_type: row.scan_type,
            barcode: row.barcode,
            status: row.status,
            product_info: row.product_info,
            product_info_source: row.product_info_source,
            analysis_status: row.analysis_status,
            analysis_result: row.analysis_result,
            images,
            latest_guidance: row.latest_guidance,
            created_at: row.created_at,
            last_activity_at: row.last_activity_at
        }
    })

    ctx.response.status = 200
    ctx.response.body = {
        scans,
        total,
        has_more: offset + scans.length < total
    }
}

// V2: New getHistoryV2 (camelCase response with latestAnalysis, favorites filter)
export async function getHistoryV2(ctx: Context) {
    const limitParam = ctx.request.url.searchParams.get('limit')
    const offsetParam = ctx.request.url.searchParams.get('offset')
    const favoritedParam = ctx.request.url.searchParams.get('favorited')

    const limit = limitParam ? parseInt(limitParam, 10) : 20
    const offset = offsetParam ? parseInt(offsetParam, 10) : 0
    const favorited = favoritedParam === 'true' ? true : favoritedParam === 'false' ? false : null

    if (isNaN(limit) || limit < 1 || limit > 100) {
        ctx.response.status = 400
        ctx.response.body = { error: 'limit must be between 1 and 100' }
        return
    }

    if (isNaN(offset) || offset < 0) {
        ctx.response.status = 400
        ctx.response.body = { error: 'offset must be non-negative' }
        return
    }

    // Fetch scans using V2 RPC (returns JSONB with scans and totalCount)
    const result = await ctx.state.supabaseClient.rpc('get_scans_v2', {
        p_limit: limit,
        p_offset: offset,
        p_favorited: favorited
    })

    if (result.error) {
        console.error('[scan#getHistoryV2] rpc error', result.error)
        ctx.response.status = 500
        ctx.response.body = { error: result.error.message ?? String(result.error) }
        return
    }

    const data = result.data ?? { scans: [], totalCount: 0 }
    const scans = data.scans ?? []
    const total = data.totalCount ?? 0

    ctx.response.status = 200
    ctx.response.body = {
        scans,
        total,
        has_more: offset + scans.length < total
    }
}

export async function getScanDetail(ctx: Context) {
    const scanId = ctx.params.scanId

    if (!scanId) {
        ctx.response.status = 400
        ctx.response.body = { error: 'scanId is required' }
        return
    }

    const result = await ctx.state.supabaseClient.rpc('get_scan_detail', {
        p_scan_id: scanId
    })

    if (result.error) {
        console.error('[scan#getScanDetail] rpc error', result.error)
        ctx.response.status = 500
        ctx.response.body = { error: result.error.message ?? String(result.error) }
        return
    }

    if (!result.data) {
        ctx.response.status = 404
        ctx.response.body = { error: 'Scan not found' }
        return
    }

    ctx.response.status = 200
    ctx.response.body = result.data
}

export async function toggleFavorite(ctx: Context) {
    const scanId = ctx.params.scanId

    if (!scanId) {
        ctx.response.status = 400
        ctx.response.body = { error: 'scanId is required' }
        return
    }

    const result = await ctx.state.supabaseClient.rpc('toggle_scan_favorite', {
        p_scan_id: scanId
    })

    if (result.error) {
        console.error('[scan#toggleFavorite] rpc error', result.error)
        if (result.error.message?.includes('not found') || result.error.message?.includes('access denied')) {
            ctx.response.status = 404
            ctx.response.body = { error: 'Scan not found' }
            return
        }
        ctx.response.status = 500
        ctx.response.body = { error: result.error.message ?? String(result.error) }
        return
    }

    ctx.response.status = 200
    ctx.response.body = result.data
}

export async function reanalyze(ctx: Context) {
    const scanId = ctx.params.scanId

    if (!scanId) {
        ctx.response.status = 400
        ctx.response.body = { error: 'scanId is required' }
        return
    }

    // Verify scan exists and belongs to user
    const scanResult = await ctx.state.supabaseClient
        .from('scans')
        .select('id, user_id, product_info')
        .eq('id', scanId)
        .single()

    if (scanResult.error || !scanResult.data) {
        ctx.response.status = 404
        ctx.response.body = { error: 'Scan not found' }
        return
    }

    // Get the AI API URL from env
    const aiApiUrl = Deno.env.get('AI_API_URL')
    if (!aiApiUrl) {
        ctx.response.status = 500
        ctx.response.body = { error: 'AI API not configured' }
        return
    }

    // Call the AI API to trigger reanalysis
    // This would typically be an async call that creates a new scan_analyses record
    // For now, return a message indicating the request was received
    ctx.response.status = 202
    ctx.response.body = {
        message: 'Reanalysis requested',
        scanId: scanId
    }
}

const MB = 1024 * 1024

async function generateContentHash(data: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', data)
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
}

export async function uploadImage(ctx: Context) {
    const scanId = ctx.params.scanId

    if (!scanId) {
        ctx.response.status = 400
        ctx.response.body = { error: 'scanId is required' }
        return
    }

    // Verify scan exists and belongs to user
    const scanResult = await ctx.state.supabaseClient
        .from('scans')
        .select('id, user_id, scan_type, images_processed')
        .eq('id', scanId)
        .single()

    if (scanResult.error || !scanResult.data) {
        ctx.response.status = 404
        ctx.response.body = { error: 'Scan not found' }
        return
    }

    // Parse form-data
    let formData
    try {
        const body = ctx.request.body({ type: 'form-data' })
        formData = await body.value.read({ maxSize: 10 * MB })
    } catch (error) {
        ctx.response.status = 400
        ctx.response.body = { error: 'Invalid form data' }
        return
    }

    // Get image file from form data
    const imageFile = formData.files?.find((file: any) => 
        file.name === 'image' || file.contentType?.startsWith('image/')
    )

    if (!imageFile || !imageFile.content) {
        ctx.response.status = 400
        ctx.response.body = { error: 'Image file is required' }
        return
    }

    const imageData = imageFile.content instanceof Uint8Array 
        ? imageFile.content 
        : new Uint8Array(await imageFile.content)

    // Generate content hash
    const contentHash = await generateContentHash(imageData)

    // Check if image already exists for this scan
    const existingImageResult = await ctx.state.supabaseClient
        .from('scan_images')
        .select('id')
        .eq('scan_id', scanId)
        .eq('content_hash', contentHash)
        .single()

    if (existingImageResult.data) {
        // Image already exists, update scan's last_activity_at and return existing record
        await ctx.state.supabaseClient
            .from('scans')
            .update({ last_activity_at: new Date().toISOString() })
            .eq('id', scanId)

        const existingImage = await ctx.state.supabaseClient
            .from('scan_images')
            .select('*')
            .eq('id', existingImageResult.data.id)
            .single()

        ctx.response.status = 200
        ctx.response.body = {
            id: existingImage.data?.id,
            contentHash: existingImage.data?.content_hash,
            status: existingImage.data?.status,
            storagePath: existingImage.data?.storage_path,
            queuedAt: existingImage.data?.queued_at
        }
        return
    }

    // Upload to storage
    const now = new Date()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const storagePath = `${year}/${month}/${scanId}/${contentHash}.jpg`

    const uploadResult = await ctx.state.supabaseClient.storage
        .from('scan-images')
        .upload(storagePath, imageData, {
            contentType: imageFile.contentType || 'image/jpeg',
            upsert: false
        })

    if (uploadResult.error) {
        console.error('[scan#uploadImage] storage upload error', uploadResult.error)
        ctx.response.status = 500
        ctx.response.body = { error: 'Failed to upload image' }
        return
    }

    // Create scan_images record
    const imageInsertResult = await ctx.state.supabaseClient
        .from('scan_images')
        .insert({
            scan_id: scanId,
            content_hash: contentHash,
            status: 'pending',
            storage_path: storagePath
        })
        .select()
        .single()

    if (imageInsertResult.error) {
        console.error('[scan#uploadImage] insert error', imageInsertResult.error)
        // Try to clean up uploaded file if insert fails
        await ctx.state.supabaseClient.storage
            .from('scan-images')
            .remove([storagePath])
        ctx.response.status = 500
        ctx.response.body = { error: 'Failed to create image record' }
        return
    }

    // Update scan's last_activity_at and increment images_processed
    await ctx.state.supabaseClient
        .from('scans')
        .update({
            last_activity_at: new Date().toISOString(),
            images_processed: (scanResult.data.images_processed || 0) + 1
        })
        .eq('id', scanId)

    ctx.response.status = 201
    ctx.response.body = {
        id: imageInsertResult.data.id,
        contentHash: imageInsertResult.data.content_hash,
        status: imageInsertResult.data.status,
        storagePath: imageInsertResult.data.storage_path,
        queuedAt: imageInsertResult.data.queued_at
    }
}
