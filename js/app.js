import {
  addPlayer,
  currentBatter,
  endInning,
  exportData,
  finishGame,
  getState,
  importData,
  recordPlateAppearance,
  recordRunnerEvent,
  removePlayer,
  resetAll,
  startGame,
  undoLastEvent,
} from "./store.js";

const RESULTS = {
  "1B": "Sencillo",
  "2B": "Doble",
  "3B": "Triple",
  HR: "Jonron",
  BB: "Base por bolas",
  HBP: "Golpeado por lanzamiento",
  K: "Ponche",
  GO: "Rolling / out forzado",
  FO: "Elevado",
  LO: "Linea",
  FC: "Jugada de seleccion",
  E: "Error",
  SF: "Elevado de sacrificio",
  DP: "Doble play",
};

const BASE_LABELS = { first: "1B", second: "2B", third: "3B", home: "Home", out: "Out", stay: "Se queda" };
const BASE_NAMES = { first: "Primera", second: "Segunda", third: "Tercera" };
let lineupIds = [];
let selectedBase = null;
let toastTimer;

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const playerById = (state, id) => state.roster.find((player) => player.id === id);

function notify(message) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
}

function switchTab(tabId) {
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.tab === tabId));
  document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.id === tabId));
}

function syncLineup(state) {
  const rosterIds = state.roster.map((player) => player.id);
  lineupIds = lineupIds.filter((id) => rosterIds.includes(id));
  for (const id of rosterIds) if (!lineupIds.includes(id)) lineupIds.push(id);
}

function renderRoster(state) {
  const container = byId("roster-list");
  if (!state.roster.length) {
    container.innerHTML = '<p class="empty-state">El roster esta vacio.</p>';
    return;
  }
  container.innerHTML = state.roster.map((player) => `
    <div class="roster-player">
      <span class="jersey">${escapeHtml(player.number || "-")}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <span class="position">${escapeHtml(player.position || "-")}</span>
      <button class="text-button danger remove-player" type="button" data-id="${player.id}" aria-label="Eliminar a ${escapeHtml(player.name)}">Eliminar</button>
    </div>`).join("");
}

function renderLineup(state) {
  syncLineup(state);
  byId("roster-count").textContent = `${state.roster.length} jugador${state.roster.length === 1 ? "" : "es"}`;
  byId("empty-roster-note").hidden = state.roster.length > 0;
  byId("game-form").hidden = state.roster.length === 0;
  byId("lineup-list").innerHTML = lineupIds.map((id, index) => {
    const player = playerById(state, id);
    return `<li class="lineup-item">
      <span class="jersey">${escapeHtml(player.number || "-")}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <span class="lineup-controls">
        <button class="icon-button move-player" data-index="${index}" data-direction="-1" type="button" aria-label="Subir a ${escapeHtml(player.name)}" ${index === 0 ? "disabled" : ""}>↑</button>
        <button class="icon-button move-player" data-index="${index}" data-direction="1" type="button" aria-label="Bajar a ${escapeHtml(player.name)}" ${index === lineupIds.length - 1 ? "disabled" : ""}>↓</button>
      </span>
    </li>`;
  }).join("");
}

function defaultDestinations(result, game) {
  const occupied = game.bases;
  const defaults = { batter: "out", first: "stay", second: "stay", third: "stay" };
  if (result === "1B" || result === "E") {
    return { batter: "first", first: "second", second: "third", third: "home" };
  }
  if (result === "2B") return { batter: "second", first: "third", second: "home", third: "home" };
  if (result === "3B") return { batter: "third", first: "home", second: "home", third: "home" };
  if (result === "HR") return { batter: "home", first: "home", second: "home", third: "home" };
  if (result === "BB" || result === "HBP") {
    defaults.batter = "first";
    if (occupied.first) defaults.first = "second";
    if (occupied.first && occupied.second) defaults.second = "third";
    if (occupied.first && occupied.second && occupied.third) defaults.third = "home";
    return defaults;
  }
  if (result === "FC") {
    defaults.batter = "first";
    const leadBase = occupied.third ? "third" : occupied.second ? "second" : occupied.first ? "first" : null;
    if (leadBase) defaults[leadBase] = "out";
    return defaults;
  }
  if (result === "SF") {
    if (occupied.third) defaults.third = "home";
    return defaults;
  }
  if (result === "DP") {
    const runnerBase = occupied.first ? "first" : occupied.second ? "second" : occupied.third ? "third" : null;
    if (runnerBase) defaults[runnerBase] = "out";
    return defaults;
  }
  return defaults;
}

function destinationOptions(selected) {
  return Object.entries(BASE_LABELS).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join("");
}

function renderMovements(state) {
  const game = state.game;
  if (!game?.active) return;
  const batter = currentBatter(game);
  const defaults = defaultDestinations(byId("play-result").value, game);
  const runners = ["third", "second", "first"]
    .filter((base) => game.bases[base])
    .map((base) => ({ from: base, player: playerById(state, game.bases[base]) }));
  runners.push({ from: "batter", player: batter });
  byId("movements").innerHTML = runners.map(({ from, player }) => `
    <label class="movement">
      <span>${from === "batter" ? "Bateador" : BASE_NAMES[from]} · ${escapeHtml(player.name)}</span>
      <select class="movement-destination" data-from="${from}" data-player-id="${player.id}" aria-label="Destino de ${escapeHtml(player.name)}">
        ${destinationOptions(defaults[from])}
      </select>
    </label>`).join("");
}

function renderBases(state) {
  for (const base of ["first", "second", "third"]) {
    const button = byId(`base-${base}`);
    const player = playerById(state, state.game.bases[base]);
    button.classList.toggle("occupied", Boolean(player));
    button.classList.toggle("selected", selectedBase === base);
    button.querySelector("span").textContent = player ? player.number || player.name.slice(0, 2) : BASE_LABELS[base];
    button.setAttribute("aria-label", player ? `${BASE_NAMES[base]}: ${player.name}` : `${BASE_NAMES[base]} vacia`);
  }
}

function renderRunnerPanel(state) {
  const panel = byId("runner-panel");
  const player = selectedBase ? playerById(state, state.game?.bases[selectedBase]) : null;
  panel.hidden = !player;
  if (!player) return;
  byId("selected-runner").textContent = `${player.number ? `#${player.number} ` : ""}${player.name} · ${BASE_NAMES[selectedBase]}`;
  const allowed = selectedBase === "first" ? ["second", "third", "home", "out"] : selectedBase === "second" ? ["third", "home", "out"] : ["home", "out"];
  byId("runner-destination").innerHTML = allowed.map((base) => `<option value="${base}">${BASE_LABELS[base]}</option>`).join("");
}

function renderLiveGame(state) {
  const game = state.game;
  byId("inning-value").textContent = game.inning;
  byId("outs-value").textContent = game.outs;
  byId("runs-value").textContent = game.runs;
  byId("game-opponent").textContent = `vs. ${game.opponent}`;
  byId("game-date-label").textContent = game.date || "Sin fecha";
  const batter = currentBatter(game);
  const batterLabel = `${batter.number ? `#${batter.number} ` : ""}${batter.name}`;
  byId("current-batter").textContent = batterLabel;
  byId("play-batter").textContent = batterLabel;
  renderBases(state);
  renderRunnerPanel(state);
  renderMovements(state);
  byId("undo-play").disabled = game.events.length === 0;
}

function describeBases(bases, state) {
  const occupied = Object.entries(bases).filter(([, playerId]) => playerId);
  if (!occupied.length) return "Bases vacias";
  return occupied.map(([base, playerId]) => `${BASE_LABELS[base]}: ${playerById(state, playerId)?.name ?? "?"}`).join(" · ");
}

function renderLog(state) {
  const events = state.game?.events ?? [];
  byId("event-count").textContent = `${events.length} evento${events.length === 1 ? "" : "s"}`;
  if (!events.length) {
    byId("log-list").innerHTML = '<p class="empty-state">Las jugadas apareceran aqui.</p>';
    return;
  }
  byId("log-list").innerHTML = [...events].reverse().map((event) => `
    <article class="log-event ${event.kind === "runner-event" ? "runner" : ""}">
      <span class="log-inning">Entrada ${event.before.inning}<br>${event.before.outs} out${event.before.outs === 1 ? "" : "s"}</span>
      <div><strong>${escapeHtml(event.playerName)} · ${escapeHtml(RESULTS[event.label] ?? event.label)}</strong><small>${escapeHtml(describeBases(event.before.bases, state))} → ${escapeHtml(describeBases(event.after.bases, state))}${event.endedInning ? " · Fin de entrada" : ""}</small></div>
      <span class="log-score">${event.runsAdded ? `+${event.runsAdded} carrera${event.runsAdded === 1 ? "" : "s"}` : `${event.outsAdded || 0} outs`}</span>
    </article>`).join("");
}

function render() {
  const state = getState();
  const live = Boolean(state.game?.active);
  byId("game-setup").hidden = live;
  byId("game-live").hidden = !live;
  renderRoster(state);
  renderLineup(state);
  renderLog(state);
  if (live) renderLiveGame(state);
  byId("save-status").textContent = "Guardado local";
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

byId("roster-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    addPlayer({ number: form.get("number"), name: form.get("name"), position: form.get("position") });
    event.currentTarget.reset();
    notify("Jugador agregado");
  } catch (error) { notify(error.message); }
});

byId("roster-list").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-player");
  if (!button) return;
  try { removePlayer(button.dataset.id); } catch (error) { notify(error.message); }
});

byId("lineup-list").addEventListener("click", (event) => {
  const button = event.target.closest(".move-player");
  if (!button) return;
  const from = Number(button.dataset.index);
  const to = from + Number(button.dataset.direction);
  [lineupIds[from], lineupIds[to]] = [lineupIds[to], lineupIds[from]];
  renderLineup(getState());
});

byId("game-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    startGame({ opponent: form.get("opponent"), date: form.get("date"), lineup: lineupIds });
    notify("Partido iniciado");
  } catch (error) { notify(error.message); }
});

byId("play-result").innerHTML = Object.entries(RESULTS).map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
byId("play-result").addEventListener("change", () => renderMovements(getState()));

byId("play-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const movements = [...document.querySelectorAll(".movement-destination")].map((select) => ({ playerId: select.dataset.playerId, from: select.dataset.from, to: select.value }));
  try {
    recordPlateAppearance(byId("play-result").value, movements);
    selectedBase = null;
    notify("Jugada registrada");
  } catch (error) { notify(error.message); }
});

document.querySelectorAll(".base").forEach((base) => base.addEventListener("click", () => {
  const state = getState();
  if (!state.game?.bases[base.dataset.base]) return;
  selectedBase = selectedBase === base.dataset.base ? null : base.dataset.base;
  renderBases(state);
  renderRunnerPanel(state);
}));

byId("cancel-runner").addEventListener("click", () => { selectedBase = null; renderLiveGame(getState()); });
byId("record-runner").addEventListener("click", () => {
  try {
    recordRunnerEvent({ label: byId("runner-event-label").value, from: selectedBase, to: byId("runner-destination").value });
    selectedBase = null;
    notify("Movimiento registrado");
  } catch (error) { notify(error.message); }
});

byId("undo-play").addEventListener("click", () => { if (undoLastEvent()) { selectedBase = null; notify("Ultima jugada deshecha"); } });
byId("end-inning").addEventListener("click", () => { if (confirm("Cerrar esta entrada y limpiar las bases?")) endInning(); });
byId("finish-game").addEventListener("click", () => { if (confirm("Finalizar el partido actual?")) { finishGame(); switchTab("log"); } });

byId("export-data").addEventListener("click", () => {
  const blob = new Blob([exportData()], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `linea-viva-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

byId("import-data").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try { importData(await file.text()); notify("Respaldo importado"); } catch (error) { notify(error.message); }
  event.target.value = "";
});

byId("reset-data").addEventListener("click", () => {
  if (!confirm("Borrar roster, partido y bitacora de este navegador?")) return;
  resetAll();
  lineupIds = [];
  selectedBase = null;
  switchTab("game");
  notify("Datos eliminados");
});

window.addEventListener("scorekeeping:change", render);
byId("game-date").value = new Date().toISOString().slice(0, 10);
render();

if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js");