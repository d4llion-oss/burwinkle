(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- state ----------
  const state = {
    me: null, isAdmin: false, moderation: false,
    stories: [],        // {id, company, who, title, body, createdAt, example, mine, votes, voted}
    sort: 'hot', period: 'month', query: '', companyFilter: null,
    view: 'feed', ready: false, pendingDelete: null, offline: false, reports: [], shareOpen: null, focusId: null,
  };

  // ---------- helpers ----------
  const coKey = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const fmt = (n) => (n >= 10000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : Number(n).toLocaleString());
  function ago(ts) {
    const d = Math.max(0, Date.now() - ts), m = Math.floor(d / 60000), h = Math.floor(m / 60), dd = Math.floor(h / 24);
    if (m < 1) return 'just now'; if (m < 60) return m + 'm'; if (h < 24) return h + 'h'; if (dd < 30) return dd + 'd';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const hotScore = (s) => (s.votes + 1) / Math.pow((Date.now() - s.createdAt) / 3600000 + 2, 1.2);
  let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400); }
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  async function api(path, opts = {}) {
    const res = await fetch('/api' + path, {
      method: opts.method || 'GET', credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null; try { data = await res.json(); } catch (e) {}
    if (!res.ok) { const err = new Error((data && data.error) || 'Request failed.'); err.status = res.status; throw err; }
    return data;
  }

  const ICON_UP = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  const ICON_TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
  const ICON_FLAG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4h12l-2 4 2 4H5"/></svg>';
  const ICON_SHARE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M12 15V3M7 8l5-5 5 5"/></svg>';
  const ICON_LINK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/></svg>';

  // ---------- sharing ----------
  const storyUrl = (s) => location.origin + '/s/' + encodeURIComponent(s.id);
  const shareText = (s) => `“${s.title}” — ${s.who} at ${s.company}. Don't Get Yourself Burwinkled.`;
  function shareTargets(s) {
    const u = encodeURIComponent(storyUrl(s)), t = encodeURIComponent(shareText(s));
    return {
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}`,
      x: `https://twitter.com/intent/tweet?text=${t}&url=${u}`,
      linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    };
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      try { const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
    }
  }
  function shareSheet(s) {
    const t = shareTargets(s);
    return `<div class="share-sheet" role="group" aria-label="Share this story">
      <a class="share-btn" href="${t.facebook}" target="_blank" rel="noopener noreferrer"><span class="share-dot fb"></span>Facebook</a>
      <a class="share-btn" href="${t.x}" target="_blank" rel="noopener noreferrer"><span class="share-dot x"></span>X</a>
      <a class="share-btn" href="${t.linkedin}" target="_blank" rel="noopener noreferrer"><span class="share-dot li"></span>LinkedIn</a>
      <button class="share-btn" type="button" data-share-ig="${esc(s.id)}"><span class="share-dot ig"></span>Instagram</button>
      <button class="share-btn" type="button" data-share-copy="${esc(s.id)}">${ICON_LINK}Copy link</button>
    </div>`;
  }

  // ---------- rendering ----------
  function storyCard(s, opts = {}) {
    const canDelete = s.mine || state.isAdmin;
    const confirming = state.pendingDelete === s.id;
    return `<article class="card" data-id="${esc(s.id)}">
      <div class="card-top">
        <button class="company" data-co="${esc(s.company)}" title="See all stories from ${esc(s.company)}">${esc(s.company)}</button>
        <span class="meta">${ago(s.createdAt)} · anon</span>
      </div>
      <div class="title">${esc(s.title)}</div>
      ${s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
      <div class="who">Starring <b>${esc(s.who)}</b></div>
      <div class="actions">
        <button class="pill ${s.voted ? 'on' : ''}" data-vote="${esc(s.id)}" aria-pressed="${s.voted}" aria-label="Upvote, ${s.votes}">${ICON_UP}${fmt(s.votes)}</button>
        <button class="pill ghost ${state.shareOpen === s.id ? 'active' : ''}" data-share="${esc(s.id)}" aria-expanded="${state.shareOpen === s.id}" aria-label="Share story">${ICON_SHARE}Share</button>
        ${opts.trending ? '<span class="tag">Trending</span>' : ''}
        ${s.example ? '<span class="tag ex">Example</span>' : ''}
        <span class="spacer"></span>
        ${canDelete ? (confirming
          ? `<button class="pill danger" data-del-confirm="${esc(s.id)}">Delete?</button><button class="pill ghost" data-del-cancel="1">Keep</button>`
          : `<button class="pill ghost" data-del="${esc(s.id)}" aria-label="Delete story">${ICON_TRASH}</button>`)
          : `<button class="pill ghost" data-report="${esc(s.id)}" aria-label="Report story">${ICON_FLAG}</button>`}
      </div>
      ${state.shareOpen === s.id ? shareSheet(s) : ''}
    </article>`;
  }

  function filteredStories() {
    let list = state.stories.slice();
    if (state.companyFilter) list = list.filter((s) => coKey(s.company) === state.companyFilter);
    if (state.query) { const q = state.query.toLowerCase(); list = list.filter((s) => (s.company + ' ' + s.who + ' ' + s.title + ' ' + s.body).toLowerCase().includes(q)); }
    if (state.sort === 'week') { const cut = Date.now() - 7 * 86400000; list = list.filter((s) => s.createdAt >= cut).sort((a, b) => b.votes - a.votes || b.createdAt - a.createdAt); }
    else if (state.sort === 'new') list.sort((a, b) => b.createdAt - a.createdAt);
    else list.sort((a, b) => hotScore(b) - hotScore(a));
    return list;
  }

  function renderFeed() {
    if (!state.ready) return;
    const el = $('#feed');
    let list = filteredStories();
    const cf = $('#co-filter'); cf.hidden = !state.companyFilter;
    if (state.companyFilter) { const s = state.stories.find((x) => coKey(x.company) === state.companyFilter); $('#co-filter-name').textContent = s ? s.company : state.companyFilter; }
    if (!list.length) {
      el.innerHTML = `<div class="empty">
        <div class="display" style="font-size:22px">${state.stories.length ? 'Nothing here yet.' : 'No burns yet.'}</div>
        <p>${state.stories.length ? 'Try another filter, or tell the story yourself.' : 'Every company has a Greg. Be the first to tell the story.'}</p>
        <a class="btn" href="#tell">Tell a story</a></div>`;
      return;
    }
    const top = state.sort === 'hot' && list.length > 2 ? list[0].id : null;
    let html = '';
    if (state.focusId) {
      const f = state.stories.find((x) => x.id === state.focusId);
      if (f) {
        html += `<div class="section-row"><span>Shared story</span><button class="pill ghost" data-unfocus="1">Show all</button></div>` + storyCard(f) + `<div class="section-row"><span>More burns</span></div>`;
        list = list.filter((x) => x.id !== f.id);
      }
    }
    el.innerHTML = html + list.slice(0, 100).map((s) => storyCard(s, { trending: s.id === top && s.votes > 0 })).join('');
  }

  function renderHOF() {
    const el = $('#hof');
    const list = state.stories.filter((s) => s.votes > 0).sort((a, b) => b.votes - a.votes || a.createdAt - b.createdAt).slice(0, 25);
    if (!list.length) { el.innerHTML = `<div class="empty"><div class="display" style="font-size:22px">The hall is empty.</div><p>Stories enter the HOF once they have upvotes. Go find something worth burning.</p><a class="btn" href="#feed">Go to the feed</a></div>`; return; }
    el.innerHTML = list.map((s, i) => {
      const r = i + 1, cls = r <= 3 ? 'r' + r : 'rn';
      return `<article class="card rank-card ${r === 1 ? 'first' : ''}" data-id="${esc(s.id)}">
        <div class="rank-row">
          <div class="rank-left"><span class="badge ${cls}">${r}</span>
            <div class="rank-co"><button class="company" data-co="${esc(s.company)}">${esc(s.company)}</button><span class="meta">Inducted ${new Date(s.createdAt).toLocaleDateString(undefined, { month: 'long' })}</span></div></div>
          <div class="rank-score"><b>${fmt(s.votes)}</b><span>upvotes</span></div>
        </div>
        <div class="title" style="font-size:17px">${esc(s.title)}</div>
        ${s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
        <div class="actions"><span class="who">Starring <b>${esc(s.who)}</b></span><span class="spacer"></span>
          <button class="pill ${s.voted ? 'on' : ''}" data-vote="${esc(s.id)}" aria-pressed="${s.voted}" aria-label="Upvote">${ICON_UP}${s.voted ? 'Upvoted' : 'Upvote'}</button></div>
      </article>`;
    }).join('');
  }

  function companyStats() {
    const cut = state.period === 'month' ? Date.now() - 30 * 86400000 : 0;
    const map = new Map();
    for (const s of state.stories) {
      if (s.createdAt < cut) continue;
      const k = coKey(s.company); if (!k) continue;
      const c = map.get(k) || { name: s.company, stories: 0, votes: 0, hof: 0 };
      c.stories++; c.votes += s.votes; map.set(k, c);
    }
    const hofIds = new Set(state.stories.filter((s) => s.votes > 0).sort((a, b) => b.votes - a.votes).slice(0, 10).map((s) => s.id));
    for (const s of state.stories) if (hofIds.has(s.id)) { const c = map.get(coKey(s.company)); if (c) c.hof++; }
    const rows = Array.from(map.entries()).map(([key, c]) => ({ key, ...c, burn: c.votes + c.stories * 5 }));
    rows.sort((a, b) => b.burn - a.burn || b.stories - a.stories);
    const max = rows.length ? rows[0].burn : 1;
    return rows.map((r) => ({ ...r, score: Math.max(1, Math.round(100 * r.burn / max)) }));
  }

  function renderCompanies() {
    const el = $('#companies');
    $('#co-sub').textContent = state.period === 'month' ? 'Ranked by Burn Score this month.' : 'Ranked by Burn Score, all-time.';
    const rows = companyStats();
    if (!rows.length) { el.innerHTML = `<div class="empty"><div class="display" style="font-size:22px">No companies on the board.</div><p>${state.period === 'month' ? 'Nothing posted in the last 30 days.' : 'Once stories come in, companies get ranked here.'}</p><a class="btn" href="#tell">Tell a story</a></div>`; return; }
    el.innerHTML = rows.slice(0, 50).map((r, i) => {
      const rk = i + 1, cls = rk <= 3 ? 'r' + rk : '';
      return `<button class="co-row" data-co="${esc(r.name)}">
        <span class="co-rank ${cls}">${rk}</span>
        <span class="co-main">
          <span class="co-head"><span class="co-name">${esc(r.name)}</span><span class="co-score ${rk === 1 ? 'r1' : ''}">${r.score}</span></span>
          <span class="bar"><i class="${rk === 1 ? 'r1' : ''}" style="width:${r.score}%"></i></span>
          <span class="co-sub">${r.stories} ${r.stories === 1 ? 'story' : 'stories'} · ${fmt(r.votes)} upvotes${r.hof ? ' · ' + r.hof + ' in the HOF' : ''}</span>
        </span></button>`;
    }).join('');
  }

  function renderMe() {
    const mine = state.stories.filter((s) => s.mine).sort((a, b) => b.createdAt - a.createdAt);
    $('#me-stories').textContent = mine.length;
    $('#me-votes').textContent = fmt(mine.reduce((n, s) => n + s.votes, 0));
    $('#me-given').textContent = state.stories.filter((s) => s.voted).length;
    $('#me-list').innerHTML = mine.length ? mine.map((s) => storyCard(s)).join('')
      : `<div class="empty"><div class="display" style="font-size:22px">You haven't burned anyone yet.</div><p>Your stories show up here, still anonymous to everyone else.</p><a class="btn" href="#tell">Tell a story</a></div>`;
    $('#admin-head').hidden = !state.moderation && !state.isAdmin;
    $('#admin-locked').hidden = state.isAdmin || !state.moderation;
    $('#admin-open').hidden = !state.isAdmin;
    if (state.isAdmin) {
      const el = $('#reports');
      el.innerHTML = state.reports.length ? state.reports.map((r) => {
        const s = state.stories.find((x) => x.id === r.storyId);
        return `<article class="card" data-id="${esc(r.storyId)}">
          <div class="card-top"><span class="company">${esc(r.company)}</span><span class="meta">${r.reports} ${r.reports === 1 ? 'report' : 'reports'} · last ${ago(r.lastAt)}</span></div>
          <div class="title">${esc(r.title)}</div>
          ${s && s.body ? `<div class="body">${esc(s.body)}</div>` : ''}
          <div class="actions"><span class="spacer"></span>
            ${state.pendingDelete === r.storyId
              ? `<button class="pill danger" data-del-confirm="${esc(r.storyId)}">Delete?</button><button class="pill ghost" data-del-cancel="1">Keep</button>`
              : `<button class="pill ghost" data-del="${esc(r.storyId)}">${ICON_TRASH} Remove</button>`}
          </div></article>`;
      }).join('') : '<div class="empty"><p>No reported stories. Quiet day.</p></div>';
    }
  }

  function renderCompanyList() {
    const names = new Map(); for (const s of state.stories) names.set(coKey(s.company), s.company);
    $('#company-list').innerHTML = Array.from(names.values()).sort().map((n) => `<option value="${esc(n)}"></option>`).join('');
  }

  function renderAll() {
    if (!state.ready) return;
    renderFeed(); renderHOF(); renderCompanies(); renderMe(); renderCompanyList();
  }

  // ---------- navigation ----------
  const VIEWS = ['feed', 'hof', 'companies', 'tell', 'me'];
  function show(view) {
    if (!VIEWS.includes(view)) view = 'feed';
    state.view = view; state.pendingDelete = null;
    VIEWS.forEach((v) => { $('#view-' + v).hidden = v !== view; });
    $$('.nav a').forEach((a) => { if (a.dataset.nav === view) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    window.scrollTo({ top: 0 });
    if (view === 'tell') setTimeout(() => $('#f-company').focus(), 50);
    if (view === 'me' && state.isAdmin) loadReports();
    renderAll();
  }
  window.addEventListener('hashchange', () => show(location.hash.replace('#', '')));

  // ---------- data ----------
  async function loadStories() {
    try {
      const data = await api('/stories');
      state.stories = data.stories; state.ready = true;
      if (state.offline) { state.offline = false; $('#banner').hidden = true; }
      renderAll();
    } catch (e) {
      state.ready = true; state.offline = true;
      const b = $('#banner'); b.textContent = "Can't reach Burwinkle right now. Showing what we have; we'll keep trying."; b.hidden = false;
      renderAll();
    }
  }
  async function loadMe() {
    try { const me = await api('/me'); state.me = me.id; state.isAdmin = me.isAdmin; state.moderation = me.moderation; } catch (e) {}
  }
  async function loadReports() {
    try { state.reports = (await api('/admin/reports')).reports; renderMe(); } catch (e) {}
  }

  // ---------- actions ----------
  async function toggleVote(id) {
    const s = state.stories.find((x) => x.id === id); if (!s) return;
    const prev = { voted: s.voted, votes: s.votes };
    s.voted = !s.voted; s.votes += s.voted ? 1 : -1; renderAll();
    try { const r = await api('/stories/' + encodeURIComponent(id) + '/vote', { method: 'POST' }); s.voted = r.voted; s.votes = r.votes; renderAll(); }
    catch (e) { Object.assign(s, prev); renderAll(); toast(e.message || "Couldn't save your upvote."); }
  }
  async function deleteStory(id) {
    state.pendingDelete = null;
    const backup = state.stories.slice();
    state.stories = state.stories.filter((s) => s.id !== id); state.reports = state.reports.filter((r) => r.storyId !== id); renderAll();
    try { await api('/stories/' + encodeURIComponent(id), { method: 'DELETE' }); toast('Story deleted.'); }
    catch (e) { state.stories = backup; renderAll(); toast(e.message || "Couldn't delete that story."); }
  }
  async function reportStory(id) {
    try { await api('/stories/' + encodeURIComponent(id) + '/report', { method: 'POST', body: { reason: 'flagged' } }); toast('Reported. A moderator will take a look.'); }
    catch (e) { toast(e.message || "Couldn't send the report."); }
  }
  async function submitStory(ev) {
    ev.preventDefault();
    const err = $('#tell-err'); err.hidden = true;
    const body = {
      company: $('#f-company').value.trim().replace(/\s+/g, ' '), who: $('#f-who').value.trim(),
      title: $('#f-title').value.trim(), body: $('#f-body').value.trim(),
    };
    const problems = [];
    if (body.company.length < 2) problems.push('Name the company.');
    if (body.who.length < 2) problems.push('Say who did it (a first name or role).');
    if (body.title.length < 8) problems.push('The one-liner needs a few more words.');
    if (/@|https?:\/\/|www\.|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/i.test(body.who + ' ' + body.title + ' ' + body.body)) problems.push('No emails, links, or phone numbers.');
    if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; return; }
    const btn = $('#btn-submit'); btn.disabled = true;
    try {
      const r = await api('/stories', { method: 'POST', body });
      state.stories.unshift(r.story);
      $('#tell-form').reset(); $('#body-count').textContent = '0 / 500'; store.set('bw-draft', '');
      state.sort = 'new'; $$('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.sort === 'new'));
      state.companyFilter = null;
      location.hash = '#feed'; toast('Burwinkled. Your story is live.');
    } catch (e) { err.textContent = e.message || "Couldn't post the story. Try again."; err.hidden = false; }
    finally { btn.disabled = false; }
  }
  async function adminLogin(ev) {
    ev.preventDefault();
    const err = $('#admin-err'); err.hidden = true;
    try { await api('/admin/login', { method: 'POST', body: { token: $('#f-admin').value } }); $('#f-admin').value = ''; state.isAdmin = true; toast('Moderation unlocked.'); loadReports(); renderAll(); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  }

  async function shareInstagram(id) {
    const s = state.stories.find((x) => x.id === id); if (!s) return;
    // Instagram has no web share endpoint. On phones the system share sheet
    // lists Instagram; elsewhere we copy the link for pasting into a post or story.
    if (navigator.share) {
      try { await navigator.share({ title: 'Burwinkle', text: shareText(s), url: storyUrl(s) }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    const ok = await copyText(storyUrl(s));
    toast(ok ? 'Link copied. Paste it into your Instagram post or story.' : 'Instagram needs the link pasted: ' + storyUrl(s));
  }

  // ---------- wiring ----------
  document.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-vote],[data-co],[data-del],[data-del-confirm],[data-del-cancel],[data-report],[data-sort],[data-period],[data-share],[data-share-ig],[data-share-copy],[data-unfocus]');
    if (!t) { if (state.shareOpen && !ev.target.closest('.share-sheet')) { state.shareOpen = null; renderAll(); } return; }
    if (t.dataset.share) { state.shareOpen = state.shareOpen === t.dataset.share ? null : t.dataset.share; renderAll(); return; }
    if (t.dataset.shareCopy) { const s = state.stories.find((x) => x.id === t.dataset.shareCopy); if (s) copyText(storyUrl(s)).then((ok) => toast(ok ? 'Link copied.' : "Couldn't copy. The link is " + storyUrl(s))); return; }
    if (t.dataset.shareIg) { return shareInstagram(t.dataset.shareIg); }
    if (t.dataset.unfocus) { state.focusId = null; history.replaceState(null, '', '/#feed'); renderFeed(); return; }
    if (t.dataset.vote) return toggleVote(t.dataset.vote);
    if (t.dataset.co !== undefined) { state.companyFilter = coKey(t.dataset.co); state.query = ''; $('#search').value = ''; location.hash = '#feed'; renderFeed(); return; }
    if (t.dataset.del) { state.pendingDelete = t.dataset.del; renderAll(); return; }
    if (t.dataset.delConfirm) return deleteStory(t.dataset.delConfirm);
    if (t.dataset.delCancel) { state.pendingDelete = null; renderAll(); return; }
    if (t.dataset.report) return reportStory(t.dataset.report);
    if (t.dataset.sort) { state.sort = t.dataset.sort; $$('[data-sort]').forEach((b) => b.setAttribute('aria-pressed', b === t)); renderFeed(); return; }
    if (t.dataset.period) { state.period = t.dataset.period; $$('[data-period]').forEach((b) => b.setAttribute('aria-pressed', b === t)); renderCompanies(); }
  });
  $('#co-filter').addEventListener('click', () => { state.companyFilter = null; renderFeed(); });
  $('#btn-search').addEventListener('click', () => { const w = $('#search-wrap'); w.hidden = !w.hidden; $('#btn-search').setAttribute('aria-pressed', String(!w.hidden)); if (!w.hidden) $('#search').focus(); else { state.query = ''; $('#search').value = ''; renderFeed(); } });
  $('#search').addEventListener('input', (e) => { state.query = e.target.value.trim(); renderFeed(); });
  $('#btn-close-tell').addEventListener('click', () => { location.hash = '#feed'; });
  $('#tell-form').addEventListener('submit', submitStory);
  $('#admin-form').addEventListener('submit', adminLogin);
  $('#btn-admin-logout').addEventListener('click', async () => { try { await api('/admin/logout', { method: 'POST' }); } catch (e) {} state.isAdmin = false; state.reports = []; renderAll(); toast('Moderation locked.'); });
  const bodyEl = $('#f-body');
  bodyEl.addEventListener('input', () => { const n = bodyEl.value.length; const c = $('#body-count'); c.textContent = n + ' / 500'; c.classList.toggle('over', n > 500); store.set('bw-draft', bodyEl.value); });
  const draft = store.get('bw-draft'); if (draft) { bodyEl.value = draft; $('#body-count').textContent = draft.length + ' / 500'; }

  // ---------- boot ----------
  const shared = document.body.dataset.story || (location.pathname.startsWith('/s/') ? decodeURIComponent(location.pathname.slice(3)) : '');
  if (shared) { state.focusId = shared; }
  show(location.hash.replace('#', '') || 'feed');
  (async () => { await loadMe(); await loadStories(); if (state.focusId && !state.stories.some((x) => x.id === state.focusId)) { state.focusId = null; toast('That story is no longer on Burwinkle.'); renderFeed(); } })();
  setInterval(() => { if (document.visibilityState === 'visible' && state.view !== 'tell') loadStories(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadStories(); });
})();
