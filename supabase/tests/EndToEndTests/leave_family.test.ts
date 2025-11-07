import { signInAnon, functionsUrl } from './test_utils.ts';

Deno.test('leave family clears association', async () => {
  const baseUrl = Deno.env.get('SUPABASE_BASE_URL') ?? 'http://127.0.0.1:54321';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  const { accessToken } = await signInAnon(baseUrl, anonKey);
  const headers: HeadersInit = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const selfId = crypto.randomUUID();
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family`, { method: 'POST', headers, body: JSON.stringify({ name: 'Gamma', selfMember: { id: selfId, name: 'Leaver', color: '#123456' } }) });
    if (resp.status !== 201) throw new Error(`create family failed ${resp.status}`);
    await resp.text();
  }

  // Leave
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/leave`, { method: 'POST', headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (resp.status !== 200) throw new Error(`leave failed ${resp.status}`);
    await resp.text();
  }

  // After leaving, get should error via edge handler (400/500). We just ensure it is not 200.
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family`, { headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (resp.status === 200) throw new Error('expected get to fail after leaving family');
    await resp.text();
  }
});



