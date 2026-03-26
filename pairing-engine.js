/**
 * WTC 8-Man Pairing Engine
 *
 * Implements the full WTC pairing process as documented in the
 * WTC Pairings Visualized guide.
 *
 * The process has 3 pairing rounds:
 *   Round 1 (steps 1-4): Produces 2 matches, uses table choice token
 *   Round 2 (steps 5-repeat): Produces 2 more matches, token switches
 *   Round 3 (steps 6-8): Produces final 4 matches from remaining players
 */

class PairingEngine {
  constructor(teamA, teamB, tables) {
    // teamA/teamB: arrays of { id, faction }
    this.teamA = [...teamA];
    this.teamB = [...teamB];
    this.tables = [...tables]; // 8 tables with map/mission info

    // Pools of available players
    this.poolA = teamA.map(p => p.id);
    this.poolB = teamB.map(p => p.id);

    // Completed matches: { playerA, playerB, table, pairingType }
    this.matches = [];

    // Available tables
    this.availableTables = tables.map((_, i) => i);

    // Table choice token: 'A' or 'B'
    this.tableChoiceToken = null;

    // Current state machine
    this.round = 1; // 1, 2, or 3
    this.step = 'choose_defenders';

    // Temp state for current round
    this.defenderA = null;
    this.defenderB = null;
    this.attackersA = []; // Team A's attackers sent against Team B's defender
    this.attackersB = []; // Team B's attackers sent against Team A's defender
    this.refusedA = null; // The attacker from Team A that Team B refused
    this.refusedB = null; // The attacker from Team B that Team A refused
    this.acceptedA = null; // The attacker from Team A accepted to play vs Team B's defender
    this.acceptedB = null; // The attacker from Team B accepted to play vs Team A's defender

    // Round 3 special tracking
    this.round3DefenderA = null;
    this.round3DefenderB = null;
    this.round3AttackersA = [];
    this.round3AttackersB = [];
    this.round3RefusedA = null;
    this.round3RefusedB = null;
    this.round3LastA = null;
    this.round3LastB = null;

    // History log
    this.log = [];
  }

  getPlayer(id) {
    return this.teamA.find(p => p.id === id) || this.teamB.find(p => p.id === id);
  }

  getPlayerName(id) {
    const p = this.getPlayer(id);
    return p ? p.faction : id;
  }

  getState() {
    return {
      round: this.round,
      step: this.step,
      poolA: [...this.poolA],
      poolB: [...this.poolB],
      matches: [...this.matches],
      availableTables: [...this.availableTables],
      tableChoiceToken: this.tableChoiceToken,
      defenderA: this.defenderA,
      defenderB: this.defenderB,
      attackersA: [...this.attackersA],
      attackersB: [...this.attackersB],
      refusedA: this.refusedA,
      refusedB: this.refusedB,
      acceptedA: this.acceptedA,
      acceptedB: this.acceptedB,
      log: [...this.log],
      isComplete: this.step === 'complete',
    };
  }

  /**
   * Returns what the current step expects as input
   */
  getCurrentPrompt() {
    switch (this.step) {
      case 'choose_defenders':
        return {
          type: 'dual_select',
          titleA: 'Team A: Choose your Defender',
          titleB: 'Team B: Choose your Defender',
          optionsA: this.poolA,
          optionsB: this.poolB,
          simultaneous: true,
          description: `Both teams secretly choose their defender and reveal simultaneously.`,
        };

      case 'choose_attackers':
        return {
          type: 'dual_select_multi',
          titleA: `Team A: Choose 2 attackers to send against ${this.getPlayerName(this.defenderB)}`,
          titleB: `Team B: Choose 2 attackers to send against ${this.getPlayerName(this.defenderA)}`,
          optionsA: this.poolA.filter(id => id !== this.defenderA),
          optionsB: this.poolB.filter(id => id !== this.defenderB),
          count: 2,
          simultaneous: true,
          description: `Both teams secretly choose 2 attackers for the opponent's defender, then reveal simultaneously.`,
        };

      case 'roll_table_choice':
        return {
          type: 'roll_off',
          description: `First pairings are set! Captains now roll off to determine who gets the Table Choice token. The winner's defender picks their table first.`,
        };

      case 'refuse_attackers':
        return {
          type: 'dual_select',
          titleA: `Team A: Refuse one of Team B's attackers (attacking ${this.getPlayerName(this.defenderA)})`,
          titleB: `Team B: Refuse one of Team A's attackers (attacking ${this.getPlayerName(this.defenderB)})`,
          optionsA: this.attackersB,
          optionsB: this.attackersA,
          simultaneous: true,
          description: `Each team secretly chooses which of the 2 attackers to refuse. Refused attackers return to the pool.`,
        };

      case 'choose_tables_defenders':
        return {
          type: 'sequential_table_select',
          description: `Defenders choose their tables. The team with the Table Choice token picks first.`,
          firstTeam: this.tableChoiceToken,
          matches: this._getPendingTableMatches(),
          availableTables: this.availableTables,
        };

      // Round 3 specific steps
      case 'r3_choose_defenders':
        return {
          type: 'dual_select',
          titleA: 'Team A: Choose your Defender',
          titleB: 'Team B: Choose your Defender',
          optionsA: this.poolA,
          optionsB: this.poolB,
          simultaneous: true,
          description: `Round 3: Both teams choose defenders. Note: the last remaining player on each side will automatically be paired together.`,
        };

      case 'r3_choose_attackers':
        return {
          type: 'dual_select_multi',
          titleA: `Team A: Choose 2 attackers against ${this.getPlayerName(this.round3DefenderB)}`,
          titleB: `Team B: Choose 2 attackers against ${this.getPlayerName(this.round3DefenderA)}`,
          optionsA: this.poolA.filter(id => id !== this.round3DefenderA),
          optionsB: this.poolB.filter(id => id !== this.round3DefenderB),
          count: 2,
          simultaneous: true,
          description: `Both teams choose 2 attackers. The remaining unchosen player on each side auto-pairs for the 8th match.`,
        };

      case 'r3_refuse_attackers':
        return {
          type: 'dual_select',
          titleA: `Team A: Refuse one of Team B's attackers (attacking ${this.getPlayerName(this.round3DefenderA)})`,
          titleB: `Team B: Refuse one of Team A's attackers (attacking ${this.getPlayerName(this.round3DefenderB)})`,
          optionsA: this.round3AttackersB,
          optionsB: this.round3AttackersA,
          simultaneous: true,
          description: `Refuse one attacker each. Refused attackers face each other (7th match). Accepted attackers play defenders (5th & 6th matches).`,
        };

      case 'r3_choose_tables':
        return {
          type: 'sequential_table_select_r3',
          description: `Choose tables for the final 4 matches. Team with Table Choice token's defender picks first, then the other defender, then alternating for remaining matches (defenders first).`,
          firstTeam: this.tableChoiceToken,
          matches: this._getR3PendingTableMatches(),
          availableTables: this.availableTables,
        };

      case 'complete':
        return {
          type: 'complete',
          description: 'All 8 pairings are complete!',
          matches: this.matches,
        };

      default:
        return { type: 'unknown', description: `Unknown step: ${this.step}` };
    }
  }

  /**
   * Process user input for the current step
   */
  processInput(input) {
    switch (this.step) {
      case 'choose_defenders':
        return this._processDefenders(input.defenderA, input.defenderB);
      case 'choose_attackers':
        return this._processAttackers(input.attackersA, input.attackersB);
      case 'roll_table_choice':
        return this._processRollOff(input.winner);
      case 'refuse_attackers':
        return this._processRefusals(input.refuseA, input.refuseB);
      case 'choose_tables_defenders':
        return this._processTableChoices(input.tableAssignments);
      case 'r3_choose_defenders':
        return this._processR3Defenders(input.defenderA, input.defenderB);
      case 'r3_choose_attackers':
        return this._processR3Attackers(input.attackersA, input.attackersB);
      case 'r3_refuse_attackers':
        return this._processR3Refusals(input.refuseA, input.refuseB);
      case 'r3_choose_tables':
        return this._processR3Tables(input.tableAssignments);
      default:
        return { success: false, error: 'Invalid step' };
    }
  }

  // --- Round 1 & 2 Processing ---

  _processDefenders(defA, defB) {
    if (!this.poolA.includes(defA)) return { success: false, error: 'Invalid Team A defender' };
    if (!this.poolB.includes(defB)) return { success: false, error: 'Invalid Team B defender' };

    this.defenderA = defA;
    this.defenderB = defB;
    this.step = 'choose_attackers';

    this.log.push(`Round ${this.round}: Team A defends with ${this.getPlayerName(defA)}, Team B defends with ${this.getPlayerName(defB)}`);

    return { success: true };
  }

  _processAttackers(atkA, atkB) {
    if (atkA.length !== 2) return { success: false, error: 'Team A must choose exactly 2 attackers' };
    if (atkB.length !== 2) return { success: false, error: 'Team B must choose exactly 2 attackers' };

    this.attackersA = atkA; // Team A sends these against Team B's defender
    this.attackersB = atkB; // Team B sends these against Team A's defender

    this.log.push(`Round ${this.round}: Team A attacks with ${atkA.map(id => this.getPlayerName(id)).join(' & ')}`);
    this.log.push(`Round ${this.round}: Team B attacks with ${atkB.map(id => this.getPlayerName(id)).join(' & ')}`);

    // Always go to refuse next — roll-off happens after the first game is set
    this.step = 'refuse_attackers';

    return { success: true };
  }

  _processRollOff(winner) {
    if (winner !== 'A' && winner !== 'B') return { success: false, error: 'Winner must be A or B' };
    this.tableChoiceToken = winner;
    this.step = 'choose_tables_defenders';
    this.log.push(`Table Choice token goes to Team ${winner}`);
    return { success: true };
  }

  _processRefusals(refuseFromB, refuseFromA) {
    // Team A refuses one of Team B's attackers (that were attacking Team A's defender)
    if (!this.attackersB.includes(refuseFromB)) return { success: false, error: 'Invalid refusal from Team A' };
    // Team B refuses one of Team A's attackers (that were attacking Team B's defender)
    if (!this.attackersA.includes(refuseFromA)) return { success: false, error: 'Invalid refusal from Team B' };

    this.refusedB = refuseFromB; // The Team B attacker that was refused
    this.refusedA = refuseFromA; // The Team A attacker that was refused

    // Determine accepted attackers
    this.acceptedB = this.attackersB.find(id => id !== refuseFromB);
    this.acceptedA = this.attackersA.find(id => id !== refuseFromA);

    this.log.push(`Round ${this.round}: Team A refuses ${this.getPlayerName(refuseFromB)}, accepts ${this.getPlayerName(this.acceptedB)} vs defender ${this.getPlayerName(this.defenderA)}`);
    this.log.push(`Round ${this.round}: Team B refuses ${this.getPlayerName(refuseFromA)}, accepts ${this.getPlayerName(this.acceptedA)} vs defender ${this.getPlayerName(this.defenderB)}`);

    // Create the two matches (without tables yet)
    this.matches.push({
      playerA: this.defenderA,
      playerB: this.acceptedB,
      table: null,
      type: 'defender_vs_attacker',
      round: this.round,
      defenderTeam: 'A',
    });
    this.matches.push({
      playerA: this.acceptedA,
      playerB: this.defenderB,
      table: null,
      type: 'defender_vs_attacker',
      round: this.round,
      defenderTeam: 'B',
    });

    // Remove matched players from pools (but NOT refused players — they go back)
    this.poolA = this.poolA.filter(id => id !== this.defenderA && id !== this.acceptedA);
    this.poolB = this.poolB.filter(id => id !== this.defenderB && id !== this.acceptedB);

    // Roll-off happens after the first game is determined (Round 1 only)
    if (this.tableChoiceToken === null) {
      this.step = 'roll_table_choice';
    } else {
      this.step = 'choose_tables_defenders';
    }
    return { success: true };
  }

  _getPendingTableMatches() {
    return this.matches.filter(m => m.table === null);
  }

  _processTableChoices(assignments) {
    // assignments: array of { matchIndex, tableIndex }
    for (const { matchIndex, tableIndex } of assignments) {
      if (!this.availableTables.includes(tableIndex)) {
        return { success: false, error: `Table ${tableIndex + 1} is not available` };
      }
      this.matches[matchIndex].table = tableIndex;
      this.availableTables = this.availableTables.filter(t => t !== tableIndex);
      this.log.push(`Table ${tableIndex + 1} assigned: ${this.getPlayerName(this.matches[matchIndex].playerA)} vs ${this.getPlayerName(this.matches[matchIndex].playerB)}`);
    }

    // Move to next round
    if (this.round === 1) {
      this.round = 2;
      // Token switches
      this.tableChoiceToken = this.tableChoiceToken === 'A' ? 'B' : 'A';
      this.log.push(`Table Choice token passes to Team ${this.tableChoiceToken}`);
      this._resetRoundState();
      this.step = 'choose_defenders';
    } else if (this.round === 2) {
      this.round = 3;
      this._resetRoundState();
      this.step = 'r3_choose_defenders';
      this.log.push('--- Final Round: 4 remaining players per team ---');
    }

    return { success: true };
  }

  // --- Round 3 Processing ---

  _processR3Defenders(defA, defB) {
    if (!this.poolA.includes(defA)) return { success: false, error: 'Invalid Team A defender' };
    if (!this.poolB.includes(defB)) return { success: false, error: 'Invalid Team B defender' };

    this.round3DefenderA = defA;
    this.round3DefenderB = defB;

    this.log.push(`Round 3: Team A defends with ${this.getPlayerName(defA)}, Team B defends with ${this.getPlayerName(defB)}`);

    this.step = 'r3_choose_attackers';
    return { success: true };
  }

  _processR3Attackers(atkA, atkB) {
    if (atkA.length !== 2) return { success: false, error: 'Team A must choose exactly 2 attackers' };
    if (atkB.length !== 2) return { success: false, error: 'Team B must choose exactly 2 attackers' };

    this.round3AttackersA = atkA;
    this.round3AttackersB = atkB;

    // Auto-identify the remaining (last) players
    const usedA = [this.round3DefenderA, ...atkA];
    const usedB = [this.round3DefenderB, ...atkB];
    this.round3LastA = this.poolA.find(id => !usedA.includes(id));
    this.round3LastB = this.poolB.find(id => !usedB.includes(id));

    this.log.push(`Round 3: Team A attacks with ${atkA.map(id => this.getPlayerName(id)).join(' & ')}`);
    this.log.push(`Round 3: Team B attacks with ${atkB.map(id => this.getPlayerName(id)).join(' & ')}`);
    this.log.push(`Round 3: Auto-paired remainders — ${this.getPlayerName(this.round3LastA)} vs ${this.getPlayerName(this.round3LastB)}`);

    // Record the 8th match (remaining players) immediately
    this.matches.push({
      playerA: this.round3LastA,
      playerB: this.round3LastB,
      table: null,
      type: 'remaining',
      round: 3,
      defenderTeam: null,
    });

    this.step = 'r3_refuse_attackers';
    return { success: true };
  }

  _processR3Refusals(refuseFromB, refuseFromA) {
    if (!this.round3AttackersB.includes(refuseFromB)) return { success: false, error: 'Invalid refusal' };
    if (!this.round3AttackersA.includes(refuseFromA)) return { success: false, error: 'Invalid refusal' };

    this.round3RefusedB = refuseFromB;
    this.round3RefusedA = refuseFromA;

    const acceptedB = this.round3AttackersB.find(id => id !== refuseFromB);
    const acceptedA = this.round3AttackersA.find(id => id !== refuseFromA);

    this.log.push(`Round 3: Team A refuses ${this.getPlayerName(refuseFromB)}, accepts ${this.getPlayerName(acceptedB)}`);
    this.log.push(`Round 3: Team B refuses ${this.getPlayerName(refuseFromA)}, accepts ${this.getPlayerName(acceptedA)}`);

    // Match 5: Team A defender vs accepted Team B attacker
    this.matches.push({
      playerA: this.round3DefenderA,
      playerB: acceptedB,
      table: null,
      type: 'defender_vs_attacker',
      round: 3,
      defenderTeam: 'A',
    });

    // Match 6: accepted Team A attacker vs Team B defender
    this.matches.push({
      playerA: acceptedA,
      playerB: this.round3DefenderB,
      table: null,
      type: 'defender_vs_attacker',
      round: 3,
      defenderTeam: 'B',
    });

    // Match 7: Refused attackers face each other
    this.matches.push({
      playerA: refuseFromA,
      playerB: refuseFromB,
      table: null,
      type: 'refused_vs_refused',
      round: 3,
      defenderTeam: null,
    });

    // Remove all from pools
    this.poolA = [];
    this.poolB = [];

    this.log.push(`Round 3: Refused attackers ${this.getPlayerName(refuseFromA)} vs ${this.getPlayerName(refuseFromB)}`);

    this.step = 'r3_choose_tables';
    return { success: true };
  }

  _getR3PendingTableMatches() {
    return this.matches.filter(m => m.table === null);
  }

  _processR3Tables(assignments) {
    for (const { matchIndex, tableIndex } of assignments) {
      if (!this.availableTables.includes(tableIndex)) {
        return { success: false, error: `Table ${tableIndex + 1} is not available` };
      }
      this.matches[matchIndex].table = tableIndex;
      this.availableTables = this.availableTables.filter(t => t !== tableIndex);
      this.log.push(`Table ${tableIndex + 1} assigned: ${this.getPlayerName(this.matches[matchIndex].playerA)} vs ${this.getPlayerName(this.matches[matchIndex].playerB)}`);
    }

    this.step = 'complete';
    this.log.push('=== All 8 pairings complete! ===');
    return { success: true };
  }

  _resetRoundState() {
    this.defenderA = null;
    this.defenderB = null;
    this.attackersA = [];
    this.attackersB = [];
    this.refusedA = null;
    this.refusedB = null;
    this.acceptedA = null;
    this.acceptedB = null;
  }
}
