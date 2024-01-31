
import { supabase, signIn } from './kitchensink.ts'

await signIn()

const barcode = '028400310413'

const result = await supabase.functions.invoke(`safeeats/inventory/${barcode}`, { method: 'GET' })

if (result.error) {
    console.log(`Error fetching inventory: ${result.error.message}`)
}

console.log(result.data)