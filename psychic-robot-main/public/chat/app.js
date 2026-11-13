/* Lunaar Chat — accounts + Discord-style chat on Supabase (free tier).
 * Plain JavaScript, no build step. All user text is inserted with textContent /
 * text nodes (never innerHTML), so messages can't inject markup. */
(() => {
  'use strict';

  const CFG = window.LUNAAR_CHAT || {};
  const PAGE = 50;
  const USERNAME_RE = /^[A-Za-z0-9_.-]{3,24}$/;
  const configured = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
    !/YOUR-PROJECT|YOUR-ANON/.test(CFG.SUPABASE_URL + CFG.SUPABASE_ANON_KEY));

  const $ = (s, el = document) => el.querySelector(s);

  /* ---------------------------------------------------------- helpers */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      el.append(typeof kid === 'object' && kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return el;
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); };

  function hue(str) {
    let n = 0;
    for (let i = 0; i < str.length; i++) n = (n * 31 + str.charCodeAt(i)) >>> 0;
    return n % 360;
  }
  const nameColor = (id) => `hsl(${hue(id)} 80% 75%)`;

  function toast(text, kind = '') {
    const el = h('div', { class: `toast ${kind}`, text });
    $('#toasts').append(el);
    setTimeout(() => el.remove(), 4500);
  }

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const sameDay = (a, b) => a.toDateString() === b.toDateString();

  function linkify(text) {
    const frag = document.createDocumentFragment();
    const re = /https?:\/\/[^\s<>"']+/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const url = m[0].replace(/[.,!?;:)\]]+$/, '');
      frag.append(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer nofollow', text: url }));
      if (url.length < m[0].length) frag.append(m[0].slice(url.length));
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    return frag;
  }

  function avatarEl(profile, { small = false, online = null } = {}) {
    const name = profile?.username || '?';
    const el = h('div', { class: 'avatar' + (small ? ' sm' : '') });
    const fallback = () => {
      clear(el);
      el.style.background = `hsl(${hue(profile?.id || name)} 70% 72%)`;
      el.append(name[0].toUpperCase());
      if (online !== null) el.append(h('span', { class: 'dot' + (online ? ' on' : '') }));
    };
    if (profile?.avatar_url && /^https:\/\//.test(profile.avatar_url)) {
      const img = h('img', { src: profile.avatar_url, alt: '', referrerpolicy: 'no-referrer', loading: 'lazy' });
      img.addEventListener('error', fallback);
      el.append(img);
      if (online !== null) el.append(h('span', { class: 'dot' + (online ? ' on' : '') }));
    } else fallback();
    return el;
  }

  /* ------------------------------------------------------ modals / menus */
  let closeMenu = () => {};
  function showMenu(anchor, items) {
    closeMenu();
    const r = anchor.getBoundingClientRect();
    const menu = h('div', { class: 'menu', role: 'menu' });
    items.filter(Boolean).forEach((it) => menu.append(h('button', {
      type: 'button', role: 'menuitem', class: it.danger ? 'danger' : '', text: it.label,
      onclick: () => { closeMenu(); it.onClick(); },
    })));
    document.body.append(menu);
    const w = menu.offsetWidth, hgt = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    menu.style.top = (r.bottom + hgt + 12 > innerHeight ? Math.max(8, r.top - hgt - 4) : r.bottom + 4) + 'px';
    const off = (e) => { if (!menu.contains(e.target)) closeMenu(); };
    setTimeout(() => document.addEventListener('mousedown', off), 0);
    closeMenu = () => { menu.remove(); document.removeEventListener('mousedown', off); closeMenu = () => {}; };
  }

  let closeModal = () => {};
  function openModal(content) {
    closeModal();
    const back = h('div', { class: 'modal-back', onmousedown: (e) => { if (e.target === back) closeModal(); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, content));
    $('#modal-root').append(back);
    const onKey = (e) => { if (e.key === 'Escape') closeModal(); };
    document.addEventListener('keydown', onKey);
    closeModal = () => { back.remove(); document.removeEventListener('keydown', onKey); closeModal = () => {}; };
    const first = back.querySelector('input, button');
    if (first) first.focus();
    return back;
  }

  /** Modal with inputs. onSubmit(values) may throw an Error to show it inline. */
  function formModal({ title, text, fields, submit, danger, onSubmit, extra }) {
    const err = h('div', { class: 'err', role: 'alert' });
    const inputs = {};
    const form = h('form', { novalidate: true },
      h('h2', { text: title }),
      text ? h('p', { text }) : null,
      ...(fields || []).map((f) => {
        inputs[f.name] = h('input', {
          type: f.type || 'text', value: f.value || '', placeholder: f.placeholder || '',
          maxlength: f.maxlength || 100, autocomplete: 'off',
        });
        return h('label', { text: f.label }, inputs[f.name]);
      }),
      extra || null,
      err,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => closeModal() }),
        h('button', { type: 'submit', class: 'btn ' + (danger ? 'danger' : 'primary'), text: submit || 'OK' })));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      const values = {};
      for (const k in inputs) values[k] = inputs[k].value.trim();
      const btn = form.querySelector('button[type=submit]');
      btn.disabled = true;
      try { await onSubmit(values); closeModal(); }
      catch (ex) { err.textContent = ex.message || String(ex); btn.disabled = false; }
    });
    openModal(form);
  }

  const confirmModal = (title, text, label = 'Confirm') => new Promise((resolve) => {
    formModal({ title, text, submit: label, danger: true, fields: [], onSubmit: async () => resolve(true) });
    const back = $('#modal-root .modal-back');
    new MutationObserver((_, o) => { if (!back.isConnected) { resolve(false); o.disconnect(); } })
      .observe($('#modal-root'), { childList: true });
  });

  /* ------------------------------------------------------------ state */
  const state = {
    me: null, profile: null,
    servers: [],            // [{id,name,owner_id,invite_code,role}]
    server: null,           // active server
    channels: [], channel: null,
    members: [],            // [{user_id, role}]
    profiles: new Map(),
    online: new Set(),
    view: 'dm',             // 'server' | 'dm'
    peer: null,             // active DM peer id
    dms: [],                // [{peer, last}]
    unread: new Map(),      // peerId -> count
    messages: [], hasMore: false, loadingOlder: false, chatKey: '',
    typing: new Map(),      // userId -> timeout
  };
  let sb, entered = false;
  const subs = { presence: null, me: null, dm: null, server: null, chan: null };

  const myRole = () => state.server?.role || 'member';
  const isAdmin = () => myRole() === 'owner' || myRole() === 'admin';
  const prof = (id) => state.profiles.get(id) || { id, username: 'unknown' };

  async function ensureProfiles(ids) {
    const need = [...new Set(ids)].filter((id) => id && !state.profiles.has(id));
    if (!need.length) return;
    const { data } = await sb.from('profiles').select('id,username,avatar_url').in('id', need);
    (data || []).forEach((p) => state.profiles.set(p.id, p));
  }

  /* -------------------------------------------------------------- auth */
  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
    $('.signup-only').hidden = mode !== 'signup';
    $('#auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Log in';
    $('#auth-password').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('#auth-forgot').hidden = mode === 'signup';
    authMsg('');
  }
  function authMsg(text, ok = false) {
    const el = $('#auth-msg');
    el.textContent = text;
    el.classList.toggle('ok', ok);
  }

  function showOnly(id) {
    ['setup', 'auth', 'layout'].forEach((s) => { $('#' + s).hidden = s !== id; });
  }

  function wireAuth() {
    $('#brand-name').textContent = CFG.SITE_NAME || 'Lunaar Chat';
    document.title = CFG.SITE_NAME || 'Lunaar Chat';
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setAuthMode(t.dataset.mode)));

    $('#auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = $('#auth-email').value.trim();
      const password = $('#auth-password').value;
      const username = $('#auth-username').value.trim();
      if (!email || !password) return authMsg('Enter your email and password.');
      if (authMode === 'signup') {
        if (!USERNAME_RE.test(username)) return authMsg('Username: 3–24 letters, numbers, _ . or -');
        if (password.length < 8) return authMsg('Password must be at least 8 characters.');
      }
      const btn = $('#auth-submit');
      btn.disabled = true; authMsg('');
      try {
        if (authMode === 'signup') {
          const { data, error } = await sb.auth.signUp({
            email, password,
            options: { data: { username }, emailRedirectTo: location.origin + location.pathname },
          });
          if (error) throw error;
          if (!data.session) authMsg('Check your email to confirm your account, then log in.', true);
        } else {
          const { error } = await sb.auth.signInWithPassword({ email, password });
          if (error) throw error;
        }
      } catch (ex) { authMsg(ex.message || 'Something went wrong.'); }
      btn.disabled = false;
    });

    $('#auth-forgot').addEventListener('click', async () => {
      const email = $('#auth-email').value.trim();
      if (!email) return authMsg('Type your email above first.');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      error ? authMsg(error.message) : authMsg('Password reset email sent (check spam too).', true);
    });

    const providers = (CFG.OAUTH || []).filter(Boolean);
    if (providers.length) {
      $('#oauth').hidden = false;
      providers.forEach((p) => $('#oauth-buttons').append(h('button', {
        type: 'button', class: 'btn', text: 'Continue with ' + p[0].toUpperCase() + p.slice(1),
        onclick: () => sb.auth.signInWithOAuth({ provider: p, options: { redirectTo: location.origin + location.pathname } }),
      })));
    }
  }

  function newPasswordModal() {
    formModal({
      title: 'Choose a new password', submit: 'Update password',
      fields: [{ name: 'pw', label: 'New password', type: 'password', maxlength: 72 }],
      onSubmit: async ({ pw }) => {
        if (pw.length < 8) throw new Error('At least 8 characters.');
        const { error } = await sb.auth.updateUser({ password: pw });
        if (error) throw error;
        toast('Password updated', 'ok');
      },
    });
  }

  /* ---------------------------------------------------------- boot/enter */
  async function boot() {
    if (!configured) { showOnly('setup'); return; }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });
    wireAuth();
    setAuthMode('login');

    const invite = new URLSearchParams(location.search).get('invite');
    if (invite) try { sessionStorage.setItem('pendingInvite', invite); } catch (_) {}

    sb.auth.onAuthStateChange((event, session) => {
      // Never await supabase calls directly inside this callback.
      if (event === 'PASSWORD_RECOVERY') setTimeout(newPasswordModal, 0);
      if (event === 'SIGNED_OUT') { entered = false; teardown(); $('#auth-password').value = ''; showOnly('auth'); }
      else if (session && event !== 'TOKEN_REFRESHED') maybeEnter(session.user);
    });
    const { data } = await sb.auth.getSession();
    data.session ? maybeEnter(data.session.user) : showOnly('auth');
  }

  function maybeEnter(user) {
    if (entered) return;
    entered = true;
    setTimeout(() => enterApp(user).catch((e) => { console.error(e); toast(e.message || 'Could not load chat', 'error'); }), 0);
  }

  async function enterApp(user) {
    state.me = user;
    let { data: p } = await sb.from('profiles').select('id,username,avatar_url').eq('id', user.id).maybeSingle();
    if (!p) {
      const base = (user.user_metadata?.username || (user.email || 'user').split('@')[0]).replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 18);
      const username = (base.length >= 3 ? base : base + 'user') + Math.floor(Math.random() * 90 + 10);
      const res = await sb.from('profiles').insert({ id: user.id, username }).select().single();
      if (res.error) throw new Error('Profile missing — did you run schema.sql? ' + res.error.message);
      p = res.data;
    }
    state.profile = p;
    state.profiles.set(p.id, p);

    showOnly('layout');
    wireLayout();
    await loadServers();
    startPresence();
    startMeChannel();
    await loadDmList();

    let joined = null;
    let invite = null;
    try { invite = sessionStorage.getItem('pendingInvite'); sessionStorage.removeItem('pendingInvite'); } catch (_) {}
    if (invite) {
      history.replaceState(null, '', location.pathname);
      joined = await joinWithCode(invite, true);
    }
    if (joined) await openServer(joined);
    else if (state.servers.length) {
      let last = null;
      try { last = localStorage.getItem('lunaar.lastServer'); } catch (_) {}
      await openServer((state.servers.find((s) => s.id === last) || state.servers[0]).id);
    } else openDmHome();
    renderRail();
  }

  function teardown() {
    Object.keys(subs).forEach((k) => { if (subs[k]) { sb.removeChannel(subs[k]); subs[k] = null; } });
    Object.assign(state, {
      me: null, profile: null, servers: [], server: null, channels: [], channel: null, members: [],
      view: 'dm', peer: null, dms: [], messages: [], online: new Set(), chatKey: '',
    });
    state.unread.clear(); state.profiles.clear();
    clear($('#messages'));
  }

  /* ------------------------------------------------------ layout wiring */
  let layoutWired = false;
  function wireLayout() {
    if (layoutWired) return;
    layoutWired = true;
    const input = $('#input');
    $('#composer').addEventListener('submit', (e) => { e.preventDefault(); sendMessage(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
      sendTyping();
    });
    $('#messages').addEventListener('scroll', () => {
      const el = $('#messages');
      if (el.scrollTop < 80 && state.hasMore && !state.loadingOlder) loadOlder();
    });
    $('#scrim').addEventListener('click', () => $('#layout').classList.remove('nav-open', 'members-open'));
  }

  /* -------------------------------------------------------------- rail */
  function renderRail() {
    const rail = $('#rail');
    clear(rail);
    const totalUnread = [...state.unread.values()].reduce((a, b) => a + b, 0);
    rail.append(h('button', {
      class: 'rail-btn' + (state.view === 'dm' ? ' active' : ''), title: 'Direct messages', 'aria-label': 'Direct messages',
      onclick: openDmHome,
    }, '✉', totalUnread ? h('span', { class: 'badge', text: totalUnread > 99 ? '99+' : totalUnread }) : null));
    rail.append(h('div', { class: 'rail-sep' }));
    state.servers.forEach((s) => rail.append(h('button', {
      class: 'rail-btn' + (state.view === 'server' && state.server?.id === s.id ? ' active' : ''),
      title: s.name, 'aria-label': s.name, onclick: () => openServer(s.id),
    }, (s.name[0] || '?').toUpperCase())));
    rail.append(h('button', { class: 'rail-btn add', title: 'Create or join a server', 'aria-label': 'Add server', onclick: addServerModal }, '+'));
    rail.append(h('div', { class: 'rail-spacer' }));
    if (CFG.HOME_URL) rail.append(h('a', { class: 'rail-btn', href: CFG.HOME_URL, title: 'Back to site', 'aria-label': 'Back to site', style: 'text-decoration:none' }, '⌂'));
  }

  /* ------------------------------------------------------------ userbar */
  function renderUserbar() {
    const bar = $('#userbar');
    clear(bar);
    bar.append(
      avatarEl(state.profile, { small: true }),
      h('div', { class: 'who' }, h('b', { text: state.profile.username }), h('small', { text: 'Online' })),
      h('button', { class: 'icon-btn', title: 'Settings', 'aria-label': 'Settings', onclick: settingsModal }, '⚙'));
  }

  function settingsModal() {
    formModal({
      title: 'Your profile', submit: 'Save',
      fields: [
        { name: 'username', label: 'Username', value: state.profile.username, maxlength: 24 },
        { name: 'avatar', label: 'Avatar image URL (https, optional)', value: state.profile.avatar_url || '', maxlength: 500, placeholder: 'https://…' },
      ],
      extra: h('div', { class: 'actions', style: 'justify-content:flex-start' },
        h('button', { type: 'button', class: 'btn danger', text: 'Log out', onclick: () => { closeModal(); sb.auth.signOut(); } })),
      onSubmit: async ({ username, avatar }) => {
        if (!USERNAME_RE.test(username)) throw new Error('Username: 3–24 letters, numbers, _ . or -');
        if (avatar && !/^https:\/\/\S+$/.test(avatar)) throw new Error('Avatar must be an https:// link.');
        const { data, error } = await sb.from('profiles').update({ username, avatar_url: avatar || null }).eq('id', state.me.id).select().single();
        if (error) throw new Error(error.code === '23505' ? 'That username is taken.' : error.message);
        state.profile = data; state.profiles.set(data.id, data);
        renderUserbar(); renderMembers(); renderMessages();
        toast('Profile saved', 'ok');
      },
    });
  }

  /* ----------------------------------------------------------- servers */
  async function loadServers() {
    const { data, error } = await sb.from('server_members')
      .select('role, servers(id,name,owner_id,invite_code)').eq('user_id', state.me.id);
    if (error) throw error;
    state.servers = (data || []).filter((r) => r.servers).map((r) => ({ ...r.servers, role: r.role }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function addServerModal() {
    const joinInput = h('input', { placeholder: 'Invite code or link', maxlength: 200, autocomplete: 'off' });
    const err = h('div', { class: 'err' });
    const createForm = () => formModal({
      title: 'Create a server', text: 'Your own space to chat. You can invite people afterwards.', submit: 'Create',
      fields: [{ name: 'name', label: 'Server name', maxlength: 40, placeholder: 'My cool server' }],
      onSubmit: async ({ name }) => {
        if (!name) throw new Error('Give your server a name.');
        const { data, error } = await sb.from('servers').insert({ name, owner_id: state.me.id }).select('id').single();
        if (error) throw error;
        await loadServers(); await openServer(data.id);
      },
    });
    const body = h('div', {},
      h('h2', { text: 'Add a server' }),
      h('p', { text: 'Start your own, or join a friend with an invite.' }),
      h('button', { type: 'button', class: 'btn primary wide', text: 'Create my own', onclick: createForm }),
      h('div', { class: 'sep' }),
      h('label', { text: 'Have an invite?' }, joinInput),
      err,
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => closeModal() }),
        h('button', {
          type: 'button', class: 'btn primary', text: 'Join',
          onclick: async () => {
            err.textContent = '';
            const sid = await joinWithCode(joinInput.value, false, (m) => { err.textContent = m; });
            if (sid) { closeModal(); await openServer(sid); }
          },
        })));
    openModal(body);
  }

  async function joinWithCode(raw, silent, onError) {
    let code = String(raw || '').trim();
    const m = code.match(/[?&]invite=([A-Za-z0-9]+)/);
    if (m) code = m[1];
    if (!/^[A-Za-z0-9]{4,32}$/.test(code)) { (onError || toast)('That invite code looks wrong.'); return null; }
    const { data, error } = await sb.rpc('join_server', { code });
    if (error) { (onError || ((t) => toast(t, 'error')))(error.message); return null; }
    await loadServers();
    if (!silent) toast('Joined server', 'ok');
    else toast('You joined a server from an invite', 'ok');
    return data;
  }

  async function openServer(id) {
    let s = state.servers.find((x) => x.id === id);
    if (!s) { await loadServers(); s = state.servers.find((x) => x.id === id); }
    if (!s) return openDmHome();
    $('#layout').classList.remove('nav-open');
    state.view = 'server'; state.server = s; state.peer = null;
    try { localStorage.setItem('lunaar.lastServer', s.id); } catch (_) {}
    $('#members').hidden = false;

    if (subs.server) { sb.removeChannel(subs.server); subs.server = null; }
    subscribeServer(s.id);

    const [{ data: chans }, { data: mem }] = await Promise.all([
      sb.from('channels').select('id,name,server_id').eq('server_id', s.id).order('created_at'),
      sb.from('server_members').select('user_id,role').eq('server_id', s.id),
    ]);
    if (state.server?.id !== s.id) return; // switched away meanwhile
    state.channels = chans || [];
    state.members = mem || [];
    await ensureProfiles(state.members.map((m) => m.user_id));
    renderRail(); renderSidebar(); renderMembers(); renderUserbar();
    const keep = state.channel && state.channels.find((c) => c.id === state.channel.id);
    await openChannel(keep || state.channels[0] || null);
  }

  function subscribeServer(sid) {
    subs.server = sb.channel('server:' + sid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels', filter: `server_id=eq.${sid}` }, async (p) => {
        if (state.server?.id !== sid) return;
        const { data } = await sb.from('channels').select('id,name,server_id').eq('server_id', sid).order('created_at');
        state.channels = data || [];
        if (state.channel && !state.channels.find((c) => c.id === state.channel.id)) await openChannel(state.channels[0] || null);
        else renderSidebar();
      })
      // DELETE events can't be filtered by Supabase, so check the row ourselves.
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'channels' }, async (p) => {
        if (state.server?.id !== sid || !state.channels.some((c) => c.id === p.old.id)) return;
        state.channels = state.channels.filter((c) => c.id !== p.old.id);
        if (state.channel?.id === p.old.id) await openChannel(state.channels[0] || null); else renderSidebar();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'server_members', filter: `server_id=eq.${sid}` }, () => refreshMembers(sid))
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'server_members' }, (p) => {
        if (p.old.server_id === sid && p.old.user_id !== state.me.id) refreshMembers(sid);
      })
      .subscribe();
  }

  async function refreshMembers(sid) {
    const { data } = await sb.from('server_members').select('user_id,role').eq('server_id', sid);
    if (state.server?.id !== sid) return;
    state.members = data || [];
    const mine = state.members.find((m) => m.user_id === state.me.id);
    if (mine && state.server.role !== mine.role) { state.server.role = mine.role; renderSidebar(); }
    await ensureProfiles(state.members.map((m) => m.user_id));
    renderMembers();
  }

  /** Listens for changes to *my* memberships (kicked / joined elsewhere / server deleted). */
  function startMeChannel() {
    subs.me = sb.channel('me:' + state.me.id)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'server_members' }, async (p) => {
        if (p.old.user_id !== state.me.id) return;
        const gone = state.servers.find((s) => s.id === p.old.server_id);
        if (!gone) return;
        await loadServers();
        if (state.server?.id === gone.id) { toast(`You are no longer in ${gone.name}`, 'error'); state.server = null; state.channel = null; openDmHome(); }
        renderRail();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'server_members', filter: `user_id=eq.${state.me.id}` }, async () => {
        await loadServers(); renderRail();
      })
      .subscribe();
  }

  function renderSidebar() {
    const head = $('#sidebar-head'), body = $('#sidebar-body');
    clear(head); clear(body);
    if (state.view === 'dm') return renderDmSidebar();
    const s = state.server;
    head.append(h('button', {
      class: 'title', 'aria-haspopup': 'menu',
      onclick: (e) => showMenu(e.currentTarget, serverMenuItems()),
    }, h('span', { class: 'name', text: s.name }), '▾'));
    body.append(h('div', { class: 'section-label' }, 'Text channels',
      isAdmin() ? h('button', { class: 'icon-btn', title: 'Create channel', 'aria-label': 'Create channel', onclick: createChannelModal }, '+') : null));
    state.channels.forEach((c) => body.append(h('button', {
      class: 'row' + (state.channel?.id === c.id ? ' active' : ''), onclick: () => { $('#layout').classList.remove('nav-open'); openChannel(c); },
    }, h('span', { class: 'hash', text: '#' }), h('span', { class: 'label', text: c.name }),
    isAdmin() && state.channels.length > 1 ? h('span', {
      class: 'icon-btn x', role: 'button', title: 'Delete channel', 'aria-label': 'Delete channel ' + c.name,
      onclick: (e) => { e.stopPropagation(); deleteChannel(c); },
    }, '×') : null)));
  }

  function serverMenuItems() {
    const s = state.server;
    return [
      { label: 'Invite people', onClick: inviteModal },
      isAdmin() ? { label: 'Create channel', onClick: createChannelModal } : null,
      myRole() === 'owner'
        ? { label: 'Delete server', danger: true, onClick: deleteServer }
        : { label: 'Leave server', danger: true, onClick: leaveServer },
    ];
  }

  function inviteModal() {
    const link = `${location.origin}${location.pathname}?invite=${state.server.invite_code}`;
    const inp = h('input', { value: link, readonly: true, 'aria-label': 'Invite link' });
    inp.addEventListener('focus', () => inp.select());
    openModal(h('div', {},
      h('h2', { text: 'Invite people to ' + state.server.name }),
      h('p', { text: 'Anyone with this link can join (they need an account — they can make one on the spot).' }),
      h('div', { class: 'copyrow' }, inp, h('button', {
        class: 'btn primary', text: 'Copy',
        onclick: async (e) => {
          try { await navigator.clipboard.writeText(link); e.target.textContent = 'Copied!'; }
          catch (_) { inp.select(); document.execCommand('copy'); e.target.textContent = 'Copied!'; }
        },
      })),
      h('p', { style: 'margin-top:12px', text: 'Code: ' + state.server.invite_code }),
      h('div', { class: 'actions' }, h('button', { class: 'btn', text: 'Done', onclick: () => closeModal() }))));
  }

  function createChannelModal() {
    formModal({
      title: 'Create channel', submit: 'Create',
      fields: [{ name: 'name', label: 'Channel name', placeholder: 'game-night', maxlength: 30 }],
      onSubmit: async ({ name }) => {
        const clean = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        if (!clean) throw new Error('Use letters, numbers and dashes.');
        const { error } = await sb.from('channels').insert({ server_id: state.server.id, name: clean });
        if (error) throw new Error(error.code === '23505' ? 'A channel with that name exists.' : error.message);
      },
    });
  }

  async function deleteChannel(c) {
    if (!(await confirmModal('Delete #' + c.name + '?', 'All messages in it are deleted permanently.', 'Delete channel'))) return;
    const { error } = await sb.from('channels').delete().eq('id', c.id);
    if (error) toast(error.message, 'error');
  }

  async function deleteServer() {
    const s = state.server;
    if (!(await confirmModal('Delete ' + s.name + '?', 'Every channel and message is deleted permanently.', 'Delete server'))) return;
    const { error } = await sb.from('servers').delete().eq('id', s.id);
    if (error) return toast(error.message, 'error');
    await loadServers(); state.server = null; state.channel = null;
    state.servers.length ? openServer(state.servers[0].id) : openDmHome();
  }

  async function leaveServer() {
    const s = state.server;
    if (!(await confirmModal('Leave ' + s.name + '?', 'You can rejoin later with an invite.', 'Leave'))) return;
    const { error } = await sb.from('server_members').delete().eq('server_id', s.id).eq('user_id', state.me.id);
    if (error) return toast(error.message, 'error');
    await loadServers(); state.server = null; state.channel = null;
    state.servers.length ? openServer(state.servers[0].id) : openDmHome();
  }

  /* ----------------------------------------------------------- members */
  function renderMembers() {
    const el = $('#members');
    clear(el);
    $('#layout').classList.toggle('no-members', state.view !== 'server');
    if (state.view !== 'server') { el.hidden = true; return; }
    el.hidden = false;
    const rank = { owner: 0, admin: 1, member: 2 };
    const list = state.members.slice().sort((a, b) =>
      rank[a.role] - rank[b.role] || prof(a.user_id).username.localeCompare(prof(b.user_id).username));
    const on = list.filter((m) => state.online.has(m.user_id));
    const off = list.filter((m) => !state.online.has(m.user_id));
    const group = (label, arr) => {
      if (!arr.length) return;
      el.append(h('div', { class: 'section-label', text: `${label} — ${arr.length}` }));
      arr.forEach((m) => {
        const p = prof(m.user_id);
        el.append(h('button', {
          class: 'row' + (state.online.has(m.user_id) ? '' : ' off'),
          onclick: (e) => memberMenu(e.currentTarget, m),
        }, avatarEl(p, { small: true, online: state.online.has(m.user_id) }),
        h('span', { class: 'label', style: 'color:' + nameColor(p.id || m.user_id), text: p.username }),
        m.role !== 'member' ? h('span', { class: 'role-tag', text: m.role }) : null));
      });
    };
    group('Online', on); group('Offline', off);
  }

  function memberMenu(anchor, m) {
    if (m.user_id === state.me.id) return;
    const p = prof(m.user_id);
    showMenu(anchor, [
      { label: 'Message ' + p.username, onClick: () => openDm(m.user_id) },
      myRole() === 'owner' && m.role !== 'owner'
        ? { label: m.role === 'admin' ? 'Remove admin' : 'Make admin', onClick: () => setRole(m, m.role === 'admin' ? 'member' : 'admin') } : null,
      isAdmin() && m.role !== 'owner' && !(myRole() === 'admin' && m.role === 'admin')
        ? { label: 'Kick ' + p.username, danger: true, onClick: () => kick(m) } : null,
    ]);
  }

  async function setRole(m, role) {
    const { error } = await sb.from('server_members').update({ role }).eq('server_id', state.server.id).eq('user_id', m.user_id);
    if (error) return toast(error.message, 'error');
    refreshMembers(state.server.id);
  }

  async function kick(m) {
    const name = prof(m.user_id).username;
    if (!(await confirmModal('Kick ' + name + '?', 'They can rejoin with an invite link.', 'Kick'))) return;
    const { error } = await sb.from('server_members').delete().eq('server_id', state.server.id).eq('user_id', m.user_id);
    if (error) return toast(error.message, 'error');
    refreshMembers(state.server.id);
  }

  /* ---------------------------------------------------------- presence */
  function startPresence() {
    const ch = sb.channel('presence:global', { config: { presence: { key: state.me.id } } });
    ch.on('presence', { event: 'sync' }, () => {
      state.online = new Set(Object.keys(ch.presenceState()));
      if (state.view === 'server') renderMembers();
      if (state.view === 'dm') renderDmSidebar();
    }).subscribe(async (status) => {
      if (status === 'SUBSCRIBED') await ch.track({ at: Date.now() });
    });
    subs.presence = ch;
  }

  /* ------------------------------------------------------- channel chat */
  async function openChannel(c) {
    state.channel = c;
    state.view = 'server';
    state.chatKey = c ? 'ch:' + c.id : '';
    state.messages = []; state.hasMore = false;
    state.typing.forEach((t) => clearTimeout(t)); state.typing.clear(); renderTyping();
    if (subs.chan) { sb.removeChannel(subs.chan); subs.chan = null; }
    renderSidebar(); renderChatHead(); renderMembers();
    const composer = $('#composer');
    composer.classList.toggle('disabled', !c);
    $('#input').placeholder = c ? `Message #${c.name}` : 'No channels yet';
    if (!c) { clear($('#messages')); return; }
    subscribeChat('chan:' + c.id, { table: 'messages', filter: `channel_id=eq.${c.id}` }, (row) => row.channel_id === c.id);
    await loadMessages();
    $('#input').focus({ preventScroll: true });
  }

  /** Shared by channel + DM views. `accept` filters realtime rows for this chat. */
  function subscribeChat(name, { table, filter }, accept) {
    const key = state.chatKey;
    const ch = sb.channel(name, { config: { broadcast: { self: false } } });
    const norm = table === 'messages'
      ? (r) => r : (r) => ({ id: r.id, user_id: r.sender_id, content: r.content, created_at: r.created_at, _row: r });
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, (p) => {
      if (state.chatKey !== key || !accept(p.new)) return;
      addMessage(norm(p.new), key);
    }).on('postgres_changes', { event: 'DELETE', schema: 'public', table }, (p) => {
      if (state.chatKey !== key) return;
      removeMessage(p.old.id);
    }).on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (state.chatKey !== key || !payload?.user_id || payload.user_id === state.me.id) return;
      ensureProfiles([payload.user_id]).then(() => {
        clearTimeout(state.typing.get(payload.user_id));
        state.typing.set(payload.user_id, setTimeout(() => { state.typing.delete(payload.user_id); renderTyping(); }, 3500));
        renderTyping();
      });
    }).subscribe();
    subs.chan = ch;
  }

  let lastTypingSent = 0;
  function sendTyping() {
    if (!subs.chan || Date.now() - lastTypingSent < 2500 || !$('#input').value) return;
    lastTypingSent = Date.now();
    subs.chan.send({ type: 'broadcast', event: 'typing', payload: { user_id: state.me.id } });
  }

  function renderTyping() {
    const names = [...state.typing.keys()].map((id) => prof(id).username);
    const el = $('#typing');
    el.textContent = !names.length ? '' :
      names.length === 1 ? `${names[0]} is typing…` :
      names.length === 2 ? `${names[0]} and ${names[1]} are typing…` : 'Several people are typing…';
  }

  function renderChatHead() {
    const head = $('#chat-head');
    clear(head);
    const toggles = [
      h('button', { class: 'icon-btn only-small nav-toggle', 'aria-label': 'Menu', onclick: () => $('#layout').classList.toggle('nav-open') }, '☰'),
    ];
    if (state.view === 'server') {
      head.append(...toggles,
        h('span', { class: 'hash', text: '#' }),
        h('span', { class: 'grow', text: state.channel?.name || 'no channel' }),
        h('button', { class: 'icon-btn only-small', 'aria-label': 'Members', title: 'Members', onclick: () => $('#layout').classList.toggle('members-open') }, '👥'));
    } else if (state.peer) {
      const p = prof(state.peer);
      head.append(...toggles, avatarEl(p, { small: true, online: state.online.has(p.id) }), h('span', { class: 'grow', text: p.username }));
    } else {
      head.append(...toggles, h('span', { class: 'grow', text: 'Direct messages' }));
    }
  }

  /* ------------------------------------------------------------ messages */
  const queryFor = () => {
    if (state.view === 'server') {
      return sb.from('messages').select('id,user_id,content,created_at').eq('channel_id', state.channel.id);
    }
    const a = state.me.id, b = state.peer;
    return sb.from('dm_messages').select('id,sender_id,recipient_id,content,created_at')
      .or(`and(sender_id.eq.${a},recipient_id.eq.${b}),and(sender_id.eq.${b},recipient_id.eq.${a})`);
  };
  const normRow = (r) => ('sender_id' in r ? { id: r.id, user_id: r.sender_id, content: r.content, created_at: r.created_at } : r);

  async function loadMessages() {
    const key = state.chatKey;
    const { data, error } = await queryFor().order('id', { ascending: false }).limit(PAGE);
    if (state.chatKey !== key) return;
    if (error) { toast(error.message, 'error'); return; }
    const loaded = (data || []).map(normRow).reverse();
    state.hasMore = (data || []).length === PAGE;
    const byId = new Map();
    [...loaded, ...state.messages].forEach((m) => byId.set(m.id, m)); // keep any realtime arrivals
    state.messages = [...byId.values()].sort((a, b) => a.id - b.id);
    await ensureProfiles(state.messages.map((m) => m.user_id));
    if (state.chatKey !== key) return;
    renderMessages(true);
  }

  async function loadOlder() {
    if (!state.messages.length) return;
    const key = state.chatKey;
    state.loadingOlder = true;
    const { data } = await queryFor().lt('id', state.messages[0].id).order('id', { ascending: false }).limit(PAGE);
    if (state.chatKey !== key) { state.loadingOlder = false; return; }
    const older = (data || []).map(normRow).reverse();
    state.hasMore = (data || []).length === PAGE;
    await ensureProfiles(older.map((m) => m.user_id));
    const el = $('#messages');
    const prevH = el.scrollHeight, prevTop = el.scrollTop;
    state.messages = [...older, ...state.messages];
    renderMessages(false);
    el.scrollTop = el.scrollHeight - prevH + prevTop;
    state.loadingOlder = false;
  }

  function msgNodes(m, prev) {
    const out = [];
    const d = new Date(m.created_at);
    if (!prev || !sameDay(new Date(prev.created_at), d)) out.push(h('div', { class: 'day', text: dayFmt.format(d) }));
    const grouped = prev && prev.user_id === m.user_id && sameDay(new Date(prev.created_at), d) &&
      d - new Date(prev.created_at) < 5 * 60 * 1000;
    const p = prof(m.user_id);
    const canDel = m.user_id === state.me.id || (state.view === 'server' && isAdmin());
    const row = h('div', { class: 'msg-row' + (grouped ? '' : ' first'), 'data-id': m.id },
      grouped
        ? h('div', { class: 'gutter' }, h('div', { class: 'time-hover', text: timeFmt.format(d) }))
        : h('div', { class: 'gutter' }, avatarEl(p)),
      h('div', { class: 'msg-body' },
        grouped ? null : h('div', { class: 'msg-meta' },
          h('span', {
            class: 'author', style: 'color:' + nameColor(m.user_id), text: p.username,
            onclick: () => { if (m.user_id !== state.me.id) openDm(m.user_id); },
          }),
          h('time', { datetime: d.toISOString(), text: timeFmt.format(d) })),
        h('div', { class: 'msg-text' }, linkify(m.content))),
      canDel ? h('div', { class: 'msg-actions' }, h('button', {
        class: 'icon-btn', title: 'Delete message', 'aria-label': 'Delete message', onclick: () => deleteMessage(m),
      }, '🗑')) : null);
    out.push(row);
    return out;
  }

  function helloBlock() {
    if (state.view === 'server' && state.channel) {
      return h('div', { class: 'hello' }, h('h2', { text: `Welcome to #${state.channel.name}` }), h('p', { text: 'This is the start of the channel.' }));
    }
    if (state.view === 'dm' && state.peer) {
      return h('div', { class: 'hello' }, h('h2', { text: prof(state.peer).username }), h('p', { text: 'This is the start of your private conversation.' }));
    }
    return null;
  }

  function renderMessages(toBottom) {
    const el = $('#messages');
    const atBottom = toBottom || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    clear(el);
    if (!state.hasMore) { const hb = helloBlock(); if (hb) el.append(hb); }
    state.messages.forEach((m, i) => el.append(...msgNodes(m, state.messages[i - 1])));
    if (atBottom) el.scrollTop = el.scrollHeight;
  }

  async function addMessage(m, key = state.chatKey) {
    if (state.chatKey !== key || state.messages.some((x) => x.id === m.id)) return;
    await ensureProfiles([m.user_id]);
    if (state.chatKey !== key || state.messages.some((x) => x.id === m.id)) return;
    const prev = state.messages[state.messages.length - 1];
    state.messages.push(m);
    state.messages.sort((a, b) => a.id - b.id);
    const el = $('#messages');
    const stick = m.user_id === state.me.id || el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (state.messages[state.messages.length - 1] === m) el.append(...msgNodes(m, prev));
    else renderMessages(false);
    if (stick) el.scrollTop = el.scrollHeight;
    if (state.typing.has(m.user_id)) { clearTimeout(state.typing.get(m.user_id)); state.typing.delete(m.user_id); renderTyping(); }
  }

  function removeMessage(id) {
    if (!state.messages.some((m) => m.id === id)) return;
    state.messages = state.messages.filter((m) => m.id !== id);
    renderMessages(false);
  }

  async function deleteMessage(m) {
    const table = state.view === 'server' ? 'messages' : 'dm_messages';
    const { error } = await sb.from(table).delete().eq('id', m.id);
    if (error) return toast(error.message, 'error');
    removeMessage(m.id);
  }

  async function sendMessage() {
    const input = $('#input');
    const text = input.value.trim();
    if (!text) return;
    if (state.view === 'server' ? !state.channel : !state.peer) return;
    input.value = ''; input.style.height = 'auto';
    const key = state.chatKey;
    let res;
    if (state.view === 'server') {
      res = await sb.from('messages').insert({ channel_id: state.channel.id, user_id: state.me.id, content: text })
        .select('id,user_id,content,created_at').single();
    } else {
      res = await sb.from('dm_messages').insert({ sender_id: state.me.id, recipient_id: state.peer, content: text })
        .select('id,sender_id,recipient_id,content,created_at').single();
    }
    if (res.error) { input.value = text; return toast(res.error.message, 'error'); }
    const row = res.data;
    if (state.view === 'dm') bumpDm(row);
    addMessage(normRow(row), key);
  }

  /* --------------------------------------------------------------- DMs */
  async function loadDmList() {
    const me = state.me.id;
    const { data } = await sb.from('dm_messages').select('id,sender_id,recipient_id,content,created_at')
      .or(`sender_id.eq.${me},recipient_id.eq.${me}`).order('id', { ascending: false }).limit(300);
    const seen = new Map();
    (data || []).forEach((r) => { const peer = r.sender_id === me ? r.recipient_id : r.sender_id; if (!seen.has(peer)) seen.set(peer, r); });
    state.dms = [...seen].map(([peer, last]) => ({ peer, last }));
    await ensureProfiles(state.dms.map((d) => d.peer));

    if (subs.dm) sb.removeChannel(subs.dm);
    subs.dm = sb.channel('dm:' + me)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `recipient_id=eq.${me}` }, onIncomingDm)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `sender_id=eq.${me}` }, onIncomingDm)
      .subscribe();
  }

  async function onIncomingDm(p) {
    const row = p.new;
    const peer = row.sender_id === state.me.id ? row.recipient_id : row.sender_id;
    await ensureProfiles([peer]);
    bumpDm(row);
    const open = state.view === 'dm' && state.peer === peer;
    if (open) addMessage(normRow(row), 'dm:' + peer);
    else if (row.sender_id !== state.me.id) {
      state.unread.set(peer, (state.unread.get(peer) || 0) + 1);
      toast(`New message from ${prof(peer).username}`);
      renderRail(); if (state.view === 'dm') renderDmSidebar();
    }
  }

  function bumpDm(row) {
    const peer = row.sender_id === state.me.id ? row.recipient_id : row.sender_id;
    state.dms = [{ peer, last: row }, ...state.dms.filter((d) => d.peer !== peer)];
    if (state.view === 'dm') renderDmSidebar();
  }

  function openDmHome() {
    if (subs.chan) { sb.removeChannel(subs.chan); subs.chan = null; }
    state.view = 'dm'; state.peer = null; state.chatKey = 'dm-home';
    state.messages = []; state.hasMore = false;
    $('#layout').classList.remove('nav-open');
    $('#composer').classList.add('disabled');
    $('#input').placeholder = 'Pick a conversation';
    renderRail(); renderSidebar(); renderMembers(); renderChatHead(); renderUserbar();
    const el = $('#messages');
    clear(el);
    el.append(h('div', { class: 'hello' }, h('h2', { text: 'Direct messages' }),
      h('p', { text: 'Search for a username in the sidebar to start a private chat, or create/join a server with the + button.' })));
  }

  async function openDm(peerId) {
    if (peerId === state.me.id) return;
    await ensureProfiles([peerId]);
    if (subs.chan) { sb.removeChannel(subs.chan); subs.chan = null; }
    state.view = 'dm'; state.peer = peerId; state.chatKey = 'dm:' + peerId;
    state.messages = []; state.hasMore = false;
    state.unread.delete(peerId);
    state.typing.forEach((t) => clearTimeout(t)); state.typing.clear(); renderTyping();
    $('#layout').classList.remove('nav-open', 'members-open');
    $('#composer').classList.remove('disabled');
    $('#input').placeholder = 'Message @' + prof(peerId).username;
    if (!state.dms.some((d) => d.peer === peerId)) state.dms.unshift({ peer: peerId, last: null });
    const a = state.me.id, b = peerId;
    // typing indicator channel is a private-pair broadcast channel (ids sorted so both sides match)
    const pair = [a, b].sort().join('_');
    const key = state.chatKey;
    const ch = sb.channel('dmtyping:' + pair, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'typing' }, ({ payload }) => {
      if (state.chatKey !== key || payload?.user_id !== peerId) return;
      clearTimeout(state.typing.get(peerId));
      state.typing.set(peerId, setTimeout(() => { state.typing.delete(peerId); renderTyping(); }, 3500));
      renderTyping();
    }).subscribe();
    subs.chan = ch;
    renderRail(); renderSidebar(); renderMembers(); renderChatHead(); renderUserbar();
    await loadMessages();
    $('#input').focus({ preventScroll: true });
  }

  let dmQuery = '';
  function renderDmSidebar() {
    const head = $('#sidebar-head'), body = $('#sidebar-body');
    const hadFocus = document.activeElement && document.activeElement.classList.contains('search');
    clear(head); clear(body);
    head.append(h('span', { text: 'Direct messages' }));
    const results = h('div', {});
    const search = h('input', { class: 'search', type: 'search', placeholder: 'Find a user…', 'aria-label': 'Find a user', maxlength: 24, autocomplete: 'off', value: dmQuery });
    const runSearch = async () => {
      const q = search.value.trim().replace(/[^A-Za-z0-9_.-]/g, '').replace(/_/g, '\\_');
      if (q.length < 2) { clear(results); return; }
      const { data } = await sb.from('profiles').select('id,username,avatar_url').ilike('username', `%${q}%`).neq('id', state.me.id).limit(8);
      if (!results.isConnected) return;
      clear(results);
      (data || []).forEach((p) => { state.profiles.set(p.id, p); results.append(dmRow(p.id, null)); });
      if (!data?.length) results.append(h('div', { class: 'empty', text: 'No users found.' }));
    };
    let timer;
    search.addEventListener('input', () => { dmQuery = search.value; clearTimeout(timer); timer = setTimeout(runSearch, 250); });
    body.append(search, results);
    if (dmQuery.trim().length >= 2) runSearch();
    if (hadFocus) { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }
    body.append(h('div', { class: 'section-label', text: 'Conversations' }));
    if (!state.dms.length) body.append(h('div', { class: 'empty', text: 'No conversations yet.' }));
    state.dms.forEach((d) => body.append(dmRow(d.peer, d.last)));
  }

  function dmRow(peer, last) {
    const p = prof(peer);
    const n = state.unread.get(peer) || 0;
    return h('button', { class: 'row' + (state.view === 'dm' && state.peer === peer ? ' active' : ''), onclick: () => openDm(peer) },
      avatarEl(p, { small: true, online: state.online.has(peer) }),
      h('span', { class: 'label', text: p.username }),
      n ? h('span', { class: 'unread', text: n }) : null);
  }

  /* ------------------------------------------------------------- start */
  boot().catch((e) => { console.error(e); toast(e.message || 'Failed to start', 'error'); });
})();
