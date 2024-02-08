
import { supabase, signIn } from './kitchensink.ts'

await signIn()

if (!Deno.args[0]) {
    console.error("Error: No barcode specified.")
    Deno.exit(1)
}

const barcode = Deno.args[0]

const result = await supabase.functions.invoke(`ingredicheck/inventory/${barcode}`, { method: 'GET' })

if (result.error) {
    console.log(`Error fetching inventory: ${result.error.message}`)
}

console.log(result.data)