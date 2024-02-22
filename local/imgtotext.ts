
// This script does not work :(
// Error: error: Uncaught (in promise) NotSupported: Classic workers are not supported.
// Deno's current support for only module type workers

import { createWorker } from 'https://esm.sh/tesseract.js'

const main = async () => {
    const args = Deno.args
    if (args.length === 0) {
        console.log('Please provide a path to a .jpg file')
        Deno.exit(1)
    }

    const imagePath = args[0]
    const worker = await createWorker({
        logger: m => console.log(m)
    })

    try {
        await worker.load()
        await worker.loadLanguage('eng')
        await worker.initialize('eng')
        const { data: { text } } = await worker.recognize(imagePath)
        console.log(text)
    } catch (error) {
        console.error('Error processing image:', error)
    } finally {
        await worker.terminate()
    }
}

main()
