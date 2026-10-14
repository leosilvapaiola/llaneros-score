import {
  addPlayer,
  calculateGameStats,
  currentBatter,
  endInning,
  exportData,
  finishGame,
  getState,
  importData,
  initializeRoster,
  recordPlateAppearance,
  recordRunnerEvent,
  removePlayer,
  resetAll,
  startGame,
  substitutePlayer,
  substituteRunner,
  undoLastEvent,
  updatePlayer,
  updateImportedStats,
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
const POSITIONS = {
  P: "Pitcher",
  C: "Catcher",
  "1B": "1st Base",
  "2B": "2nd Base",
  "3B": "3rd Base",
  SS: "Shortstop",
  LF: "Left Field",
  CF: "Center Field",
  RF: "Right Field",
  SF: "Short Field",
  DH: "Designated Hitter",
  BENCH: "Banco",
};
let lineupIds = [];
let gameDayAssignments = new Map();
let selectedBase = null;
let rosterEditing = false;
let editingPlayerId = null;
let editingStatsPlayerId = null;
const STAT_FIELDS = { ab: "AB", r: "R", rbi: "RBI", k: "K", bb: "BB", hbp: "HBP", sf: "SF", singles: "1B", doubles: "2B", triples: "3B", hr: "HR" };
let toastTimer;

const byId = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
const playerById = (state, id) => state.roster.find((player) => player.id === id);

export function exportFileName(state) {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replaceAll(":", "-");
  const opponent = (state.game?.opponent || "Rival")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "Rival";
  return `${timestamp}-vs-${opponent}-llaneros-virtual.json`;
}

function normalizedPosition(position) {
  const code = String(position ?? "").trim().toUpperCase();
  return Object.hasOwn(POSITIONS, code) ? code : "";
}

function usualPositions(player) {
  const positions = Array.isArray(player?.positions) ? player.positions : [player?.position];
  return positions.map(normalizedPosition).filter(Boolean);
}

function sortRosterByNumber(roster) {
  return [...roster].sort((firstPlayer, secondPlayer) => {
    const firstNumber = Number.parseInt(firstPlayer.number, 10);
    const secondNumber = Number.parseInt(secondPlayer.number, 10);
    if (Number.isNaN(firstNumber) && Number.isNaN(secondNumber)) return firstPlayer.name.localeCompare(secondPlayer.name);
    if (Number.isNaN(firstNumber)) return 1;
    if (Number.isNaN(secondNumber)) return -1;
    return firstNumber - secondNumber;
  });
}

function positionOptions(selected = "", playerId = null, includeEmpty = false, preferredPositions = []) {
  const used = new Map(
    [...gameDayAssignments.values()]
      .filter((assignment) => assignment.available && assignment.position && assignment.position !== "BENCH")
      .map((assignment) => [assignment.position, assignment.playerId]),
  );
  const selectedValues = Array.isArray(selected) ? selected : [selected];
  const orderedPositions = [...new Set([...preferredPositions, ...Object.keys(POSITIONS)])];
  const options = includeEmpty ? '<option value="">Sin posicion habitual</option>' : '<option value="BENCH">Banco</option>';
  return options + orderedPositions.filter((value) => !includeEmpty || value !== "BENCH").map((value) => {
    const unavailable = value !== "BENCH" && used.has(value) && used.get(value) !== playerId;
    return `<option value="${value}" ${selectedValues.includes(value) ? "selected" : ""} ${unavailable ? "disabled" : ""}>${POSITIONS[value]}</option>`;
  }).join("");
}

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

function syncGameDay(state) {
  const rosterIds = new Set(state.roster.map((player) => player.id));
  for (const playerId of gameDayAssignments.keys()) {
    if (!rosterIds.has(playerId)) gameDayAssignments.delete(playerId);
  }
  for (const player of state.roster) {
    if (!gameDayAssignments.has(player.id)) {
      gameDayAssignments.set(player.id, {
        playerId: player.id,
        available: true,
        position: "BENCH",
      });
    }
  }
  const eligibleIds = state.roster
    .filter((player) => {
      const assignment = gameDayAssignments.get(player.id);
      return assignment.available && assignment.position && assignment.position !== "BENCH";
    })
    .map((player) => player.id);
  lineupIds = lineupIds.filter((id) => eligibleIds.includes(id));
  for (const id of eligibleIds) if (!lineupIds.includes(id)) lineupIds.push(id);
}

function renderRoster(state) {
  const container = byId("roster-list");
  if (!state.roster.length) {
    container.innerHTML = '<p class="empty-state">El roster esta vacio.</p>';
    return;
  }
  const sortedRoster = sortRosterByNumber(state.roster);
  container.innerHTML = sortedRoster.map((player) => `
    <div class="roster-player">
      <span class="jersey">${escapeHtml(player.number || "-")}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <span class="position">${escapeHtml(usualPositions(player).map((position) => POSITIONS[position]).join(", ") || "Sin posicion")}</span>
      <span class="roster-actions" ${rosterEditing ? "" : "hidden"}>
        <button class="text-button edit-player" type="button" data-id="${player.id}" aria-label="Editar a ${escapeHtml(player.name)}">Editar</button>
        <button class="text-button danger remove-player" type="button" data-id="${player.id}" aria-label="Eliminar a ${escapeHtml(player.name)}">Eliminar</button>
      </span>
    </div>`).join("");
}

function renderGameSetup(state) {
  syncGameDay(state);
  byId("roster-count").textContent = `${state.roster.length} jugador${state.roster.length === 1 ? "" : "es"}`;
  byId("empty-roster-note").hidden = state.roster.length > 0;
  byId("game-form").hidden = state.roster.length === 0;
  byId("game-day-roster").innerHTML = sortRosterByNumber(state.roster).map((player) => {
    const assignment = gameDayAssignments.get(player.id);
    return `<div class="game-day-player ${assignment.available ? "" : "absent"}">
      <label class="availability" title="Disponible para este partido">
        <input class="availability-toggle" data-id="${player.id}" type="checkbox" ${assignment.available ? "checked" : ""} aria-label="${escapeHtml(player.name)} disponible">
        <span aria-hidden="true"></span>
      </label>
      <span class="jersey">${escapeHtml(player.number || "-")}</span>
      <strong>${escapeHtml(player.name)}</strong>
      <select class="game-day-position" data-id="${player.id}" aria-label="Posicion de ${escapeHtml(player.name)}" ${assignment.available ? "" : "disabled"}>
        ${positionOptions(assignment.position, player.id, false, usualPositions(player))}
      </select>
    </div>`;
  }).join("");
  byId("starter-count").textContent = `${lineupIds.length} titulares`;
  byId("lineup-list").innerHTML = lineupIds.map((id, index) => {
    const player = playerById(state, id);
    const position = gameDayAssignments.get(id).position;
    return `<li class="lineup-item">
      <span class="jersey">${escapeHtml(player.number || "-")}</span>
      <strong>${escapeHtml(player.name)} · ${escapeHtml(POSITIONS[position])}</strong>
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
  const slot = state.game.lineupSlots.find((entry) => entry.currentPlayerId === player.id);
  const eligible = slot ? state.game.gameDay.filter((assignment) => assignment.status === "bench" && (assignment.role === "substitute" || assignment.playerId === slot.starterPlayerId)) : [];
  byId("pinch-runner-player").innerHTML = `<option value="">${eligible.length ? "Seleccionar jugador..." : "Sin reemplazos disponibles"}</option>` + eligible.map((assignment) => {
    const incoming = playerById(state, assignment.playerId);
    return `<option value="${escapeHtml(incoming.id)}">${escapeHtml(incoming.number ? `#${incoming.number} ` : "")}${escapeHtml(incoming.name)}</option>`;
  }).join("");
  byId("pinch-runner-player").disabled = !eligible.length;
  byId("substitute-runner").disabled = true;
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

function renderLiveLineup(state) {
  const game = state.game;
  const active = Boolean(game?.active && game.lineupSlots);
  byId("live-lineup-content").hidden = !active;
  byId("lineup-empty").hidden = active;
  byId("lineup-empty").textContent = game && !game.active ? "El partido finalizo. Las sustituciones quedaron registradas en la Bitacora." : "Inicia un partido para administrar sustituciones.";
  byId("lineup-status").textContent = active ? `${game.lineupSlots.length} lugares` : game ? "Partido finalizado" : "Sin partido";
  if (!active) return;

  byId("live-lineup-list").innerHTML = game.lineupSlots.map((slot) => {
    const current = playerById(state, slot.currentPlayerId);
    const eligible = game.gameDay.filter((assignment) => assignment.status === "bench" && (assignment.role === "substitute" || assignment.playerId === slot.starterPlayerId));
    const options = eligible.map((assignment) => {
      const player = playerById(state, assignment.playerId);
      const reentry = assignment.role === "starter" ? " · reingreso" : "";
      return `<option value="${player.id}">#${escapeHtml(player.number || "-")} ${escapeHtml(player.name)}${reentry}</option>`;
    }).join("");
    return `<li class="live-lineup-slot">
      <span class="jersey">${escapeHtml(current.number || "-")}</span>
      <span class="slot-player"><strong>${escapeHtml(current.name)}</strong><small>${escapeHtml(POSITIONS[slot.position] || slot.position)}${slot.currentPlayerId === slot.starterPlayerId ? " · titular" : " · sustituto"}</small></span>
      <select class="substitution-select" data-slot="${slot.index}" aria-label="Sustituir a ${escapeHtml(current.name)}" ${eligible.length ? "" : "disabled"}>
        <option value="">${eligible.length ? "Sustituir por..." : "Sin reemplazos disponibles"}</option>${options}
      </select>
    </li>`;
  }).join("");

  const benchAssignments = game.gameDay.filter((assignment) => assignment.status !== "active");
  byId("bench-list").innerHTML = benchAssignments.length ? benchAssignments.map((assignment) => {
    const player = playerById(state, assignment.playerId);
    const statusLabel = assignment.status === "bench" ? assignment.role === "starter" ? "Puede reingresar" : "Disponible" : assignment.status === "finished" ? "No disponible" : "Ausente";
    const statusClass = assignment.status === "bench" ? "available" : assignment.status;
    return `<div class="bench-player"><span class="jersey">${escapeHtml(player.number || "-")}</span><strong>${escapeHtml(player.name)}</strong><span class="player-status ${statusClass}">${statusLabel}</span></div>`;
  }).join("") : '<p class="empty-state">No hay jugadores en el banco.</p>';
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
  byId("log-list").innerHTML = [...events].reverse().map((event) => {
    const beforeInning = event.before?.inning ?? 1;
    const beforeOuts = event.before?.outs ?? 0;
    const beforeBases = event.before?.bases ?? { first: null, second: null, third: null };
    const afterBases = event.after?.bases ?? { first: null, second: null, third: null };

    return `
    <article class="log-event ${event.kind === "runner-event" || event.kind === "substitution" ? "runner" : ""}">
      <span class="log-inning">Entrada ${beforeInning}<br>${beforeOuts} out${beforeOuts === 1 ? "" : "s"}</span>
      <div><strong>${event.kind === "substitution" ? `${escapeHtml(event.incomingPlayerName)} entra por ${escapeHtml(event.outgoingPlayerName)}` : `${escapeHtml(event.playerName)} · ${escapeHtml(RESULTS[event.label] ?? event.label)}`}</strong><small>${event.kind === "substitution" ? `Lugar ${event.slotIndex + 1} · ${escapeHtml(POSITIONS[event.position] || event.position)}` : `${escapeHtml(describeBases(beforeBases, state))} → ${escapeHtml(describeBases(afterBases, state))}${event.endedInning ? " · Fin de entrada" : ""}`}</small></div>
      <span class="log-score">${event.kind === "substitution" ? event.runnerBase ? `Corredor · ${BASE_LABELS[event.runnerBase]}` : "Cambio" : event.runsAdded ? `+${event.runsAdded} carrera${event.runsAdded === 1 ? "" : "s"}` : `${event.outsAdded || 0} outs`}</span>
    </article>`;
  }).join("");
}

function renderStats(state) {
  const game = state.game;
  const editable = state.gameSource === "imported" && game && !game.active;
  byId("btn-export-stats-json").hidden = !editable;
  const statsEmpty = byId("stats-empty");
  const statsContent = byId("stats-content");
  const statsBadge = byId("stats-game-badge");
  const exportBtn = byId("btn-export-stats-csv");
  const printPdfBtn = byId("btn-print-stats-pdf");

  if (!game) {
    statsEmpty.hidden = false;
    statsEmpty.textContent = "No hay datos de partido activos ni importados.";
    statsContent.hidden = true;
    statsBadge.textContent = "Sin partido";
    if (exportBtn) exportBtn.disabled = true;
    if (printPdfBtn) printPdfBtn.disabled = true;
    return;
  }

  const stats = calculateGameStats(game, state.roster);
  if (!stats) {
    statsEmpty.hidden = false;
    statsContent.hidden = true;
    statsBadge.textContent = "Sin datos";
    if (exportBtn) exportBtn.disabled = true;
    if (printPdfBtn) printPdfBtn.disabled = true;
    return;
  }

  statsEmpty.hidden = true;
  statsContent.hidden = false;
  if (exportBtn) exportBtn.disabled = false;
  if (printPdfBtn) printPdfBtn.disabled = false;

  const statusText = editable ? "Importado" : stats.isActive ? `En vivo · Entr. ${stats.inning}` : "Finalizado";
  statsBadge.textContent = statusText;
  byId("stats-matchup-title").textContent = `Ofensiva vs. ${escapeHtml(stats.opponent)}`;
  byId("stats-game-meta").textContent = `${stats.date || "Fecha no especificada"} · Carreras: ${stats.runs}`;

  // Build table rows
  const tbody = byId("stats-table-body");
  if (!stats.players.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">No hay turnos registrados en este partido aún.</td></tr>';
  } else {
    tbody.innerHTML = stats.players.map((p) => {
      const isSub = !p.isStarter && p.lineupSlotIndex !== null;
      const posDisplay = p.positionsLabel ? `(${escapeHtml(p.positionsLabel)})` : "";
      const jerseyDisplay = p.number ? `#${escapeHtml(p.number)} ` : "";
      const nameClass = isSub ? "substitute-indent" : "";

      return `<tr>
        <td class="col-player ${nameClass}">
          <div class="player-cell-content">
            <span class="player-name-link">${jerseyDisplay}${escapeHtml(p.name)}</span>
            <span class="player-pos-tag">${posDisplay}</span>
            ${editable ? `<button class="text-button edit-player-stats" type="button" data-player-id="${escapeHtml(p.id)}" aria-label="Editar estadisticas de ${escapeHtml(p.name)}">Editar</button>` : ""}
          </div>
        </td>
        <td class="stat-highlight">${p.ab}</td>
        <td>${p.r}</td>
        <td class="stat-highlight">${p.h}</td>
        <td>${p.rbi}</td>
        <td>${p.hr}</td>
        <td>${p.k}</td>
        <td>${p.bb}</td>
        <td class="stat-rate">${p.avg}</td>
        <td class="stat-rate">${p.obp}</td>
        <td class="stat-rate">${p.slg}</td>
        <td class="stat-rate stat-highlight">${p.ops}</td>
      </tr>`;
    }).join("");
  }

  // Table footer totals
  const tfoot = byId("stats-table-foot");
  const tot = stats.totals;
  tfoot.innerHTML = `<tr>
    <td class="col-player"><strong>Total</strong></td>
    <td class="stat-highlight">${tot.ab}</td>
    <td>${tot.r}</td>
    <td class="stat-highlight">${tot.h}</td>
    <td>${tot.rbi}</td>
    <td>${tot.hr}</td>
    <td>${tot.k}</td>
    <td>${tot.bb}</td>
    <td class="stat-rate">${tot.avg}</td>
    <td class="stat-rate">${tot.obp}</td>
    <td class="stat-rate">${tot.slg}</td>
    <td class="stat-rate stat-highlight">${tot.ops}</td>
  </tr>`;

  // Game Extra-Base Hits & Events Notes
  const notesContainer = byId("stats-game-notes");
  const doublesPlayers = stats.players.filter((p) => p.doubles > 0).map((p) => `${p.name} (${p.doubles})`);
  const triplesPlayers = stats.players.filter((p) => p.triples > 0).map((p) => `${p.name} (${p.triples})`);
  const hrPlayers = stats.players.filter((p) => p.hr > 0).map((p) => `${p.name} (${p.hr})`);
  const hbpPlayers = stats.players.filter((p) => p.hbp > 0).map((p) => `${p.name} (${p.hbp})`);
  const sfPlayers = stats.players.filter((p) => p.sf > 0).map((p) => `${p.name} (${p.sf})`);

  const notesHtml = [];
  if (doublesPlayers.length) notesHtml.push(`<div><strong>2B:</strong> ${escapeHtml(doublesPlayers.join(", "))}</div>`);
  if (triplesPlayers.length) notesHtml.push(`<div><strong>3B:</strong> ${escapeHtml(triplesPlayers.join(", "))}</div>`);
  if (hrPlayers.length) notesHtml.push(`<div><strong>HR:</strong> ${escapeHtml(hrPlayers.join(", "))}</div>`);
  if (hbpPlayers.length) notesHtml.push(`<div><strong>HBP:</strong> ${escapeHtml(hbpPlayers.join(", "))}</div>`);
  if (sfPlayers.length) notesHtml.push(`<div><strong>SF:</strong> ${escapeHtml(sfPlayers.join(", "))}</div>`);
  notesHtml.push(`<div><strong>Total Bases (TB):</strong> ${tot.tb}</div>`);

  notesContainer.innerHTML = notesHtml.join("");
}

function exportStatsCsv(state) {
  const game = state.game;
  if (!game) return;
  const stats = calculateGameStats(game, state.roster);
  if (!stats) return;

  const headers = ["Player", "Number", "Position", "AB", "R", "H", "RBI", "HR", "K", "BB", "AVG", "OBP", "SLG", "OPS"];
  const rows = stats.players.map((p) => [
    `"${p.name.replace(/"/g, '""')}"`,
    `"${p.number}"`,
    `"${p.positionsLabel}"`,
    p.ab,
    p.r,
    p.h,
    p.rbi,
    p.hr,
    p.k,
    p.bb,
    p.avg,
    p.obp,
    p.slg,
    p.ops,
  ]);
  const tot = stats.totals;
  rows.push([
    '"TOTAL"',
    '""',
    '""',
    tot.ab,
    tot.r,
    tot.h,
    tot.rbi,
    tot.hr,
    tot.k,
    tot.bb,
    tot.avg,
    tot.obp,
    tot.slg,
    tot.ops,
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  const safeOpponent = (stats.opponent || "Rival").replace(/[^a-zA-Z0-9]+/g, "-");
  link.download = `stats-vs-${safeOpponent}-${stats.date || "game"}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function render() {
  const state = getState();
  const live = Boolean(state.game?.active);
  byId("game-setup").hidden = live;
  byId("game-live").hidden = !live;
  renderRoster(state);
  renderGameSetup(state);
  renderLiveLineup(state);
  renderLog(state);
  renderStats(state);
  if (live) renderLiveGame(state);
  byId("save-status").textContent = "Guardado local";
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => switchTab(tab.dataset.tab)));

byId("roster-position").innerHTML = positionOptions("", null, true);
byId("toggle-roster-edit").addEventListener("click", () => {
  rosterEditing = !rosterEditing;
  editingPlayerId = null;
  byId("roster-form").hidden = !rosterEditing;
  byId("toggle-roster-edit").textContent = rosterEditing ? "Cerrar edicion" : "Editar roster";
  byId("save-player").textContent = "Agregar";
  byId("cancel-player-edit").hidden = true;
  byId("roster-form").reset();
  renderRoster(getState());
});

byId("roster-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const player = { number: form.get("number"), name: form.get("name"), positions: [...event.currentTarget.elements.positions.selectedOptions].map((option) => option.value) };
    if (editingPlayerId) {
      updatePlayer(editingPlayerId, player);
      editingPlayerId = null;
      byId("save-player").textContent = "Agregar";
      byId("cancel-player-edit").hidden = true;
      notify("Jugador actualizado");
    } else {
      addPlayer(player);
      notify("Jugador agregado");
    }
    event.currentTarget.reset();
  } catch (error) { notify(error.message); }
});

byId("roster-list").addEventListener("click", (event) => {
  const button = event.target.closest(".remove-player, .edit-player");
  if (!button) return;
  if (button.classList.contains("edit-player")) {
    const player = playerById(getState(), button.dataset.id);
    editingPlayerId = player.id;
    const form = byId("roster-form");
    form.elements.number.value = player.number;
    form.elements.name.value = player.name;
    [...form.elements.positions.options].forEach((option) => { option.selected = usualPositions(player).includes(option.value); });
    byId("save-player").textContent = "Guardar";
    byId("cancel-player-edit").hidden = false;
    form.elements.name.focus();
    return;
  }
  try { removePlayer(button.dataset.id); } catch (error) { notify(error.message); }
});

byId("cancel-player-edit").addEventListener("click", () => {
  editingPlayerId = null;
  byId("roster-form").reset();
  byId("save-player").textContent = "Agregar";
  byId("cancel-player-edit").hidden = true;
});

byId("game-day-roster").addEventListener("change", (event) => {
  const playerId = event.target.dataset.id;
  const assignment = gameDayAssignments.get(playerId);
  if (!assignment) return;
  if (event.target.classList.contains("availability-toggle")) {
    assignment.available = event.target.checked;
    if (assignment.available && !assignment.position) assignment.position = "BENCH";
  } else if (event.target.classList.contains("game-day-position")) {
    assignment.position = event.target.value;
  }
  renderGameSetup(getState());
});

byId("lineup-list").addEventListener("click", (event) => {
  const button = event.target.closest(".move-player");
  if (!button) return;
  const from = Number(button.dataset.index);
  const to = from + Number(button.dataset.direction);
  [lineupIds[from], lineupIds[to]] = [lineupIds[to], lineupIds[from]];
  renderGameSetup(getState());
});

byId("live-lineup-list").addEventListener("change", (event) => {
  const select = event.target.closest(".substitution-select");
  if (!select?.value) return;
  const state = getState();
  const slot = state.game.lineupSlots[Number(select.dataset.slot)];
  const outgoing = playerById(state, slot.currentPlayerId);
  const incoming = playerById(state, select.value);
  if (!confirm(`Sustituir a ${outgoing.name} por ${incoming.name}?`)) {
    select.value = "";
    return;
  }
  try {
    substitutePlayer(Number(select.dataset.slot), select.value);
    notify(`${incoming.name} entra al line-up`);
  } catch (error) { notify(error.message); }
});

byId("game-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    startGame({
      opponent: form.get("opponent"),
      date: form.get("date"),
      lineup: lineupIds,
      gameDay: [...gameDayAssignments.values()],
    });
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
byId("pinch-runner-player").addEventListener("change", (event) => {
  byId("substitute-runner").disabled = !event.target.value;
});
byId("substitute-runner").addEventListener("click", () => {
  const state = getState();
  const incomingId = byId("pinch-runner-player").value;
  const outgoing = playerById(state, state.game?.bases[selectedBase]);
  const incoming = playerById(state, incomingId);
  if (!outgoing || !incoming || !confirm(`Corredor emergente: ${incoming.name} por ${outgoing.name} en ${BASE_NAMES[selectedBase]}?`)) return;
  try {
    substituteRunner(selectedBase, incomingId);
    selectedBase = null;
    renderLiveGame(getState());
    notify(`${incoming.name} entra como corredor emergente`);
  } catch (error) { notify(error.message); }
});
byId("record-runner").addEventListener("click", () => {
  try {
    recordRunnerEvent({ label: byId("runner-event-label").value, from: selectedBase, to: byId("runner-destination").value });
    selectedBase = null;
    notify("Movimiento registrado");
  } catch (error) { notify(error.message); }
});

byId("undo-play").addEventListener("click", () => { if (undoLastEvent()) { selectedBase = null; notify("Ultima jugada deshecha"); } });
byId("end-inning").addEventListener("click", () => { if (confirm("Cerrar esta entrada y limpiar las bases?")) endInning(); });
const finishDialog = byId("finish-dialog");
byId("finish-game").addEventListener("click", () => finishDialog.showModal());
byId("continue-finish").addEventListener("click", () => {
  byId("finish-step-one").hidden = true;
  byId("finish-step-two").hidden = false;
  byId("finish-confirmation").focus();
});
byId("finish-confirmation").addEventListener("input", (event) => {
  byId("confirm-finish").disabled = event.target.value.trim().toUpperCase() !== "FINALIZAR";
});
document.querySelectorAll(".close-finish-dialog").forEach((button) => button.addEventListener("click", () => finishDialog.close()));
finishDialog.addEventListener("close", () => {
  byId("finish-step-one").hidden = false;
  byId("finish-step-two").hidden = true;
  byId("finish-confirmation").value = "";
  byId("confirm-finish").disabled = true;
});
byId("confirm-finish").addEventListener("click", () => {
  finishGame();
  finishDialog.close();
  switchTab("stats");
  notify("Partido finalizado");
});

const csvBtn = byId("btn-export-stats-csv");
if (csvBtn) {
  csvBtn.addEventListener("click", () => exportStatsCsv(getState()));
}

const printPdfBtn = byId("btn-print-stats-pdf");
if (printPdfBtn) {
  printPdfBtn.addEventListener("click", () => {
    switchTab("stats");
    window.print();
  });
}

function downloadJson() {
  const blob = new Blob([exportData()], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = exportFileName(getState());
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

byId("export-data").addEventListener("click", downloadJson);
byId("btn-export-stats-json").addEventListener("click", downloadJson);

const statsDialog = byId("stats-edit-dialog");
byId("stats-table-body").addEventListener("click", (event) => {
  const button = event.target.closest(".edit-player-stats");
  if (!button) return;
  const state = getState();
  if (state.gameSource !== "imported" || state.game?.active) return;
  const player = calculateGameStats(state.game, state.roster).players.find((entry) => entry.id === button.dataset.playerId);
  if (!player) return;
  editingStatsPlayerId = player.id;
  byId("stats-edit-title").textContent = player.name;
  byId("stats-edit-fields").innerHTML = Object.entries(STAT_FIELDS).map(([field, label]) => `<label>${label}<input name="${field}" type="number" min="0" step="1" required value="${player[field]}"></label>`).join("");
  byId("stats-edit-error").textContent = "";
  statsDialog.showModal();
});
byId("cancel-stats-edit").addEventListener("click", () => statsDialog.close());
byId("stats-edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const values = Object.fromEntries(Object.keys(STAT_FIELDS).map((field) => [field, Number(form.get(field))]));
  try {
    updateImportedStats(editingStatsPlayerId, values);
    statsDialog.close();
    notify("Estadisticas corregidas");
  } catch (error) { byId("stats-edit-error").textContent = error.message; }
});

byId("import-data").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    importData(await file.text());
    selectedBase = null;
    statsDialog.close();
    switchTab("stats");
    notify("Respaldo importado");
  } catch (error) { notify(error.message); }
  event.target.value = "";
});

byId("reset-data").addEventListener("click", () => {
  if (!confirm("Borrar roster, partido y bitacora de este navegador?")) return;
  resetAll();
  lineupIds = [];
  gameDayAssignments = new Map();
  selectedBase = null;
  switchTab("game");
  notify("Datos eliminados");
  loadDefaultRoster();
});

window.addEventListener("scorekeeping:change", render);
byId("game-date").value = new Date().toISOString().slice(0, 10);

async function loadDefaultRoster() {
  try {
    const response = await fetch("./data/roster.json");
    if (!response.ok) throw new Error("No se pudo leer data/roster.json.");
    const data = await response.json();
    initializeRoster(Array.isArray(data) ? data : data.players ?? []);
    render();
  } catch (error) {
    notify(error.message);
    render();
  }
}

loadDefaultRoster();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./service-worker.js").then((reg) => {
    reg.update();
  });
}