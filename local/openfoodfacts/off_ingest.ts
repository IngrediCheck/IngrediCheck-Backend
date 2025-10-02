// deno run -A --unstable-kv local/openfoodfacts/off_ingest.ts
// Environment: Copy .env.template to .env and fill in your values
// Performance: Use --unstable-kv for better memory management

// Load environment variables from .env file
async function loadEnv() {
    try {
        const envText = await Deno.readTextFile("local/.env");
        const lines = envText.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith("#")) {
                const [key, ...valueParts] = trimmed.split("=");
                if (key && valueParts.length > 0) {
                    const value = valueParts.join("=").trim();
                    Deno.env.set(key.trim(), value);
                }
            }
        }
    } catch (error) {
        console.warn("⚠️  Could not load .env file:", (error as Error).message);
        console.warn("   Make sure to copy .env.template to .env and fill in your values");
    }
}

type Ingredient = {
    name: string;
    vegan?: boolean;
    vegetarian?: boolean;
    ingredients?: Ingredient[];
};

type Image = { 
    url: string; 
    resolution?: string; 
    width?: number; 
    height?: number; 
};

type CacheRow = {
    barcode: string;
    data_source: string;
    brand?: string;
    name?: string;
    ingredients: Ingredient[];
    images: Image[];
    off_last_modified_t?: number;
};

const OFF_JSONL_GZ_URL = "https://static.openfoodfacts.org/data/openfoodfacts-products.jsonl.gz";
const OUTPUT_PATH = "local/off_inventory_cache.jsonl";
const BATCH_UPLOAD_SIZE = 1000; // Products per batch
const BATCHES_PER_CONFIRMATION = 500; // Upload 500 batches (500k rows) before asking for confirmation
const PARALLEL_BATCHES = 10; // Upload 10 batches in parallel = 10,000 products per batch group
const DELAY_BETWEEN_BATCH_GROUPS_MS = 500; // 500ms delay between batch groups to avoid rate limiting
const SAMPLE_SIZE = 10000; // Sample size for size estimation
const SAMPLE_LINES = 100000; // Only process first 100k lines for sampling

function mapIngredient(node: any): Ingredient {
    const item: Ingredient = {
        name: typeof node?.text === "string" ? node.text : undefined as unknown as string,
        vegan: node?.vegan,
        vegetarian: node?.vegetarian,
        ingredients: [],
    };
    if (Array.isArray(node?.ingredients) && node.ingredients.length > 0) {
        item.ingredients = node.ingredients.filter((x: any) => x && typeof x === "object").map(mapIngredient);
    }
    return item;
}

function isValidImageUrl(url: string): boolean {
    try {
        const parsedUrl = new URL(url);
        return parsedUrl.protocol === 'https:' && 
               parsedUrl.hostname === 'static.openfoodfacts.org' &&
               url.includes('/images/products/') &&
               url.endsWith('.jpg');
    } catch {
        return false;
    }
}

async function validateImageUrlExists(url: string): Promise<boolean> {
    try {
        const response = await fetch(url, { method: 'HEAD' });
        return response.status === 200;
    } catch {
        return false;
    }
}

// Convert barcode to Open Food Facts path format
// Example: "3017620422003" -> "301/762/042/2003"
// Example: "1" -> "1"
function barcodeToPath(barcode: string): string {
    // Short barcodes (8 digits or fewer) are used as-is
    if (barcode.length <= 8) {
        return barcode;
    }
    // Longer barcodes are padded to at least 13 digits and split
    const code = barcode.padStart(13, '0');
    // Split into segments of 3 digits, except the last part
    const segments: string[] = [];
    for (let i = 0; i < code.length - 4; i += 3) {
        segments.push(code.slice(i, i + 3));
    }
    segments.push(code.slice(code.length - 4)); // Last 4 digits
    return segments.join('/');
}

function extractDisplayImageUrls(images: any, barcode: string): Image[] {
    if (!images || typeof images !== "object") {
        return [];
    }
    
    const urls: Image[] = [];
    const processedImages = new Set<string>(); // Track processed image IDs to avoid duplicates
    const barcodePath = barcodeToPath(barcode);
    
    try {
        // Open Food Facts image structure: images contains both numeric keys (1,2,3,4) and language-specific keys (front_en, ingredients_fr, etc.)
        // Language-specific keys reference numeric images via imgid
        
        // First, collect all language-specific front images
        const languageKeys = ['front_en', 'front_fr', 'front_de', 'front_es', 'front_it', 'front_pt', 'front_nl', 'front_sv', 'front_da', 'front_no', 'front_fi'];
        
        for (const langKey of languageKeys) {
            const imageRef = images[langKey];
            if (imageRef && typeof imageRef === "object" && imageRef.imgid) {
                const imgId = String(imageRef.imgid); // Ensure imgid is a string
                if (processedImages.has(imgId)) continue; // Skip if already processed
                
                const imageData = images[imgId];
                if (imageData && typeof imageData === "object" && imageData.sizes) {
                    const sizes = imageData.sizes;
                    
                    // Collect all available sizes for this image, grouped by resolution
                    const imageUrls: { url: string; resolution: string; width: number; height: number }[] = [];
                    
                    if (sizes.full && sizes.full.w && sizes.full.h) {
                        const url = `https://static.openfoodfacts.org/images/products/${barcodePath}/${imgId}.jpg`;
                        if (isValidImageUrl(url)) {
                            imageUrls.push({ url, resolution: 'full', width: sizes.full.w, height: sizes.full.h });
                        }
                    }
                    
                    if (sizes["400"] && sizes["400"].w && sizes["400"].h) {
                        const url = `https://static.openfoodfacts.org/images/products/${barcodePath}/${imgId}.400.jpg`;
                        if (isValidImageUrl(url)) {
                            imageUrls.push({ url, resolution: '400px', width: sizes["400"].w, height: sizes["400"].h });
                        }
                    }
                    
                    if (sizes["200"] && sizes["200"].w && sizes["200"].h) {
                        const url = `https://static.openfoodfacts.org/images/products/${barcodePath}/${imgId}.200.jpg`;
                        if (isValidImageUrl(url)) {
                            imageUrls.push({ url, resolution: '200px', width: sizes["200"].w, height: sizes["200"].h });
                        }
                    }
                    
                    if (sizes["100"] && sizes["100"].w && sizes["100"].h) {
                        const url = `https://static.openfoodfacts.org/images/products/${barcodePath}/${imgId}.100.jpg`;
                        if (isValidImageUrl(url)) {
                            imageUrls.push({ url, resolution: '100px', width: sizes["100"].w, height: sizes["100"].h });
                        }
                    }
                    
                    // Add all valid URLs for this image
                    for (const img of imageUrls) {
                        urls.push({ 
                            url: img.url,
                            resolution: img.resolution,
                            width: img.width,
                            height: img.height
                        });
                    }
                    
                    processedImages.add(imgId);
                }
            }
        }
        
        // If no language-specific front images found, try any numeric image
        if (urls.length === 0) {
            for (const [key, imageData] of Object.entries(images)) {
                if (/^\d+$/.test(key) && imageData && typeof imageData === "object" && (imageData as any).sizes) {
                    const sizes = (imageData as any).sizes;
                    
                    // Collect all available sizes for this image
                    if (sizes.full && sizes.full.w && sizes.full.h) {
                        const url = `https://static.openfoodfacts.org/images/products/${barcodePath}/${key}.jpg`;
                        if (isValidImageUrl(url)) {
                            urls.push({ 
                                url, 
                                resolution: 'full', 
                                width: sizes.full.w, 
                                height: sizes.full.h 
                            });
                        }
                    }
                    
                    if (sizes["400"] && sizes["400"].w && sizes["400"].h) {
                        const url = `https://static.openfoodfacts.org/images/products/${barcodePath}/${key}.400.jpg`;
                        if (isValidImageUrl(url)) {
                            urls.push({ 
                                url, 
                                resolution: '400px', 
                                width: sizes["400"].w, 
                                height: sizes["400"].h 
                            });
                        }
                    }
                    
                    if (urls.length > 0) break; // Stop after finding the first valid image
                }
            }
        }
    } catch (_error) {
        // ignore malformed structures
    }
    
    return urls;
}

function mapToCacheRow(product: any): CacheRow | null {
    const dataSource = "openfoodfacts/v3";

    let barcode: string | undefined;
    const code = product?.code;
    if (typeof code === "string" && code.trim()) {
        barcode = code.trim();
    } else if (typeof code === "number") {
        barcode = String(code);
    } else if (typeof product?._id === "string" && product._id.trim()) {
        barcode = product._id.trim();
    }
    if (!barcode) return null;

    let brand: string | undefined;
    if (typeof product?.brand_owner === "string" && product.brand_owner.trim()) {
        brand = product.brand_owner.trim();
    } else if (typeof product?.brands === "string" && product.brands.trim()) {
        brand = product.brands.split(",")[0]?.trim();
    }

    let name: string | undefined;
    if (typeof product?.product_name === "string" && product.product_name.trim()) {
        name = product.product_name.trim();
    } else {
        for (const [k, v] of Object.entries(product ?? {})) {
            if (k.startsWith("product_name_") && typeof v === "string" && (v as string).trim()) {
                name = (v as string).trim();
                break;
            }
        }
    }

    let ingredients: Ingredient[] = [];
    if (Array.isArray(product?.ingredients) && product.ingredients.length > 0) {
        ingredients = product.ingredients.filter((x: any) => x && typeof x === "object").map(mapIngredient);
    }

    const images = extractDisplayImageUrls(product?.images, barcode);
    const off_last_modified_t = typeof product?.last_modified_t === "number" ? product.last_modified_t : undefined;
    
    

    return {
        barcode,
        data_source: dataSource,
        brand,
        name,
        ingredients,
        images,
        off_last_modified_t,
    };
}

async function* iterLinesFromGzip(url: string, showProgress: boolean = true): AsyncGenerator<string> {
    if (showProgress) {
        console.log("📥 Downloading Open Food Facts data...");
    }
    const res = await fetch(url);
    if (!res.body) throw new Error("No response body from OFF");
    
    const contentLength = res.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength) : 0;
    if (showProgress) {
        console.log(`📦 File size: ${totalBytes > 0 ? formatBytes(totalBytes) : "unknown"}`);
    }
    
    const decompressed = res.body.pipeThrough(new DecompressionStream("gzip"));
    const textStream = decompressed.pipeThrough(new TextDecoderStream());
    const reader = textStream.getReader();
    let buf = "";
    let lineCount = 0;
    let lastProgressTime = Date.now();
    
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value ?? "";
            let idx: number;
            while ((idx = buf.indexOf("\n")) !== -1) {
                const line = buf.slice(0, idx);
                buf = buf.slice(idx + 1);
                lineCount++;
                
                // Show progress every 50k lines or every 10 seconds (only if showProgress is true)
                if (showProgress) {
                    const now = Date.now();
                    if (lineCount % 50000 === 0 || now - lastProgressTime > 10000) {
                        console.log(`📊 Processed ${lineCount.toLocaleString()} products...`);
                        lastProgressTime = now;
                    }
                }
                
                yield line;
            }
        }
        if (buf.length > 0) {
            lineCount++;
            yield buf;
        }
    } finally {
        reader.releaseLock();
    }
    if (showProgress) {
        console.log(`✅ Download complete! Processed ${lineCount.toLocaleString()} products`);
    }
}

async function writeJsonl(rows: AsyncIterable<{ row: CacheRow; stats: any }>, outPath: string): Promise<{ count: number; totalBytes: number; nonEmpty: { brand: number; name: number; ingredients: number; images: number }; validationStats: any }> {
    console.log("💾 Writing transformed data to local file...");
    const file = await Deno.open(outPath, { create: true, write: true, truncate: true });
    const encoder = new TextEncoder();
    let count = 0;
    let totalBytes = 0;
    let nonBrand = 0, nonName = 0, nonIng = 0, nonImg = 0;
    let lastProgressTime = Date.now();
    let lastStats: any = null;
    
    try {
        for await (const { row, stats } of rows) {
            count++;
            if (row.brand) nonBrand++;
            if (row.name) nonName++;
            if (row.ingredients && row.ingredients.length) nonIng++;
            if (row.images && row.images.length) nonImg++;
            const json = JSON.stringify(row);
            totalBytes += encoder.encode(json).byteLength;
            await file.write(encoder.encode(json + "\n"));
            lastStats = stats;
            
            // Show progress every 25k rows or every 5 seconds
            const now = Date.now();
            if (count % 25000 === 0 || now - lastProgressTime > 5000) {
                const validRate = ((lastStats.validProducts / lastStats.totalLines) * 100).toFixed(1);
                const invalidRate = (((lastStats.emptyLines + lastStats.jsonParseErrors + lastStats.noBarcode) / lastStats.totalLines) * 100).toFixed(1);
                console.log(`📝 Written ${count.toLocaleString()} products (${validRate}% valid, ${invalidRate}% invalid)`);
                lastProgressTime = now;
            }
        }
    } finally {
        file.close();
    }
    
    // Final validation statistics
    if (lastStats) {
        console.log(`\n📊 Validation Statistics:`);
        console.log(`  Total lines processed: ${lastStats.totalLines.toLocaleString()}`);
        console.log(`  Valid products: ${lastStats.validProducts.toLocaleString()} (${((lastStats.validProducts / lastStats.totalLines) * 100).toFixed(1)}%)`);
        console.log(`  Invalid products: ${(lastStats.emptyLines + lastStats.jsonParseErrors + lastStats.noBarcode).toLocaleString()} (${(((lastStats.emptyLines + lastStats.jsonParseErrors + lastStats.noBarcode) / lastStats.totalLines) * 100).toFixed(1)}%)`);
        console.log(`    - Empty lines: ${lastStats.emptyLines.toLocaleString()}`);
        console.log(`    - JSON parse errors: ${lastStats.jsonParseErrors.toLocaleString()}`);
        console.log(`    - No barcode: ${lastStats.noBarcode.toLocaleString()}`);
    }
    
    console.log(`✅ Local file complete! ${count.toLocaleString()} products written`);
    return { count, totalBytes, nonEmpty: { brand: nonBrand, name: nonName, ingredients: nonIng, images: nonImg }, validationStats: lastStats };
}

async function* projectRows(lines: AsyncIterable<string>): AsyncGenerator<{ row: CacheRow; stats: { totalLines: number; emptyLines: number; jsonParseErrors: number; noBarcode: number; validProducts: number } }> {
    let totalLines = 0;
    let emptyLines = 0;
    let jsonParseErrors = 0;
    let noBarcode = 0;
    let validProducts = 0;
    
    for await (const line of lines) {
        totalLines++;
        
        const trimmed = line.trim();
        if (!trimmed) {
            emptyLines++;
            continue;
        }
        
        try {
            const product = JSON.parse(trimmed);
            const row = mapToCacheRow(product);
            if (row && row.barcode) {
                validProducts++;
                
                // Progress reporting every 50k products
                if (validProducts % 50000 === 0) {
                    const validRate = ((validProducts / totalLines) * 100).toFixed(1);
                    const invalidRate = (((emptyLines + jsonParseErrors + noBarcode) / totalLines) * 100).toFixed(1);
                    console.log(`📊 Processed ${totalLines.toLocaleString()} lines, found ${validProducts.toLocaleString()} valid products (${validRate}% valid, ${invalidRate}% invalid)...`);
                }
                
                yield { row, stats: { totalLines, emptyLines, jsonParseErrors, noBarcode, validProducts } };
            } else {
                noBarcode++;
            }
        } catch (_) {
            jsonParseErrors++;
        }
    }
}

function formatBytes(bytes: number): string {
    const units = ["B", "KB", "MB", "GB", "TB"] as const;
    let i = 0;
    let n = bytes;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n.toFixed(2)} ${units[i]}`;
}

function estimateDatabaseSize(sampleRows: CacheRow[], totalProducts: number): {
    avgRowSize: number;
    estimatedTableSize: number;
    estimatedIndexSize: number;
    estimatedTotalSize: number;
} {
    if (sampleRows.length === 0) {
        return { avgRowSize: 0, estimatedTableSize: 0, estimatedIndexSize: 0, estimatedTotalSize: 0 };
    }
    
    // Calculate average row size from sample
    const sampleSizes = sampleRows.map(row => {
        const json = JSON.stringify(row);
        return new TextEncoder().encode(json).byteLength;
    });
    
    const avgRowSize = sampleSizes.reduce((sum, size) => sum + size, 0) / sampleSizes.length;
    
    // Estimate table size (data only)
    const estimatedTableSize = avgRowSize * totalProducts;
    
    // Estimate index size (barcode PK + other indexes)
    // Barcode index: ~20 bytes per row + overhead
    const barcodeIndexSize = (20 + 8) * totalProducts; // 20 bytes key + 8 bytes pointer
    const otherIndexSize = totalProducts * 16; // Additional indexes
    const estimatedIndexSize = barcodeIndexSize + otherIndexSize;
    
    // PostgreSQL overhead (20-30% for metadata, TOAST, etc.)
    const overhead = 0.25;
    const estimatedTotalSize = (estimatedTableSize + estimatedIndexSize) * (1 + overhead);
    
    return {
        avgRowSize: Math.round(avgRowSize),
        estimatedTableSize: Math.round(estimatedTableSize),
        estimatedIndexSize: Math.round(estimatedIndexSize),
        estimatedTotalSize: Math.round(estimatedTotalSize)
    };
}

async function sampleProductsForSizeEstimation(lines: AsyncIterable<string>, sampleSize: number, maxLines: number): Promise<{ sampleRows: CacheRow[]; estimatedTotalValidProducts: number; sampleLines: number }> {
    console.log(`📊 Sampling ${sampleSize.toLocaleString()} products from first ${maxLines.toLocaleString()} lines for size estimation...`);
    const sampleRows: CacheRow[] = [];
    let sampleLines = 0;
    let validProductsInSample = 0;
    let sampled = 0;
    let lastProgressTime = Date.now();
    
    for await (const line of lines) {
        sampleLines++;
        const trimmed = line.trim();
        if (!trimmed) continue;
        
        try {
            const product = JSON.parse(trimmed);
            const row = mapToCacheRow(product);
            if (row && row.barcode) {
                validProductsInSample++;
                if (sampled < sampleSize) {
                    sampleRows.push(row);
                    sampled++;
                }
            }
        } catch (_) {
            // skip invalid lines
        }
        
        // Show progress every 10k lines or every 5 seconds
        const now = Date.now();
        if (sampleLines % 10000 === 0 || now - lastProgressTime > 5000) {
            console.log(`📊 Scanned ${sampleLines.toLocaleString()} lines, found ${validProductsInSample.toLocaleString()} valid products...`);
            lastProgressTime = now;
        }
        
        // Stop after processing maxLines
        if (sampleLines >= maxLines) break;
    }
    
    // Estimate total valid products based on sample ratio
    const validRatio = validProductsInSample / sampleLines;
    const estimatedTotalValidProducts = Math.round(validRatio * 4046118); // Known total lines from earlier
    
    console.log(`✅ Sampled ${sampled.toLocaleString()} products from ${validProductsInSample.toLocaleString()} valid products in ${sampleLines.toLocaleString()} lines`);
    console.log(`📊 Estimated total valid products: ${estimatedTotalValidProducts.toLocaleString()} (${(validRatio * 100).toFixed(1)}% valid rate)`);
    
    return { sampleRows, estimatedTotalValidProducts, sampleLines };
}

async function askUploadPermission(stats: { count: number; totalBytes: number; dbEstimate?: any }): Promise<boolean> {
    console.log("\nSummary:");
    console.log(`  Rows: ${stats.count}`);
    console.log(`  Payload size (JSON only): ${formatBytes(stats.totalBytes)} (~${Math.round(stats.totalBytes / Math.max(1, stats.count))} B/row)`);
    
    if (stats.dbEstimate) {
        console.log("\n📊 Database Size Estimate:");
        console.log(`  Average row size: ${formatBytes(stats.dbEstimate.avgRowSize)}`);
        console.log(`  Table data size: ${formatBytes(stats.dbEstimate.estimatedTableSize)}`);
        console.log(`  Index size: ${formatBytes(stats.dbEstimate.estimatedIndexSize)}`);
        console.log(`  Total estimated size: ${formatBytes(stats.dbEstimate.estimatedTotalSize)}`);
    }
    
    const answer = confirm("Upload to Supabase inventory_cache? This can take a long time. (y/N)");
    return !!answer;
}


async function uploadJsonlToSupabase(path: string) {
    console.log("📤 Starting upload to Supabase...");
    
    // Load env for Supabase connection
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    if (!url || !key) {
        console.error("❌ SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
        Deno.exit(1);
    }
    
    const { createClient } = await import("npm:@supabase/supabase-js@2.39.3");
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    console.log("🔍 Opening file:", path);
    const file = await Deno.open(path, { read: true });
    console.log("✅ File opened successfully");

    const decoder = new TextDecoder();
    const bufSize = 64 * 1024;
    const buf = new Uint8Array(bufSize);
    let pending: any[] = [];
    let leftover = "";
    let total = 0;
    let batchCount = 0;
    let uploadedBatches = 0;
    let parallelUploads: Promise<void>[] = []; // Track parallel uploads
    
    // Progress tracking
    const startTime = Date.now();
    const progressInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = total / elapsed;
        console.log(`📊 Progress: ${total} products processed, ${batchCount} batches uploaded (${rate.toFixed(0)} products/sec)`);
    }, 10000); // Every 10 seconds
    
    try {
        while (true) {
            const read = await file.read(buf);
            if (read === null) {
                break;
            }

            const chunk = decoder.decode(buf.subarray(0, read));
            let data = leftover + chunk;
            let idx: number;
            let linesInChunk = 0;
            while ((idx = data.indexOf("\n")) !== -1) {
                linesInChunk++;
                const line = data.slice(0, idx);
                data = data.slice(idx + 1);
                if (!line) continue;

                try {
                    const row = JSON.parse(line);
                    row.last_refreshed_at = new Date().toISOString();
                    pending.push(row);
                    total++;

                    if (pending.length >= BATCH_UPLOAD_SIZE) {
                        batchCount++;
                        const currentBatchNum = batchCount;
                        
                        // Deduplicate by barcode (keep last occurrence) to avoid "ON CONFLICT DO UPDATE command cannot affect row a second time" error
                        const deduped = new Map<string, any>();
                        for (const row of pending) {
                            deduped.set(row.barcode, row);
                        }
                        
                        // Create batch for upload
                        const batch = Array.from(deduped.values()).map(row => ({
                            ...row,
                            last_refreshed_at: new Date().toISOString()
                        }));
                        
                        // Log if duplicates were found
                        const duplicateCount = pending.length - batch.length;
                        if (duplicateCount > 0) {
                            console.log(`⚠️  Removed ${duplicateCount} duplicate barcodes from batch ${currentBatchNum}`);
                        }
                        
                        // Clear pending immediately
                        pending = [];
                        uploadedBatches++;
                        
                        // Wait if we've reached the parallel limit BEFORE creating new promise
                        if (parallelUploads.length >= PARALLEL_BATCHES) {
                            console.log(`⏳ Waiting for ${parallelUploads.length} parallel uploads to complete...`);
                            await Promise.all(parallelUploads);
                            parallelUploads = [];
                            console.log(`✅ Completed batch group at ${batchCount} batches`);
                            
                            // Add delay to avoid rate limiting
                            if (DELAY_BETWEEN_BATCH_GROUPS_MS > 0) {
                                await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCH_GROUPS_MS));
                            }
                        }
                        
                        // Now create and add the upload promise
                        const uploadPromise = (async () => {
                            try {
                                const { error } = await supabase
                                    .from('inventory_cache')
                                    .upsert(batch, { onConflict: 'barcode' });
                                
                                if (error) {
                                    console.error(`❌ Batch ${currentBatchNum} failed:`, error.message);
                                    throw error;
                                }
                                
                                // Only log every 10 batches
                                if (currentBatchNum % 10 === 0) {
                                    console.log(`✅ Uploaded batch ${currentBatchNum} (${batch.length} rows)`);
                                }
                            } catch (error) {
                                console.error(`❌ Upload error at batch ${currentBatchNum}:`, error);
                                throw error;
                            }
                        })();
                        
                        parallelUploads.push(uploadPromise);

                        // Check if we need confirmation (every 500k products)
                        if (uploadedBatches >= BATCHES_PER_CONFIRMATION) {
                            // Wait for any pending uploads before asking
                            if (parallelUploads.length > 0) {
                                await Promise.all(parallelUploads);
                                parallelUploads = [];
                            }
                            
                            console.log(`\n📊 Checkpoint: ${total.toLocaleString()} products uploaded in ${batchCount} batches`);
                            console.log(`   (Uploaded ${(uploadedBatches * BATCH_UPLOAD_SIZE).toLocaleString()} products since last checkpoint)`);
                            const continueUpload = confirm(`Continue uploading next 500k products? [y/N]`);
                            if (!continueUpload) {
                                console.log("❌ Upload cancelled by user");
                                return;
                            }
                            uploadedBatches = 0;
                            console.log("✅ Continuing upload...\n");
                        }
                    }
                } catch (error) {
                    console.error(`❌ JSON parse error on line:`, (error as Error).message);
                    // skip invalid JSON
                }
            }
            leftover = data;
        }
        
        // Handle remaining data
        if (leftover.trim()) {
            try {
                const row = JSON.parse(leftover.trim());
                row.last_refreshed_at = new Date().toISOString();
                pending.push(row);
                total++;
            } catch (_) {
                // skip invalid JSON
            }
        }
        
        // Upload final batch if there's pending data
        if (pending.length > 0) {
            batchCount++;
            const currentBatchNum = batchCount;
            
            // Deduplicate by barcode (keep last occurrence)
            const deduped = new Map<string, any>();
            for (const row of pending) {
                deduped.set(row.barcode, row);
            }
            
            const batch = Array.from(deduped.values()).map(row => ({
                ...row,
                last_refreshed_at: new Date().toISOString()
            }));
            
            const duplicateCount = pending.length - batch.length;
            if (duplicateCount > 0) {
                console.log(`⚠️  Removed ${duplicateCount} duplicate barcodes from final batch ${currentBatchNum}`);
            }
            
            const uploadPromise = (async () => {
                try {
                    const { error } = await supabase
                        .from('inventory_cache')
                        .upsert(batch, { onConflict: 'barcode' });
                    
                    if (error) {
                        console.error(`❌ Final batch ${currentBatchNum} failed:`, error.message);
                        throw error;
                    }
                    
                    console.log(`✅ Uploaded final batch ${currentBatchNum} (${batch.length} rows)`);
                } catch (error) {
                    console.error(`❌ Upload error at final batch ${currentBatchNum}:`, error);
                    throw error;
                }
            })();
            
            parallelUploads.push(uploadPromise);
        }
        
        // Wait for all remaining parallel uploads to complete
        if (parallelUploads.length > 0) {
            console.log(`⏳ Waiting for final ${parallelUploads.length} uploads to complete...`);
            await Promise.all(parallelUploads);
            console.log(`✅ All uploads completed!`);
        }
        
        console.log(`✅ Upload complete! ${total} rows processed in ${batchCount} batches`);
        
    } finally {
        file.close();
        clearInterval(progressInterval);
    }
}

async function main() {
    // Parse command line arguments
    const args = Deno.args;
    const skipDownload = args.includes('--upload-only') || args.includes('-u');
    const showHelp = args.includes('--help') || args.includes('-h');
    
    if (showHelp) {
        console.log(`
Usage: deno run -A --unstable-kv local/openfoodfacts/off_ingest.ts [options]

Options:
  --upload-only, -u    Skip download and processing, go straight to upload
  --help, -h          Show this help message

Examples:
  deno run -A --unstable-kv local/openfoodfacts/off_ingest.ts                    # Full process
  deno run -A --unstable-kv local/openfoodfacts/off_ingest.ts --upload-only      # Upload only
  deno run -A --unstable-kv local/openfoodfacts/off_ingest.ts -u                 # Upload only (short)
        `);
        return;
    }
    
    if (skipDownload) {
        console.log("🚀 Starting in upload-only mode (skipping download and processing)...");
    }
    
    // Load environment variables from .env file
    await loadEnv();
    
    if (!skipDownload) {
        console.log("Downloading OFF JSONL.gz and streaming transform...");
        
        // First pass: Sample products for size estimation (fast)
        const lines = iterLinesFromGzip(OFF_JSONL_GZ_URL, false);
        const { sampleRows, estimatedTotalValidProducts } = await sampleProductsForSizeEstimation(lines, SAMPLE_SIZE, SAMPLE_LINES);
        
        // Estimate database size for the entire dataset
        const dbEstimate = estimateDatabaseSize(sampleRows, estimatedTotalValidProducts);
        console.log("\n📊 Database Size Estimate (Full Dataset):");
        console.log(`  Estimated total valid products: ${estimatedTotalValidProducts.toLocaleString()}`);
        console.log(`  Average row size: ${formatBytes(dbEstimate.avgRowSize)}`);
        console.log(`  Table data size: ${formatBytes(dbEstimate.estimatedTableSize)}`);
        console.log(`  Index size: ${formatBytes(dbEstimate.estimatedIndexSize)}`);
        console.log(`  Total estimated size: ${formatBytes(dbEstimate.estimatedTotalSize)}`);
        
        // Second pass: Process all products
        console.log("\n🔄 Processing all products...");
        const rows = projectRows(iterLinesFromGzip(OFF_JSONL_GZ_URL, true));
        const stats = await writeJsonl(rows, OUTPUT_PATH);
        
        console.log("\nField coverage (non-empty counts):");
        console.log(`  brand: ${stats.nonEmpty.brand}`);
        console.log(`  name: ${stats.nonEmpty.name}`);
        console.log(`  ingredients: ${stats.nonEmpty.ingredients}`);
        console.log(`  images: ${stats.nonEmpty.images}`);
        
        // Show validation summary
        if (stats.validationStats) {
            console.log("\n📊 Data Quality Summary:");
            const validRate = ((stats.validationStats.validProducts / stats.validationStats.totalLines) * 100).toFixed(1);
            console.log(`  Success rate: ${validRate}% (${stats.validationStats.validProducts.toLocaleString()} valid out of ${stats.validationStats.totalLines.toLocaleString()} total)`);
            console.log(`  Invalid breakdown:`);
            console.log(`    - Empty lines: ${stats.validationStats.emptyLines.toLocaleString()}`);
            console.log(`    - JSON parse errors: ${stats.validationStats.jsonParseErrors.toLocaleString()}`);
            console.log(`    - No barcode: ${stats.validationStats.noBarcode.toLocaleString()}`);
        }
        
        const proceed = await askUploadPermission({ ...stats, dbEstimate });
        if (!proceed) {
            console.log("Upload skipped.");
            return;
        }
    } else {
        // Check if the local file exists
        try {
            const stat = await Deno.stat(OUTPUT_PATH);
            console.log(`📁 Found existing file: ${OUTPUT_PATH} (${formatBytes(stat.size)})`);
        } catch {
            console.error(`❌ No existing ${OUTPUT_PATH} file found. Run without --upload-only first.`);
            return;
        }
    }
    console.log("\nUploading to Supabase (batched upserts)...");
    const start = Date.now();
    await uploadJsonlToSupabase(OUTPUT_PATH);
    const elapsed = (Date.now() - start) / 1000;
    console.log(`Done in ${elapsed.toFixed(1)}s.`);
}

if (import.meta.main) {
    await main().catch((err) => {
        console.error("Error:", err);
        Deno.exit(1);
    });
}


