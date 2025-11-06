import { signInAnon, functionsUrl } from './test_utils.ts';

Deno.test('member lifecycle', async () => {
  const baseUrl = Deno.env.get('SUPABASE_BASE_URL') ?? 'http://127.0.0.1:54321';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const { accessToken } = await signInAnon(baseUrl, anonKey);
  const headers: HeadersInit = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const selfId = crypto.randomUUID();
  const newId = crypto.randomUUID();
  {
    const r = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family`, { method: 'POST', headers, body: JSON.stringify({ name: 'House', selfMember: { id: selfId, name: 'A', color: '#000000' } }) });
    await r.text();
  }
  let resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/members`, { method: 'POST', headers, body: JSON.stringify({ id: newId, name: 'B', color: '#FF0000' }) });
  if (resp.status !== 201) throw new Error(`add failed ${resp.status}`);
  await resp.text();
  resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/members/${newId}`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'B2', color: '#00FF00' }) });
  if (resp.status !== 200) throw new Error(`edit failed ${resp.status}`);
  await resp.text();
  resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/members/${newId}`, { method: 'DELETE', headers: { Authorization: headers['Authorization'] as string } });
  if (resp.status !== 200) throw new Error(`delete failed ${resp.status}`);
  await resp.text();
});


