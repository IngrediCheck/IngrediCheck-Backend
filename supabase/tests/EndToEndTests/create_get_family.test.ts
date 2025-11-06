import { signInAnon, functionsUrl } from './test_utils.ts';

Deno.test('create and get family', async () => {
  const baseUrl = Deno.env.get('SUPABASE_BASE_URL') ?? 'http://127.0.0.1:54321';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const { accessToken } = await signInAnon(baseUrl, anonKey);
  const headers: HeadersInit = { 'Authorization': `Bearer ${accessToken}` };
  const body = {
    name: 'Morgan Household',
    selfMember: { id: crypto.randomUUID(), name: 'Morgan Shaw', nicknames: ['Mo'], info: 'Account owner', color: '#264653' },
    otherMembers: [ { id: crypto.randomUUID(), name: 'Alex Shaw', color: '#2A9D8F' } ]
  };
  const createResp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (createResp.status !== 201) throw new Error(`create failed ${createResp.status}`);
  const getResp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family`, { headers });
  if (getResp.status !== 200) throw new Error(`get failed ${getResp.status}`);
  const json = await getResp.json();
  if (!json?.selfMember?.joined) throw new Error('selfMember not joined');
});


