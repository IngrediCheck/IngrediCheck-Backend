import { signInAnon, functionsUrl } from './test_utils.ts';

Deno.test('invite and join flow', async () => {
  const baseUrl = Deno.env.get('SUPABASE_BASE_URL') ?? 'http://127.0.0.1:54321';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // User A creates family with a placeholder member B (unjoined)
  const userA = await signInAnon(baseUrl, anonKey);
  const headersA: HeadersInit = { 'Authorization': `Bearer ${userA.accessToken}`, 'Content-Type': 'application/json' };
  const selfId = crypto.randomUUID();
  const memberBId = crypto.randomUUID();

  {
    const body = {
      name: 'Team Alpha',
      selfMember: { id: selfId, name: 'User A', color: '#111111' },
      otherMembers: [ { id: memberBId, name: 'User B', color: '#222222' } ]
    };
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family`, { method: 'POST', headers: headersA, body: JSON.stringify(body) });
    if (resp.status !== 201) throw new Error(`create family failed ${resp.status}`);
    await resp.text();
  }

  // User A generates invite for member B
  let inviteCode = '';
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/invite`, { method: 'POST', headers: headersA, body: JSON.stringify({ memberID: memberBId }) });
    if (resp.status !== 201) throw new Error(`create invite failed ${resp.status}`);
    const json = await resp.json();
    inviteCode = json?.inviteCode ?? '';
    if (!inviteCode) throw new Error('missing inviteCode');
  }

  // User B signs in and joins family via invite
  const userB = await signInAnon(baseUrl, anonKey);
  const headersB: HeadersInit = { 'Authorization': `Bearer ${userB.accessToken}`, 'Content-Type': 'application/json' };
  {
    const resp = await fetch(`${functionsUrl(baseUrl)}/ingredicheck/family/join`, { method: 'POST', headers: headersB, body: JSON.stringify({ inviteCode }) });
    if (resp.status !== 201) throw new Error(`join failed ${resp.status}`);
    const json = await resp.json();
    if (!json?.selfMember?.joined) throw new Error('User B not joined after invite');
  }
});


