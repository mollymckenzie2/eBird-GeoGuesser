const API_ROOT = 'https://api.ebird.org/v2';
const apiKey = window.EBIRD_API_KEY || '';
const map = L.map('map', { zoomControl: false, minZoom: 2 }).setView([25, 10], 2);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);

let checklist; let guessMarker; let answerMarker; let round = 1; let score = 0; let shortestDistance = Infinity; let gameMode = 'usa'; let loadToken = 0;
const regionSets = { usa: ['US'], world: ['US', 'CA', 'MX', 'BR', 'AR', 'GB', 'AU', 'ZA', 'IN', 'JP', 'ES', 'KE'] };
const $ = (id) => document.getElementById(id);
const formatDate = (value) => { const date = new Date(value.replace(' ', 'T')); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); };
const formatTime = (value) => value.includes(' ') ? value.split(' ')[1].slice(0, 5) : '—';
const markerIcon = (className) => L.divIcon({ className, iconSize: [18, 18] });
const quantity = (observation) => observation.howManyStr || (observation.howManyAtleast === observation.howManyAtmost ? observation.howManyAtleast : `${observation.howManyAtleast || '?'}-${observation.howManyAtmost || '?'}`) || 'present';

async function ebird(path) {
  if (!apiKey) throw new Error('Add your eBird API key to config.js to load live checklists.');
  const response = await fetch(API_ROOT + path, { headers: { 'X-eBirdApiToken': apiKey } });
  if (!response.ok) throw new Error(`eBird API returned ${response.status}.`);
  return response.json();
}

async function findCandidates(regions) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const region = regions[Math.floor(Math.random() * regions.length)];
    const date = new Date(); date.setUTCDate(date.getUTCDate() - Math.floor(Math.random() * 365));
    const year = date.getUTCFullYear(); const month = String(date.getUTCMonth() + 1).padStart(2, '0'); const day = String(date.getUTCDate()).padStart(2, '0');
    try {
      const lists = await ebird(`/product/lists/${region}/${year}/${month}/${day}`);
      const candidates = lists.filter((item) => item.numSpecies >= 10 && item.loc?.latitude && item.loc?.longitude && item.subId);
      if (candidates.length) return candidates;
    } catch (error) { }
  }
  return [];
}

async function selectCandidate(candidates) {
  const shuffled = [...candidates].sort(() => Math.random() - 0.5);
  let fallback;
  for (const candidate of shuffled.slice(0, 8)) {
    try {
      const detail = await ebird(`/product/checklist/view/${candidate.subId}`);
      if (!fallback) fallback = { candidate, detail };
      if (detail.comments?.trim()) return { candidate, detail };
    } catch (error) { }
  }
  return fallback || { candidate: shuffled[0], detail: await ebird(`/product/checklist/view/${shuffled[0].subId}`) };
}

async function loadRound() {
  const requestToken = ++loadToken;
  $('message').textContent = 'Finding a recent checklist...'; $('submitButton').disabled = true; $('resultOverlay').classList.remove('visible');
  if (guessMarker) { map.removeLayer(guessMarker); guessMarker = null; }
  if (answerMarker) { map.removeLayer(answerMarker); answerMarker = null; }
  map.eachLayer((layer) => { if (layer instanceof L.Polyline) map.removeLayer(layer); });
  try {
    const candidates = await findCandidates(regionSets[gameMode]);
    if (!candidates.length) throw new Error('No recent checklists were available.');
    const selected = await selectCandidate(candidates);
    const observation = { ...selected.candidate, lat: selected.candidate.loc.latitude, lng: selected.candidate.loc.longitude, obsDt: selected.candidate.isoObsDate || selected.candidate.obsDt };
    const detail = selected.detail;
    if (requestToken !== loadToken) return;
    checklist = observation;
    $('locationHint').textContent = 'Location withheld';
    $('dateValue').textContent = formatDate(observation.obsDt); $('timeValue').textContent = formatTime(observation.obsDt);
    $('speciesValue').textContent = '— noted'; $('speciesList').innerHTML = '<li>Loading bird list...</li>';
    $('commentValue').textContent = observation.comments || '';
    $('speciesValue').textContent = `${detail.numSpecies || '—'} noted`;
    $('commentValue').textContent = detail.comments || observation.comments || '';
    const observations = detail.obs || [];
    if (observations.length) {
      const codes = observations.map((item) => item.speciesCode).join(',');
      const taxonomy = await ebird(`/ref/taxonomy/ebird?species=${encodeURIComponent(codes)}&fmt=json`);
      if (requestToken !== loadToken) return;
      const names = new Map(taxonomy.map((item) => [item.speciesCode, item.comName]));
      $('speciesList').innerHTML = observations.map((item) => `<li><span>${names.get(item.speciesCode) || item.speciesCode}</span><span class="quantity">${quantity(item)}</span></li>`).join('');
    } else $('speciesList').innerHTML = '<li>No species details were reported.</li>';
    $('message').textContent = ''; $('pinStatus').textContent = 'Drop a pin';
  } catch (error) { if (requestToken === loadToken) { $('message').textContent = error.message; $('commentValue').textContent = ''; } }
}

map.on('click', (event) => { if (!checklist || $('resultOverlay').classList.contains('visible')) return; if (guessMarker) map.removeLayer(guessMarker); guessMarker = L.marker(event.latlng, { icon: markerIcon('guess-marker') }).addTo(map); $('pinStatus').textContent = `${event.latlng.lat.toFixed(2)}°, ${event.latlng.lng.toFixed(2)}°`; $('submitButton').disabled = false; });

$('submitButton').addEventListener('click', () => {
  if (!guessMarker || !checklist) return;
  const answer = L.latLng(checklist.lat, checklist.lng); const guess = guessMarker.getLatLng(); const distance = guess.distanceTo(answer) / 1000; const points = Math.max(100, Math.round(5000 * Math.exp(-distance / 1800))); score += points;
  if (distance < shortestDistance) shortestDistance = distance;
  answerMarker = L.marker(answer, { icon: markerIcon('answer-marker') }).addTo(map); L.polyline([guess, answer], { className: 'line' }).addTo(map); map.fitBounds(L.latLngBounds([guess, answer]).pad(.35));
  $('resultPoints').textContent = `+${points.toLocaleString()} POINTS`; $('resultDistance').textContent = distance < 1 ? 'You were right there.' : `${Math.round(distance).toLocaleString()} km away`; $('resultOverlay').classList.add('visible'); $('scoreLabel').textContent = `${String(score).padStart(3, '0')} PTS • ${Math.round(shortestDistance)} km`; $('roundLabel').textContent = `ROUND ${String(round).padStart(2, '0')}`;
});shortestDistance = Infinity; 
$('nextRoundButton').addEventListener('click', () => { round += 1; loadRound(); }); $('newRoundButton').addEventListener('click', () => { round = 1; score = 0; $('scoreLabel').textContent = '000 PTS'; loadRound(); });
document.querySelectorAll('.mode-button').forEach((button) => button.addEventListener('click', () => { if (button.dataset.mode === gameMode) return; gameMode = button.dataset.mode; document.querySelectorAll('.mode-button').forEach((item) => item.classList.toggle('active', item === button)); round = 1; score = 0; $('scoreLabel').textContent = '000 PTS'; loadRound(); }));
loadRound();
