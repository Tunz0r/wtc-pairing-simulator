// ============================================
// WTC 8-Man Pairing Simulator — Main App
// ============================================

let engine = null;
let teamAData = [];
let teamBData = [];
let tablesData = [];
let roundDeployment = '';
let roundMission = '';
let matchupScores = {};      // "a{i}_b{j}" → score (0–20)
let matchupVolatility = {};  // "a{i}_b{j}" → volatility (0–5)
let matchupTablePrefs = {};  // "a{i}_b{j}" → { tableIdx: 'good'|'bad'|'neutral' }
let selectedMatrixCell = null; // currently selected cell key for table prefs

// --- Initialization ---

function init() {
  buildPlayerInputs('team-a-players', 'a');
  buildPlayerInputs('team-b-players', 'b');
  buildRoundConfig();
  bindNavigation();
  bindPhaseActions();
  initMapTooltip();
  buildMatrix();

  // Rebuild matrix headers when factions change
  document.querySelectorAll('.player-faction').forEach(input => {
    input.addEventListener('change', () => buildMatrix());
  });
}

// --- Player Input Setup ---

function buildPlayerInputs(containerId, team) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  for (let i = 0; i < 8; i++) {
    const wrapper = document.createElement('div');
    wrapper.className = 'player-entry';
    wrapper.innerHTML = `
      <div class="player-row">
        <span class="player-num">${i + 1}</span>
        <input type="text" class="player-faction" id="${team}-faction-${i}" placeholder="Army / Faction" list="faction-list" />
        <button type="button" class="btn-list-toggle" data-target="${team}-list-${i}" title="Army List">&#9776;</button>
      </div>
      <div class="army-list-wrap" id="${team}-list-wrap-${i}" style="display:none">
        <textarea class="army-list-input" id="${team}-list-${i}" placeholder="Paste army list here..." rows="8"></textarea>
      </div>
    `;
    container.appendChild(wrapper);
  }

  // Toggle army list textareas
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn-list-toggle');
    if (!btn) return;
    const targetId = btn.dataset.target;
    const wrap = document.getElementById(targetId.replace('list-', 'list-wrap-'));
    if (wrap) {
      const isOpen = wrap.style.display !== 'none';
      wrap.style.display = isOpen ? 'none' : '';
      btn.classList.toggle('active', !isOpen);
    }
  });

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
    document.getElementById(`a-faction-${i}`).value = factionsA[i];
    document.getElementById(`b-faction-${i}`).value = factionsB[i];
  }

  document.getElementById('team-a-name').value = 'Waaagh Warriors';
  document.getElementById('team-b-name').value = 'Hive Fleet Sigma';

  buildMatrix();
}

// --- Matchup Matrix ---

function getMatrixPlayers() {
  const a = [], b = [];
  for (let i = 0; i < 8; i++) {
    a.push({ faction: document.getElementById(`a-faction-${i}`).value.trim() || '?' });
    b.push({ faction: document.getElementById(`b-faction-${i}`).value.trim() || '?' });
  }
  return { a, b };
}

function buildMatrix() {
  const thead = document.getElementById('matrix-thead');
  const tbody = document.getElementById('matrix-tbody');
  const { a: teamA, b: teamB } = getMatrixPlayers();

  // Header row
  let headerHTML = '<tr><th class="matrix-corner"></th>';
  for (let j = 0; j < 8; j++) {
    headerHTML += `<th class="col-header team-b-color" title="${teamB[j].faction}">${teamB[j].faction}</th>`;
  }
  headerHTML += '</tr>';
  thead.innerHTML = headerHTML;

  // Body rows with score + volatility
  let bodyHTML = '';
  for (let i = 0; i < 8; i++) {
    bodyHTML += `<tr>`;
    bodyHTML += `<th class="row-header team-a-color" title="${teamA[i].faction}">${teamA[i].faction}</th>`;
    for (let j = 0; j < 8; j++) {
      const key = `a${i}_b${j}`;
      const score = matchupScores[key] !== undefined ? matchupScores[key] : '';
      const vol = matchupVolatility[key] !== undefined ? matchupVolatility[key] : '';
      const cls = getMatrixCellClass(score);
      const hasTablePrefs = matchupTablePrefs[key] && Object.keys(matchupTablePrefs[key]).length > 0;
      const selClass = selectedMatrixCell === key ? ' matrix-cell-selected' : '';
      const tpIndicator = hasTablePrefs ? '<span class="tp-dot" title="Has table preferences">&#9679;</span>' : '';
      bodyHTML += `<td class="${cls}${selClass}" data-key="${key}">
        <div class="cell-inputs">
          <input type="number" class="matrix-input" data-key="${key}" min="0" max="20" value="${score}" placeholder="—" title="Expected score (0–20)">
          <input type="number" class="matrix-vol" data-key="${key}" min="0" max="5" value="${vol}" placeholder="V" title="Volatility (0–5)">
        </div>
        ${tpIndicator}
      </td>`;
    }
    bodyHTML += '</tr>';
  }
  tbody.innerHTML = bodyHTML;

  // Score input handlers
  tbody.querySelectorAll('.matrix-input').forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      const key = e.target.dataset.key;
      if (val === '') {
        delete matchupScores[key];
      } else {
        val = Math.max(0, Math.min(20, parseInt(val) || 0));
        e.target.value = val;
        matchupScores[key] = val;
      }
      updateCellColor(e.target.closest('td'), key);
    });
    // Prevent click from bubbling to cell selector
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  // Volatility input handlers
  tbody.querySelectorAll('.matrix-vol').forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.trim();
      const key = e.target.dataset.key;
      if (val === '') {
        delete matchupVolatility[key];
      } else {
        val = Math.max(0, Math.min(5, parseInt(val) || 0));
        e.target.value = val;
        matchupVolatility[key] = val;
      }
    });
    input.addEventListener('click', (e) => e.stopPropagation());
  });

  // Cell click → select for table prefs
  tbody.querySelectorAll('td[data-key]').forEach(td => {
    td.addEventListener('click', () => {
      const key = td.dataset.key;
      if (selectedMatrixCell === key) {
        selectedMatrixCell = null;
      } else {
        selectedMatrixCell = key;
      }
      // Update selection highlight
      tbody.querySelectorAll('td[data-key]').forEach(c => c.classList.toggle('matrix-cell-selected', c.dataset.key === selectedMatrixCell));
      renderTablePrefsPanel();
    });
  });

  renderTablePrefsPanel();
}

function updateCellColor(td, key) {
  const val = matchupScores[key];
  // Remove old color classes, keep selected
  td.className = getMatrixCellClass(val) + (selectedMatrixCell === key ? ' matrix-cell-selected' : '');
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

function renderTablePrefsPanel() {
  const panel = document.getElementById('table-prefs-panel');
  if (!selectedMatrixCell) {
    panel.style.display = 'none';
    return;
  }

  const key = selectedMatrixCell;
  const [aIdx, bIdx] = key.replace('a','').split('_b').map(Number);
  const { a: teamA, b: teamB } = getMatrixPlayers();
  const prefs = matchupTablePrefs[key] || {};

  // Get current deployment to show table/map names
  const dep = document.getElementById('round-deployment').value;
  const maps = dep ? WTC_MAPS[dep] : null;

  let html = `
    <div class="tp-header">
      <span class="team-a-color">${teamA[aIdx].faction}</span>
      <span class="tp-vs">vs</span>
      <span class="team-b-color">${teamB[bIdx].faction}</span>
      <span class="tp-label">— Table Preferences for Team A</span>
    </div>
    <div class="tp-buttons">
  `;

  for (let t = 0; t < 8; t++) {
    const pref = prefs[t] || 'neutral';
    const mapIdx = typeof WTC_TABLE_MAP_INDICES !== 'undefined' ? WTC_TABLE_MAP_INDICES[t] : t;
    const mapName = maps ? maps[mapIdx].name : `Table ${t + 1}`;
    const label = `T${t + 1}`;
    html += `
      <button class="tp-btn tp-${pref}" data-table="${t}" data-key="${key}" title="${mapName}">
        <strong>${label}</strong>
        <small>${mapName}</small>
        <span class="tp-state">${pref === 'good' ? '✓' : pref === 'bad' ? '✗' : '—'}</span>
      </button>
    `;
  }

  html += `</div>
    <p class="tp-hint">Click to cycle: neutral → good → bad → neutral</p>
  `;

  panel.innerHTML = html;
  panel.style.display = '';

  // Button handlers
  panel.querySelectorAll('.tp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = parseInt(btn.dataset.table);
      const k = btn.dataset.key;
      if (!matchupTablePrefs[k]) matchupTablePrefs[k] = {};
      const current = matchupTablePrefs[k][t] || 'neutral';
      const next = current === 'neutral' ? 'good' : current === 'good' ? 'bad' : 'neutral';
      if (next === 'neutral') {
        delete matchupTablePrefs[k][t];
      } else {
        matchupTablePrefs[k][t] = next;
      }
      renderTablePrefsPanel();
      // Update dot indicator in matrix
      const td = document.querySelector(`td[data-key="${k}"]`);
      if (td) {
        let dot = td.querySelector('.tp-dot');
        const hasPrefs = matchupTablePrefs[k] && Object.keys(matchupTablePrefs[k]).length > 0;
        if (hasPrefs && !dot) {
          dot = document.createElement('span');
          dot.className = 'tp-dot';
          dot.title = 'Has table preferences';
          dot.innerHTML = '&#9679;';
          td.appendChild(dot);
        } else if (!hasPrefs && dot) {
          dot.remove();
        }
      }
    });
  });
}

// --- Optimal Pairing Algorithm ---

function runOptimalPairing() {
  const resultsEl = document.getElementById('algorithm-results');

  // Validate: need all 64 scores
  let missing = 0;
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      if (matchupScores[`a${i}_b${j}`] === undefined) missing++;
    }
  }
  if (missing > 0) {
    resultsEl.innerHTML = `<p class="algo-error">Please fill in all ${missing} missing matchup scores first.</p>`;
    resultsEl.style.display = '';
    return;
  }

  const { a: teamA, b: teamB } = getMatrixPlayers();

  // Build score matrix [i][j] = Team A's expected score when a[i] faces b[j]
  const S = [];
  const V = [];
  for (let i = 0; i < 8; i++) {
    S[i] = [];
    V[i] = [];
    for (let j = 0; j < 8; j++) {
      S[i][j] = matchupScores[`a${i}_b${j}`];
      V[i][j] = matchupVolatility[`a${i}_b${j}`] || 0;
    }
  }

  // Use Hungarian algorithm to find optimal assignment (maximize Team A score)
  const bestAssignment = hungarianMax(S);
  const bestTotal = bestAssignment.reduce((sum, j, i) => sum + S[i][j], 0);

  // Also find worst case (minimize Team A = maximize Team B)
  const worstAssignment = hungarianMin(S);
  const worstTotal = worstAssignment.reduce((sum, j, i) => sum + S[i][j], 0);

  // Find top 5 assignments by brute force sampling (full brute force for 8! = 40320)
  const allPerms = getAllPermutations(8);
  const scored = allPerms.map(perm => ({
    perm,
    total: perm.reduce((sum, j, i) => sum + S[i][j], 0),
    avgVol: perm.reduce((sum, j, i) => sum + V[i][j], 0) / 8,
  }));
  scored.sort((a, b) => b.total - a.total);

  const top5 = scored.slice(0, 5);
  const bottom5 = scored.slice(-5).reverse();
  const avg = scored.reduce((s, x) => s + x.total, 0) / scored.length;

  // Generate pairing strategy recommendations
  const strategy = generatePairingStrategy(S, V, teamA, teamB, bestAssignment);

  // Render results
  let html = `
    <h3>Optimal Pairing Analysis</h3>
    <div class="algo-summary">
      <div class="algo-stat algo-stat-best">
        <span class="algo-stat-label">Best Case</span>
        <span class="algo-stat-value">${bestTotal}</span>
      </div>
      <div class="algo-stat algo-stat-avg">
        <span class="algo-stat-label">Average</span>
        <span class="algo-stat-value">${avg.toFixed(1)}</span>
      </div>
      <div class="algo-stat algo-stat-worst">
        <span class="algo-stat-label">Worst Case</span>
        <span class="algo-stat-value">${worstTotal}</span>
      </div>
    </div>

    <h4>Best Pairing for Team A</h4>
    <table class="algo-table">
      <thead><tr><th>Team A</th><th>Team B</th><th>Score</th><th>Vol</th></tr></thead>
      <tbody>
        ${bestAssignment.map((j, i) => `
          <tr>
            <td class="team-a-color">${teamA[i].faction}</td>
            <td class="team-b-color">${teamB[j].faction}</td>
            <td class="${getMatrixCellClass(S[i][j])}" style="font-weight:700;text-align:center">${S[i][j]}</td>
            <td style="text-align:center">${V[i][j] ? '±' + V[i][j] : '—'}</td>
          </tr>
        `).join('')}
        <tr class="algo-total-row">
          <td colspan="2"><strong>Total</strong></td>
          <td style="text-align:center"><strong>${bestTotal}</strong></td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <h4>Worst Pairing for Team A <small>(opponent's ideal)</small></h4>
    <table class="algo-table">
      <thead><tr><th>Team A</th><th>Team B</th><th>Score</th><th>Vol</th></tr></thead>
      <tbody>
        ${worstAssignment.map((j, i) => `
          <tr>
            <td class="team-a-color">${teamA[i].faction}</td>
            <td class="team-b-color">${teamB[j].faction}</td>
            <td class="${getMatrixCellClass(S[i][j])}" style="font-weight:700;text-align:center">${S[i][j]}</td>
            <td style="text-align:center">${V[i][j] ? '±' + V[i][j] : '—'}</td>
          </tr>
        `).join('')}
        <tr class="algo-total-row">
          <td colspan="2"><strong>Total</strong></td>
          <td style="text-align:center"><strong>${worstTotal}</strong></td>
          <td></td>
        </tr>
      </tbody>
    </table>

    <h4>Pairing Strategy Recommendations</h4>
    <div class="algo-strategy">
      ${strategy}
    </div>
  `;

  resultsEl.innerHTML = html;
  resultsEl.style.display = '';
}

function generatePairingStrategy(S, V, teamA, teamB, optimalAssignment) {
  // Analyze which players are "flexible" (small range) vs "critical" (big range)
  const playerAnalysis = [];
  for (let i = 0; i < 8; i++) {
    const scores = S[i].slice();
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / 8;
    const range = max - min;
    playerAnalysis.push({ idx: i, faction: teamA[i].faction, min, max, avg, range, scores });
  }

  // Opponent analysis
  const oppAnalysis = [];
  for (let j = 0; j < 8; j++) {
    const scores = S.map(row => row[j]);
    const min = Math.min(...scores);
    const max = Math.max(...scores);
    const avg = scores.reduce((a, b) => a + b, 0) / 8;
    oppAnalysis.push({ idx: j, faction: teamB[j].faction, min, max, avg });
  }

  // Defender recommendation: put forward a player who is "safe" — small range, decent average
  // The ideal defender is one whose worst matchup isn't terrible and who doesn't have a critical best matchup
  const defenderCandidates = [...playerAnalysis].sort((a, b) => {
    // Prefer players with high minimum scores (safe) and low range (not polarized)
    const safeA = a.min * 2 - a.range;
    const safeB = b.min * 2 - b.range;
    return safeB - safeA;
  });

  // Attacker recommendation: players with the most polarized matchups (high range, low min)
  // These are players you want to target specific opponents with
  const attackerCandidates = [...playerAnalysis].sort((a, b) => b.range - a.range);

  // Opponent vulnerability: which Team B players give Team A the most points on average
  const oppVulnerable = [...oppAnalysis].sort((a, b) => b.avg - a.avg);

  // Opponent threats: which Team B players take the most from Team A
  const oppThreats = [...oppAnalysis].sort((a, b) => a.avg - b.avg);

  let html = `
    <div class="strat-section">
      <h5>Defender Priorities <small>(safe, unpunishable picks)</small></h5>
      <ol class="strat-list">
        ${defenderCandidates.slice(0, 3).map(p => `
          <li>
            <strong class="team-a-color">${p.faction}</strong> —
            Range: ${p.min}–${p.max}, Avg: ${p.avg.toFixed(1)}
            <span class="strat-tag strat-safe">Safe pick</span>
          </li>
        `).join('')}
      </ol>
    </div>

    <div class="strat-section">
      <h5>Attacker Priorities <small>(target specific opponents)</small></h5>
      <ol class="strat-list">
        ${attackerCandidates.slice(0, 3).map(p => {
          const bestJ = p.scores.indexOf(Math.max(...p.scores));
          return `
            <li>
              <strong class="team-a-color">${p.faction}</strong> —
              Best: ${Math.max(...p.scores)} vs <strong class="team-b-color">${teamB[bestJ].faction}</strong>,
              Worst: ${p.min}
              <span class="strat-tag strat-attack">High impact</span>
            </li>
          `;
        }).join('')}
      </ol>
    </div>

    <div class="strat-section">
      <h5>Opponent Vulnerabilities <small>(target these)</small></h5>
      <ol class="strat-list">
        ${oppVulnerable.slice(0, 3).map(p => `
          <li>
            <strong class="team-b-color">${p.faction}</strong> —
            Avg score for us: ${p.avg.toFixed(1)} (${p.min}–${p.max})
            <span class="strat-tag strat-target">Target</span>
          </li>
        `).join('')}
      </ol>
    </div>

    <div class="strat-section">
      <h5>Opponent Threats <small>(protect against)</small></h5>
      <ol class="strat-list">
        ${oppThreats.slice(0, 3).map(p => `
          <li>
            <strong class="team-b-color">${p.faction}</strong> —
            Avg score for us: ${p.avg.toFixed(1)} (${p.min}–${p.max})
            <span class="strat-tag strat-danger">Dangerous</span>
          </li>
        `).join('')}
      </ol>
    </div>
  `;

  return html;
}

// --- Hungarian Algorithm (Kuhn-Munkres) for assignment ---

function hungarianMax(matrix) {
  // Convert to minimization by negating
  const n = matrix.length;
  const neg = matrix.map(row => row.map(v => -v));
  return hungarianMin_internal(neg);
}

function hungarianMin(matrix) {
  return hungarianMin_internal(matrix);
}

function hungarianMin_internal(cost) {
  const n = cost.length;
  // Pad to square if needed (already 8x8)
  const u = new Array(n + 1).fill(0);
  const v = new Array(n + 1).fill(0);
  const p = new Array(n + 1).fill(0);
  const way = new Array(n + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array(n + 1).fill(Infinity);
    const used = new Array(n + 1).fill(false);

    do {
      used[j0] = true;
      let i0 = p[j0], delta = Infinity, j1;

      for (let j = 1; j <= n; j++) {
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      }

      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }

      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }

  // Extract assignment: result[i] = j (0-indexed)
  const result = new Array(n);
  for (let j = 1; j <= n; j++) {
    result[p[j] - 1] = j - 1;
  }
  return result;
}

// Generate all permutations of [0..n-1]
function getAllPermutations(n) {
  const result = [];
  const arr = Array.from({ length: n }, (_, i) => i);

  function permute(start) {
    if (start === n) {
      result.push([...arr]);
      return;
    }
    for (let i = start; i < n; i++) {
      [arr[start], arr[i]] = [arr[i], arr[start]];
      permute(start + 1);
      [arr[start], arr[i]] = [arr[i], arr[start]];
    }
  }

  permute(0);
  return result;
}

// --- Matrix Reference (read-only for pairing phase) ---

function buildMatrixReference() {
  const body = document.getElementById('matrix-ref-body');
  if (!teamAData.length || !teamBData.length) {
    body.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No team data yet.</p>';
    return;
  }

  let html = `
    <div class="matrix-legend">
      <span class="legend-item legend-brown">0–2</span>
      <span class="legend-item legend-red">3–7</span>
      <span class="legend-item legend-yellow">8–12</span>
      <span class="legend-item legend-green">13–17</span>
      <span class="legend-item legend-blue">18–20</span>
    </div>
    <table class="matchup-matrix">
      <thead><tr><th></th>`;

  teamBData.forEach(p => {
    html += `<th class="col-header team-b-color">${p.faction}</th>`;
  });
  html += '</tr></thead><tbody>';

  teamAData.forEach((pA, i) => {
    html += `<tr><th class="row-header team-a-color">${pA.faction}</th>`;
    teamBData.forEach((pB, j) => {
      const key = `a${i}_b${j}`;
      const val = matchupScores[key];
      const vol = matchupVolatility[key];
      const cls = getMatrixCellClass(val);
      const display = val !== undefined ? val : '—';
      const volDisplay = vol !== undefined ? `<small class="ref-vol">±${vol}</small>` : '';
      html += `<td class="${cls}" style="font-weight:700;text-align:center">${display}${volDisplay}</td>`;
    });
    html += '</tr>';
  });

  html += '</tbody></table>';
  body.innerHTML = html;
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
  document.getElementById('btn-run-algo').addEventListener('click', runOptimalPairing);
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
    const factionA = document.getElementById(`a-faction-${i}`).value.trim() || 'Unknown';
    const listA = document.getElementById(`a-list-${i}`).value.trim();
    teamAData.push({ id: `a${i}`, faction: factionA, armyList: listA });

    const factionB = document.getElementById(`b-faction-${i}`).value.trim() || 'Unknown';
    const listB = document.getElementById(`b-list-${i}`).value.trim();
    teamBData.push({ id: `b${i}`, faction: factionB, armyList: listB });
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
        <strong>${playerHTML(match.playerA, pA.faction)}</strong>
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
        <strong>${playerHTML(match.playerB, pB.faction)}</strong>
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
    return `<div class="pool-player team-a-bg" data-id="${id}"><strong>${playerHTML(id, p.faction)}</strong></div>`;
  }).join('');

  poolBEl.innerHTML = state.poolB.map(id => {
    const p = engine.getPlayer(id);
    return `<div class="pool-player team-b-bg" data-id="${id}"><strong>${playerHTML(id, p.faction)}</strong></div>`;
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
            return `<button class="sel-btn" data-id="${id}">${p.faction}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="select-panel team-b-panel">
        <h3>${prompt.titleB}</h3>
        <div class="select-options" id="sel-b">
          ${prompt.optionsB.map(id => {
            const p = engine.getPlayer(id);
            return `<button class="sel-btn" data-id="${id}">${p.faction}</button>`;
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
            return `<button class="sel-btn" data-id="${id}">${p.faction}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="select-panel team-b-panel">
        <h3>${prompt.titleB}</h3>
        <p class="sel-hint">Select ${prompt.count} players</p>
        <div class="select-options" id="sel-b">
          ${prompt.optionsB.map(id => {
            const p = engine.getPlayer(id);
            return `<button class="sel-btn" data-id="${id}">${p.faction}</button>`;
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
        <p class="match-preview">${playerHTML(currentMatch.playerA, pA.faction)} vs ${playerHTML(currentMatch.playerB, pB.faction)}</p>
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
        <td class="team-a-cell">${playerHTML(match.playerA, pA.faction)}</td>
        <td class="vs-cell">vs</td>
        <td class="team-b-cell">${playerHTML(match.playerB, pB.faction)}</td>
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
  const mapTip = document.getElementById('map-tooltip');
  const mapImg = document.getElementById('map-tooltip-img');
  const mapLabel = document.getElementById('map-tooltip-label');

  const listTip = document.getElementById('list-tooltip');
  const listHeader = document.getElementById('list-tooltip-header');
  const listBody = document.getElementById('list-tooltip-body');

  document.addEventListener('mouseover', (e) => {
    // Map hover
    const mapTarget = e.target.closest('.map-hoverable');
    if (mapTarget) {
      const mapId = mapTarget.dataset.mapId;
      if (mapId) {
        mapImg.src = `maps/${mapId}.jpg`;
        mapLabel.textContent = mapTarget.dataset.mapName || '';
        mapTip.classList.add('visible');
        positionTooltip(e, mapTip, 480, 360);
      }
      return;
    }

    // Player hover
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
      return;
    }
  });

  document.addEventListener('mousemove', (e) => {
    if (mapTip.classList.contains('visible')) {
      positionTooltip(e, mapTip, 480, 360);
    }
    if (listTip.classList.contains('visible')) {
      positionTooltip(e, listTip, 400, 300);
    }
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('.map-hoverable')) {
      mapTip.classList.remove('visible');
    }
    if (e.target.closest('.player-hoverable')) {
      listTip.classList.remove('visible');
    }
  });
}

function getPlayerData(id) {
  return teamAData.find(p => p.id === id) || teamBData.find(p => p.id === id);
}

function positionTooltip(e, tooltip, tooltipW, tooltipH) {
  const pad = 16;
  tooltipW = tooltipW || 480;
  tooltipH = tooltipH || 360;

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
 */
function mapNameHTML(mapId, mapName) {
  if (!mapId) return mapName || '—';
  return `<span class="map-hoverable" data-map-id="${mapId}" data-map-name="${mapName}">${mapName}</span>`;
}

/**
 * Returns HTML for a player name that shows their army list on hover.
 */
function playerHTML(playerId, faction) {
  const player = getPlayerData(playerId);
  const hasList = player && player.armyList;
  if (hasList) {
    return `<span class="player-hoverable" data-player-id="${playerId}">${faction}</span>`;
  }
  return faction;
}

// --- Boot ---
document.addEventListener('DOMContentLoaded', init);
