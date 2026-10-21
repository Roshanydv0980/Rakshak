const token = location.pathname.split('/').pop();
const map = L.map('map').setView([20.59, 78.96], 5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
const line = L.polyline([], { color: '#6a4ddb', weight: 5 }).addTo(map);
let marker = null, first = true;
const status = (active, ts) => {
  document.getElementById('st').innerHTML = (active ? '<span class="live">Live</span>' : '<span class="done">Sharing ended</span>')
    + (ts ? ' · updated ' + new Date(ts).toLocaleTimeString() : '');
};
function add(p) {
  const ll = [p.lat, p.lng]; line.addLatLng(ll);
  if (!marker) marker = L.circleMarker(ll, { radius: 9, color: '#fff', weight: 3, fillColor: '#e0243d', fillOpacity: 1 }).addTo(map);
  else marker.setLatLng(ll);
  map.setView(ll, first ? 16 : map.getZoom()); first = false; status(true, p.ts);
}
fetch('/api/track/' + token).then((r) => r.ok ? r.json() : Promise.reject()).then((d) => {
  document.getElementById('who').textContent = d.name + (d.kind === 'sos' ? ' needs help' : ' is sharing location');
  d.points.forEach(add); status(d.active, d.points.length ? d.points[d.points.length - 1].ts : 0);
  if (d.active) {
    const socket = io(); socket.emit('join', token);
    socket.on('location', add); socket.on('ended', () => status(false));
  }
}).catch(() => { document.getElementById('who').textContent = 'This link is not valid.'; });
