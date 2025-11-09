export async function signInAnon(baseUrl: string, anonKey: string): Promise<{ accessToken: string }> {
  const url = `${baseUrl.replace(/\/$/, '')}/auth/v1/signup`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `anon-${crypto.randomUUID()}@test.local`, password: crypto.randomUUID() })
  });
  if (!resp.ok) throw new Error(`auth failed: ${resp.status}`);
  const json = await resp.json();
  const accessToken = json?.access_token ?? json?.accessToken;
  if (!accessToken) throw new Error('missing access token');
  return { accessToken };
}

export function functionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/functions/v1`;
}


