
const clientId = Deno.env.get('KROGER_CLIENT_ID')
const clientSecret = Deno.env.get('KROGER_CLIENT_SECRET')

async function fetchAccessToken(): Promise<string> {
    const url = 'https://api.kroger.com/v1/connect/oauth2/token'
    const headers = {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`
    }

    // scope=product.full.read does not work because the app is not approved for that scope
    const body = 'grant_type=client_credentials&scope=product.compact'

    const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: body
    })

    if (!response.ok) {
        console.log(response)
        throw new Error('Failed to fetch access token')
    }

    const data = await response.json()
    return data.access_token
}

async function fetchProductDetails(productId: string, accessToken: string): Promise<any> {
    const url = `https://api.kroger.com/v1/products/${productId}`
    const headers = {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
    }

    const response = await fetch(url, {
        method: 'GET',
        headers: headers
    })

    if (!response.ok) {
        console.log(response)
        throw new Error('Failed to fetch product details')
    }

    const data = await response.json()
    return data
}

async function main() {
    const productId = Deno.args[0]
    if (!productId) {
        console.log('Please provide a product ID.')
        return
    }

    try {
        const accessToken = await fetchAccessToken()
        console.log('Product ID:', productId)
        console.log('Access token:', accessToken)
        const productDetails = await fetchProductDetails(productId, accessToken)
        console.log(JSON.stringify(productDetails, null, 4))
    } catch (error) {
        console.error('Error fetching product details:', error)
    }
}

console.log(clientId, clientSecret)
main()
