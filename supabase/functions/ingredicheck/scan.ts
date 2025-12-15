import { Context } from 'https://deno.land/x/oak@v12.6.0/mod.ts'

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

    // Fetch scans
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
