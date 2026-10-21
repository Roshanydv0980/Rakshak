const $ = (i) => document.getElementById(i);
let token = localStorage.getItem('rk-token'), active = null, watchId = null, lastSent = 0;

async function api(path, method = 'GET', body) {
  const r = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401 && token) logout(); throw new Error(d.error || 'Something went wrong'); }
  return d;
}
function show() {
  $('authc').classList.toggle('hidden', !!token);
  $('app').classList.toggle('hidden', !token);
  $('out').classList.toggle('hidden', !token);
  if (token) loadContacts();
}
function logout() { token = null; localStorage.removeItem('rk-token'); stopShare(true); show(); }
$('out').onclick = logout;

async function auth(kind) {
  $('aerr').textContent = '';
  try {
    const d = await api('/' + kind, 'POST', { name: $('n').value, email: $('e').value, password: $('p').value });
    token = d.token; localStorage.setItem('rk-token', token); show();
  } catch (e) { $('aerr').textContent = e.message; }
}
$('login').onclick = () => auth('login');
$('reg').onclick = () => auth('register');

/* contacts */
async function loadContacts() {
  const list = await api('/contacts'); const el = $('list'); el.innerHTML = '';
  if (!list.length) { el.innerHTML = '<p class="mute">No contacts yet. Add someone you trust.</p>'; return; }
  list.forEach((c) => {
    const row = document.createElement('div'); row.className = 'li';
    const t = document.createElement('div'); t.textContent = c.name + ' · ' + c.phone;
    const b = document.createElement('button'); b.className = 'x'; b.textContent = 'Remove';
    b.onclick = async () => { await api('/contacts/' + c.id, 'DELETE'); loadContacts(); };
    row.append(t, b); el.append(row);
  });
}
$('add').onclick = async () => {
  $('cerr').textContent = '';
  try { await api('/contacts', 'POST', { name: $('cn').value, phone: $('cp').value }); $('cn').value = $('cp').value = ''; loadContacts(); }
  catch (e) { $('cerr').textContent = e.message; }
};

/* location sharing */
const getPos = () => new Promise((res) => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition((p) => res(p.coords), () => res(null), { enableHighAccuracy: true, timeout: 8000 })
  : res(null));

function stream(tok) {
  active = tok; $('go').classList.add('hidden'); $('stop').classList.remove('hidden');
  watchId = navigator.geolocation.watchPosition((p) => {
    if (Date.now() - lastSent < 3000) return; lastSent = Date.now();
    api(`/trips/${tok}/location`, 'POST', { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }).catch(() => {});
  }, () => { $('status').textContent = 'Location blocked. Allow location access in your browser.'; },
  { enableHighAccuracy: true, maximumAge: 2000 });
}
async function begin(kind) {
  const c = await getPos();
  const d = await api(kind === 'sos' ? '/sos' : '/trips/start', 'POST', { lat: c && c.latitude, lng: c && c.longitude });
  $('status').textContent = (kind === 'sos' ? 'ALERT SENT. ' : 'Sharing live. ') + d.notified + ' contact(s) notified.';
  $('share').innerHTML = `<a href="${d.url}" target="_blank" rel="noopener">${d.url}</a>`;
  stream(d.token);
}
async function stopShare(silent) {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  if (active && !silent) await api(`/trips/${active}/end`, 'POST').catch(() => {});
  active = null; $('go').classList.remove('hidden'); $('stop').classList.add('hidden');
  if (!silent) { $('status').textContent = 'Sharing stopped. Glad you’re safe.'; $('share').innerHTML = ''; }
}
$('go').onclick = () => begin('trip').catch((e) => ($('status').textContent = e.message));
$('stop').onclick = () => stopShare();

/* SOS hold */
let hs = 0, raf = 0; const C = 2 * Math.PI * 46;
const ring = (p) => $('ringp').setAttribute('stroke-dashoffset', C * (1 - p));
function loop() {
  const p = Math.min(1, (performance.now() - hs) / 2000); ring(p);
  if (p >= 1) { release(); if (!active) begin('sos').catch((e) => ($('status').textContent = e.message)); return; }
  raf = requestAnimationFrame(loop);
}
function press() { if (!hs) { hs = performance.now(); loop(); } }
function release() { cancelAnimationFrame(raf); hs = 0; ring(0); }
const s = $('sos');
s.addEventListener('pointerdown', (e) => { e.preventDefault(); press(); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((n) => s.addEventListener(n, release));
s.addEventListener('contextmenu', (e) => e.preventDefault());
s.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); press(); } });
s.addEventListener('keyup', release);
show();
