// deno run -A local/off_ingest.ts
// Environment: Copy .env.template to .env and fill in your values

import { createClient } from "npm:@supabase/supabase-js@2.39.3";

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
    console.warn("⚠️  Could not load .env file:", error.message);
    console.warn("   Make sure to copy .env.template to .env and fill in your values");
  }
}

type Ingredient = {
    name: string;
    vegan?: boolean;
    vegetarian?: boolean;
    ingredients?: Ingredient[];
};

type Image = { url: string };

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
const BATCH_UPLOAD_SIZE = 1000;
const BATCHES_PER_CONFIRMATION = 5; // Upload 5 batches (5000 rows) before asking for confirmation

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

function extractDisplayImageUrls(selectedImages: any): Image[] {
    if (!selectedImages || typeof selectedImages !== "object") return [];
    const urls: Image[] = [];
    try {
        for (const value of Object.values(selectedImages as Record<string, any>)) {
            const display = (value as any)?.display;
            if (display && typeof display === "object") {
                if (typeof display.en === "string" && display.en) {
                    urls.push({ url: display.en });
                } else {
                    for (const v of Object.values(display)) {
                        if (typeof v === "string" && v) {
                            urls.push({ url: v });
                            break;
                        }
                    }
                }
            }
        }
    } catch (_) {
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

    const images = extractDisplayImageUrls(product?.selected_images);
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

async function* iterLinesFromGzip(url: string): AsyncGenerator<string> {
    console.log("📥 Downloading Open Food Facts data...");
    const res = await fetch(url);
    if (!res.body) throw new Error("No response body from OFF");
    
    const contentLength = res.headers.get("content-length");
    const totalBytes = contentLength ? parseInt(contentLength) : 0;
    console.log(`📦 File size: ${totalBytes > 0 ? formatBytes(totalBytes) : "unknown"}`);
    
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
                
                // Show progress every 50k lines or every 10 seconds
                const now = Date.now();
                if (lineCount % 50000 === 0 || now - lastProgressTime > 10000) {
                    console.log(`📊 Processed ${lineCount.toLocaleString()} products...`);
                    lastProgressTime = now;
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
    console.log(`✅ Download complete! Processed ${lineCount.toLocaleString()} products`);
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

async function askUploadPermission(stats: { count: number; totalBytes: number }): Promise<boolean> {
    console.log("\nSummary:");
    console.log(`  Rows: ${stats.count}`);
    console.log(`  Payload size (JSON only): ${formatBytes(stats.totalBytes)} (~${Math.round(stats.totalBytes / Math.max(1, stats.count))} B/row)`);
    const answer = confirm("Upload to Supabase inventory_cache? This can take a long time. (y/N)");
    return !!answer;
}

async function uploadJsonlToSupabase(path: string) {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY for legacy) must be set in environment");
    const supabase = createClient(url, key, { auth: { persistSession: false } });

    const file = await Deno.open(path, { read: true });
    const decoder = new TextDecoder();
    const bufSize = 1024 * 1024;
    const buf = new Uint8Array(bufSize);
    let pending: any[] = [];
    let leftover = "";
    let total = 0;
    let batchCount = 0;
    let uploadedBatches = 0;
    
    try {
        while (true) {
            const read = await file.read(buf);
            if (read === null) break;
            const chunk = decoder.decode(buf.subarray(0, read));
            let data = leftover + chunk;
            let idx: number;
            while ((idx = data.indexOf("\n")) !== -1) {
                const line = data.slice(0, idx);
                data = data.slice(idx + 1);
                if (!line) continue;
                try {
                    const row = JSON.parse(line);
                    // Set last_refreshed_at during upsert
                    row.last_refreshed_at = new Date().toISOString();
                    pending.push(row);
                    total++;
                    
                    if (pending.length >= BATCH_UPLOAD_SIZE) {
                        // Upload this batch
                        const { error } = await supabase.from("inventory_cache").upsert(pending, { onConflict: "barcode" });
                        if (error) throw error;
                        
                        batchCount++;
                        uploadedBatches++;
                        console.log(`✅ Uploaded batch ${batchCount} (${pending.length} rows) - Total: ${total} rows`);
                        
                        // Check if we need confirmation
                        if (uploadedBatches >= BATCHES_PER_CONFIRMATION) {
                            console.log(`\n📊 Progress: ${total} rows uploaded in ${batchCount} batches`);
                            const continueUpload = confirm(`Continue uploading? (${total} rows uploaded so far) [y/N]`);
                            if (!continueUpload) {
                                console.log("❌ Upload cancelled by user");
                                return;
                            }
                            uploadedBatches = 0; // Reset counter
                        }
                        
                        pending = [];
                    }
                } catch (_) {
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
            } catch (_) {}
        }
        
        // Upload final batch if any
        if (pending.length) {
            const { error } = await supabase.from("inventory_cache").upsert(pending, { onConflict: "barcode" });
            if (error) throw error;
            batchCount++;
            console.log(`✅ Uploaded final batch ${batchCount} (${pending.length} rows)`);
        }
    } finally {
        file.close();
    }
    
    console.log(`\n🎉 Upload complete! Total: ${total} rows uploaded in ${batchCount} batches`);
}

async function main() {
    // Load environment variables from .env file
    await loadEnv();
    
    console.log("Downloading OFF JSONL.gz and streaming transform...");
    const rows = projectRows(iterLinesFromGzip(OFF_JSONL_GZ_URL));
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
    
    const proceed = await askUploadPermission(stats);
    if (!proceed) {
        console.log("Upload skipped.");
        return;
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


