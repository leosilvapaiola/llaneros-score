const STORAGE_KEY = "scorekeeping-softball-v1";

const emptyBases = () => ({ first: null, second: null, third: null });

const initialState = () => ({
  roster: [],
  rosterSourceLoaded: false,
  game: null,
});

let state = loadState();

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : initialState();
  } catch {
    return initialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("scorekeeping:change"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function gameSnapshot() {
  const { inning, outs, runs, bases, battingIndex, lineupSlots, gameDay } = state.game;
  return clone({ inning, outs, runs, bases, battingIndex, lineupSlots, gameDay });
}

function restoreSnapshot(snapshot) {
  Object.assign(state.game, clone(snapshot));
}

function playerName(playerId) {
  return state.roster.find((player) => player.id === playerId)?.name ?? "Jugador desconocido";
}

function ensureLineupModel(game = state.game) {
  if (!game || game.lineupSlots) return;
  game.lineupSlots = game.lineup.map((playerId, index) => {
    const assignment = game.gameDay.find((item) => item.playerId === playerId);
    return {
      index,
      starterPlayerId: playerId,
      currentPlayerId: playerId,
      position: assignment?.position ?? "",
    };
  });
  game.gameDay = game.gameDay.map((assignment) => ({
    ...assignment,
    role: game.lineup.includes(assignment.playerId) ? "starter" : "substitute",
    status: !assignment.available ? "absent" : game.lineup.includes(assignment.playerId) ? "active" : "bench",
  }));
}

function completeEvent(event, before) {
  if (state.game.outs >= 3) {
    state.game.inning += 1;
    state.game.outs = 0;
    state.game.bases = emptyBases();
    event.endedInning = true;
  }

  event.before = before;
  event.after = gameSnapshot();
  state.game.events.push(event);
  saveState();
}

function applyMovements(movements) {
  const nextBases = emptyBases();
  let outsAdded = 0;
  let runsAdded = 0;

  for (const movement of movements) {
    if (!movement.playerId || movement.to === "stay") {
      if (movement.from !== "batter") nextBases[movement.from] = movement.playerId;
      continue;
    }
    if (movement.to === "out") {
      outsAdded += 1;
      continue;
    }
    if (movement.to === "home") {
      runsAdded += 1;
      continue;
    }
    if (nextBases[movement.to]) {
      throw new Error("Dos corredores no pueden terminar en la misma base.");
    }
    nextBases[movement.to] = movement.playerId;
  }

  state.game.bases = nextBases;
  state.game.outs += outsAdded;
  state.game.runs += runsAdded;
  return { outsAdded, runsAdded };
}

export function getState() {
  ensureLineupModel();
  return clone(state);
}

export function addPlayer({ number, name, position, positions }) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre del jugador.");
  state.roster.push({
    id: createId(),
    number: String(number).trim(),
    name: cleanName,
    positions: Array.isArray(positions) ? positions : Array.isArray(position) ? position : [position].filter(Boolean),
  });
  saveState();
}

export function updatePlayer(playerId, { number, name, position, positions }) {
  if (state.game?.active) throw new Error("No puedes modificar el roster durante un partido.");
  const player = state.roster.find((item) => item.id === playerId);
  if (!player) throw new Error("No se encontro el jugador.");
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre del jugador.");
  Object.assign(player, {
    number: String(number).trim(),
    name: cleanName,
    positions: Array.isArray(positions) ? positions : Array.isArray(position) ? position : [position].filter(Boolean),
  });
  saveState();
}

export function initializeRoster(players) {
  if (state.roster.length) {
    if (!state.rosterSourceLoaded) {
      state.rosterSourceLoaded = true;
      saveState();
    }
    return;
  }
  state.roster = players.map((player) => ({
    id: player.id || createId(),
    number: String(player.number ?? "").trim(),
    name: String(player.name ?? "").trim(),
    positions: Array.isArray(player.positions) ? player.positions : [player.position].filter(Boolean),
  })).filter((player) => player.name);
  state.rosterSourceLoaded = true;
  saveState();
}

export function removePlayer(playerId) {
  if (state.game?.active) throw new Error("No puedes modificar el roster durante un partido.");
  state.roster = state.roster.filter((player) => player.id !== playerId);
  saveState();
}

export function startGame({ opponent, date, lineup, gameDay }) {
  if (lineup.length < 10 || lineup.length > 11) {
    throw new Error("El lineup debe tener 10 u 11 titulares.");
  }
  const starters = gameDay.filter((assignment) => assignment.available && assignment.position !== "BENCH");
  const positions = starters.map((assignment) => assignment.position);
  if (positions.some((position) => !position)) {
    throw new Error("Asigna una posicion a cada jugador disponible.");
  }
  if (new Set(positions).size !== positions.length) {
    throw new Error("Las posiciones titulares no pueden repetirse.");
  }
  if (lineup.some((playerId) => !starters.some((assignment) => assignment.playerId === playerId))) {
    throw new Error("El lineup contiene un jugador sin posicion de campo.");
  }
  state.game = {
    active: true,
    opponent: opponent.trim() || "Rival",
    date,
    lineup: [...lineup],
    lineupSlots: lineup.map((playerId, index) => ({
      index,
      starterPlayerId: playerId,
      currentPlayerId: playerId,
      position: gameDay.find((assignment) => assignment.playerId === playerId).position,
    })),
    gameDay: gameDay.map((assignment) => ({
      ...clone(assignment),
      role: lineup.includes(assignment.playerId) ? "starter" : "substitute",
      status: !assignment.available ? "absent" : lineup.includes(assignment.playerId) ? "active" : "bench",
    })),
    inning: 1,
    outs: 0,
    runs: 0,
    bases: emptyBases(),
    battingIndex: 0,
    events: [],
    startedAt: new Date().toISOString(),
  };
  saveState();
}

export function currentBatter(game = state.game) {
  ensureLineupModel(game);
  if (!game?.lineupSlots.length) return null;
  const playerId = game.lineupSlots[game.battingIndex % game.lineupSlots.length].currentPlayerId;
  return state.roster.find((player) => player.id === playerId) ?? null;
}

export function substitutePlayer(slotIndex, incomingPlayerId) {
  if (!state.game?.active) throw new Error("No hay un partido activo.");
  ensureLineupModel();
  const slot = state.game.lineupSlots[slotIndex];
  const incoming = state.game.gameDay.find((assignment) => assignment.playerId === incomingPlayerId);
  if (!slot || !incoming) throw new Error("La sustitucion no es valida.");
  if (incoming.status === "finished" || incoming.status === "absent") {
    throw new Error("Ese jugador ya no esta disponible.");
  }
  if (incoming.status === "active") throw new Error("Ese jugador ya esta en el lineup.");
  if (incoming.role === "starter" && incoming.playerId !== slot.starterPlayerId) {
    throw new Error("Un titular solo puede reingresar en su lugar original.");
  }

  const outgoingPlayerId = slot.currentPlayerId;
  const outgoing = state.game.gameDay.find((assignment) => assignment.playerId === outgoingPlayerId);
  const before = gameSnapshot();
  outgoing.status = outgoing.role === "starter" ? "bench" : "finished";
  outgoing.position = "BENCH";
  incoming.status = "active";
  incoming.position = slot.position;
  slot.currentPlayerId = incomingPlayerId;

  completeEvent({
    id: createId(),
    kind: "substitution",
    label: "Sustitucion",
    playerId: incomingPlayerId,
    playerName: playerName(incomingPlayerId),
    incomingPlayerId,
    incomingPlayerName: playerName(incomingPlayerId),
    outgoingPlayerId,
    outgoingPlayerName: playerName(outgoingPlayerId),
    slotIndex,
    position: slot.position,
    outsAdded: 0,
    runsAdded: 0,
    createdAt: new Date().toISOString(),
  }, before);
}

export function recordPlateAppearance(result, movements) {
  if (!state.game?.active) throw new Error("No hay un partido activo.");
  const batter = currentBatter();
  const before = gameSnapshot();
  const totals = applyMovements(movements);
  state.game.battingIndex += 1;
  completeEvent({
    id: createId(),
    kind: "plate-appearance",
    label: result,
    playerId: batter.id,
    playerName: batter.name,
    movements: clone(movements),
    ...totals,
    createdAt: new Date().toISOString(),
  }, before);
}

export function recordRunnerEvent({ label, from, to }) {
  if (!state.game?.active) throw new Error("No hay un partido activo.");
  const playerId = state.game.bases[from];
  if (!playerId) throw new Error("No hay corredor en esa base.");
  const before = gameSnapshot();
  const movements = Object.entries(state.game.bases)
    .filter(([, id]) => id)
    .map(([base, id]) => ({ playerId: id, from: base, to: base === from ? to : "stay" }));
  const totals = applyMovements(movements);
  completeEvent({
    id: createId(),
    kind: "runner-event",
    label,
    playerId,
    playerName: playerName(playerId),
    movements,
    ...totals,
    createdAt: new Date().toISOString(),
  }, before);
}

export function endInning() {
  if (!state.game?.active) return;
  const before = gameSnapshot();
  state.game.inning += 1;
  state.game.outs = 0;
  state.game.bases = emptyBases();
  completeEvent({
    id: createId(),
    kind: "manual",
    label: "Fin de entrada manual",
    playerName: "-",
    outsAdded: 0,
    runsAdded: 0,
    createdAt: new Date().toISOString(),
  }, before);
}

export function undoLastEvent() {
  if (!state.game?.events.length) return false;
  const event = state.game.events.pop();
  restoreSnapshot(event.before);
  saveState();
  return true;
}

export function calculateGameStats(gameState = state.game, roster = state.roster) {
  if (!gameState) return null;
  ensureLineupModel(gameState);

  const playersMap = new Map(roster.map((p) => [p.id, p]));

  // Track player stats: key = playerId
  const statsMap = new Map();

  function getPlayerEntry(playerId, fallbackName = "") {
    if (!statsMap.has(playerId)) {
      const p = playersMap.get(playerId);
      statsMap.set(playerId, {
        id: playerId,
        number: p?.number || "",
        name: p?.name || fallbackName || "Desconocido",
        positions: [],
        firstAppearanceOrder: Infinity,
        lineupSlotIndex: null,
        isStarter: false,
        ab: 0,
        r: 0,
        h: 0,
        rbi: 0,
        hr: 0,
        k: 0,
        bb: 0,
        hbp: 0,
        sf: 0,
        singles: 0,
        doubles: 0,
        triples: 0,
        tb: 0,
        obp: 0,
        slg: 0,
        ops: 0,
        avg: 0,
      });
    }
    return statsMap.get(playerId);
  }

  // Pre-seed from lineupSlots and gameDay if available
  if (Array.isArray(gameState.lineupSlots)) {
    gameState.lineupSlots.forEach((slot, idx) => {
      if (slot.starterPlayerId) {
        const entry = getPlayerEntry(slot.starterPlayerId);
        entry.lineupSlotIndex = idx;
        entry.isStarter = true;
        if (slot.position && !entry.positions.includes(slot.position)) {
          entry.positions.push(slot.position);
        }
      }
      if (slot.currentPlayerId && slot.currentPlayerId !== slot.starterPlayerId) {
        const entry = getPlayerEntry(slot.currentPlayerId);
        if (entry.lineupSlotIndex === null) entry.lineupSlotIndex = idx;
        if (slot.position && !entry.positions.includes(slot.position)) {
          entry.positions.push(slot.position);
        }
      }
    });
  }

  const events = gameState.events || [];
  let orderCounter = 0;

  for (const event of events) {
    if (event.kind === "substitution") {
      const inc = getPlayerEntry(event.incomingPlayerId, event.incomingPlayerName);
      if (inc.lineupSlotIndex === null && event.slotIndex !== undefined) {
        inc.lineupSlotIndex = event.slotIndex;
      }
      if (event.position && !inc.positions.includes(event.position)) {
        inc.positions.push(event.position);
      }
      continue;
    }

    if (event.kind === "plate-appearance") {
      const batter = getPlayerEntry(event.playerId, event.playerName);
      if (batter.firstAppearanceOrder === Infinity) {
        batter.firstAppearanceOrder = orderCounter++;
      }

      const res = event.label;
      const isSingle = res === "1B";
      const isDouble = res === "2B";
      const isTriple = res === "3B";
      const isHR = res === "HR";
      const isHit = isSingle || isDouble || isTriple || isHR;
      const isWalk = res === "BB";
      const isHBP = res === "HBP";
      const isSF = res === "SF";
      const isK = res === "K";

      if (isHit) {
        batter.h += 1;
        if (isSingle) { batter.singles += 1; batter.tb += 1; }
        else if (isDouble) { batter.doubles += 1; batter.tb += 2; }
        else if (isTriple) { batter.triples += 1; batter.tb += 3; }
        else if (isHR) { batter.hr += 1; batter.tb += 4; }
      }

      if (isWalk) batter.bb += 1;
      if (isHBP) batter.hbp += 1;
      if (isSF) batter.sf += 1;
      if (isK) batter.k += 1;

      // At Bat (AB): all PA except BB, HBP, SF
      if (!isWalk && !isHBP && !isSF) {
        batter.ab += 1;
      }

      // Count runs scored on this plate appearance
      // Movements to 'home' count as runs for those runners
      if (Array.isArray(event.movements)) {
        let runsScoredOnPlay = 0;
        for (const mov of event.movements) {
          if (mov.to === "home" && mov.playerId) {
            const runner = getPlayerEntry(mov.playerId);
            runner.r += 1;
            runsScoredOnPlay += 1;
          }
        }
        // RBI: In baseball/softball, runners scoring on hits, walks with bases loaded, SF, and groundouts drive in runs (except double plays or errors if strict, but in softball/scorekeeping apps all scoring movements on PA credit RBI to batter)
        // Except when run scored on error/DP, but standard scorekeeping credits RBI for hits/SF/groundout/bases-loaded BB.
        // If it's a DP, RBI is usually 0. Otherwise runs scored on PA count as RBI for batter.
        if (res !== "DP") {
          batter.rbi += runsScoredOnPlay;
        }
      }
    } else if (event.kind === "runner-event") {
      // Runner events (steal to home, wild pitch, advance to home, etc.)
      if (Array.isArray(event.movements)) {
        for (const mov of event.movements) {
          if (mov.to === "home" && mov.playerId) {
            const runner = getPlayerEntry(mov.playerId, event.playerName);
            runner.r += 1;
            // Runner event runs do NOT count as RBI for a batter
          }
        }
      }
    }
  }

  // Calculate totals and averages
  const totals = {
    ab: 0,
    r: 0,
    h: 0,
    rbi: 0,
    hr: 0,
    k: 0,
    bb: 0,
    hbp: 0,
    sf: 0,
    tb: 0,
    avg: ".000",
    obp: ".000",
    slg: ".000",
    ops: ".000",
  };

  const playersList = Array.from(statsMap.values()).map((p) => {
    totals.ab += p.ab;
    totals.r += p.r;
    totals.h += p.h;
    totals.rbi += p.rbi;
    totals.hr += p.hr;
    totals.k += p.k;
    totals.bb += p.bb;
    totals.hbp += p.hbp;
    totals.sf += p.sf;
    totals.tb += p.tb;

    const avgVal = p.ab > 0 ? p.h / p.ab : 0;
    const obpDenom = p.ab + p.bb + p.hbp + p.sf;
    const obpVal = obpDenom > 0 ? (p.h + p.bb + p.hbp) / obpDenom : 0;
    const slgVal = p.ab > 0 ? p.tb / p.ab : 0;
    const opsVal = obpVal + slgVal;

    const formatRate = (val) => {
      if (val >= 1) return val.toFixed(3);
      return val.toFixed(3).replace(/^0\./, ".");
    };

    return {
      ...p,
      avg: formatRate(avgVal),
      obp: formatRate(obpVal),
      slg: formatRate(slgVal),
      ops: formatRate(opsVal),
      positionsLabel: p.positions.length ? p.positions.join("/") : "",
    };
  });

  // Sort players: starters first by lineup slot index (or appearance), then substitutes
  playersList.sort((a, b) => {
    const slotA = a.lineupSlotIndex !== null ? a.lineupSlotIndex : 999;
    const slotB = b.lineupSlotIndex !== null ? b.lineupSlotIndex : 999;
    if (slotA !== slotB) return slotA - slotB;
    if (a.isStarter !== b.isStarter) return a.isStarter ? -1 : 1;
    return a.firstAppearanceOrder - b.firstAppearanceOrder;
  });

  // Calculate team rates
  const teamAvg = totals.ab > 0 ? totals.h / totals.ab : 0;
  const teamObpDenom = totals.ab + totals.bb + totals.hbp + totals.sf;
  const teamObp = teamObpDenom > 0 ? (totals.h + totals.bb + totals.hbp) / teamObpDenom : 0;
  const teamSlg = totals.ab > 0 ? totals.tb / totals.ab : 0;
  const formatRate = (val) => {
    if (val >= 1) return val.toFixed(3);
    return val.toFixed(3).replace(/^0\./, ".");
  };
  totals.avg = formatRate(teamAvg);
  totals.obp = formatRate(teamObp);
  totals.slg = formatRate(teamSlg);
  totals.ops = formatRate(teamObp + teamSlg);

  return {
    players: playersList,
    totals,
    opponent: gameState.opponent || "Rival",
    date: gameState.date || "",
    inning: gameState.inning || 1,
    outs: gameState.outs || 0,
    runs: gameState.runs || totals.r,
    isActive: Boolean(gameState.active),
  };
}

export function finishGame() {
  if (!state.game) return;
  state.game.active = false;
  state.game.finishedAt = new Date().toISOString();
  saveState();
}

export function exportData() {
  return JSON.stringify(state, null, 2);
}

export function importData(json) {
  const imported = JSON.parse(json);
  if (!Array.isArray(imported.roster) || (imported.game !== null && typeof imported.game !== "object")) {
    throw new Error("El archivo no contiene datos validos.");
  }
  state = imported;
  saveState();
}

export function resetAll() {
  state = initialState();
  saveState();
}