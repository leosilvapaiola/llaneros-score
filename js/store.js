const STORAGE_KEY = "scorekeeping-softball-v1";

const emptyBases = () => ({ first: null, second: null, third: null });

const initialState = () => ({
  roster: [],
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
  const { inning, outs, runs, bases, battingIndex } = state.game;
  return clone({ inning, outs, runs, bases, battingIndex });
}

function restoreSnapshot(snapshot) {
  Object.assign(state.game, clone(snapshot));
}

function playerName(playerId) {
  return state.roster.find((player) => player.id === playerId)?.name ?? "Jugador desconocido";
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
  return clone(state);
}

export function addPlayer({ number, name, position }) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre del jugador.");
  state.roster.push({
    id: createId(),
    number: String(number).trim(),
    name: cleanName,
    position: position.trim(),
  });
  saveState();
}

export function removePlayer(playerId) {
  if (state.game?.active) throw new Error("No puedes modificar el roster durante un partido.");
  state.roster = state.roster.filter((player) => player.id !== playerId);
  saveState();
}

export function startGame({ opponent, date, lineup }) {
  if (!lineup.length) throw new Error("Agrega al menos un jugador al lineup.");
  state.game = {
    active: true,
    opponent: opponent.trim() || "Rival",
    date,
    lineup: [...lineup],
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
  if (!game?.lineup.length) return null;
  const playerId = game.lineup[game.battingIndex % game.lineup.length];
  return state.roster.find((player) => player.id === playerId) ?? null;
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