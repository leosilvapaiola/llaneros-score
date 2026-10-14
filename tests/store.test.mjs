import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.window = { dispatchEvent: () => {} };
globalThis.CustomEvent = class {};
const source = await readFile(new URL("../js/store.js", import.meta.url), "utf8");
const store = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const roster = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, name: `Player ${index}`, number: String(index), positions: [] }));
const lineup = roster.slice(0, 10).map((player) => player.id);
const gameDay = roster.map((player, index) => ({ playerId: player.id, available: true, position: index < 10 ? String(index) : "BENCH" }));
const values = { ab: 4, r: 2, rbi: 3, k: 1, bb: 1, hbp: 0, sf: 0, singles: 1, doubles: 1, triples: 0, hr: 1 };

function start() {
  store.importData(JSON.stringify({ roster, game: null }));
  store.startGame({ opponent: "Rival", date: "2026-10-14", lineup, gameDay });
}

test("only uploaded games allow corrections, including after export and reload", () => {
  start();
  assert.throws(() => store.updateImportedStats("p0", values), /importado/);
  store.finishGame();
  assert.throws(() => store.updateImportedStats("p0", values), /importado/);
  store.importData(store.exportData());
  store.updateImportedStats("p0", values);
  store.importData(store.exportData());
  const stats = store.calculateGameStats();
  assert.equal(stats.players[0].h, 3);
  assert.equal(stats.players[0].tb, 7);
  assert.equal(stats.players[0].avg, ".750");
  assert.equal(stats.players[0].obp, ".800");
  assert.equal(stats.players[0].slg, "1.750");
  assert.equal(stats.players[0].ops, "2.550");
  assert.equal(stats.totals.r, 2);
  assert.equal(stats.runs, 2);
  assert.deepEqual(store.getState().game.events, []);
  assert.throws(() => store.updateImportedStats("p0", { ...values, ab: -1 }), /enteros/);
  assert.throws(() => store.updateImportedStats("p0", { ...values, ab: 1 }), /turnos/);
});

test("uploaded active backups are read-only and new games lose editing access", () => {
  start();
  store.importData(store.exportData());
  assert.equal(store.getState().game.active, false);
  store.updateImportedStats("p0", values);
  store.startGame({ opponent: "Next", date: "2026-10-14", lineup, gameDay });
  assert.throws(() => store.updateImportedStats("p0", values), /importado/);
  assert.equal(store.getState().game.statCorrections, undefined);
});

for (const base of ["first", "second", "third"]) {
  test(`pinch runner on ${base} inherits lineup, scores under own name and supports undo`, () => {
    start();
    store.recordPlateAppearance("1B", [{ playerId: "p0", from: "batter", to: base }]);
    const before = store.getState().game;
    store.substituteRunner(base, "p10");
    const game = store.getState().game;
    assert.equal(game.bases[base], "p10");
    assert.equal(game.lineupSlots[0].currentPlayerId, "p10");
    assert.equal(game.battingIndex, before.battingIndex);
    assert.equal(game.runs, before.runs);
    assert.equal(game.outs, before.outs);
    assert.equal(game.events.at(-1).runnerBase, base);
    assert.throws(() => store.substituteRunner(base, "p1"), /lineup/);
    store.recordRunnerEvent({ label: "Avance", from: base, to: "home" });
    const stats = store.calculateGameStats();
    assert.equal(stats.players.find((player) => player.id === "p10").r, 1);
    assert.equal(stats.players.find((player) => player.id === "p0").r, 0);
    assert.equal(stats.players.find((player) => player.id === "p0").h, 1);
    store.undoLastEvent();
    store.undoLastEvent();
    assert.deepEqual(store.getState().game, before);
  });
}

test("lineup substitutions also replace runners and retain reentry rules", () => {
  start();
  assert.throws(() => store.substituteRunner("first", "p10"), /corredor/);
  store.recordPlateAppearance("1B", [{ playerId: "p0", from: "batter", to: "first" }]);
  store.substitutePlayer(0, "p10");
  assert.equal(store.getState().game.bases.first, "p10");
  assert.throws(() => store.substitutePlayer(1, "p0"), /original/);
  store.substituteRunner("first", "p0");
  assert.equal(store.getState().game.bases.first, "p0");
  assert.equal(store.getState().game.gameDay.find((entry) => entry.playerId === "p10").status, "finished");
  assert.throws(() => store.substituteRunner("first", "p10"), /disponible/);
  store.finishGame();
  assert.throws(() => store.substituteRunner("first", "p11"), /activo/);
});