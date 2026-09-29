// Smoke test against a running server: BASE=http://localhost:8080 npm run smoke
const BASE = process.env.BASE || 'http://localhost:8080';
const ADMIN = process.env.ADMIN_TOKEN || '';
let cookie = '';
async function call(path, opts = {}) {
  const res = await fetch(BASE + path, { ...opts, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(opts.headers || {}) } });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) { const kv = c.split(';')[0]; const k = kv.split('=')[0]; cookie = cookie.split('; ').filter((x) => x && !x.startsWith(k + '=')).concat(kv).join('; '); }
  return { status: res.status, data: await res.json().catch(() => null) };
}
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } console.log('ok  ', m); };

const h = await call('/api/health'); assert(h.status === 200 && h.data.ok, 'health ' + JSON.stringify(h.data));
const me = await call('/api/me'); assert(me.status === 200 && me.data.id.startsWith('u_'), 'anonymous identity issued');
const me2 = await call('/api/me'); assert(me2.data.id === me.data.id, 'identity is stable across requests');
const bad = await call('/api/stories', { method: 'POST', body: JSON.stringify({ company: 'X', who: 'Y', title: 'short', body: 'call me 615-555-0100' }) });
assert(bad.status === 400 && /company|phone/i.test(bad.data.error), 'validation rejects bad post: ' + bad.data.error);
const post = await call('/api/stories', { method: 'POST', body: JSON.stringify({ company: 'Smoke Test Co', who: 'Pat in QA', title: 'Ran the smoke test in production.', body: 'It passed, allegedly.' }) });
assert(post.status === 201 && post.data.story.mine, 'story created');
const id = post.data.story.id;
const v1 = await call(`/api/stories/${id}/vote`, { method: 'POST' }); assert(v1.data.voted === true && v1.data.votes === 1, 'upvote counted once');
const v2 = await call(`/api/stories/${id}/vote`, { method: 'POST' }); assert(v2.data.voted === false && v2.data.votes === 0, 'second tap removes the vote (toggle)');
const v3 = await call(`/api/stories/${id}/vote`, { method: 'POST' }); assert(v3.data.voted === true && v3.data.votes === 1, 'third tap re-adds it, still one vote per person');
const list = await call('/api/stories'); assert(list.data.stories.some((s) => s.id === id && s.voted && s.votes === 1), 'story appears in feed with my vote');
const rep = await call(`/api/stories/${id}/report`, { method: 'POST', body: JSON.stringify({ reason: 'test' }) }); assert(rep.status === 200, 'report accepted');
const otherCookie = cookie; cookie = '';
const del403 = await call(`/api/stories/${id}`, { method: 'DELETE' }); assert(del403.status === 403, 'stranger cannot delete my story');
if (ADMIN) {
  const badLogin = await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ token: 'nope' }) }); assert(badLogin.status === 401, 'wrong admin token rejected');
  const login = await call('/api/admin/login', { method: 'POST', body: JSON.stringify({ token: ADMIN }) }); assert(login.status === 200, 'admin login');
  const reports = await call('/api/admin/reports'); assert(reports.status === 200 && reports.data.reports.some((r) => r.storyId === id), 'admin sees the report');
  const adel = await call(`/api/stories/${id}`, { method: 'DELETE' }); assert(adel.status === 200, 'admin can delete any story');
} else {
  cookie = otherCookie;
  const del = await call(`/api/stories/${id}`, { method: 'DELETE' }); assert(del.status === 200, 'author can delete own story');
}
const gone = await call('/api/stories'); assert(!gone.data.stories.some((s) => s.id === id), 'deleted story is gone');
console.log('\nAll smoke checks passed against ' + BASE);
