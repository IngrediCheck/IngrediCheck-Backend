// Child process for uploading a single batch to Supabase
import { createClient } from "npm:@supabase/supabase-js@2.39.3";

async function uploadBatch() {
    const batchFile = Deno.args[0];
    const batchNumber = Deno.args[1];
    
    if (!batchFile || !batchNumber) {
        console.error("Usage: deno run off_upload_batch.ts <batch_file> <batch_number>");
        Deno.exit(1);
    }
    
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    
    if (!url || !key) {
        console.error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set");
        Deno.exit(1);
    }
    
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    
    try {
        // Read batch file
        const batchData = await Deno.readTextFile(batchFile);
        const rows = batchData.trim().split('\n').map(line => JSON.parse(line));
        
        // Upload to Supabase
        const { error } = await supabase
            .from('inventory_cache')
            .upsert(rows, { onConflict: 'barcode' });
            
        if (error) {
            console.error(`❌ Batch ${batchNumber} failed:`, error.message);
            Deno.exit(1);
        }
        
        // Only log every 10th batch to reduce output
        if (parseInt(batchNumber) % 10 === 0) {
            console.log(`✅ Uploaded batch ${batchNumber} (${rows.length} rows)`);
        }
        
    } catch (error) {
        console.error(`❌ Batch ${batchNumber} error:`, error.message);
        Deno.exit(1);
    } finally {
        // Clean up temp file
        try {
            await Deno.remove(batchFile);
        } catch {
            // Ignore cleanup errors
        }
    }
}

uploadBatch();
