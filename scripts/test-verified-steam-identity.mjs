import assert from 'node:assert/strict';
import { verifiedSteamIdentity } from '../web/lib/verifiedSteamIdentity.ts';
import { getSessionUser } from '../web/lib/sessionUser.ts';

const confirmed = {
  email: '76561198000000001@steam.local',
  email_confirmed_at: '2026-09-20T00:00:00Z',
};
assert.equal(verifiedSteamIdentity(confirmed), '76561198000000001');
// Spoofing either metadata object must not change the verified identity.
assert.equal(verifiedSteamIdentity({ ...confirmed,
  user_metadata: { steam_id: '76561198000000002' },
  app_metadata: { steam_id: '76561198000000002' },
}), '76561198000000001');
for (const user of [
  {}, { user_metadata: { steam_id: '76561198000000001' } },
  { ...confirmed, email_confirmed_at: undefined },
  { ...confirmed, email: '76561198000000001@steam.local.attacker.example' },
  { ...confirmed, email: '76561198000000001@example.com' },
  { ...confirmed, email: '00000000000000000@steam.local' },
  { ...confirmed, email: '76561202255233024@steam.local' },
]) assert.equal(verifiedSteamIdentity(user), null);
const request = { headers: { authorization: 'Bearer test-token' } };
assert.deepEqual(await getSessionUser(request, {
  auth: { getUser: async (token) => {
    assert.equal(token, 'test-token');
    return { data: { user: { ...confirmed, user_metadata: { steam_id: '76561198000000002' } } }, error: null };
  } },
}), { steamId: '76561198000000001' });
assert.deepEqual(await getSessionUser(request, {
  auth: { getUser: async () => ({ data: { user: confirmed }, error: new Error('invalid token') }) },
}), { steamId: null });
assert.deepEqual(await getSessionUser({ headers: {} }, {
  auth: { getUser: async () => { throw new Error('must not query without a token'); } },
}), { steamId: null });
console.log('Verified Steam identity: valid legacy sessions accepted; spoofed/unconfirmed identities rejected.');
