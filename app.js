// ============================================
// WTC 8-Man Pairing Simulator — Main App
// ============================================

let engine = null;
let teamAData = [];
let teamBData = [];
let tablesData = [];
let roundDeployment = '';
let roundMission = '';

// --- Initialization ---

function init() {
  buildPlayerInputs('team-a-players', 'a');
  buildPlayerInputs('team-b-players', 'b');
  buildRoundConfig();
  bindNavigation();
  bindPhaseActions();
  initMapTooltip();
}

// --- Player Input Setup ---

function buildPlayerInputs(containerId, team) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const row = document.createElement('div');
    row.className = 'player-row';
    row.innerHTML = `
      <span class="player-num">${i + 1}</span>
      <input type="text" class="player-name" id="${team}-name-${i}" placeholder="Player ${i + 1} Name" />
      <input type="text" class="player-faction" id="${team}-faction-${i}" placeholder="Faction" list="faction-list" />
    `;
    container.appendChild(row);
  }

  // Add datalist for factions (once)
  if (!document.getElementById('faction-list')) {
    const dl = document.createElement('datalist');
    dl.id = 'faction-list';
    FACTIONS_40K.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      dl.appendChild(opt);
    });
    document.body.appendChild(dl);
  }
}

// --- Dummy Data ---

function fillDummyTeams() {
  const shuffle = arr => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  // Build a valid team of 8 unique factions.
  // Pick 7 from UNIQUE_FACTIONS + 1 SM chapter, or 8 from UNIQUE_FACTIONS.
  // We always include one SM chapter slot for variety.
  function pickTeamFactions() {
    const nonSM = shuffle(UNIQUE_FACTIONS);
    const smChapter = shuffle(SPACE_MARINE_CHAPTERS)[0];
    // Take 7 non-SM factions + 1 SM chapter
    const picked = nonSM.slice(0, 7);
    picked.push(smChapter);
    return shuffle(picked);
  }

  const factionsA = pickTeamFactions();
  const factionsB = pickTeamFactions();

  for (let i = 0; i < 8; i++) {
    document.getElementById(`a-name-${i}`).value = DUMMY_NAMES_A[i];
    document.getElementById(`a-faction-${i}`).value = factionsA[i];
    document.getElementById(`b-name-${i}`).value = DUMMY_NAMES_B[i];
    document.getElementById(`b-faction-${i}`).value = factionsB[i];
  }

  document.getElementById('team-a-name').value = 'Waaagh Warriors';
  document.getElementById('team-b-name').value = 'Hive Fleet Sigma';
}

// --- Round Config (Deployment + Mission) ---

function buildRoundConfig() {
  const depSelect = document.getElementById('round-deployment');
  depSelect.innerHTML = `
    <option value="">— Select Deployment —</option>
    ${WTC_DEPLOYMENTS.map(d => `<option value="${d}">${d}</option>`).join('')}
    <optgroup label="BETA">
      ${WTC_DEPLOYMENTS_BETA.map(d => `<option value="${d}">${d} (BETA)</option>`).join('')}
    </optgroup>
  `;

  const missionSelect = document.getElementById('round-mission');
  missionSelect.innerHTML = `
    <option value="">— Select Mission —</option>
    ${WTC_MISSIONS.map(m => `<option value="${m.id}">${m.name}</option>`).join('')}
  `;

  depSelect.addEventListener('change', updateTablesPreview);
  missionSelect.addEventListener('change', updateTablesPreview);

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

function randomizeRound() {
  const allDeps = [...WTC_DEPLOYMENTS];
  const dep = allDeps[Math.floor(Math.random() * allDeps.length)];
  document.getElementById('round-deployment').value = dep;

  const missions = [...WTC_MISSIONS];
  const mission = missions[Math.floor(Math.random() * missions.length)];
  document.getElementById('round-mission').value = mission.id;

  updateTablesPreview();
}

// --- Navigation ---

function bindNavigation() {
  document.querySelectorAll('.phase-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const phase = btn.dataset.phase;
      showPhase(phase);
    });
  });
}

function showPhase(phaseName) {
  document.querySelectorAll('.phase').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.phase-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`phase-${phaseName}`).classList.add('active');
  document.querySelector(`[data-phase="${phaseName}"]`).classList.add('active');
}

function bindPhaseActions() {
  document.getElementById('btn-fill-dummy').addEventListener('click', fillDummyTeams);
  document.getElementById('btn-to-tables').addEventListener('click', () => {
    if (collectTeamData()) showPhase('tables');
  });
  document.getElementById('btn-back-setup').addEventListener('click', () => showPhase('setup'));
  document.getElementById('btn-randomize-tables').addEventListener('click', randomizeRound);
  document.getElementById('btn-to-pairing').addEventListener('click', () => {
    if (collectTableData()) {
      startPairing();
      showPhase('pairing');
    }
  });
  document.getElementById('btn-back-tables').addEventListener('click', () => showPhase('tables'));
  document.getElementById('btn-reset-pairing').addEventListener('click', () => {
    startPairing();
  });
  document.getElementById('btn-back-pairing').addEventListener('click', () => showPhase('pairing'));
  document.getElementById('btn-new-round').addEventListener('click', () => {
    showPhase('setup');
  });
}

// --- Data Collection ---

function collectTeamData() {
  teamAData = [];
  teamBData = [];

  for (let i = 0; i < 8; i++) {
    const nameA = document.getElementById(`a-name-${i}`).value.trim() || `A-Player ${i + 1}`;
    const factionA = document.getElementById(`a-faction-${i}`).value.trim() || 'Unknown';
    teamAData.push({ id: `a${i}`, name: nameA, faction: factionA });

    const nameB = document.getElementById(`b-name-${i}`).value.trim() || `B-Player ${i + 1}`;
    const factionB = document.getElementById(`b-faction-${i}`).value.trim() || 'Unknown';
    teamBData.push({ id: `b${i}`, name: nameB, faction: factionB });
  }

  return true;
}

function collectTableData() {
  const dep = document.getElementById('round-deployment').value;
  const missionId = document.getElementById('round-mission').value;

  if (!dep) {
    alert('Please select a deployment zone.');
    return false;
  }
  if (!missionId) {
    alert('Please select a mission.');
    return false;
  }

  roundDeployment = dep;
  roundMission = WTC_MISSIONS.find(m => m.id === missionId)?.name || missionId;

  const maps = WTC_MAPS[dep];
  tablesData = [];

  for (let i = 0; i < 8; i++) {
    const mapIdx = WTC_TABLE_MAP_INDICES[i];
    const map = maps[mapIdx];
    tablesData.push({
      index: i,
      deployment: dep,
      map: map.name,
      mapId: map.id,
      mission: roundMission,
      missionId: missionId,
    });
  }

  return true;
}

// --- Pairing Process ---

function startPairing() {
  engine = new PairingEngine(teamAData, teamBData, tablesData);

  document.getElementById('board-team-a-name').textContent =
    document.getElementById('team-a-name').value || 'Team A';
  document.getElementById('board-team-b-name').textContent =
    document.getElementById('team-b-name').value || 'Team B';

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

    const row = document.createElement('div');
    row.className = 'match-row';
    row.innerHTML = `
      <div class="match-player team-a-bg">
        <strong>${pA.name}</strong>
        <span class="faction-tag">${pA.faction}</span>
      </div>
      <div class="match-info">
        <div class="match-number">#${idx + 1}</div>
        ${tableInfo ? `
          <div class="match-table">Table ${match.table + 1}</div>
          <div class="match-map">${mapNameHTML(tableInfo.mapId, tableInfo.map)}</div>
        ` : '<div class="match-table pending">Table TBD</div>'}
        <div class="match-type">${match.type.replace(/_/g, ' ')}</div>
      </div>
      <div class="match-player team-b-bg">
        <strong>${pB.name}</strong>
        <span class="faction-tag">${pB.faction}</span>
      </div>
    `;
    container.appendChild(row);
  });
}

function renderPools(state) {
  const poolAEl = document.getElementById('pool-a');
  const poolBEl = document.getElementById('pool-b');

  poolAEl.innerHTML = state.poolA.map(id => {
    const p = engine.getPlayer(id);
    return `<div class="pool-player team-a-bg" data-id="${id}"><strong>${p.name}</strong><span>${p.faction}</span></div>`;
  }).join('');

  poolBEl.innerHTML = state.poolB.map(id => {
    const p = engine.getPlayer(id);
    return `<div class="pool-player team-b-bg" data-id="${id}"><strong>${p.name}</strong><span>${p.faction}</span></div>`;
  }).join('');
}

function renderTableChoiceToken(state) {
  const section = document.getElementById('table-choice-section');
  const span = document.getElementById('table-choice-team');
  if (state.tableChoiceToken) {
    section.style.display = '';
    const teamName = state.tableChoiceToken === 'A'
      ? (document.getElementById('team-a-name').value || 'Team A')
      : (document.getElementById('team-b-name').value || 'Team B');
    span.textContent = teamName;
    span.className = state.tableChoiceToken === 'A' ? 'team-a-color' : 'team-b-color';
  } else {
    section.style.display = 'none';
  }
}

// --- Action Panel Rendering ---

function renderActionPanel(prompt, state) {
  // Clone and replace the panel to remove ALL stale event listeners
  const oldPanel = document.getElementById('action-content');
  const panel = oldPanel.cloneNode(false);
  oldPanel.parentNode.replaceChild(panel, oldPanel);

  switch (prompt.type) {
    case 'dual_select':
      renderDualSelect(panel, prompt);
      break;
    case 'dual_select_multi':
      renderDualSelectMulti(panel, prompt);
      break;
    case 'roll_off':
      renderRollOff(panel, prompt);
      break;
    case 'sequential_table_select':
    case 'sequential_table_select_r3':
      renderTableSelect(panel, prompt, state);
      break;
    case 'complete':
      renderComplete(panel, prompt);
      break;
    default:
      panel.innerHTML = `<p>Unknown step</p>`;
  }
}

function renderDualSelect(panel, prompt) {
  let selectedA = null;
  let selectedB = null;

  const html = `
    <div class="dual-panels">
      <div class="select-panel team-a-panel">
        <h3>${prompt.titleA}</h3>
        <div class="select-options" id="sel-a">
          ${prompt.optionsA.map(id => {
            const p = engine.getPlayer(id);
            return `<button class="sel-btn" data-id="${id}">${p.name}<br><small>${p.faction}</small></button>`;
          }).join('')}
        </div>
      </div>
      <div class="select-panel team-b-panel">
        <h3>${prompt.titleB}</h3>
        <div class="select-options" id="sel-b">
          ${prompt.optionsB.map(id => {
            const p = engine.getPlayer(id);
            return `<button class="sel-btn" data-id="${id}">${p.name}<br><small>${p.faction}</small></button>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="reveal-section" id="reveal-section" style="display:none">
      <p class="reveal-text">Both teams have made their secret choice.</p>
      <button class="btn btn-primary btn-reveal" id="btn-reveal">Reveal Simultaneously</button>
    </div>
  `;

  panel.innerHTML = html;

  panel.querySelectorAll('#sel-a .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('#sel-a .sel-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedA = btn.dataset.id;
      checkReady();
    });
  });

  panel.querySelectorAll('#sel-b .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panel.querySelectorAll('#sel-b .sel-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedB = btn.dataset.id;
      checkReady();
    });
  });

  function checkReady() {
    if (selectedA && selectedB) {
      document.getElementById('reveal-section').style.display = '';
    }
  }

  panel.addEventListener('click', (e) => {
    if (e.target.id === 'btn-reveal' || e.target.closest('#btn-reveal')) {
      const step = engine.step;
      let input;
      if (step === 'choose_defenders' || step === 'r3_choose_defenders') {
        input = { defenderA: selectedA, defenderB: selectedB };
      } else if (step === 'refuse_attackers' || step === 'r3_refuse_attackers') {
        input = { refuseA: selectedA, refuseB: selectedB };
      }
      const result = engine.processInput(input);
      if (result.success) {
        renderPairingState();
      } else {
        alert(result.error);
      }
    }
  });
}

function renderDualSelectMulti(panel, prompt) {
  let selectedA = [];
  let selectedB = [];

  const html = `
    <div class="dual-panels">
      <div class="select-panel team-a-panel">
        <h3>${prompt.titleA}</h3>
        <p class="sel-hint">Select ${prompt.count} players</p>
        <div class="select-options" id="sel-a">
          ${prompt.optionsA.map(id => {
            const p = engine.getPlayer(id);
            return `<button class="sel-btn" data-id="${id}">${p.name}<br><small>${p.faction}</small></button>`;
          }).join('')}
        </div>
      </div>
      <div class="select-panel team-b-panel">
        <h3>${prompt.titleB}</h3>
        <p class="sel-hint">Select ${prompt.count} players</p>
        <div class="select-options" id="sel-b">
          ${prompt.optionsB.map(id => {
            const p = engine.getPlayer(id);
            return `<button class="sel-btn" data-id="${id}">${p.name}<br><small>${p.faction}</small></button>`;
          }).join('')}
        </div>
      </div>
    </div>
    <div class="reveal-section" id="reveal-section" style="display:none">
      <p class="reveal-text">Both teams have chosen their attackers.</p>
      <button class="btn btn-primary btn-reveal" id="btn-reveal">Reveal Simultaneously</button>
    </div>
  `;

  panel.innerHTML = html;

  panel.querySelectorAll('#sel-a .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (selectedA.includes(id)) {
        selectedA = selectedA.filter(x => x !== id);
        btn.classList.remove('selected');
      } else if (selectedA.length < prompt.count) {
        selectedA.push(id);
        btn.classList.add('selected');
      }
      checkReady();
    });
  });

  panel.querySelectorAll('#sel-b .sel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      if (selectedB.includes(id)) {
        selectedB = selectedB.filter(x => x !== id);
        btn.classList.remove('selected');
      } else if (selectedB.length < prompt.count) {
        selectedB.push(id);
        btn.classList.add('selected');
      }
      checkReady();
    });
  });

  function checkReady() {
    if (selectedA.length === prompt.count && selectedB.length === prompt.count) {
      document.getElementById('reveal-section').style.display = '';
    } else {
      document.getElementById('reveal-section').style.display = 'none';
    }
  }

  panel.addEventListener('click', (e) => {
    if (e.target.id === 'btn-reveal' || e.target.closest('#btn-reveal')) {
      const result = engine.processInput({ attackersA: selectedA, attackersB: selectedB });
      if (result.success) {
        renderPairingState();
      } else {
        alert(result.error);
      }
    }
  });
}

function renderRollOff(panel, prompt) {
  const teamAName = document.getElementById('team-a-name').value || 'Team A';
  const teamBName = document.getElementById('team-b-name').value || 'Team B';

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

  document.getElementById('roll-a').addEventListener('click', () => {
    engine.processInput({ winner: 'A' });
    renderPairingState();
  });

  document.getElementById('roll-b').addEventListener('click', () => {
    engine.processInput({ winner: 'B' });
    renderPairingState();
  });
}

function renderTableSelect(panel, prompt, state) {
  // Get pending matches directly from engine (not state copies)
  const pendingMatches = engine.matches.filter(m => m.table === null);
  const available = [...engine.availableTables];

  if (pendingMatches.length === 0) {
    engine.processInput({ tableAssignments: [] });
    renderPairingState();
    return;
  }

  // Order: token holder's defender first
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
        matchIndex: engine.matches.indexOf(match),
        tableIndex: assignments[i].tableIndex,
      }));
      engine.processInput({ tableAssignments: finalAssignments });
      renderPairingState();
      return;
    }

    const currentMatch = orderedMatches[currentMatchIdx];
    const pA = engine.getPlayer(currentMatch.playerA);
    const pB = engine.getPlayer(currentMatch.playerB);
    const matchNum = engine.matches.indexOf(currentMatch) + 1;

    const whoChooses = currentMatch.defenderTeam === prompt.firstTeam ? 'Token holder\'s defender' : 'Other defender';

    panel.innerHTML = `
      <div class="table-select-section">
        <h3>Assign Table for Match #${matchNum}</h3>
        <p class="match-preview">${pA.name} (${pA.faction}) vs ${pB.name} (${pB.faction})</p>
        <p class="sel-hint">${whoChooses} chooses table</p>
        <div class="table-options" id="table-opts">
          ${remainingTables.map(tIdx => `
            <button class="table-btn" data-table="${tIdx}">
              <strong>Table ${tIdx + 1}</strong>
              <span>${mapNameHTML(tablesData[tIdx].mapId, tablesData[tIdx].map)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    panel.querySelectorAll('.table-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        assignments.push({ tableIndex: parseInt(btn.dataset.table) });
        buildUI();
      });
    });
  };

  buildUI();
}

function renderComplete(panel, prompt) {
  panel.innerHTML = `
    <div class="complete-section">
      <h3>All 8 Pairings Complete!</h3>
      <button class="btn btn-primary" id="btn-view-results">View Results Summary</button>
    </div>
  `;

  document.getElementById('btn-view-results').addEventListener('click', () => {
    renderResults();
    showPhase('results');
  });
}

// --- Results ---

function renderResults() {
  const container = document.getElementById('results-content');
  const state = engine.getState();
  const teamAName = document.getElementById('team-a-name').value || 'Team A';
  const teamBName = document.getElementById('team-b-name').value || 'Team B';

  let html = `
    <div class="results-header">
      <div class="team-a-color"><strong>${teamAName}</strong></div>
      <div>vs</div>
      <div class="team-b-color"><strong>${teamBName}</strong></div>
    </div>
    <div class="round-info-bar">
      <span>Deployment: <strong>${roundDeployment}</strong></span>
      <span>Mission: <strong>${roundMission}</strong></span>
    </div>
    <div class="results-table">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Table</th>
            <th>Map</th>
            <th>${teamAName}</th>
            <th>vs</th>
            <th>${teamBName}</th>
            <th>Type</th>
          </tr>
        </thead>
        <tbody>
  `;

  const sorted = [...state.matches].sort((a, b) => (a.table || 0) - (b.table || 0));

  sorted.forEach((match, i) => {
    const pA = engine.getPlayer(match.playerA);
    const pB = engine.getPlayer(match.playerB);
    const table = tablesData[match.table];
    html += `
      <tr>
        <td>${i + 1}</td>
        <td>Table ${match.table + 1}</td>
        <td>${table ? mapNameHTML(table.mapId, table.map) : '—'}</td>
        <td class="team-a-cell">${pA.name}<br><small>${pA.faction}</small></td>
        <td class="vs-cell">vs</td>
        <td class="team-b-cell">${pB.name}<br><small>${pB.faction}</small></td>
        <td><span class="type-badge">${match.type.replace(/_/g, ' ')}</span></td>
      </tr>
    `;
  });

  html += `</tbody></table></div>`;

  html += `
    <div class="event-log">
      <h3>Pairing Log</h3>
      <div class="log-entries">
        ${state.log.map(entry => `<div class="log-entry">${entry}</div>`).join('')}
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// --- Map Tooltip ---

function initMapTooltip() {
  const tooltip = document.getElementById('map-tooltip');
  const tooltipImg = document.getElementById('map-tooltip-img');
  const tooltipLabel = document.getElementById('map-tooltip-label');

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('.map-hoverable');
    if (!target) return;

    const mapId = target.dataset.mapId;
    if (!mapId) return;

    tooltipImg.src = `maps/${mapId}.jpg`;
    tooltipLabel.textContent = target.dataset.mapName || '';
    tooltip.classList.add('visible');
    positionTooltip(e, tooltip);
  });

  document.addEventListener('mousemove', (e) => {
    if (tooltip.classList.contains('visible')) {
      positionTooltip(e, tooltip);
    }
  });

  document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('.map-hoverable');
    if (target) {
      tooltip.classList.remove('visible');
    }
  });
}

function positionTooltip(e, tooltip) {
  const pad = 16;
  const tooltipW = 480;
  const tooltipH = 360;

  let x = e.clientX + pad;
  let y = e.clientY + pad;

  // Keep within viewport
  if (x + tooltipW > window.innerWidth) {
    x = e.clientX - tooltipW - pad;
  }
  if (y + tooltipH > window.innerHeight) {
    y = e.clientY - tooltipH - pad;
  }
  if (x < 0) x = pad;
  if (y < 0) y = pad;

  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

/**
 * Returns an HTML string for a map name that shows a preview on hover.
 * Use this everywhere a map name is displayed.
 */
function mapNameHTML(mapId, mapName) {
  if (!mapId) return mapName || '—';
  return `<span class="map-hoverable" data-map-id="${mapId}" data-map-name="${mapName}">${mapName}</span>`;
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', init);
