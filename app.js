// ============================================
// WTC 8-Man Pairing Simulator — Main App
// ============================================

const STORAGE_KEY = 'wtc_pairing_app';

// --- App State ---
let appState = {
  myTeam: { name: '', players: Array.from({ length: 8 }, () => ({ faction: '', armyList: '' })) },
  opponents: {},       // { countryName: { players: [...], matchups: {}, tablePrefs: {} } }
  rounds: Array(7).fill(null),
  tableTags: {},       // { deployment: { tableIdx: ['shooting', 'melee', ...] } }
  armyTablePrefs: {},  // { deployment: { faction: { tableIdx: 'good'|'bad' } } }
};

let engine = null;
let currentRoundIdx = 0;       // 0-6 for rounds 1-7
let currentPrepCountry = null;
let selectedMatrixCell = null;

// Transient round data (not saved)
let teamAData = [];
let teamBData = [];
let tablesData = [];
let roundMatchupScores = {};
let roundMatchupVolatility = {};
let roundMatchupTablePrefs = {};
let roundMatchupVolDir = {};
let roundMatchupPreferred = {};

// What-If mode
let whatIfSnapshot = null;
let isWhatIfMode = false;

// --- Init ---

function init() {
  loadState();
  // Ensure Denmark is always the team name
  if (!appState.myTeam.name || appState.myTeam.name === '') {
    appState.myTeam.name = 'Denmark';
    saveState();
  }
  buildMyTeamInputs();
  buildTablePrefsUI();
  buildPrepUI();
  buildRoundUI();
  initCoaching();
  bindNavigation();
  initMapTooltip();
  renderOverview();
}

// --- Boot: login gate first, then init ---
document.addEventListener('DOMContentLoaded', () => {
  if (typeof initLoginGate === 'function') {
    const loggedIn = initLoginGate();
    if (loggedIn) {
      init();
      if (typeof initSync === 'function') initSync();
    }
    // If not logged in, sync.js attemptLogin() will call init() + initSync() on success
  } else {
    // No sync.js loaded — boot directly
    init();
  }
});

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      appState = { ...appState, ...saved };
      if (!appState.rounds) appState.rounds = Array(7).fill(null);
      while (appState.rounds.length < 7) appState.rounds.push(null);
      if (!appState.tableTags) appState.tableTags = {};
      if (!appState.armyTablePrefs) appState.armyTablePrefs = {};
      if (!appState.opponents) appState.opponents = {};
      // Firebase drops empty objects — ensure every opponent has matchups + tablePrefs
      for (const key of Object.keys(appState.opponents)) {
        const opp = appState.opponents[key];
        if (!opp.matchups) opp.matchups = {};
        if (!opp.tablePrefs) opp.tablePrefs = {};
        if (!opp.players) opp.players = Array.from({ length: 8 }, () => ({ faction: '', armyList: '' }));
      }
    }
  } catch (e) { console.warn('Failed to load state', e); }
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(appState)); } catch (e) { console.warn('Failed to save', e); }
  if (typeof syncState === 'function') syncState();
}

let _debouncedSaveTimer = null;
function debouncedSaveState() {
  clearTimeout(_debouncedSaveTimer);
  _debouncedSaveTimer = setTimeout(() => saveState(), 400);
}

// ===========================
// TAB 1: My Team
// ===========================

function buildMyTeamInputs() {
  // Clone container to remove stale event listeners from previous renders
  const oldContainer = document.getElementById('my-team-players');
  const container = oldContainer.cloneNode(false);
  oldContainer.parentNode.replaceChild(container, oldContainer);

  appState.myTeam.name = 'Denmark';
  document.getElementById('my-team-name').value = 'Denmark';

  for (let i = 0; i < 8; i++) {
    const p = appState.myTeam.players[i] || { faction: '', armyList: '' };
    const wrapper = document.createElement('div');
    wrapper.className = 'player-entry';
    wrapper.innerHTML = `
      <div class="player-row">
        <span class="player-num">${i + 1}</span>
        <input type="text" class="player-faction" id="my-faction-${i}" placeholder="Army / Faction" list="faction-list" value="${escHTML(p.faction)}" />
        <button type="button" class="btn-list-toggle" data-target="my-list-${i}" title="Army List">&#9776;</button>
      </div>
      <div class="army-list-wrap" id="my-list-wrap-${i}" style="display:none">
        <textarea class="army-list-input" id="my-list-${i}" placeholder="Paste army list here..." rows="8">${escHTML(p.armyList)}</textarea>
      </div>
    `;
    container.appendChild(wrapper);
  }

  addListToggle(container);
  ensureFactionDatalist();

  // Auto-save on change (fresh listeners, no stacking)
  container.addEventListener('input', () => { collectMyTeam(); debouncedSaveState(); });

  // These only need binding once, guard against stacking
  const nameInput = document.getElementById('my-team-name');
  const saveBtn = document.getElementById('btn-save-my-team');
  if (!nameInput._bound) {
    nameInput.addEventListener('input', () => { collectMyTeam(); debouncedSaveState(); });
    nameInput._bound = true;
  }
  if (!saveBtn._bound) {
    saveBtn.addEventListener('click', () => { collectMyTeam(); saveState(); showToast('Team saved!'); });
    saveBtn._bound = true;
  }
}

function collectMyTeam() {
  appState.myTeam.name = document.getElementById('my-team-name').value.trim();
  for (let i = 0; i < 8; i++) {
    appState.myTeam.players[i] = {
      faction: document.getElementById(`my-faction-${i}`).value.trim(),
      armyList: document.getElementById(`my-list-${i}`).value.trim(),
    };
  }
}

function fillDummyMyTeam() {
  const factions = pickTeamFactions();
  appState.myTeam.name = 'Denmark';
  for (let i = 0; i < 8; i++) {
    appState.myTeam.players[i] = { faction: factions[i], armyList: '' };
  }
}

// ===========================
// TAB 2: Table Preferences
// ===========================

const TABLE_TAG_OPTIONS = [
  { id: 'shooting', label: 'Shooting', icon: '🎯', color: '#42a5f5' },
  { id: 'melee', label: 'Melee Staging', icon: '⚔️', color: '#ef5350' },
  { id: 'los_heavy', label: 'Heavy LoS Block', icon: '🧱', color: '#8d6e63' },
  { id: 'los_light', label: 'Light LoS Block', icon: '🔍', color: '#ffca28' },
  { id: 'open', label: 'Open', icon: '🏜️', color: '#ffa726' },
  { id: 'dense', label: 'Dense', icon: '🌲', color: '#66bb6a' },
  { id: 'ruins', label: 'Ruin Heavy', icon: '🏚️', color: '#78909c' },
  { id: 'symmetric', label: 'Symmetric', icon: '⚖️', color: '#ab47bc' },
];

function buildTablePrefsUI() {
  const depSel = document.getElementById('tp-deployment');
  depSel.innerHTML = `
    <option value="">— Select Deployment —</option>
    ${WTC_DEPLOYMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
    <optgroup label="BETA">
      ${WTC_DEPLOYMENTS_BETA.map(d => `<option value="${d}">${d} (BETA)</option>`).join('')}
    </optgroup>
  `;

  depSel.addEventListener('change', renderTablePrefsTab);
  document.getElementById('btn-save-tableprefs').addEventListener('click', () => {
    saveState();
    showToast('Table preferences saved!');
  });
}

function renderTablePrefsTab() {
  const dep = document.getElementById('tp-deployment').value;
  const area = document.getElementById('tp-tables-area');

  if (!dep) {
    area.style.display = 'none';
    return;
  }
  area.style.display = '';

  const maps = WTC_MAPS[dep];
  if (!appState.tableTags[dep]) appState.tableTags[dep] = {};
  if (!appState.armyTablePrefs[dep]) appState.armyTablePrefs[dep] = {};

  // Render tag cards
  renderTableTagsGrid(dep, maps);
  // Render army prefs grid
  renderArmyPrefsGrid(dep, maps);
}

function renderTableTagsGrid(dep, maps) {
  const oldGrid = document.getElementById('tp-tags-grid');
  // Clone to remove stale event listeners
  const grid = oldGrid.cloneNode(false);
  oldGrid.parentNode.replaceChild(grid, oldGrid);

  let html = '';
  for (let t = 0; t < 8; t++) {
    const mapIdx = WTC_TABLE_MAP_INDICES[t];
    const map = maps ? maps[mapIdx] : null;
    const mapName = map ? map.name : `Table ${t + 1}`;
    const mapId = map ? map.id : null;
    const activeTags = (appState.tableTags[dep] && appState.tableTags[dep][t]) || [];

    html += `
      <div class="tp-tag-card">
        <div class="tp-tag-card-header">
          <strong>T${t + 1}</strong>
          <span class="tp-tag-map">${mapId ? mapNameHTML(mapId, mapName) : mapName}</span>
        </div>
        <div class="tp-tag-buttons" data-table="${t}">
          ${TABLE_TAG_OPTIONS.map(tag => {
            const active = activeTags.includes(tag.id);
            return `<button class="tp-tag-btn ${active ? 'active' : ''}" data-tag="${tag.id}" data-table="${t}" style="--tag-color:${tag.color}" title="${tag.label}">${tag.icon} ${tag.label}</button>`;
          }).join('')}
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;

  // Bind tag toggle (fresh listener, no stacking)
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.tp-tag-btn');
    if (!btn) return;
    const t = parseInt(btn.dataset.table);
    const tagId = btn.dataset.tag;
    const tags = appState.tableTags[dep];
    if (!tags[t]) tags[t] = [];
    const idx = tags[t].indexOf(tagId);
    if (idx >= 0) { tags[t].splice(idx, 1); btn.classList.remove('active'); }
    else { tags[t].push(tagId); btn.classList.add('active'); }
    debouncedSaveState();
  });
}

function renderArmyPrefsGrid(dep, maps) {
  const thead = document.getElementById('tp-army-grid-head');
  // Clone tbody to remove stale event listeners
  const oldTbody = document.getElementById('tp-army-grid-body');
  const tbody = oldTbody.cloneNode(false);
  oldTbody.parentNode.replaceChild(tbody, oldTbody);
  const prefs = appState.armyTablePrefs[dep];
  const tags = appState.tableTags[dep] || {};

  collectMyTeam();
  const armies = appState.myTeam.players.filter(p => p.faction).map(p => p.faction);
  if (armies.length === 0) {
    thead.innerHTML = '';
    tbody.innerHTML = '<tr><td colspan="9" style="padding:20px;text-align:center;color:var(--text-muted)">Enter your team\'s armies in the My Team tab first.</td></tr>';
    return;
  }

  // Header: Army | T1 | T2 | ... | T8
  let headerHTML = '<tr><th class="tp-grid-army-header">Army</th>';
  for (let t = 0; t < 8; t++) {
    const mapIdx = WTC_TABLE_MAP_INDICES[t];
    const map = maps ? maps[mapIdx] : null;
    const mapName = map ? map.name : `T${t + 1}`;
    const mapId = map ? map.id : null;
    const tableTags = tags[t] || [];
    const tagIcons = tableTags.map(tid => {
      const to = TABLE_TAG_OPTIONS.find(x => x.id === tid);
      return to ? `<span title="${to.label}" style="font-size:0.7rem">${to.icon}</span>` : '';
    }).join(' ');

    headerHTML += `<th class="tp-grid-table-header">
      <div>T${t + 1}</div>
      <div class="tp-grid-map-name">${mapId ? mapNameHTML(mapId, mapName) : mapName}</div>
      ${tagIcons ? `<div class="tp-grid-tags">${tagIcons}</div>` : ''}
    </th>`;
  }
  headerHTML += '</tr>';
  thead.innerHTML = headerHTML;

  // Body: one row per army
  let bodyHTML = '';
  armies.forEach(faction => {
    if (!prefs[faction]) prefs[faction] = {};
    const armyPref = prefs[faction];
    bodyHTML += `<tr><td class="tp-grid-army-name team-a-color">${escHTML(faction)}</td>`;
    for (let t = 0; t < 8; t++) {
      const val = armyPref[t] || 'neutral';
      const cls = val === 'good' ? 'tp-cell-good' : val === 'bad' ? 'tp-cell-bad' : 'tp-cell-neutral';
      const display = val === 'good' ? '▲' : val === 'bad' ? '▼' : '—';
      bodyHTML += `<td class="tp-grid-cell ${cls}" data-faction="${escHTML(faction)}" data-table="${t}" title="${val}">${display}</td>`;
    }
    bodyHTML += '</tr>';
  });
  tbody.innerHTML = bodyHTML;

  // Click to cycle: neutral → good → bad → neutral
  tbody.addEventListener('click', (e) => {
    const td = e.target.closest('.tp-grid-cell');
    if (!td) return;
    const faction = td.dataset.faction;
    const t = parseInt(td.dataset.table);
    const currentPrefs = appState.armyTablePrefs[dep];
    if (!currentPrefs[faction]) currentPrefs[faction] = {};
    const current = currentPrefs[faction][t] || 'neutral';
    const next = current === 'neutral' ? 'good' : current === 'good' ? 'bad' : 'neutral';
    if (next === 'neutral') delete currentPrefs[faction][t];
    else currentPrefs[faction][t] = next;

    td.className = 'tp-grid-cell ' + (next === 'good' ? 'tp-cell-good' : next === 'bad' ? 'tp-cell-bad' : 'tp-cell-neutral');
    td.textContent = next === 'good' ? '▲' : next === 'bad' ? '▼' : '—';
    td.title = next;
    debouncedSaveState();
  });
}

/**
 * Auto-apply army-level table prefs to matchup-level table prefs.
 * For a matchup (my army i vs opp army j), if my army has a pref for table T,
 * that becomes the matchup table pref (unless already manually overridden).
 */
function applyArmyTablePrefsToMatchups(deployment, myPlayers, oppPlayers, matchupTablePrefs, context) {
  const armyPrefs = appState.armyTablePrefs[deployment];
  if (!armyPrefs) return;

  for (let i = 0; i < 8; i++) {
    const myFaction = myPlayers[i]?.faction;
    if (!myFaction || !armyPrefs[myFaction]) continue;

    for (let j = 0; j < 8; j++) {
      const key = context === 'prep' ? `${i}_${j}` : `a${i}_b${j}`;
      // Only auto-fill if no manual pref exists for this matchup
      if (matchupTablePrefs[key] && Object.keys(matchupTablePrefs[key]).length > 0) continue;

      const armyPref = armyPrefs[myFaction];
      const hasPrefs = Object.keys(armyPref).some(t => armyPref[t]);
      if (hasPrefs) {
        matchupTablePrefs[key] = {};
        Object.entries(armyPref).forEach(([t, val]) => {
          matchupTablePrefs[key][parseInt(t)] = val;
        });
      }
    }
  }
}

// ===========================
// TAB 3: Prep
// ===========================

function buildPrepUI() {
  populateCountryDropdown();
  populatePrepDeployment();

  document.getElementById('btn-add-country').addEventListener('click', addCountry);
  document.getElementById('btn-remove-country').addEventListener('click', removeCountry);
  document.getElementById('prep-country-select').addEventListener('change', onPrepCountryChange);
  document.getElementById('prep-deployment').addEventListener('change', () => { if (currentPrepCountry) renderPrepMatrix(); });
  document.getElementById('btn-run-algo').addEventListener('click', () => { if (currentPrepCountry) runOptimalPairing('prep'); });
  document.getElementById('btn-save-prep').addEventListener('click', () => { collectPrepData(); saveState(); showToast('Prep saved!'); });
}

function populateCountryDropdown() {
  const sel = document.getElementById('prep-country-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Opponent Country —</option>';

  // Countries that have prep data
  const prepped = Object.keys(appState.opponents).sort();
  if (prepped.length > 0) {
    const grp = document.createElement('optgroup');
    grp.label = 'Prepped Opponents';
    prepped.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  }

  // All WTC countries not yet prepped
  if (typeof WTC_COUNTRIES !== 'undefined') {
    const unprepped = WTC_COUNTRIES.filter(c => !appState.opponents[c]);
    if (unprepped.length > 0) {
      const grp2 = document.createElement('optgroup');
      grp2.label = 'All WTC Countries';
      unprepped.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c; opt.textContent = c;
        grp2.appendChild(opt);
      });
      sel.appendChild(grp2);
    }
  }

  if (current) sel.value = current;
}

function populatePrepDeployment() {
  const sel = document.getElementById('prep-deployment');
  sel.innerHTML = `
    <option value="">— Select —</option>
    ${WTC_DEPLOYMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
    <optgroup label="BETA">
      ${WTC_DEPLOYMENTS_BETA.map(d => `<option value="${d}">${d} (BETA)</option>`).join('')}
    </optgroup>
  `;
}

function addCountry() {
  const sel = document.getElementById('prep-country-select');
  let country = sel.value;
  if (!country) {
    country = prompt('Enter opponent country/team name:');
    if (!country) return;
    country = country.trim();
  }
  if (!appState.opponents[country]) {
    appState.opponents[country] = {
      players: Array.from({ length: 8 }, () => ({ faction: '', armyList: '' })),
      matchups: {},
      tablePrefs: {},
    };
    saveState();
  }
  populateCountryDropdown();
  sel.value = country;
  onPrepCountryChange();
}

function removeCountry() {
  if (!currentPrepCountry) return;
  if (!confirm(`Remove all prep data for ${currentPrepCountry}?`)) return;
  delete appState.opponents[currentPrepCountry];
  currentPrepCountry = null;
  saveState();
  populateCountryDropdown();
  document.getElementById('prep-country-select').value = '';
  onPrepCountryChange();
}

function onPrepCountryChange() {
  const country = document.getElementById('prep-country-select').value;
  const editor = document.getElementById('prep-editor');
  const removeBtn = document.getElementById('btn-remove-country');

  if (!country) {
    currentPrepCountry = null;
    editor.style.display = 'none';
    removeBtn.style.display = 'none';
    return;
  }

  currentPrepCountry = country;
  // Ensure opponent data exists
  if (!appState.opponents[country]) {
    appState.opponents[country] = {
      players: Array.from({ length: 8 }, () => ({ faction: '', armyList: '' })),
      matchups: {},
      tablePrefs: {},
    };
  }

  editor.style.display = '';
  removeBtn.style.display = '';
  document.getElementById('opp-team-title').textContent = country;
  buildOppTeamInputs();
  renderPrepMatrix();
}

function buildOppTeamInputs() {
  // Clone container to remove stale event listeners
  const oldContainer = document.getElementById('opp-team-players');
  const container = oldContainer.cloneNode(false);
  oldContainer.parentNode.replaceChild(container, oldContainer);

  const opp = appState.opponents[currentPrepCountry];

  for (let i = 0; i < 8; i++) {
    const p = opp.players[i] || { faction: '', armyList: '', flags: [] };
    const flags = p.flags || [];
    const wrapper = document.createElement('div');
    wrapper.className = 'player-entry';
    wrapper.innerHTML = `
      <div class="player-row">
        <span class="player-num">${i + 1}</span>
        <input type="text" class="player-faction" id="opp-faction-${i}" placeholder="Army / Faction" list="faction-list" value="${escHTML(p.faction)}" />
        <div class="opp-flags" data-idx="${i}">
          <button type="button" class="flag-btn ${flags.includes('unknown') ? 'active' : ''}" data-flag="unknown" data-idx="${i}" title="Unknown / Unusual List">❓</button>
          <button type="button" class="flag-btn ${flags.includes('danger') ? 'active' : ''}" data-flag="danger" data-idx="${i}" title="Dangerous Player / Top Competitor">⚠️</button>
          <button type="button" class="flag-btn ${flags.includes('wildcard') ? 'active' : ''}" data-flag="wildcard" data-idx="${i}" title="Wildcard / Off-Meta Build">🃏</button>
        </div>
        <button type="button" class="btn-list-toggle" data-target="opp-list-${i}" title="Army List">&#9776;</button>
      </div>
      <div class="army-list-wrap" id="opp-list-wrap-${i}" style="display:none">
        <textarea class="army-list-input" id="opp-list-${i}" placeholder="Paste army list here..." rows="8">${escHTML(p.armyList)}</textarea>
      </div>
    `;
    container.appendChild(wrapper);
  }

  addListToggle(container);

  // Flag toggle handlers (fresh listener, no stacking)
  container.addEventListener('click', (e) => {
    const flagBtn = e.target.closest('.flag-btn');
    if (!flagBtn) return;
    const idx = parseInt(flagBtn.dataset.idx);
    const flag = flagBtn.dataset.flag;
    const currentOpp = appState.opponents[currentPrepCountry];
    if (!currentOpp.players[idx].flags) currentOpp.players[idx].flags = [];
    const arr = currentOpp.players[idx].flags;
    const pos = arr.indexOf(flag);
    if (pos >= 0) { arr.splice(pos, 1); flagBtn.classList.remove('active'); }
    else { arr.push(flag); flagBtn.classList.add('active'); }
    debouncedSaveState();
  });

  container.addEventListener('input', () => { collectPrepData(); debouncedSaveState(); });
}

function collectPrepData() {
  if (!currentPrepCountry) return;
  const opp = appState.opponents[currentPrepCountry];
  for (let i = 0; i < 8; i++) {
    const fEl = document.getElementById(`opp-faction-${i}`);
    const lEl = document.getElementById(`opp-list-${i}`);
    const existingFlags = opp.players[i]?.flags || [];
    if (fEl) opp.players[i] = {
      faction: fEl.value.trim(),
      armyList: lEl ? lEl.value.trim() : '',
      flags: existingFlags,
    };
  }
}

function fillDummyOppTeam() {
  if (!currentPrepCountry) return;
  const factions = pickTeamFactions();
  const opp = appState.opponents[currentPrepCountry];
  for (let i = 0; i < 8; i++) {
    opp.players[i] = { faction: factions[i], armyList: '' };
  }
  buildOppTeamInputs();
  renderPrepMatrix();
}

function fillDummyPrepMatrix() {
  if (!currentPrepCountry) return;
  const opp = appState.opponents[currentPrepCountry];
  opp.matchups = {};
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      const key = `${i}_${j}`;
      opp.matchups[key] = { score: randomScore(), volatility: Math.random() < 0.1 ? 1 + Math.floor(Math.random() * 5) : 0 };
    }
  }
  renderPrepMatrix();
}

// --- Prep Matrix ---

function renderPrepMatrix() {
  if (!currentPrepCountry) return;
  const opp = appState.opponents[currentPrepCountry];
  if (!opp) return;
  if (!opp.matchups) opp.matchups = {};
  if (!opp.tablePrefs) opp.tablePrefs = {};
  if (!opp.players) opp.players = Array.from({ length: 8 }, () => ({ faction: '', armyList: '' }));
  const dep = document.getElementById('prep-deployment').value;
  selectedMatrixCell = null;

  // Auto-apply army-level table prefs
  if (dep) {
    applyArmyTablePrefsToMatchups(dep, appState.myTeam.players, opp.players, opp.tablePrefs, 'prep');
  }

  buildMatrixDOM(
    'matrix-thead', 'matrix-tbody', 'table-prefs-panel',
    appState.myTeam.players, opp.players,
    opp.matchups, opp.tablePrefs,
    dep,
    'prep'
  );
}

// ===========================
// TAB 3: Play Round
// ===========================

function buildRoundUI() {
  populateRoundDeployment();
  populateRoundMissions();
  populateRoundOpponents();

  // Round selector
  document.querySelectorAll('.round-num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentRoundIdx = parseInt(btn.dataset.round);
      document.querySelectorAll('.round-num-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      showRoundConfig();
    });
  });

  document.getElementById('round-deployment').addEventListener('change', updateTablesPreview);
  document.getElementById('round-mission').addEventListener('change', () => {});
  document.getElementById('round-opponent').addEventListener('change', onRoundOpponentChange);
  document.getElementById('btn-randomize-round').addEventListener('click', randomizeRound);
  document.getElementById('btn-load-prep').addEventListener('click', loadPrepIntoRound);
  document.getElementById('btn-start-pairing').addEventListener('click', startPairing);
  document.getElementById('btn-back-round-config').addEventListener('click', () => {
    exitWhatIfMode();
    document.getElementById('round-config-area').style.display = '';
    document.getElementById('round-pairing-area').style.display = 'none';
  });
  document.getElementById('btn-reset-pairing').addEventListener('click', () => { exitWhatIfMode(); startPairing(); });
  document.getElementById('btn-whatif').addEventListener('click', enterWhatIfMode);
  document.getElementById('btn-whatif-exit').addEventListener('click', () => exitWhatIfMode(true));
  document.getElementById('btn-round-algo').addEventListener('click', () => runOptimalPairing('round'));

  showRoundConfig();
}

function populateRoundDeployment() {
  const sel = document.getElementById('round-deployment');
  sel.innerHTML = `
    <option value="">— Select —</option>
    ${WTC_DEPLOYMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
    <optgroup label="BETA">
      ${WTC_DEPLOYMENTS_BETA.map(d => `<option value="${d}">${d} (BETA)</option>`).join('')}
    </optgroup>
  `;
}

function populateRoundMissions() {
  const sel = document.getElementById('round-mission');
  sel.innerHTML = `
    <option value="">— Select —</option>
    ${WTC_MISSIONS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
  `;
}

function populateRoundOpponents() {
  const sel = document.getElementById('round-opponent');
  sel.innerHTML = '<option value="">— Select Opponent —</option>';
  const prepped = Object.keys(appState.opponents).sort();
  prepped.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c + ' (prepped)';
    sel.appendChild(opt);
  });
  // Manual entry option
  const optManual = document.createElement('option');
  optManual.value = '__manual__'; optManual.textContent = '+ Enter manually...';
  sel.appendChild(optManual);
}

function onRoundOpponentChange() {
  const val = document.getElementById('round-opponent').value;
  const prefillBar = document.getElementById('round-prefill-bar');
  if (val && val !== '__manual__' && appState.opponents[val]) {
    prefillBar.style.display = '';
  } else {
    prefillBar.style.display = 'none';
  }
  if (val === '__manual__') {
    const name = prompt('Enter opponent team name:');
    if (name) {
      // Add as a new opponent if not exists
      if (!appState.opponents[name]) {
        appState.opponents[name] = {
          players: Array.from({ length: 8 }, () => ({ faction: '', armyList: '' })),
          matchups: {}, tablePrefs: {},
        };
        saveState();
      }
      populateRoundOpponents();
      document.getElementById('round-opponent').value = name;
      onRoundOpponentChange();
    }
  }
}

function showRoundConfig() {
  document.getElementById('round-config-area').style.display = '';
  document.getElementById('round-pairing-area').style.display = 'none';
  document.getElementById('round-title').textContent = `Round ${currentRoundIdx + 1} Setup`;

  // If round already completed, show results
  const rd = appState.rounds[currentRoundIdx];
  if (rd && rd.completed) {
    // Show completed state
    document.getElementById('round-opponent').value = rd.opponent || '';
    document.getElementById('round-deployment').value = rd.deployment || '';
    document.getElementById('round-mission').value = rd.missionId || '';
    updateTablesPreview();
  }

  // Refresh opponent dropdown
  populateRoundOpponents();

  // Build round matrix (empty or from saved round data)
  buildRoundMatrix();

  // Update round buttons with completion status
  updateRoundButtons();
}

function updateRoundButtons() {
  document.querySelectorAll('.round-num-btn').forEach(btn => {
    const idx = parseInt(btn.dataset.round);
    const rd = appState.rounds[idx];
    btn.classList.toggle('round-completed', !!(rd && rd.completed));
    btn.classList.toggle('active', idx === currentRoundIdx);
  });
}

function loadPrepIntoRound() {
  const oppName = document.getElementById('round-opponent').value;
  if (!oppName || !appState.opponents[oppName]) return;
  const dep = document.getElementById('round-deployment').value;

  const opp = appState.opponents[oppName];
  roundMatchupScores = {};
  roundMatchupVolatility = {};
  roundMatchupTablePrefs = {};
  roundMatchupVolDir = {};
  roundMatchupPreferred = {};

  Object.entries(opp.matchups).forEach(([key, val]) => {
    const aKey = `a${key.split('_')[0]}_b${key.split('_')[1]}`;
    roundMatchupScores[aKey] = val.score;
    if (val.volatility) roundMatchupVolatility[aKey] = val.volatility;
    if (val.volDir) roundMatchupVolDir[aKey] = val.volDir;
    if (val.preferred) roundMatchupPreferred[aKey] = true;
  });
  Object.entries(opp.tablePrefs || {}).forEach(([key, val]) => {
    const aKey = `a${key.split('_')[0]}_b${key.split('_')[1]}`;
    roundMatchupTablePrefs[aKey] = { ...val };
  });

  // Auto-apply army-level table prefs for this deployment
  if (dep) {
    collectMyTeam();
    applyArmyTablePrefsToMatchups(dep, appState.myTeam.players, opp.players, roundMatchupTablePrefs, 'round');
  }

  buildRoundMatrix();
  showToast('Matrix loaded from prep' + (dep ? ' + army table prefs applied' : ''));
}

function buildRoundMatrix() {
  collectMyTeam();
  const oppName = document.getElementById('round-opponent').value;
  let oppPlayers = Array.from({ length: 8 }, () => ({ faction: '?' }));
  if (oppName && appState.opponents[oppName]) {
    oppPlayers = appState.opponents[oppName].players;
  }

  buildMatrixDOM(
    'round-matrix-thead', 'round-matrix-tbody', 'round-table-prefs-panel',
    appState.myTeam.players, oppPlayers,
    roundMatchupScores, roundMatchupTablePrefs,
    document.getElementById('round-deployment').value,
    'round'
  );
}

function randomizeRound() {
  const allDeps = [...WTC_DEPLOYMENTS];
  document.getElementById('round-deployment').value = allDeps[Math.floor(Math.random() * allDeps.length)];
  const missions = [...WTC_MISSIONS];
  document.getElementById('round-mission').value = missions[Math.floor(Math.random() * missions.length)].id;
  updateTablesPreview();
}

function updateTablesPreview() {
  const dep = document.getElementById('round-deployment').value;
  const grid = document.getElementById('tables-grid');
  grid.innerHTML = '';
  const maps = dep ? WTC_MAPS[dep] : null;

  for (let i = 0; i < 8; i++) {
    const mapIdx = WTC_TABLE_MAP_INDICES[i];
    const map = maps ? maps[mapIdx] : null;
    const card = document.createElement('div');
    card.className = 'table-card' + (map ? '' : ' table-card-empty');
    card.innerHTML = `
      <h3>Table ${i + 1}</h3>
      <div class="table-map-name">${map ? mapNameHTML(map.id, map.name) : '—'}</div>
      <div class="table-map-label">${WTC_TABLE_LABELS[i]}</div>
    `;
    grid.appendChild(card);
  }
}

// ===========================
// Generic Matrix Builder
// ===========================

function buildMatrixDOM(theadId, tbodyId, tpPanelId, myPlayers, oppPlayers, scores, tablePrefs, deployment, context) {
  const thead = document.getElementById(theadId);
  const tbody = document.getElementById(tbodyId);

  // For 'prep' context, scores = { '0_0': { score, volatility } }
  // For 'round' context, scores = { 'a0_b0': score }, separate volatility obj

  let headerHTML = '<tr><th class="matrix-corner"></th>';
  for (let j = 0; j < 8; j++) {
    const f = oppPlayers[j]?.faction || '?';
    const flags = oppPlayers[j]?.flags || [];
    const flagIcons = flags.map(fl => fl === 'unknown' ? '❓' : fl === 'danger' ? '⚠️' : fl === 'wildcard' ? '🃏' : '').join('');
    headerHTML += `<th class="col-header team-b-color" title="${escHTML(f)}">${escHTML(f)}${flagIcons ? `<span class="matrix-flags">${flagIcons}</span>` : ''}</th>`;
  }
  headerHTML += '</tr>';
  thead.innerHTML = headerHTML;

  let bodyHTML = '';
  for (let i = 0; i < 8; i++) {
    const f = myPlayers[i]?.faction || '?';
    bodyHTML += `<tr><th class="row-header team-a-color" title="${escHTML(f)}">${escHTML(f)}</th>`;
    for (let j = 0; j < 8; j++) {
      let key, score, vol, volDir, preferred;
      if (context === 'prep') {
        key = `${i}_${j}`;
        const m = scores[key];
        score = m ? m.score : '';
        vol = m ? (m.volatility || '') : '';
        volDir = m ? (m.volDir || 'both') : 'both';
        preferred = m ? (m.preferred || false) : false;
      } else {
        key = `a${i}_b${j}`;
        score = scores[key] !== undefined ? scores[key] : '';
        vol = roundMatchupVolatility[key] !== undefined ? roundMatchupVolatility[key] : '';
        volDir = roundMatchupVolDir[key] || 'both';
        preferred = roundMatchupPreferred[key] || false;
      }
      const cls = getMatrixCellClass(score);
      const hasTP = tablePrefs[context === 'prep' ? `${i}_${j}` : key] &&
                    Object.keys(tablePrefs[context === 'prep' ? `${i}_${j}` : key]).length > 0;
      const tpDot = hasTP ? '<span class="tp-dot" title="Has table preferences">&#9679;</span>' : '';
      const prefStar = preferred ? '<span class="pref-star" title="Preferred matchup">&#11088;</span>' : '';
      const dataKey = context === 'prep' ? `${i}_${j}` : `a${i}_b${j}`;
      const dirSymbol = volDir === 'up' ? '↑' : volDir === 'down' ? '↓' : '±';
      const volPlaceholder = dirSymbol + ' vol';

      bodyHTML += `<td class="${cls}" data-key="${dataKey}" data-ctx="${context}">
        <div class="cell-inputs">
          <input type="number" class="matrix-input" data-key="${dataKey}" data-ctx="${context}" min="0" max="20" value="${score}" placeholder="—" title="Expected score (0-20)">
          <span class="vol-wrapper" style="display:flex;align-items:center;width:100%">
            <input type="number" class="matrix-vol" data-key="${dataKey}" data-ctx="${context}" min="0" max="5" value="${vol}" placeholder="${volPlaceholder}" title="Volatility (0-5)" style="flex:1;min-width:0">
            <button class="vol-dir-btn" data-key="${dataKey}" data-ctx="${context}" title="Click to cycle direction: ± → ↑ → ↓">${dirSymbol}</button>
          </span>
        </div>
        ${prefStar}${tpDot}
      </td>`;
    }
    bodyHTML += '</tr>';
  }
  tbody.innerHTML = bodyHTML;

  // --- Matrix summary div ---
  const summaryId = tbodyId + '-summary';
  let summaryDiv = document.getElementById(summaryId);
  if (!summaryDiv) {
    summaryDiv = document.createElement('div');
    summaryDiv.id = summaryId;
    summaryDiv.className = 'matrix-summary';
    // Insert after the matrix-scroll parent
    const scrollParent = tbody.closest('.matrix-scroll');
    if (scrollParent) scrollParent.parentNode.insertBefore(summaryDiv, scrollParent.nextSibling);
  }

  function updateMatrixSummary() {
    let total = 0, count = 0;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        let k, val;
        if (context === 'prep') {
          k = `${r}_${c}`;
          const m = scores[k];
          val = m ? m.score : '';
        } else {
          k = `a${r}_b${c}`;
          val = scores[k] !== undefined ? scores[k] : '';
        }
        if (val !== '' && val !== undefined && val !== null) {
          total += parseInt(val) || 0;
          count++;
        }
      }
    }
    if (count === 0) {
      summaryDiv.innerHTML = '<span>No scores entered yet</span>';
    } else {
      const avg = (total / count).toFixed(1);
      const predicted = (parseFloat(avg) * 8).toFixed(0);
      summaryDiv.innerHTML = `<span>Filled cells: <strong>${count}/64</strong></span><span>Avg score per game: <strong>${avg}</strong></span><span>Predicted total: <strong>${predicted}/160</strong></span>`;
    }
  }
  updateMatrixSummary();

  // Score handlers
  tbody.querySelectorAll('.matrix-input').forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      const k = e.target.dataset.key;
      const ctx = e.target.dataset.ctx;
      if (val === '') {
        if (ctx === 'prep' && currentPrepCountry) { delete appState.opponents[currentPrepCountry].matchups[k]; }
        else { delete roundMatchupScores[k]; }
      } else {
        val = Math.max(0, Math.min(20, parseInt(val) || 0));
        e.target.value = val;
        if (ctx === 'prep' && currentPrepCountry) {
          if (!appState.opponents[currentPrepCountry].matchups[k]) appState.opponents[currentPrepCountry].matchups[k] = {};
          appState.opponents[currentPrepCountry].matchups[k].score = val;
        } else {
          roundMatchupScores[k] = val;
        }
      }
      updateCellColor(e.target.closest('td'), val);
      updateMatrixSummary();
      if (ctx === 'prep') debouncedSaveState();
    });
  });

  // Vol handlers
  tbody.querySelectorAll('.matrix-vol').forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      const k = e.target.dataset.key;
      const ctx = e.target.dataset.ctx;
      if (val === '') {
        if (ctx === 'prep' && currentPrepCountry) {
          if (appState.opponents[currentPrepCountry].matchups[k]) appState.opponents[currentPrepCountry].matchups[k].volatility = 0;
        } else { delete roundMatchupVolatility[k]; }
      } else {
        val = Math.max(0, Math.min(5, parseInt(val) || 0));
        e.target.value = val;
        if (ctx === 'prep' && currentPrepCountry) {
          if (!appState.opponents[currentPrepCountry].matchups[k]) appState.opponents[currentPrepCountry].matchups[k] = {};
          appState.opponents[currentPrepCountry].matchups[k].volatility = val;
        } else {
          roundMatchupVolatility[k] = val;
        }
      }
      if (ctx === 'prep') debouncedSaveState();
    });
  });

  // Vol direction handlers
  tbody.querySelectorAll('.vol-dir-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const k = btn.dataset.key;
      const ctx = btn.dataset.ctx;
      let current;
      if (ctx === 'prep' && currentPrepCountry) {
        const m = appState.opponents[currentPrepCountry].matchups[k];
        current = m ? (m.volDir || 'both') : 'both';
      } else {
        current = roundMatchupVolDir[k] || 'both';
      }
      const next = current === 'both' ? 'up' : current === 'up' ? 'down' : 'both';
      const symbol = next === 'up' ? '↑' : next === 'down' ? '↓' : '±';
      btn.textContent = symbol;
      // Update placeholder of adjacent vol input
      const volInput = btn.closest('.vol-wrapper').querySelector('.matrix-vol');
      if (volInput) volInput.placeholder = symbol + ' vol';
      if (ctx === 'prep' && currentPrepCountry) {
        if (!appState.opponents[currentPrepCountry].matchups[k]) appState.opponents[currentPrepCountry].matchups[k] = {};
        appState.opponents[currentPrepCountry].matchups[k].volDir = next;
        debouncedSaveState();
      } else {
        roundMatchupVolDir[k] = next;
      }
    });
  });

  // Double-click to toggle preferred star
  tbody.querySelectorAll('td[data-key]').forEach(td => {
    td.addEventListener('dblclick', (e) => {
      // Don't toggle if double-clicking on inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
      const k = td.dataset.key;
      const ctx = td.dataset.ctx;
      let isPref;
      if (ctx === 'prep' && currentPrepCountry) {
        if (!appState.opponents[currentPrepCountry].matchups[k]) appState.opponents[currentPrepCountry].matchups[k] = {};
        isPref = !appState.opponents[currentPrepCountry].matchups[k].preferred;
        appState.opponents[currentPrepCountry].matchups[k].preferred = isPref;
        debouncedSaveState();
      } else {
        isPref = !roundMatchupPreferred[k];
        if (isPref) roundMatchupPreferred[k] = true;
        else delete roundMatchupPreferred[k];
      }
      // Toggle star in DOM
      let star = td.querySelector('.pref-star');
      if (isPref && !star) {
        star = document.createElement('span');
        star.className = 'pref-star';
        star.title = 'Preferred matchup';
        star.innerHTML = '&#11088;';
        td.appendChild(star);
      } else if (!isPref && star) {
        star.remove();
      }
    });
  });

  // Cell click (single click for table prefs selection)
  tbody.querySelectorAll('td[data-key]').forEach(td => {
    td.addEventListener('click', () => {
      const k = td.dataset.key;
      selectedMatrixCell = selectedMatrixCell === k ? null : k;
      tbody.querySelectorAll('td[data-key]').forEach(c => c.classList.toggle('matrix-cell-selected', c.dataset.key === selectedMatrixCell));
      renderTablePrefsPanel(tpPanelId, myPlayers, oppPlayers, tablePrefs, deployment, context);
    });
  });
}

function updateCellColor(td, val) {
  const cls = getMatrixCellClass(val);
  const wasSel = td.classList.contains('matrix-cell-selected');
  td.className = cls + (wasSel ? ' matrix-cell-selected' : '');
}

function getMatrixCellClass(val) {
  if (val === '' || val === undefined || val === null) return 'matrix-cell-empty';
  const v = parseInt(val);
  if (isNaN(v)) return 'matrix-cell-empty';
  if (v <= 2) return 'matrix-cell-brown';
  if (v <= 7) return 'matrix-cell-red';
  if (v <= 12) return 'matrix-cell-yellow';
  if (v <= 17) return 'matrix-cell-green';
  return 'matrix-cell-blue';
}

function renderTablePrefsPanel(panelId, myPlayers, oppPlayers, tablePrefs, deployment, context) {
  const panel = document.getElementById(panelId);
  if (!selectedMatrixCell) { panel.style.display = 'none'; return; }

  const key = selectedMatrixCell;
  let aIdx, bIdx;
  if (context === 'prep') {
    [aIdx, bIdx] = key.split('_').map(Number);
  } else {
    [aIdx, bIdx] = key.replace('a','').split('_b').map(Number);
  }

  const prefs = tablePrefs[key] || {};
  const maps = deployment ? WTC_MAPS[deployment] : null;

  let html = `
    <div class="tp-header">
      <span class="team-a-color">${escHTML(myPlayers[aIdx]?.faction || '?')}</span>
      <span class="tp-vs">vs</span>
      <span class="team-b-color">${escHTML(oppPlayers[bIdx]?.faction || '?')}</span>
      <span class="tp-label">— Table Preferences</span>
    </div>
    <div class="tp-buttons">
  `;

  for (let t = 0; t < 8; t++) {
    const pref = prefs[t] || 'neutral';
    const mapIdx = WTC_TABLE_MAP_INDICES[t];
    const mapEntry = maps ? maps[mapIdx] : null;
    const mapName = mapEntry ? mapEntry.name : `Table ${t + 1}`;
    const mapId = mapEntry ? mapEntry.id : null;
    html += `
      <button class="tp-btn tp-${pref}" data-table="${t}" data-key="${key}" title="${mapName}">
        <strong>T${t + 1}</strong>
        <small>${mapId ? mapNameHTML(mapId, mapName) : mapName}</small>
        <span class="tp-state">${pref === 'good' ? '✓' : pref === 'bad' ? '✗' : '—'}</span>
      </button>
    `;
  }

  html += `</div><p class="tp-hint">Click to cycle: neutral → good → bad → neutral</p>`;
  panel.innerHTML = html;
  panel.style.display = '';

  panel.querySelectorAll('.tp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = parseInt(btn.dataset.table);
      const k = btn.dataset.key;
      if (!tablePrefs[k]) tablePrefs[k] = {};
      const current = tablePrefs[k][t] || 'neutral';
      const next = current === 'neutral' ? 'good' : current === 'good' ? 'bad' : 'neutral';
      if (next === 'neutral') { delete tablePrefs[k][t]; } else { tablePrefs[k][t] = next; }
      renderTablePrefsPanel(panelId, myPlayers, oppPlayers, tablePrefs, deployment, context);
      debouncedSaveState();
    });
  });
}

// ===========================
// Pairing Process
// ===========================

function startPairing() {
  collectMyTeam();
  const oppName = document.getElementById('round-opponent').value;
  const dep = document.getElementById('round-deployment').value;
  const missionId = document.getElementById('round-mission').value;

  if (!dep) { showToast('Please select a deployment zone.'); return; }
  if (!missionId) { showToast('Please select a mission.'); return; }

  let oppPlayers = Array.from({ length: 8 }, (_, i) => ({ faction: `Opp ${i+1}` }));
  if (oppName && appState.opponents[oppName]) {
    oppPlayers = appState.opponents[oppName].players;
  }

  teamAData = appState.myTeam.players.map((p, i) => ({
    id: `a${i}`, faction: p.faction || `Army ${i+1}`, armyList: p.armyList,
  }));
  teamBData = oppPlayers.map((p, i) => ({
    id: `b${i}`, faction: p.faction || `Opp ${i+1}`, armyList: p.armyList || '',
  }));

  const maps = WTC_MAPS[dep];
  tablesData = [];
  const missionName = WTC_MISSIONS.find(m => m.id === missionId)?.name || missionId;
  for (let i = 0; i < 8; i++) {
    const mapIdx = WTC_TABLE_MAP_INDICES[i];
    const map = maps[mapIdx];
    tablesData.push({ index: i, deployment: dep, map: map.name, mapId: map.id, mission: missionName, missionId });
  }

  engine = new PairingEngine(teamAData, teamBData, tablesData);

  document.getElementById('board-team-a-name').textContent = appState.myTeam.name || 'My Team';
  document.getElementById('board-team-b-name').textContent = oppName || 'Opponent';

  document.getElementById('round-config-area').style.display = 'none';
  document.getElementById('round-pairing-area').style.display = '';

  buildMatrixReference();
  renderPairingState();
}

function renderPairingState() {
  const state = engine.getState();
  const prompt = engine.getCurrentPrompt();
  updateStepTitle(state, prompt);
  renderMatches(state);
  renderPools(state);
  renderTableChoiceToken(state);
  renderActionPanel(prompt, state);
  updateMatrixReference();

  // If complete, save round results (but not in What-If mode)
  if (state.isComplete && !isWhatIfMode) {
    saveRoundResults();
  }
}

function saveRoundResults() {
  const oppName = document.getElementById('round-opponent').value;
  const dep = document.getElementById('round-deployment').value;
  const missionId = document.getElementById('round-mission').value;

  appState.rounds[currentRoundIdx] = {
    opponent: oppName,
    deployment: dep,
    missionId: missionId,
    missionName: WTC_MISSIONS.find(m => m.id === missionId)?.name || missionId,
    matches: engine.matches.map(m => ({
      playerA: m.playerA,
      playerB: m.playerB,
      table: m.table,
      type: m.type,
      factionA: engine.getPlayer(m.playerA)?.faction,
      factionB: engine.getPlayer(m.playerB)?.faction,
    })),
    log: engine.log,
    completed: true,
  };
  saveState();
  updateRoundButtons();
}

function updateStepTitle(state, prompt) {
  const titleEl = document.getElementById('pairing-step-title');
  const descEl = document.getElementById('pairing-step-desc');
  const stepNames = {
    'choose_defenders': 'Choose Defenders',
    'choose_attackers': 'Choose Attackers',
    'roll_table_choice': 'Roll for Table Choice',
    'refuse_attackers': 'Refuse Attackers',
    'choose_tables_defenders': 'Assign Tables',
    'r3_choose_defenders': 'Choose Defenders',
    'r3_choose_attackers': 'Choose Attackers',
    'r3_refuse_attackers': 'Refuse Attackers',
    'r3_choose_tables': 'Assign Tables',
    'complete': 'Complete!',
  };
  titleEl.textContent = `Pairing Round ${state.round} — ${stepNames[state.step] || state.step}`;
  descEl.textContent = prompt.description || '';
}

function renderMatches(state) {
  const container = document.getElementById('board-matches');
  container.innerHTML = '';
  state.matches.forEach((match, idx) => {
    const pA = engine.getPlayer(match.playerA);
    const pB = engine.getPlayer(match.playerB);
    const tableInfo = match.table !== null ? tablesData[match.table] : null;

    // Get matchup data
    const ai = parseInt(match.playerA.replace('a',''));
    const bi = parseInt(match.playerB.replace('b',''));
    const key = `a${ai}_b${bi}`;
    const est = roundMatchupScores[key];
    const vol = roundMatchupVolatility[key];
    const estCls = getMatrixCellClass(est);
    const matchVolDir = roundMatchupVolDir[key] || 'both';
    const matchVolSym = matchVolDir === 'up' ? '↑' : matchVolDir === 'down' ? '↓' : '±';

    // Table preference for this matchup
    let tablePrefHTML = '';
    if (tableInfo && match.table !== null) {
      const tpKey = key;
      const prefs = roundMatchupTablePrefs[tpKey] || {};
      const tPref = prefs[match.table];
      if (tPref === 'good') tablePrefHTML = '<span class="match-tp match-tp-good" title="Good table for us">▲</span>';
      else if (tPref === 'bad') tablePrefHTML = '<span class="match-tp match-tp-bad" title="Bad table for us">▼</span>';
    }

    const row = document.createElement('div');
    row.className = 'match-row';
    row.innerHTML = `
      <div class="match-player team-a-bg"><strong>${playerHTML(match.playerA, pA.faction)}</strong></div>
      <div class="match-info">
        <div class="match-number">#${idx + 1}</div>
        ${est !== undefined ? `<div class="match-estimate ${estCls}">${est}${vol ? `<small class="match-vol">${matchVolSym}${vol}</small>` : ''}</div>` : ''}
        ${tableInfo ? `
          <div class="match-table">Table ${match.table + 1} ${tablePrefHTML}</div>
          <div class="match-map">${mapNameHTML(tableInfo.mapId, tableInfo.map)}</div>
        ` : '<div class="match-table pending">Table TBD</div>'}
        <div class="match-type ${match.type === 'champions_pairing' ? 'match-type-champion' : ''}">${formatMatchType(match.type)}</div>
      </div>
      <div class="match-player team-b-bg"><strong>${playerHTML(match.playerB, pB.faction)}</strong></div>
    `;
    container.appendChild(row);
  });
}

function renderPools(state) {
  document.getElementById('pool-a').innerHTML = state.poolA.map(id => {
    const p = engine.getPlayer(id);
    return `<div class="pool-player team-a-bg" data-id="${id}"><strong>${playerHTML(id, p.faction)}</strong></div>`;
  }).join('');
  document.getElementById('pool-b').innerHTML = state.poolB.map(id => {
    const p = engine.getPlayer(id);
    const fi = playerFlagIcons(id);
    return `<div class="pool-player team-b-bg" data-id="${id}"><strong>${playerHTML(id, p.faction)}${fi}</strong></div>`;
  }).join('');
}

function renderTableChoiceToken(state) {
  const section = document.getElementById('table-choice-section');
  const span = document.getElementById('table-choice-team');
  if (state.tableChoiceToken) {
    section.style.display = '';
    const name = state.tableChoiceToken === 'A'
      ? (appState.myTeam.name || 'My Team')
      : (document.getElementById('round-opponent').value || 'Opponent');
    span.textContent = name;
    span.className = state.tableChoiceToken === 'A' ? 'team-a-color' : 'team-b-color';
  } else {
    section.style.display = 'none';
  }
}

// --- Action Panel ---

function renderActionPanel(prompt, state) {
  const oldPanel = document.getElementById('action-content');
  const panel = oldPanel.cloneNode(false);
  oldPanel.parentNode.replaceChild(panel, oldPanel);

  switch (prompt.type) {
    case 'dual_select': renderDualSelect(panel, prompt); break;
    case 'dual_select_multi': renderDualSelectMulti(panel, prompt); break;
    case 'roll_off': renderRollOff(panel, prompt); break;
    case 'sequential_table_select':
    case 'sequential_table_select_r3': renderTableSelect(panel, prompt, state); break;
    case 'complete': renderComplete(panel, prompt); break;
    default: panel.innerHTML = '<p>Unknown step</p>';
  }
}

function renderDualSelect(panel, prompt) {
  let selectedA = null, selectedB = null;
  panel.innerHTML = `
    <div class="dual-panels">
      <div class="select-panel team-a-panel">
        <h3>${prompt.titleA}</h3>
        <div class="select-options" id="sel-a">
          ${prompt.optionsA.map(id => `<button class="sel-btn" data-id="${id}">${engine.getPlayer(id).faction}${playerFlagIcons(id)}</button>`).join('')}
        </div>
      </div>
      <div class="select-panel team-b-panel">
        <h3>${prompt.titleB}</h3>
        <div class="select-options" id="sel-b">
          ${prompt.optionsB.map(id => `<button class="sel-btn" data-id="${id}">${engine.getPlayer(id).faction}${playerFlagIcons(id)}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="reveal-section" id="reveal-section" style="display:none">
      <p class="reveal-text">Both teams have made their secret choice.</p>
      <button class="btn btn-primary btn-reveal" id="btn-reveal">Reveal Simultaneously</button>
    </div>
  `;

  panel.querySelectorAll('#sel-a .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('#sel-a .sel-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedA = btn.dataset.id;
      if (selectedA && selectedB) document.getElementById('reveal-section').style.display = '';
    });
  });
  panel.querySelectorAll('#sel-b .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('#sel-b .sel-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedB = btn.dataset.id;
      if (selectedA && selectedB) document.getElementById('reveal-section').style.display = '';
    });
  });

  panel.addEventListener('click', (e) => {
    if (e.target.id === 'btn-reveal' || e.target.closest('#btn-reveal')) {
      const step = engine.step;
      let input;
      if (step === 'choose_defenders' || step === 'r3_choose_defenders') {
        input = { defenderA: selectedA, defenderB: selectedB };
      } else if (step === 'refuse_attackers' || step === 'r3_refuse_attackers') {
        // User selected who to PLAY AGAINST; invert to get the refusal
        const refuseA = prompt.optionsA.find(id => id !== selectedA);
        const refuseB = prompt.optionsB.find(id => id !== selectedB);
        input = { refuseA: refuseA, refuseB: refuseB };
      }
      const result = engine.processInput(input);
      if (result.success) renderPairingState();
      else showToast(result.error);
    }
  });
}

function renderDualSelectMulti(panel, prompt) {
  let selectedA = [], selectedB = [];
  panel.innerHTML = `
    <div class="dual-panels">
      <div class="select-panel team-a-panel">
        <h3>${prompt.titleA}</h3>
        <p class="sel-hint">Select ${prompt.count} players</p>
        <div class="select-options" id="sel-a">
          ${prompt.optionsA.map(id => `<button class="sel-btn" data-id="${id}">${engine.getPlayer(id).faction}${playerFlagIcons(id)}</button>`).join('')}
        </div>
      </div>
      <div class="select-panel team-b-panel">
        <h3>${prompt.titleB}</h3>
        <p class="sel-hint">Select ${prompt.count} players</p>
        <div class="select-options" id="sel-b">
          ${prompt.optionsB.map(id => `<button class="sel-btn" data-id="${id}">${engine.getPlayer(id).faction}${playerFlagIcons(id)}</button>`).join('')}
        </div>
      </div>
    </div>
    <div class="reveal-section" id="reveal-section" style="display:none">
      <p class="reveal-text">Both teams have chosen their attackers.</p>
      <button class="btn btn-primary btn-reveal" id="btn-reveal">Reveal Simultaneously</button>
    </div>
  `;

  const checkReady = () => {
    document.getElementById('reveal-section').style.display =
      (selectedA.length === prompt.count && selectedB.length === prompt.count) ? '' : 'none';
  };

  panel.querySelectorAll('#sel-a .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (selectedA.includes(id)) { selectedA = selectedA.filter(x => x !== id); btn.classList.remove('selected'); }
      else if (selectedA.length < prompt.count) { selectedA.push(id); btn.classList.add('selected'); }
      checkReady();
    });
  });
  panel.querySelectorAll('#sel-b .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (selectedB.includes(id)) { selectedB = selectedB.filter(x => x !== id); btn.classList.remove('selected'); }
      else if (selectedB.length < prompt.count) { selectedB.push(id); btn.classList.add('selected'); }
      checkReady();
    });
  });

  panel.addEventListener('click', (e) => {
    if (e.target.id === 'btn-reveal' || e.target.closest('#btn-reveal')) {
      const result = engine.processInput({ attackersA: selectedA, attackersB: selectedB });
      if (result.success) renderPairingState();
      else showToast(result.error);
    }
  });
}

function renderRollOff(panel, prompt) {
  const teamAName = appState.myTeam.name || 'My Team';
  const teamBName = document.getElementById('round-opponent').value || 'Opponent';
  panel.innerHTML = `
    <div class="roll-off-section">
      <h3>Roll Off for Table Choice Token</h3>
      <p>Captains roll a die. Winner gets to choose tables first for their defender's match.</p>
      <div class="roll-buttons">
        <button class="btn btn-team-a" id="roll-a">${teamAName} Wins</button>
        <button class="btn btn-team-b" id="roll-b">${teamBName} Wins</button>
      </div>
    </div>
  `;
  document.getElementById('roll-a').addEventListener('click', () => { engine.processInput({ winner: 'A' }); renderPairingState(); });
  document.getElementById('roll-b').addEventListener('click', () => { engine.processInput({ winner: 'B' }); renderPairingState(); });
}

function renderTableSelect(panel, prompt, state) {
  const pendingMatches = engine.matches.filter(m => m.table === null);
  const available = [...engine.availableTables];
  if (pendingMatches.length === 0) { engine.processInput({ tableAssignments: [] }); renderPairingState(); return; }

  const orderedMatches = [...pendingMatches];
  if (prompt.firstTeam) {
    orderedMatches.sort((a, b) => {
      if (a.defenderTeam === prompt.firstTeam && b.defenderTeam !== prompt.firstTeam) return -1;
      if (b.defenderTeam === prompt.firstTeam && a.defenderTeam !== prompt.firstTeam) return 1;
      return 0;
    });
  }

  let assignments = [];
  const buildUI = () => {
    const assignedTables = assignments.map(a => a.tableIndex);
    const remainingTables = available.filter(t => !assignedTables.includes(t));
    const currentMatchIdx = assignments.length;
    if (currentMatchIdx >= orderedMatches.length) {
      const finalAssignments = orderedMatches.map((match, i) => ({
        matchIndex: engine.matches.indexOf(match), tableIndex: assignments[i].tableIndex,
      }));
      engine.processInput({ tableAssignments: finalAssignments });
      renderPairingState();
      return;
    }
    const currentMatch = orderedMatches[currentMatchIdx];
    const pA = engine.getPlayer(currentMatch.playerA);
    const pB = engine.getPlayer(currentMatch.playerB);
    const matchNum = engine.matches.indexOf(currentMatch) + 1;
    const whoChooses = currentMatch.defenderTeam === prompt.firstTeam ? "Token holder's defender" : 'Other defender';

    // Get table prefs for this matchup
    const ai = parseInt(currentMatch.playerA.replace('a',''));
    const bi = parseInt(currentMatch.playerB.replace('b',''));
    const tpKey = `a${ai}_b${bi}`;
    const matchPrefs = roundMatchupTablePrefs[tpKey] || {};
    const estScore = roundMatchupScores[tpKey];
    const vol = roundMatchupVolatility[tpKey];
    const vDir = roundMatchupVolDir[tpKey] || 'both';
    const vSym = vDir === 'up' ? '↑' : vDir === 'down' ? '↓' : '±';
    const estHTML = estScore !== undefined ? `<span class="match-estimate-inline ${getMatrixCellClass(estScore)}">${estScore}${vol ? `<small class="match-vol">${vSym}${vol}</small>` : ''}</span>` : '';

    panel.innerHTML = `
      <div class="table-select-section">
        <h3>Assign Table for Match #${matchNum} ${estHTML}</h3>
        <p class="match-preview">${playerHTML(currentMatch.playerA, pA.faction)} vs ${playerHTML(currentMatch.playerB, pB.faction)}</p>
        <p class="sel-hint">${whoChooses} chooses table</p>
        <div class="table-options" id="table-opts">
          ${remainingTables.map(tIdx => {
            const pref = matchPrefs[tIdx];
            const prefCls = pref === 'good' ? 'table-btn-good' : pref === 'bad' ? 'table-btn-bad' : '';
            const prefTag = pref === 'good' ? '<span class="table-pref-tag good">▲ Good</span>' : pref === 'bad' ? '<span class="table-pref-tag bad">▼ Bad</span>' : '';
            return `
            <button class="table-btn ${prefCls}" data-table="${tIdx}">
              <strong>Table ${tIdx + 1}</strong>
              <span>${mapNameHTML(tablesData[tIdx].mapId, tablesData[tIdx].map)}</span>
              ${prefTag}
            </button>`;
          }).join('')}
        </div>
      </div>
    `;
    panel.querySelectorAll('.table-btn').forEach(btn => {
      btn.addEventListener('click', () => { assignments.push({ tableIndex: parseInt(btn.dataset.table) }); buildUI(); });
    });
  };
  buildUI();
}

function renderComplete(panel, prompt) {
  panel.innerHTML = `
    <div class="complete-section">
      <h3>All 8 Pairings Complete!</h3>
      <p style="color:var(--text-secondary);margin-bottom:16px;">Round ${currentRoundIdx + 1} results have been saved.</p>
      <button class="btn btn-primary" id="btn-view-overview">View Tournament Overview</button>
    </div>
  `;
  document.getElementById('btn-view-overview').addEventListener('click', () => {
    renderOverview();
    showPhase('overview');
  });
}

// --- What-If Mode ---

function enterWhatIfMode() {
  if (!engine || isWhatIfMode) return;
  if (engine.step === 'complete') { showToast('Pairing is already complete.'); return; }
  whatIfSnapshot = engine.createSnapshot();
  isWhatIfMode = true;
  document.getElementById('btn-whatif').style.display = 'none';
  document.getElementById('btn-whatif-exit').style.display = '';
  document.getElementById('whatif-banner').style.display = '';
  document.getElementById('round-pairing-area').classList.add('whatif-active');
  showToast('What-If mode entered. Explore freely!');
}

function exitWhatIfMode(restore) {
  if (!isWhatIfMode) return;
  if (restore && whatIfSnapshot && engine) {
    engine.restoreSnapshot(whatIfSnapshot);
    renderPairingState();
  }
  whatIfSnapshot = null;
  isWhatIfMode = false;
  document.getElementById('btn-whatif').style.display = '';
  document.getElementById('btn-whatif-exit').style.display = 'none';
  document.getElementById('whatif-banner').style.display = 'none';
  document.getElementById('round-pairing-area').classList.remove('whatif-active');
  if (restore) showToast('Restored to saved state.');
}

// --- Matrix Reference ---

function buildMatrixReference() {
  updateMatrixReference();
}

function updateMatrixReference() {
  const body = document.getElementById('matrix-ref-body');
  if (!body || !teamAData.length || !teamBData.length) return;

  const state = engine ? engine.getState() : null;
  const pairedA = new Set(), pairedB = new Set();
  const matchedPairs = new Set();
  if (state) {
    state.matches.forEach(m => {
      pairedA.add(m.playerA);
      pairedB.add(m.playerB);
      const ai = parseInt(m.playerA.replace('a',''));
      const bi = parseInt(m.playerB.replace('b',''));
      matchedPairs.add(`${ai}_${bi}`);
    });
  }
  const poolASet = state ? new Set(state.poolA) : new Set(teamAData.map(p => p.id));
  const poolBSet = state ? new Set(state.poolB) : new Set(teamBData.map(p => p.id));

  let html = `<div class="matrix-legend">
    <span class="legend-item legend-brown">0-2</span>
    <span class="legend-item legend-red">3-7</span>
    <span class="legend-item legend-yellow">8-12</span>
    <span class="legend-item legend-green">13-17</span>
    <span class="legend-item legend-blue">18-20</span>
  </div><table class="matchup-matrix ref-live"><thead><tr><th></th>`;

  teamBData.forEach((p, j) => {
    const dimmed = !poolBSet.has(p.id) && !pairedB.has(p.id) ? ' ref-dimmed' : '';
    const matched = pairedB.has(p.id) ? ' ref-matched-header' : '';
    html += `<th class="col-header team-b-color${dimmed}${matched}">${escHTML(p.faction)}</th>`;
  });
  html += '</tr></thead><tbody>';

  teamAData.forEach((pA, i) => {
    const aDimmed = !poolASet.has(pA.id) && !pairedA.has(pA.id) ? ' ref-dimmed' : '';
    const aMatched = pairedA.has(pA.id) ? ' ref-matched-header' : '';
    html += `<tr><th class="row-header team-a-color${aDimmed}${aMatched}">${escHTML(pA.faction)}</th>`;
    teamBData.forEach((pB, j) => {
      const key = `a${i}_b${j}`;
      const val = roundMatchupScores[key];
      const vol = roundMatchupVolatility[key];
      const cls = getMatrixCellClass(val);
      const isMatch = matchedPairs.has(`${i}_${j}`);
      const isAvailable = poolASet.has(`a${i}`) && poolBSet.has(`b${j}`);
      const isDimmed = !isMatch && !isAvailable;
      let extra = '';
      if (isMatch) extra = ' ref-cell-matched';
      else if (isDimmed) extra = ' ref-cell-dimmed';

      const refVolDir = roundMatchupVolDir[key] || 'both';
      const refVolSym = refVolDir === 'up' ? '↑' : refVolDir === 'down' ? '↓' : '±';
      const volHTML = vol ? `<small class="ref-vol">${refVolSym}${vol}</small>` : '';
      const refPref = roundMatchupPreferred[key] ? '<span class="pref-star" style="position:static;font-size:0.4rem">&#11088;</span>' : '';
      html += `<td class="${cls}${extra}" data-ref-key="${key}">${refPref}${val !== undefined ? val : '—'}${volHTML}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  body.innerHTML = html;
}

// ===========================
// TAB 4: Live Coaching
// ===========================

const COACHING_STORAGE_KEY = 'wtc_coaching_live';
let coachingChannel = null;

function initCoaching() {
  populateCoachingRoundSelect();
  document.getElementById('coaching-round-select').addEventListener('change', renderCoachingTab);
  document.getElementById('btn-share-coaching').addEventListener('click', shareCoachingState);
  document.getElementById('btn-import-coaching').addEventListener('click', showImportModal);

  // BroadcastChannel for multi-tab sync
  try {
    coachingChannel = new BroadcastChannel('wtc_coaching_sync');
    coachingChannel.onmessage = (e) => {
      if (e.data.type === 'coaching_update') {
        saveCoachingData(e.data.roundIdx, e.data.scores, false); // save without re-broadcasting
        const sel = document.getElementById('coaching-round-select');
        if (parseInt(sel.value) === e.data.roundIdx) {
          renderCoachingTab(); // refresh if viewing same round
        }
      }
    };
  } catch (e) { /* BroadcastChannel not supported */ }
}

function populateCoachingRoundSelect() {
  const sel = document.getElementById('coaching-round-select');
  const current = sel.value;
  sel.innerHTML = '<option value="">— Select Round —</option>';
  for (let r = 0; r < 7; r++) {
    const rd = appState.rounds[r];
    if (rd && rd.completed) {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = `Round ${r + 1} vs ${rd.opponent || '?'}`;
      sel.appendChild(opt);
    }
  }
  if (current) sel.value = current;
}

function getCoachingData(roundIdx) {
  try {
    const raw = localStorage.getItem(COACHING_STORAGE_KEY);
    if (raw) {
      const all = JSON.parse(raw);
      return all[roundIdx] || null;
    }
  } catch (e) {}
  return null;
}

function saveCoachingData(roundIdx, scores, broadcast = true) {
  try {
    const raw = localStorage.getItem(COACHING_STORAGE_KEY);
    const all = raw ? JSON.parse(raw) : {};
    all[roundIdx] = scores;
    localStorage.setItem(COACHING_STORAGE_KEY, JSON.stringify(all));
    if (broadcast && coachingChannel) {
      coachingChannel.postMessage({ type: 'coaching_update', roundIdx, scores });
    }
  } catch (e) { console.warn('Failed to save coaching data', e); }
  if (typeof syncCoaching === 'function') syncCoaching();
}

function renderCoachingTab() {
  const sel = document.getElementById('coaching-round-select');
  const content = document.getElementById('coaching-content');
  const roundIdx = sel.value;

  if (roundIdx === '' || !appState.rounds[parseInt(roundIdx)]) {
    content.innerHTML = '<p class="coaching-placeholder">Select a completed round to start coaching.</p>';
    return;
  }

  const rIdx = parseInt(roundIdx);
  const rd = appState.rounds[rIdx];
  const saved = getCoachingData(rIdx) || {};
  const matches = rd.matches || [];

  let html = `
    <div class="win-tracker" id="win-tracker">
      <div class="win-tracker-bar">
        <div class="win-tracker-fill" id="win-tracker-fill" style="width:0%"></div>
        <div class="win-tracker-target" style="left:${(86/160)*100}%"><span class="win-target-label">86</span></div>
      </div>
      <div class="win-tracker-info">
        <span class="win-tracker-current" id="win-tracker-current">0</span>
        <span class="win-tracker-sep">/</span>
        <span class="win-tracker-target-num">86 to win</span>
        <span class="win-tracker-delta" id="win-tracker-delta"></span>
      </div>
      <div class="win-tracker-needs" id="win-tracker-needs"></div>
    </div>
    <div class="coaching-table-wrap">
      <table class="coaching-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Matchup</th>
            <th>Directive</th>
            <th>Table</th>
            <th class="est-col">Est.</th>
            <th class="vol-col">Vol</th>
            <th class="br-col">BR 1</th>
            <th class="br-col">BR 2</th>
            <th class="br-col">BR 3</th>
            <th class="br-col">BR 4</th>
            <th class="br-col">BR 5</th>
            <th>Latest</th>
          </tr>
        </thead>
        <tbody>
  `;

  matches.forEach((m, idx) => {
    const mScores = saved[idx] || {};
    let preEst = '—';
    let vol = 0;
    let tablePref = null;
    const aIdx = m.playerA ? parseInt(m.playerA.replace('a','')) : idx;
    const bIdx = m.playerB ? parseInt(m.playerB.replace('b','')) : idx;
    const matrixKey = `a${aIdx}_b${bIdx}`;
    const prepKey = `${aIdx}_${bIdx}`;

    if (roundMatchupScores[matrixKey] !== undefined) {
      preEst = roundMatchupScores[matrixKey];
      vol = roundMatchupVolatility[matrixKey] || 0;
      if (m.table !== null && m.table !== undefined) {
        const prefs = roundMatchupTablePrefs[matrixKey] || {};
        tablePref = prefs[m.table] || null;
      }
    } else if (rd.opponent && appState.opponents[rd.opponent]) {
      const oppData = appState.opponents[rd.opponent];
      if (oppData.matchups[prepKey]) {
        preEst = oppData.matchups[prepKey].score;
        vol = oppData.matchups[prepKey].volatility || 0;
      }
      if (m.table !== null && m.table !== undefined && oppData.tablePrefs[prepKey]) {
        tablePref = oppData.tablePrefs[prepKey][m.table] || null;
      }
    }

    // Calculate latest
    let latest = preEst;
    for (let br = 5; br >= 1; br--) {
      if (mScores[br] !== undefined && mScores[br] !== '') {
        latest = mScores[br];
        break;
      }
    }

    const latestNum = parseInt(latest);
    const latestCls = getMatrixCellClass(latestNum);

    const tableNum = m.table !== null && m.table !== undefined ? `T${m.table + 1}` : '—';
    const tpIcon = tablePref === 'good' ? '<span class="coaching-tp coaching-tp-good" title="Good table">▲</span>'
                 : tablePref === 'bad' ? '<span class="coaching-tp coaching-tp-bad" title="Bad table">▼</span>'
                 : '';
    let coachVolDir = 'both';
    if (roundMatchupVolDir[key]) coachVolDir = roundMatchupVolDir[key];
    else if (rd.opponent && appState.opponents[rd.opponent] && appState.opponents[rd.opponent].matchups[prepKey]) {
      coachVolDir = appState.opponents[rd.opponent].matchups[prepKey].volDir || 'both';
    }
    const coachVolSym = coachVolDir === 'up' ? '↑' : coachVolDir === 'down' ? '↓' : '±';
    const volHTML = vol ? `<span class="coaching-vol-badge">${coachVolSym}${vol}</span>` : '<span class="coaching-vol-none">—</span>';

    const directive = (saved._directives && saved._directives[idx]) || '';
    html += `
      <tr>
        <td>${idx + 1}</td>
        <td class="match-cell">
          <span class="coaching-match-a">${escHTML(m.factionA || '?')}</span>
          <span class="coaching-match-vs">vs</span>
          <span class="coaching-match-b">${escHTML(m.factionB || '?')}</span>
          ${m.type === 'champions_pairing' ? '<span class="coaching-champion-tag">👑</span>' : ''}
        </td>
        <td class="directive-cell">
          <div class="directive-btns" data-match="${idx}">
            <button class="dir-btn dir-aggressive ${directive === 'aggressive' ? 'active' : ''}" data-dir="aggressive" data-match="${idx}" title="Play Aggressive">🔥</button>
            <button class="dir-btn dir-steady ${directive === 'steady' ? 'active' : ''}" data-dir="steady" data-match="${idx}" title="Stay the Course">⚖️</button>
            <button class="dir-btn dir-safe ${directive === 'safe' ? 'active' : ''}" data-dir="safe" data-match="${idx}" title="Play Safe / Protect">🛡️</button>
          </div>
        </td>
        <td class="table-cell">${tableNum} ${tpIcon}</td>
        <td class="est-cell ${getMatrixCellClass(preEst)}">${preEst}</td>
        <td class="vol-cell">${volHTML}</td>
    `;

    for (let br = 1; br <= 5; br++) {
      const val = mScores[br] !== undefined ? mScores[br] : '';
      html += `<td><input type="number" class="coaching-br-input" data-match="${idx}" data-br="${br}" min="0" max="20" value="${val}" placeholder="—"></td>`;
    }

    html += `<td class="coaching-latest ${latestCls}">${latest}</td></tr>`;
  });

  // Total row
  html += `
      <tr class="total-row">
        <td colspan="4" class="total-label">TEAM TOTAL</td>
        <td class="est-cell" id="coaching-total-est">—</td>
        <td></td>
        <td id="coaching-total-br1">—</td>
        <td id="coaching-total-br2">—</td>
        <td id="coaching-total-br3">—</td>
        <td id="coaching-total-br4">—</td>
        <td id="coaching-total-br5">—</td>
        <td id="coaching-total-latest">—</td>
      </tr>
    </tbody></table></div>
  `;

  content.innerHTML = html;

  // Bind BR input handlers
  content.querySelectorAll('.coaching-br-input').forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      const matchIdx = parseInt(e.target.dataset.match);
      const br = parseInt(e.target.dataset.br);

      const currentSaved = getCoachingData(rIdx) || {};
      if (!currentSaved[matchIdx]) currentSaved[matchIdx] = {};

      if (val === '') {
        delete currentSaved[matchIdx][br];
      } else {
        val = Math.max(0, Math.min(20, parseInt(val) || 0));
        e.target.value = val;
        currentSaved[matchIdx][br] = val;
      }

      saveCoachingData(rIdx, currentSaved);
      updateCoachingTotals(rIdx);
    });
  });

  // Bind directive button handlers
  content.querySelectorAll('.dir-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const matchIdx = parseInt(btn.dataset.match);
      const dir = btn.dataset.dir;
      const currentSaved = getCoachingData(rIdx) || {};
      if (!currentSaved._directives) currentSaved._directives = {};

      // Toggle: click same = clear
      if (currentSaved._directives[matchIdx] === dir) {
        delete currentSaved._directives[matchIdx];
      } else {
        currentSaved._directives[matchIdx] = dir;
      }

      saveCoachingData(rIdx, currentSaved);

      // Update UI locally
      const group = btn.closest('.directive-btns');
      group.querySelectorAll('.dir-btn').forEach(b => b.classList.remove('active'));
      if (currentSaved._directives[matchIdx]) {
        btn.classList.add('active');
      }
    });
  });

  updateCoachingTotals(rIdx);
}

function updateCoachingTotals(roundIdx) {
  const rd = appState.rounds[roundIdx];
  if (!rd) return;
  const matches = rd.matches || [];
  const saved = getCoachingData(roundIdx) || {};

  let estTotal = 0, estCount = 0;
  const brTotals = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const brCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let latestTotal = 0;

  matches.forEach((m, idx) => {
    const mScores = saved[idx] || {};
    const aIdx = m.playerA ? parseInt(m.playerA.replace('a','')) : idx;
    const bIdx = m.playerB ? parseInt(m.playerB.replace('b','')) : idx;

    // Pre-match estimate
    let preEst = null;
    const matrixKey = `a${aIdx}_b${bIdx}`;
    if (roundMatchupScores[matrixKey] !== undefined) {
      preEst = roundMatchupScores[matrixKey];
    } else if (rd.opponent && appState.opponents[rd.opponent]) {
      const oppData = appState.opponents[rd.opponent];
      const prepKey = `${aIdx}_${bIdx}`;
      if (oppData.matchups[prepKey]) preEst = oppData.matchups[prepKey].score;
    }

    if (preEst !== null && preEst !== '—') { estTotal += parseInt(preEst); estCount++; }

    // BR totals
    for (let br = 1; br <= 5; br++) {
      if (mScores[br] !== undefined && mScores[br] !== '') {
        brTotals[br] += parseInt(mScores[br]);
        brCounts[br]++;
      }
    }

    // Latest per match
    let latest = preEst;
    for (let br = 5; br >= 1; br--) {
      if (mScores[br] !== undefined && mScores[br] !== '') { latest = mScores[br]; break; }
    }
    if (latest !== null && latest !== '—') latestTotal += parseInt(latest);
  });

  // Update DOM
  const estEl = document.getElementById('coaching-total-est');
  if (estEl) estEl.textContent = estCount > 0 ? estTotal : '—';

  for (let br = 1; br <= 5; br++) {
    const el = document.getElementById(`coaching-total-br${br}`);
    if (el) {
      if (brCounts[br] === 8) {
        el.textContent = brTotals[br];
        el.className = brTotals[br] >= 86 ? 'coaching-good' : brTotals[br] >= 72 ? 'coaching-neutral' : 'coaching-bad';
      } else if (brCounts[br] > 0) {
        el.textContent = `${brTotals[br]} (${brCounts[br]}/8)`;
        el.className = '';
      } else {
        el.textContent = '—';
        el.className = '';
      }
    }
  }

  const latestEl = document.getElementById('coaching-total-latest');
  if (latestEl) {
    latestEl.textContent = latestTotal;
    latestEl.className = 'coaching-latest ' + (latestTotal >= 86 ? 'coaching-good' : latestTotal >= 72 ? '' : 'coaching-bad');
  }

  // Win tracker
  updateWinTracker(roundIdx, matches, saved, latestTotal);

  // Update latest column cells
  const rd2 = appState.rounds[roundIdx];
  const content = document.getElementById('coaching-content');
  const rows = content.querySelectorAll('tbody tr:not(.total-row)');
  rows.forEach((row, idx) => {
    const mScores = saved[idx] || {};
    const m = matches[idx];
    const aIdx = m.playerA ? parseInt(m.playerA.replace('a','')) : idx;
    const bIdx = m.playerB ? parseInt(m.playerB.replace('b','')) : idx;

    let preEst = '—';
    const matrixKey = `a${aIdx}_b${bIdx}`;
    if (roundMatchupScores[matrixKey] !== undefined) preEst = roundMatchupScores[matrixKey];
    else if (rd2.opponent && appState.opponents[rd2.opponent]) {
      const oppData = appState.opponents[rd2.opponent];
      const prepKey = `${aIdx}_${bIdx}`;
      if (oppData.matchups[prepKey]) preEst = oppData.matchups[prepKey].score;
    }

    let latest = preEst;
    for (let br = 5; br >= 1; br--) {
      if (mScores[br] !== undefined && mScores[br] !== '') { latest = mScores[br]; break; }
    }

    const latestCell = row.querySelector('.coaching-latest');
    if (latestCell) {
      latestCell.textContent = latest;
      latestCell.className = 'coaching-latest ' + getMatrixCellClass(parseInt(latest));
    }
  });
}

function updateWinTracker(roundIdx, matches, saved, latestTotal) {
  const WIN_TARGET = 86;
  const MAX_POINTS = 160; // 8 games × 20 max

  const fill = document.getElementById('win-tracker-fill');
  const current = document.getElementById('win-tracker-current');
  const delta = document.getElementById('win-tracker-delta');
  const needs = document.getElementById('win-tracker-needs');
  if (!fill) return;

  // Calculate fill percentage
  const pct = Math.min(100, Math.max(0, (latestTotal / MAX_POINTS) * 100));
  fill.style.width = pct + '%';

  // Color the fill bar
  if (latestTotal >= WIN_TARGET) {
    fill.className = 'win-tracker-fill win-fill-good';
  } else if (latestTotal >= WIN_TARGET - 14) {
    fill.className = 'win-tracker-fill win-fill-close';
  } else {
    fill.className = 'win-tracker-fill win-fill-behind';
  }

  // Current total
  current.textContent = latestTotal;

  // Delta display
  const diff = latestTotal - WIN_TARGET;
  if (diff >= 0) {
    delta.textContent = `+${diff} ahead`;
    delta.className = 'win-tracker-delta delta-good';
  } else {
    delta.textContent = `${diff} behind`;
    delta.className = 'win-tracker-delta delta-bad';
  }

  // Per-game needs breakdown: which games still have only estimates vs actual BR scores?
  let gamesWithScores = 0;
  let pointsFromScored = 0;
  let gamesWithEstOnly = 0;
  let pointsFromEst = 0;

  matches.forEach((m, idx) => {
    const mScores = saved[idx] || {};
    const aIdx = m.playerA ? parseInt(m.playerA.replace('a','')) : idx;
    const bIdx = m.playerB ? parseInt(m.playerB.replace('b','')) : idx;

    // Check if any BR score exists
    let hasScore = false;
    let latestVal = 0;
    for (let br = 5; br >= 1; br--) {
      if (mScores[br] !== undefined && mScores[br] !== '') {
        hasScore = true;
        latestVal = parseInt(mScores[br]);
        break;
      }
    }

    if (hasScore) {
      gamesWithScores++;
      pointsFromScored += latestVal;
    } else {
      // Estimate only
      let preEst = 10; // default if no estimate
      const matrixKey = `a${aIdx}_b${bIdx}`;
      const rd = appState.rounds[roundIdx];
      if (roundMatchupScores[matrixKey] !== undefined) {
        preEst = parseInt(roundMatchupScores[matrixKey]);
      } else if (rd.opponent && appState.opponents[rd.opponent]) {
        const oppData = appState.opponents[rd.opponent];
        const prepKey = `${aIdx}_${bIdx}`;
        if (oppData.matchups[prepKey]) preEst = parseInt(oppData.matchups[prepKey].score);
      }
      gamesWithEstOnly++;
      pointsFromEst += preEst;
    }
  });

  const gamesRemaining = 8 - gamesWithScores;

  if (gamesWithScores === 0) {
    needs.textContent = 'No scores entered yet — showing estimates only.';
  } else if (gamesRemaining === 0) {
    // All games scored
    if (latestTotal >= WIN_TARGET) {
      needs.innerHTML = `<span class="needs-win">✅ On track to win! ${latestTotal} / ${WIN_TARGET}</span>`;
    } else {
      needs.innerHTML = `<span class="needs-lose">⚠️ Currently ${WIN_TARGET - latestTotal} points short of victory.</span>`;
    }
  } else {
    // Some games scored, some not
    const pointsNeeded = WIN_TARGET - pointsFromScored;
    const avgNeeded = pointsNeeded / gamesRemaining;
    const avgNeededStr = avgNeeded.toFixed(1);

    let needsHTML = `<span class="needs-label">${gamesWithScores}/8 games scored (${pointsFromScored} pts)</span> · `;
    needsHTML += `<span class="needs-label">Remaining ${gamesRemaining} games need <strong>${pointsNeeded} pts</strong> total`;
    needsHTML += ` (avg <strong>${avgNeededStr}</strong>/game)</span>`;

    if (avgNeeded <= 10) {
      needsHTML += ` <span class="needs-tag needs-tag-ok">Achievable</span>`;
    } else if (avgNeeded <= 14) {
      needsHTML += ` <span class="needs-tag needs-tag-push">Need to push</span>`;
    } else if (avgNeeded <= 20) {
      needsHTML += ` <span class="needs-tag needs-tag-hard">Very difficult</span>`;
    } else {
      needsHTML += ` <span class="needs-tag needs-tag-impossible">Mathematically impossible</span>`;
    }

    needs.innerHTML = needsHTML;
  }
}

function shareCoachingState() {
  const sel = document.getElementById('coaching-round-select');
  const roundIdx = parseInt(sel.value);
  if (isNaN(roundIdx)) { showToast('Select a round first.'); return; }

  const rd = appState.rounds[roundIdx];
  const scores = getCoachingData(roundIdx) || {};

  const shareData = {
    v: 1,
    round: roundIdx,
    opponent: rd.opponent,
    matches: rd.matches,
    scores: scores,
  };

  const encoded = btoa(JSON.stringify(shareData));
  showShareModal(encoded, 'export');
}

function showImportModal() {
  showShareModal('', 'import');
}

function showShareModal(code, mode) {
  const modal = document.createElement('div');
  modal.className = 'coaching-share-modal';
  modal.innerHTML = `
    <div class="coaching-share-content">
      <h3>${mode === 'export' ? 'Share Coaching State' : 'Import Coaching State'}</h3>
      <p style="color:var(--text-secondary);margin-bottom:12px;font-size:0.85rem;">
        ${mode === 'export' ? 'Copy this code and share with other coaches:' : 'Paste a coaching state code from another coach:'}
      </p>
      <textarea id="share-code-area" ${mode === 'export' ? 'readonly' : ''} placeholder="Paste share code here...">${code}</textarea>
      <div class="coaching-share-btns">
        ${mode === 'export' ? '<button class="btn btn-accent" id="btn-copy-code">Copy</button>' : '<button class="btn btn-primary" id="btn-apply-import">Import</button>'}
        <button class="btn btn-secondary" id="btn-close-modal">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#btn-close-modal').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

  if (mode === 'export') {
    modal.querySelector('#btn-copy-code').addEventListener('click', () => {
      const textarea = modal.querySelector('#share-code-area');
      textarea.select();
      navigator.clipboard.writeText(textarea.value).then(() => showToast('Copied to clipboard!'));
    });
    // Auto-select
    setTimeout(() => modal.querySelector('#share-code-area').select(), 100);
  } else {
    modal.querySelector('#btn-apply-import').addEventListener('click', () => {
      const raw = modal.querySelector('#share-code-area').value.trim();
      try {
        const data = JSON.parse(atob(raw));
        if (data.v !== 1 || data.round === undefined) throw new Error('Invalid format');
        saveCoachingData(data.round, data.scores);
        // Ensure the round data exists
        if (data.matches && !appState.rounds[data.round]) {
          appState.rounds[data.round] = {
            opponent: data.opponent,
            matches: data.matches,
            completed: true,
          };
          saveState();
        }
        populateCoachingRoundSelect();
        document.getElementById('coaching-round-select').value = data.round;
        renderCoachingTab();
        modal.remove();
        showToast('Coaching state imported!');
      } catch (e) {
        showToast('Invalid share code. Check and try again.');
      }
    });
  }
}

// ===========================
// TAB 5: Overview
// ===========================

function renderOverview() {
  const container = document.getElementById('overview-content');
  let html = '<div class="overview-rounds">';

  for (let r = 0; r < 7; r++) {
    const rd = appState.rounds[r];
    html += `<div class="overview-round-card ${rd && rd.completed ? 'completed' : 'pending'}">
      <h3>Round ${r + 1}</h3>`;

    if (rd && rd.completed) {
      html += `
        <div class="overview-meta">
          <span>vs <strong>${escHTML(rd.opponent || '?')}</strong></span>
          <span>${escHTML(rd.deployment || '')}</span>
          <span>${escHTML(rd.missionName || '')}</span>
        </div>
        <table class="overview-match-table">
          <thead><tr><th>#</th><th>Table</th><th>${escHTML(appState.myTeam.name || 'My Team')}</th><th>vs</th><th>${escHTML(rd.opponent || 'Opp')}</th><th>Type</th></tr></thead>
          <tbody>
      `;
      const sorted = [...rd.matches].sort((a, b) => (a.table || 0) - (b.table || 0));
      sorted.forEach((m, i) => {
        html += `<tr>
          <td>${i + 1}</td>
          <td>T${(m.table || 0) + 1}</td>
          <td class="team-a-cell">${escHTML(m.factionA || '?')}</td>
          <td class="vs-cell">vs</td>
          <td class="team-b-cell">${escHTML(m.factionB || '?')}</td>
          <td><span class="type-badge ${m.type === 'champions_pairing' ? 'type-badge-champion' : ''}">${formatMatchType(m.type)}</span></td>
        </tr>`;
      });
      html += '</tbody></table>';
    } else {
      html += '<p class="overview-pending">Not yet played</p>';
    }
    html += '</div>';
  }
  html += '</div>';
  container.innerHTML = html;
}

// ===========================
// Optimal Pairing Algorithm
// ===========================

function runOptimalPairing(context) {
  const resultsElId = context === 'prep' ? 'algorithm-results' : 'round-algorithm-results';
  const resultsEl = document.getElementById(resultsElId);

  let S = [], V = [], myP, oppP;
  if (context === 'prep') {
    if (!currentPrepCountry) return;
    const opp = appState.opponents[currentPrepCountry];
    myP = appState.myTeam.players;
    oppP = opp.players;
    for (let i = 0; i < 8; i++) {
      S[i] = []; V[i] = [];
      for (let j = 0; j < 8; j++) {
        const m = opp.matchups[`${i}_${j}`];
        if (!m || m.score === undefined || m.score === '') {
          resultsEl.innerHTML = '<p class="algo-error">Please fill in all matchup scores first.</p>';
          resultsEl.style.display = ''; return;
        }
        S[i][j] = m.score;
        V[i][j] = m.volatility || 0;
      }
    }
  } else {
    myP = appState.myTeam.players;
    const oppName = document.getElementById('round-opponent').value;
    oppP = oppName && appState.opponents[oppName] ? appState.opponents[oppName].players : Array.from({ length: 8 }, () => ({ faction: '?' }));
    for (let i = 0; i < 8; i++) {
      S[i] = []; V[i] = [];
      for (let j = 0; j < 8; j++) {
        const key = `a${i}_b${j}`;
        if (roundMatchupScores[key] === undefined) {
          resultsEl.innerHTML = '<p class="algo-error">Please fill in all matchup scores first.</p>';
          resultsEl.style.display = ''; return;
        }
        S[i][j] = roundMatchupScores[key];
        V[i][j] = roundMatchupVolatility[key] || 0;
      }
    }
  }

  const bestAssignment = hungarianMax(S);
  const bestTotal = bestAssignment.reduce((sum, j, i) => sum + S[i][j], 0);
  const worstAssignment = hungarianMin(S);
  const worstTotal = worstAssignment.reduce((sum, j, i) => sum + S[i][j], 0);

  const allPerms = getAllPermutations(8);
  const scored = allPerms.map(perm => ({
    perm,
    total: perm.reduce((sum, j, i) => sum + S[i][j], 0),
  }));
  scored.sort((a, b) => b.total - a.total);
  const avg = scored.reduce((s, x) => s + x.total, 0) / scored.length;

  const strategy = generatePairingStrategy(S, V, myP, oppP, bestAssignment);

  resultsEl.innerHTML = `
    <h3>Optimal Pairing Analysis</h3>
    <div class="algo-summary">
      <div class="algo-stat algo-stat-best"><span class="algo-stat-label">Best Case</span><span class="algo-stat-value">${bestTotal}</span></div>
      <div class="algo-stat algo-stat-avg"><span class="algo-stat-label">Average</span><span class="algo-stat-value">${avg.toFixed(1)}</span></div>
      <div class="algo-stat algo-stat-worst"><span class="algo-stat-label">Worst Case</span><span class="algo-stat-value">${worstTotal}</span></div>
    </div>
    <h4>Best Pairing for My Team</h4>
    <table class="algo-table"><thead><tr><th>My Army</th><th>Opponent</th><th>Score</th><th>Vol</th></tr></thead><tbody>
      ${bestAssignment.map((j, i) => `<tr>
        <td class="team-a-color">${escHTML(myP[i]?.faction || '?')}</td>
        <td class="team-b-color">${escHTML(oppP[j]?.faction || '?')}</td>
        <td class="${getMatrixCellClass(S[i][j])}" style="font-weight:700;text-align:center">${S[i][j]}</td>
        <td style="text-align:center">${V[i][j] ? '±' + V[i][j] : '—'}</td>
      </tr>`).join('')}
      <tr class="algo-total-row"><td colspan="2"><strong>Total</strong></td><td style="text-align:center"><strong>${bestTotal}</strong></td><td></td></tr>
    </tbody></table>
    <h4>Worst Pairing <small>(opponent's ideal)</small></h4>
    <table class="algo-table"><thead><tr><th>My Army</th><th>Opponent</th><th>Score</th><th>Vol</th></tr></thead><tbody>
      ${worstAssignment.map((j, i) => `<tr>
        <td class="team-a-color">${escHTML(myP[i]?.faction || '?')}</td>
        <td class="team-b-color">${escHTML(oppP[j]?.faction || '?')}</td>
        <td class="${getMatrixCellClass(S[i][j])}" style="font-weight:700;text-align:center">${S[i][j]}</td>
        <td style="text-align:center">${V[i][j] ? '±' + V[i][j] : '—'}</td>
      </tr>`).join('')}
      <tr class="algo-total-row"><td colspan="2"><strong>Total</strong></td><td style="text-align:center"><strong>${worstTotal}</strong></td><td></td></tr>
    </tbody></table>
    <h4>Pairing Strategy Recommendations</h4>
    <div class="algo-strategy">${strategy}</div>
  `;
  resultsEl.style.display = '';
}

function generatePairingStrategy(S, V, myP, oppP, optimalAssignment) {
  const playerAnalysis = [];
  for (let i = 0; i < 8; i++) {
    const scores = S[i].slice();
    const min = Math.min(...scores), max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / 8;
    playerAnalysis.push({ idx: i, faction: myP[i]?.faction || '?', min, max, avg, range: max - min, scores });
  }

  const oppAnalysis = [];
  for (let j = 0; j < 8; j++) {
    const scores = S.map(row => row[j]);
    const min = Math.min(...scores), max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / 8;
    oppAnalysis.push({ idx: j, faction: oppP[j]?.faction || '?', min, max, avg });
  }

  const defenderCandidates = [...playerAnalysis].sort((a, b) => (b.min * 2 - b.range) - (a.min * 2 - a.range));
  const attackerCandidates = [...playerAnalysis].sort((a, b) => b.range - a.range);
  const oppVulnerable = [...oppAnalysis].sort((a, b) => b.avg - a.avg);
  const oppThreats = [...oppAnalysis].sort((a, b) => a.avg - b.avg);

  return `
    <div class="strat-section">
      <h5>Defender Priorities <small>(safe picks)</small></h5>
      <ol class="strat-list">${defenderCandidates.slice(0, 3).map(p => `<li><strong class="team-a-color">${escHTML(p.faction)}</strong> — Range: ${p.min}-${p.max}, Avg: ${p.avg.toFixed(1)} <span class="strat-tag strat-safe">Safe</span></li>`).join('')}</ol>
    </div>
    <div class="strat-section">
      <h5>Attacker Priorities <small>(target specific opponents)</small></h5>
      <ol class="strat-list">${attackerCandidates.slice(0, 3).map(p => {
        const bestJ = p.scores.indexOf(Math.max(...p.scores));
        return `<li><strong class="team-a-color">${escHTML(p.faction)}</strong> — Best: ${Math.max(...p.scores)} vs <strong class="team-b-color">${escHTML(oppP[bestJ]?.faction || '?')}</strong>, Worst: ${p.min} <span class="strat-tag strat-attack">High impact</span></li>`;
      }).join('')}</ol>
    </div>
    <div class="strat-section">
      <h5>Opponent Vulnerabilities <small>(target these)</small></h5>
      <ol class="strat-list">${oppVulnerable.slice(0, 3).map(p => `<li><strong class="team-b-color">${escHTML(p.faction)}</strong> — Avg: ${p.avg.toFixed(1)} (${p.min}-${p.max}) <span class="strat-tag strat-target">Target</span></li>`).join('')}</ol>
    </div>
    <div class="strat-section">
      <h5>Opponent Threats <small>(protect against)</small></h5>
      <ol class="strat-list">${oppThreats.slice(0, 3).map(p => `<li><strong class="team-b-color">${escHTML(p.faction)}</strong> — Avg: ${p.avg.toFixed(1)} (${p.min}-${p.max}) <span class="strat-tag strat-danger">Dangerous</span></li>`).join('')}</ol>
    </div>
  `;
}

// --- Hungarian Algorithm ---

function hungarianMax(matrix) {
  const n = matrix.length;
  return hungarianMin_internal(matrix.map(row => row.map(v => -v)));
}
function hungarianMin(matrix) { return hungarianMin_internal(matrix); }

function hungarianMin_internal(cost) {
  const n = cost.length;
  const u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i; let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);
    do {
      used[j0] = true; let i0 = p[j0], delta = Infinity, j1;
      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else { minv[j] -= delta; }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const result = new Array(n);
  for (let j = 1; j <= n; j++) result[p[j] - 1] = j - 1;
  return result;
}

function getAllPermutations(n) {
  const result = []; const arr = Array.from({ length: n }, (_, i) => i);
  function permute(start) {
    if (start === n) { result.push([...arr]); return; }
    for (let i = start; i < n; i++) { [arr[start], arr[i]] = [arr[i], arr[start]]; permute(start + 1); [arr[start], arr[i]] = [arr[i], arr[start]]; }
  }
  permute(0); return result;
}

// ===========================
// Navigation
// ===========================

function bindNavigation() {
  document.querySelectorAll('.phase-btn').forEach(btn => {
    btn.addEventListener('click', () => showPhase(btn.dataset.phase));
  });
}

function showPhase(name) {
  document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.phase-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`phase-${name}`).classList.add('active');
  document.querySelector(`[data-phase="${name}"]`).classList.add('active');

  // Refresh content when switching tabs
  if (name === 'tableprefs') renderTablePrefsTab();
  if (name === 'prep') { populateCountryDropdown(); if (currentPrepCountry) renderPrepMatrix(); }
  if (name === 'round') { populateRoundOpponents(); buildRoundMatrix(); updateTablesPreview(); }
  if (name === 'coaching') { populateCoachingRoundSelect(); renderCoachingTab(); }
  if (name === 'overview') renderOverview();
}

// ===========================
// Tooltips
// ===========================

function initMapTooltip() {
  const mapTip = document.getElementById('map-tooltip');
  const mapImg = document.getElementById('map-tooltip-img');
  const mapLabel = document.getElementById('map-tooltip-label');
  const listTip = document.getElementById('list-tooltip');
  const listHeader = document.getElementById('list-tooltip-header');
  const listBody = document.getElementById('list-tooltip-body');

  document.addEventListener('mouseover', (e) => {
    const mapTarget = e.target.closest('.map-hoverable');
    if (mapTarget) {
      const mapId = mapTarget.dataset.mapId;
      if (mapId) { mapImg.src = `maps/${mapId}.jpg`; mapLabel.textContent = mapTarget.dataset.mapName || ''; mapTip.classList.add('visible'); positionTooltip(e, mapTip, 480, 360); }
      return;
    }
    const playerTarget = e.target.closest('.player-hoverable');
    if (playerTarget) {
      const playerId = playerTarget.dataset.playerId;
      if (!playerId) return;
      const player = getPlayerData(playerId);
      if (!player || !player.armyList) return;
      listHeader.textContent = player.faction;
      listBody.textContent = player.armyList;
      listTip.classList.add('visible');
      positionTooltip(e, listTip, 400, 300);
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (mapTip.classList.contains('visible')) positionTooltip(e, mapTip, 480, 360);
    if (listTip.classList.contains('visible')) positionTooltip(e, listTip, 400, 300);
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.map-hoverable')) mapTip.classList.remove('visible');
    if (e.target.closest('.player-hoverable')) listTip.classList.remove('visible');
  });
}

function getPlayerData(id) {
  return teamAData.find(p => p.id === id) || teamBData.find(p => p.id === id);
}

function positionTooltip(e, tooltip, tw, th) {
  const pad = 16; tw = tw || 480; th = th || 360;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + tw > window.innerWidth) x = e.clientX - tw - pad;
  if (y + th > window.innerHeight) y = e.clientY - th - pad;
  if (x < 0) x = pad; if (y < 0) y = pad;
  tooltip.style.left = x + 'px'; tooltip.style.top = y + 'px';
}

function mapNameHTML(mapId, mapName) {
  if (!mapId) return mapName || '—';
  return `<span class="map-hoverable" data-map-id="${mapId}" data-map-name="${escHTML(mapName)}">${escHTML(mapName)}</span>`;
}

function playerHTML(playerId, faction) {
  const player = getPlayerData(playerId);
  const hasList = player && player.armyList;
  if (hasList) return `<span class="player-hoverable" data-player-id="${playerId}">${escHTML(faction)}</span>`;
  return escHTML(faction);
}

// ===========================
// Utilities
// ===========================

function getPlayerFlags(id) {
  // For team B players, get flags from the current round's opponent data
  if (!id || !id.startsWith('b')) return [];
  const idx = parseInt(id.replace('b', ''));
  const oppName = document.getElementById('round-opponent')?.value;
  if (oppName && appState.opponents[oppName] && appState.opponents[oppName].players[idx]) {
    return appState.opponents[oppName].players[idx].flags || [];
  }
  return [];
}

function playerFlagIcons(id) {
  const flags = getPlayerFlags(id);
  if (!flags.length) return '';
  return ' ' + flags.map(fl => fl === 'unknown' ? '❓' : fl === 'danger' ? '⚠️' : fl === 'wildcard' ? '🃏' : '').join('');
}

function formatMatchType(type) {
  if (type === 'champions_pairing') return '👑 Champion\'s Pairing';
  if (type === 'refused_vs_refused') return 'Refused vs Refused';
  if (type === 'defender_vs_attacker') return 'Defender vs Attacker';
  return (type || '').replace(/_/g, ' ');
}

function escHTML(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function showToast(msg) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.style.cssText = 'padding:12px 20px;background:#1a1a2e;border:1px solid #ffd600;border-radius:8px;color:#e8e8f0;font-size:0.85rem;font-family:Inter,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,0.4);animation:fadeIn 0.3s ease;';
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; setTimeout(() => toast.remove(), 300); }, 2500);
}

function addListToggle(container) {
  container.querySelectorAll('.btn-list-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const wrap = document.getElementById(targetId.replace('list-', 'list-wrap-'));
      if (wrap) { const isOpen = wrap.style.display !== 'none'; wrap.style.display = isOpen ? 'none' : ''; btn.classList.toggle('active', !isOpen); }
    });
  });
}

function ensureFactionDatalist() {
  if (document.getElementById('faction-list')) return;
  const dl = document.createElement('datalist');
  dl.id = 'faction-list';
  FACTIONS_40K.forEach(f => { const opt = document.createElement('option'); opt.value = f; dl.appendChild(opt); });
  document.body.appendChild(dl);
}

function pickTeamFactions() {
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const nonSM = shuffle(UNIQUE_FACTIONS);
  const smChapter = shuffle(SPACE_MARINE_CHAPTERS)[0];
  const picked = nonSM.slice(0, 7);
  picked.push(smChapter);
  return shuffle(picked);
}

function randomScore() {
  const r = Math.random() * 100;
  if (r < 5) return Math.floor(Math.random() * 3);
  if (r < 30) return 3 + Math.floor(Math.random() * 5);
  if (r < 70) return 8 + Math.floor(Math.random() * 5);
  if (r < 95) return 13 + Math.floor(Math.random() * 5);
  return 18 + Math.floor(Math.random() * 3);
}

// --- Boot is handled at top of file via login gate ---
