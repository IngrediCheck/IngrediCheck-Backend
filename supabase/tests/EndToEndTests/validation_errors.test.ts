import { signInAnon, functionsUrl } from './test_utils.ts';

Deno.test('validation and error cases', async () => {
  const baseUrl = Deno.env.get('SUPABASE_BASE_URL') ?? 'http://127.0.0.1:54321';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  const { accessToken } = await signInAnon(baseUrl, anonKey);
  const headers: HeadersInit = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  // 1) invalid member id format
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/members`, { method: 'POST', headers, body: JSON.stringify({ id: 'bad-id', name: 'X', color: '#000000' }) });
    if (resp.status !== 400) throw new Error(`expected 400 for invalid member id, got ${resp.status}`);
    await resp.text();
  }

  // 2) create family, then duplicate member name should error
  const selfId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  {
    const body = { name: 'Delta', selfMember: { id: selfId, name: 'Owner', color: '#111111' } };
    const r = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (r.status !== 201) throw new Error(`create family failed ${r.status}`);
    await r.text();
  }
  {
    const resp1 = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/members`, { method: 'POST', headers, body: JSON.stringify({ id: otherId, name: 'Kid', color: '#ff0000' }) });
    if (resp1.status !== 201) throw new Error(`add member failed ${resp1.status}`);
    await resp1.text();
    const resp2 = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/members`, { method: 'POST', headers, body: JSON.stringify({ id: crypto.randomUUID(), name: 'Kid', color: '#00ff00' }) });
    if (resp2.status === 201) throw new Error('expected duplicate name rejection');
    await resp2.text();
  }

  // 3) delete self should fail
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/members/${selfId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${accessToken}` } });
    if (resp.status === 200) throw new Error('expected deleting self to fail');
    await resp.text();
  }

  // 4) join with invalid invite code should fail
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/join`, { method: 'POST', headers, body: JSON.stringify({ inviteCode: 'invalid' }) });
    if (resp.status === 201) throw new Error('expected invalid invite to fail');
    await resp.text();
  }
});



