'use strict';

const assert = require('assert');
const GameExtrasModule = require('./game_extras.js');
const {createHarness, HTML_SOURCE} = require('./test_game.js');

/**
 * Verifies game_extras.js module exports, extras.css link, strict parsers,
 * seeded PRNG, Challenge URL parsing/sanitization, deterministic Country & City
 * seeded replay (with non-tautological different-seed oracle), poolCycle refill
 * determinism without verbatim looping, and Wordle-style result formatting.
 */
function testGameExtrasModuleAndSeededChallenges() {
  assert(
      HTML_SOURCE.includes('<link rel="stylesheet" href="extras.css" />'),
      'index.html must load extras.css');
  assert(
      HTML_SOURCE.includes('<script src="game_extras.js"></script>'),
      'index.html must load game_extras.js');
  assert(GameExtrasModule, 'game_extras.js module must exist');

  // normalizeSeed boundary and non-string/number type guards.
  assert.strictEqual(GameExtrasModule.normalizeSeed('482913'), '482913');
  assert.strictEqual(GameExtrasModule.normalizeSeed('  007 '), '7');
  assert.strictEqual(GameExtrasModule.normalizeSeed(42), '42');
  assert.strictEqual(GameExtrasModule.normalizeSeed('999999999'), '999999999');
  assert.strictEqual(GameExtrasModule.normalizeSeed('1000000000'), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed('0'), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed('000'), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed('-5'), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed('1.5'), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed(''), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed(null), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed(undefined), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed([42]), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed(Symbol('seed')), null);
  assert.strictEqual(GameExtrasModule.normalizeSeed('<script>'), null);

  // parseStrictFiniteNumber & own-property guarded getDeckShortName.
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber(0), 0);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber(' 3.5 '), 3.5);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber(null), null);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber(''), null);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber('   '), null);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber(false), null);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber([]), null);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber(NaN), null);
  assert.strictEqual(GameExtrasModule.parseStrictFiniteNumber(Infinity), null);
  assert.strictEqual(GameExtrasModule.getDeckShortName('europe'), 'Europe');
  assert.strictEqual(
      GameExtrasModule.getDeckShortName('toString'), 'Dense Atlas');
  assert.strictEqual(GameExtrasModule.getDeckShortName(null), 'Dense Atlas');

  // parseChallengeParams valid, invalid-seed, and per-field fallback branches.
  const parsed = GameExtrasModule.parseChallengeParams(
      '?seed=482913&target=country&mode=10round&deck=2&prompt=riddle');
  assert.deepStrictEqual(parsed, {
    seed: '482913',
    target: 'country',
    mode: '10round',
    deck: '2',
    prompt: 'riddle',
  });
  assert.strictEqual(
      GameExtrasModule.parseChallengeParams('?target=country'), null);
  assert.strictEqual(
      GameExtrasModule.parseChallengeParams('?seed=bad!seed&target=evil'),
      null);
  assert.deepStrictEqual(
      GameExtrasModule.parseChallengeParams(
          '?seed=123&target=evil&mode=bad&deck=nope&prompt=bad'),
      {
        seed: '123',
        target: 'city',
        mode: '10round',
        deck: '2',
        prompt: 'name',
      },
      'Valid seed with bad fields must sanitize each field to safe defaults');

  // buildChallengeUrl strips existing query/hash and sanitizes invalid params.
  const url = GameExtrasModule.buildChallengeUrl(
      'https://nikhilbd.github.io/world-atlas-city-finder/?foo=1#bar', parsed);
  assert.strictEqual(
      url,
      'https://nikhilbd.github.io/world-atlas-city-finder/' +
          '?seed=482913&target=country&mode=10round&deck=2&prompt=riddle');
  const sanitizedUrl = GameExtrasModule.buildChallengeUrl(
      'https://example.com/atlas/',
      {seed: '42', target: 'evil', mode: 'bad', deck: 'nope', prompt: 'bad'});
  assert.strictEqual(
      sanitizedUrl,
      'https://example.com/atlas/?seed=42&target=city&mode=10round&deck=2&prompt=name');

  // Country Mode seeded replay: identical seed => identical 10 targets;
  // different seed => distinct target sequence (non-tautological oracle).
  const searchA =
      '?seed=482913&target=country&mode=10round&deck=2&prompt=riddle';
  const searchB =
      '?seed=918273&target=country&mode=10round&deck=2&prompt=riddle';
  const h1 = createHarness({seed: 1, search: searchA});
  const h2 = createHarness({seed: 999, search: searchA});
  const h3 = createHarness({seed: 1, search: searchB});
  assert.strictEqual(h1.getState().finderMode, 'country');
  assert.strictEqual(h1.getState().promptMode, 'riddle');
  assert.strictEqual(h1.getState().currentRunSeed, '482913');
  assert.strictEqual(h2.getState().currentRunSeed, '482913');
  assert.strictEqual(h3.getState().currentRunSeed, '918273');
  assert(
      !h1.elements.get('challenge-badge').classList.contains('hidden'),
      'Seeded run must display #challenge-badge');
  assert(h1.elements.get('challenge-badge').textContent.includes('482913'));

  const seq1 = [];
  const seq2 = [];
  const seq3 = [];
  for (let i = 0; i < 10; i++) {
    const t1 = h1.getState().targetCountry;
    const t2 = h2.getState().targetCountry;
    const t3 = h3.getState().targetCountry;
    seq1.push(t1.name);
    seq2.push(t2.name);
    seq3.push(t3.name);
    const [x1, y1] = h1.internals.worldToScreen(t1.wx, t1.wy);
    const [x2, y2] = h2.internals.worldToScreen(t2.wx, t2.wy);
    const [x3, y3] = h3.internals.worldToScreen(t3.wx, t3.wy);
    h1.clickScreen(x1, y1);
    h2.clickScreen(x2, y2);
    h3.clickScreen(x3, y3);
    h1.sandbox.nextRound();
    h2.sandbox.nextRound();
    h3.sandbox.nextRound();
  }
  assert.deepStrictEqual(
      seq1, seq2, 'Same challenge seed must produce identical 10 targets');
  assert.notDeepStrictEqual(
      seq1, seq3, 'Different challenge seeds must produce different sequences');

  // Unseeded restart hides #challenge-badge and clears isChallengeRun.
  h1.sandbox.restartGame();
  assert(
      h1.elements.get('challenge-badge').classList.contains('hidden'),
      'Unseeded restart must hide #challenge-badge');
  assert.strictEqual(h1.getState().isChallengeRun, false);

  // Delegated launchSeededChallenge rejects invalid seed and sanitizes bad
  // settings without clearing <select> elements.
  const prevSeed = h1.getState().currentRunSeed;
  const dispatchLbPlay = (attrs) => {
    h1.elements.get('leaderboard-list').dispatch('click', {
      target: {
        closest: (sel) => sel === '[data-lb-seed]' ?
            {getAttribute: (k) => attrs[k] || null} :
            null,
      },
    });
  };
  dispatchLbPlay({'data-lb-seed': 'not-a-seed', 'data-lb-target': 'evil'});
  assert.strictEqual(
      h1.getState().currentRunSeed, prevSeed,
      'Invalid seed in launchSeededChallenge must be a safe no-op');
  assert.strictEqual(h1.elements.get('select-target-type').value, 'country');
  dispatchLbPlay({
    'data-lb-seed': '777777',
    'data-lb-target': 'bogus',
    'data-lb-mode': 'bogus',
    'data-lb-deck': 'bogus',
    'data-lb-prompt': 'bogus',
  });
  assert.strictEqual(h1.getState().currentRunSeed, '777777');
  assert.strictEqual(h1.getState().finderMode, 'city');
  assert.strictEqual(h1.getState().promptMode, 'name');

  // City Mode seeded replay: identical seed matches, different seed differs.
  const citySearchA =
      '?seed=654321&target=city&mode=10round&deck=2&prompt=name';
  const citySearchB =
      '?seed=123456&target=city&mode=10round&deck=2&prompt=name';
  const hc1 = createHarness({seed: 1, search: citySearchA});
  const hc2 = createHarness({seed: 888, search: citySearchA});
  const hc3 = createHarness({seed: 1, search: citySearchB});
  const citySeq1 = [];
  const citySeq2 = [];
  const citySeq3 = [];
  for (let i = 0; i < 6; i++) {
    citySeq1.push(hc1.getState().targetCity.name);
    citySeq2.push(hc2.getState().targetCity.name);
    citySeq3.push(hc3.getState().targetCity.name);
    hc1.sandbox.revealTarget();
    hc2.sandbox.revealTarget();
    hc3.sandbox.revealTarget();
    hc1.sandbox.nextRound();
    hc2.sandbox.nextRound();
    hc3.sandbox.nextRound();
  }
  assert.deepStrictEqual(
      citySeq1, citySeq2, 'Same City Mode seed must produce identical targets');
  assert.notDeepStrictEqual(
      citySeq1, citySeq3,
      'Different City Mode seeds must produce different targets');

  // Pool refill determinism without verbatim looping in Endless mode (Africa
  // country deck = 52 countries).
  const refillSearch =
      '?seed=555555&target=country&mode=endless&deck=africa&prompt=name';
  const hr1 = createHarness({seed: 3, search: refillSearch});
  const hr2 = createHarness({seed: 99, search: refillSearch});
  const deckSize = hr1.getState().activeCount;
  assert.strictEqual(deckSize, 52);
  const cycle1A = [];
  const cycle2A = [];
  const cycle2B = [];
  for (let i = 0; i < deckSize * 2; i++) {
    const name1 = hr1.getState().targetCountry.name;
    const name2 = hr2.getState().targetCountry.name;
    if (i < deckSize) {
      cycle1A.push(name1);
    } else {
      cycle2A.push(name1);
      cycle2B.push(name2);
    }
    hr1.sandbox.revealTarget();
    hr2.sandbox.revealTarget();
    hr1.sandbox.nextRound();
    hr2.sandbox.nextRound();
  }
  assert.notDeepStrictEqual(
      cycle1A, cycle2A,
      'Pool refill must re-shuffle rather than repeat cycle 1');
  assert.deepStrictEqual(
      cycle2A, cycle2B,
      'Pool refill cycle 2 must stay deterministic for identical seed');

  // formatShareResultText in 10-round, Blitz, and null-avgTime variants.
  const shareText = GameExtrasModule.formatShareResultText({
    countryMode: true,
    gameMode: '10round',
    deckLabel: 'Dense Atlas',
    promptMode: 'riddle',
    score: 13420,
    foundCount: 10,
    totalRounds: 10,
    accuracyPct: 91,
    bestStreak: 8,
    avgTimeSec: 2,
    roundHistory: [
      {status: 'Found', wrong: 0},
      {status: 'Found', wrong: 2},
      {status: 'Revealed', wrong: 1},
    ],
    challengeUrl: url,
  });
  assert(shareText.includes('Country Mode'));
  assert(shareText.includes('13,420'));
  assert(shareText.includes('Avg: 2.0s'));
  assert(shareText.includes('🟢🟡⚪'));
  assert(shareText.includes('Challenge me (same 10 targets)'));
  assert(shareText.includes(url));

  const blitzShare = GameExtrasModule.formatShareResultText({
    countryMode: false,
    gameMode: 'blitz',
    deckLabel: 'Europe',
    promptMode: 'name',
    score: 4800,
    foundCount: 4,
    totalRounds: 0,
    accuracyPct: 100,
    bestStreak: 4,
    avgTimeSec: null,
    roundHistory: [],
    challengeUrl: sanitizedUrl,
  });
  assert(blitzShare.includes('City Mode'));
  assert(blitzShare.includes('4 (60s Blitz)'));
  assert(blitzShare.includes('Avg: —'));
  assert(blitzShare.includes('Play this exact seed'));
}

/**
 * Verifies L1 local Hall of Fame storage, strict normalization, multi-bucket
 * isolation, Top-25 pruning contract, Summary-vs-Leaderboard metric parity,
 * Endless mode guards, async clipboard/fallback toasts, XSS escaping,
 * Passport/Leaderboard mutual exclusion, and delegated seed replay clicks.
 */
async function testLocalLeaderboardPersistenceRankingAndDom() {
  assert(GameExtrasModule, 'game_extras.js module must exist');

  assert.strictEqual(
      GameExtrasModule.sanitizePlayerName('  Nikhil\n\t  D  '), 'Nikhil D');
  assert.strictEqual(GameExtrasModule.sanitizePlayerName('   '), 'Explorer');
  assert.strictEqual(
      GameExtrasModule.sanitizePlayerName('A'.repeat(30)).length, 20);

  // Storage fallback tests: null, malformed JSON, non-array JSON, throwing
  // getItem, null rawEntry, and throwing setItem.
  assert.deepStrictEqual(GameExtrasModule.loadLeaderboard(null), []);
  assert.deepStrictEqual(
      GameExtrasModule.loadLeaderboard({getItem: () => '{"a":1}'}), []);
  assert.deepStrictEqual(
      GameExtrasModule.loadLeaderboard({
        getItem() {
          throw new Error('SecurityError');
        },
      }),
      []);
  const badStore = {
    getItem: () => '{bad json',
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
  assert.deepStrictEqual(GameExtrasModule.loadLeaderboard(badStore), []);
  assert.strictEqual(
      GameExtrasModule.saveLeaderboardEntry(badStore, null).saved, false);
  assert.strictEqual(
      GameExtrasModule.saveLeaderboardEntry(badStore, undefined).saved, false);
  const failSave = GameExtrasModule.saveLeaderboardEntry(badStore, {
    name: 'Test',
    finderMode: 'country',
    gameMode: '10round',
    deck: '2',
    promptMode: 'name',
    score: 9000,
    foundCount: 8,
    totalRounds: 10,
    accuracyPct: 80,
    bestStreak: 5,
    avgTimeSec: 3.1,
    seed: '111111',
  });
  assert.strictEqual(failSave.saved, false);
  assert.strictEqual(failSave.outsideTopBucket, false);

  // Strict numeric coercion rejects score: null/''/false and falls back
  // totalRounds: null -> 10.
  const corruptedStore = {
    getItem: () => JSON.stringify([
      {finderMode: 'country', gameMode: '10round', score: null},
      {finderMode: 'country', gameMode: '10round', score: ''},
      {finderMode: 'country', gameMode: '10round', score: '  '},
      {finderMode: 'country', gameMode: '10round', score: false},
      {
        finderMode: 'country',
        gameMode: '10round',
        score: 5000,
        totalRounds: null,
        avgTimeSec: null,
        name: 'ValidOne',
      },
    ]),
  };
  const loadedClean = GameExtrasModule.loadLeaderboard(corruptedStore);
  assert.strictEqual(loadedClean.length, 1);
  assert.strictEqual(loadedClean[0].name, 'ValidOne');
  assert.strictEqual(loadedClean[0].totalRounds, 10);
  assert.strictEqual(loadedClean[0].avgTimeSec, null);

  // Top-25 cap, tie-breaking (timed beats null avgTimeSec), outsideTopBucket
  // rejection, multi-bucket isolation, and deck filtering.
  const map = new Map();
  const memStore = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  for (let i = 0; i < 30; i++) {
    GameExtrasModule.saveLeaderboardEntry(memStore, {
      name: `P${i}`,
      finderMode: 'country',
      gameMode: '10round',
      deck: i % 2 === 0 ? '2' : 'europe',
      promptMode: 'name',
      score: 1000 + i * 100,
      foundCount: 10,
      totalRounds: 10,
      accuracyPct: 100,
      bestStreak: 10,
      avgTimeSec: 4.0,
      seed: String(200000 + i),
    });
  }
  const tieRes = GameExtrasModule.saveLeaderboardEntry(memStore, {
    name: 'FastTie',
    finderMode: 'country',
    gameMode: '10round',
    deck: '2',
    promptMode: 'name',
    score: 3900,
    foundCount: 10,
    totalRounds: 10,
    accuracyPct: 100,
    bestStreak: 10,
    avgTimeSec: 1.5,
    seed: '333333',
  });
  assert.strictEqual(tieRes.saved, true);
  assert.strictEqual(tieRes.rankInBucket, 1);

  // 26th lower score must NOT report saved: true; must return outsideTopBucket.
  const lowRes = GameExtrasModule.saveLeaderboardEntry(memStore, {
    name: 'TooLow',
    finderMode: 'country',
    gameMode: '10round',
    deck: '2',
    promptMode: 'name',
    score: 200,
    foundCount: 1,
    totalRounds: 10,
    accuracyPct: 50,
    bestStreak: 1,
    avgTimeSec: 9.0,
    seed: '333334',
  });
  assert.strictEqual(lowRes.saved, false);
  assert.strictEqual(lowRes.outsideTopBucket, true);
  assert.strictEqual(lowRes.rankInBucket, 0);

  // Endless entries are rejected by normalizeLeaderboardEntry.
  const endlessSave = GameExtrasModule.saveLeaderboardEntry(memStore, {
    name: 'EndlessRun',
    finderMode: 'country',
    gameMode: 'endless',
    deck: '2',
    promptMode: 'name',
    score: 50000,
    foundCount: 50,
    totalRounds: 50,
    accuracyPct: 100,
    bestStreak: 50,
    avgTimeSec: 1.0,
    seed: '444444',
  });
  assert.strictEqual(endlessSave.saved, false);

  // Separate buckets (city:10round, country:blitz, city:blitz) are isolated.
  assert.strictEqual(
      GameExtrasModule
          .saveLeaderboardEntry(memStore, {
            name: 'CityAce',
            finderMode: 'city',
            gameMode: '10round',
            deck: 'europe',
            promptMode: 'name',
            score: 8800,
            foundCount: 10,
            totalRounds: 10,
            accuracyPct: 95,
            bestStreak: 7,
            avgTimeSec: 2.1,
            seed: '555551',
          })
          .saved,
      true);
  assert.strictEqual(
      GameExtrasModule
          .saveLeaderboardEntry(memStore, {
            name: 'BlitzCountry',
            finderMode: 'country',
            gameMode: 'blitz',
            deck: '2',
            promptMode: 'name',
            score: 7200,
            foundCount: 6,
            totalRounds: 6,
            accuracyPct: 86,
            bestStreak: 4,
            avgTimeSec: null,
            seed: '555552',
          })
          .saved,
      true);
  assert.strictEqual(
      GameExtrasModule
          .saveLeaderboardEntry(memStore, {
            name: 'BlitzCity',
            finderMode: 'city',
            gameMode: 'blitz',
            deck: '2',
            promptMode: 'name',
            score: 6400,
            foundCount: 5,
            totalRounds: 5,
            accuracyPct: 83,
            bestStreak: 3,
            avgTimeSec: 3.4,
            seed: '555553',
          })
          .saved,
      true);

  const allLoaded = GameExtrasModule.loadLeaderboard(memStore);
  const countryBoard = GameExtrasModule.filterLeaderboard(
      allLoaded, {finderMode: 'country', gameMode: '10round', deck: 'all'});
  assert.strictEqual(countryBoard.length, 25);
  assert.strictEqual(countryBoard[0].name, 'FastTie');
  const countryEuropeOnly = GameExtrasModule.filterLeaderboard(
      allLoaded, {finderMode: 'country', gameMode: '10round', deck: 'europe'});
  assert(countryEuropeOnly.length > 0 && countryEuropeOnly.length < 25);
  assert(countryEuropeOnly.every((e) => e.deck === 'europe'));
  assert.strictEqual(
      GameExtrasModule
          .filterLeaderboard(
              allLoaded, {finderMode: 'city', gameMode: '10round', deck: 'all'})
          .length,
      1);
  assert.strictEqual(
      GameExtrasModule
          .filterLeaderboard(
              allLoaded,
              {finderMode: 'country', gameMode: 'blitz', deck: 'all'})
          .length,
      1);
  assert.strictEqual(
      GameExtrasModule
          .filterLeaderboard(
              allLoaded, {finderMode: 'city', gameMode: 'blitz', deck: 'all'})
          .length,
      1);

  // computeRunMetrics unit parity: ignores Revealed rounds & defaults 0 clicks
  // to 100% accuracy / null avgTimeSec.
  assert.deepStrictEqual(
      GameExtrasModule.computeRunMetrics(
          [
            {status: 'Found', elapsedSec: 3.0, time: '3.0s'},
            {status: 'Revealed', elapsedSec: 0.2, time: '0.2s'},
          ],
          1, 1),
      {foundCount: 1, accuracyPct: 100, avgTimeSec: 3});
  assert.deepStrictEqual(
      GameExtrasModule.computeRunMetrics(
          [{status: 'Revealed', elapsedSec: 0.3, time: '0.3s'}], 0, 0),
      {foundCount: 0, accuracyPct: 100, avgTimeSec: null});

  // End-to-end 10-round game with 8 Found (slow 2s) + 2 Revealed (fast 0.1s)
  // verifies Summary modal DOM === saved Leaderboard entry metrics.
  const h = createHarness({seed: 19});
  h.elements.get('select-target-type').value = 'country';
  h.sandbox.changeGameSettings();
  h.stepFrame();
  for (let r = 0; r < 10; r++) {
    if (r < 8) {
      h.stepFrame(2000);
      const t = h.getState().targetCountry;
      const [sx, sy] = h.internals.worldToScreen(t.wx, t.wy);
      h.clickScreen(sx, sy);
    } else {
      h.stepFrame(100);
      h.sandbox.revealTarget();
    }
    h.sandbox.nextRound();
  }
  assert.strictEqual(h.getState().gameEnded, true);
  assert(!h.elements.get('summary-save-row').classList.contains('hidden'));
  const summaryAvgText = h.elements.get('summary-avgtime').textContent;
  const summaryAccText = h.elements.get('summary-accuracy').textContent;

  h.elements.get('lb-player-name').value = '<Nikhil> & Co';
  h.sandbox.saveCurrentScoreToLeaderboard();
  assert.strictEqual(h.elements.get('btn-save-score').disabled, true);
  assert(h.elements.get('summary-save-status').textContent.includes('#1'));
  const savedEntries = GameExtrasModule.loadLeaderboard(h.window.localStorage);
  assert.strictEqual(savedEntries.length, 1);
  assert.strictEqual(savedEntries[0].foundCount, 8);
  assert.strictEqual(`${savedEntries[0].accuracyPct}%`, summaryAccText);
  assert.strictEqual(
      `${savedEntries[0].avgTimeSec.toFixed(1)}s`, summaryAvgText);

  // Async clipboard success microtask verification.
  const flushMicrotasks = () => new Promise((r) => setImmediate(r));
  h.sandbox.copyShareResult();
  await flushMicrotasks();
  assert.strictEqual(h.copiedTexts.length, 1);
  assert(h.copiedTexts[0].includes('Country Mode'));
  assert(h.copiedTexts[0].includes(`Avg: ${summaryAvgText}`));
  assert(h.elements.get('feedback-inner').className.includes('toast-emerald'));
  h.sandbox.copyChallengeLink();
  await flushMicrotasks();
  assert.strictEqual(h.copiedTexts.length, 2);
  assert(h.copiedTexts[1].includes(`seed=${h.getState().currentRunSeed}`));

  // Clipboard rejection & missing-clipboard (file://) toast tests.
  const hReject = createHarness({
    seed: 19,
    clipboardImpl: () => Promise.reject(new Error('PermissionDenied')),
    execCommandResult: false,
  });
  hReject.sandbox.copyChallengeLink();
  await flushMicrotasks();
  assert(
      hReject.elements.get('feedback-inner').className.includes('toast-amber'),
      'Rejected clipboard without execCommand fallback must show amber toast');
  assert(hReject.elements.get('feedback-inner')
             .textContent.includes('unavailable'));

  const hNoClipFail =
      createHarness({seed: 19, clipboardImpl: null, execCommandResult: false});
  hNoClipFail.sandbox.copyChallengeLink();
  assert(
      hNoClipFail.elements.get('feedback-inner')
          .className.includes('toast-amber'),
      'Missing navigator.clipboard without execCommand must NOT fake success');

  const hNoClipFallback =
      createHarness({seed: 19, clipboardImpl: null, execCommandResult: true});
  hNoClipFallback.sandbox.copyChallengeLink();
  assert(
      hNoClipFallback.elements.get('feedback-inner')
          .className.includes('toast-emerald'),
      'execCommand fallback returning true should report emerald success');

  // Endless mode hides #summary-save-row and saveCurrentScoreToLeaderboard is
  // a no-op.
  const hEndless = createHarness({seed: 7});
  hEndless.elements.get('select-mode').value = 'endless';
  hEndless.sandbox.changeGameSettings();
  hEndless.sandbox.finishGame();
  assert(
      hEndless.elements.get('summary-save-row').classList.contains('hidden'),
      'Endless mode must hide #summary-save-row');
  hEndless.sandbox.saveCurrentScoreToLeaderboard();
  assert.strictEqual(
      GameExtrasModule.loadLeaderboard(hEndless.window.localStorage).length, 0);

  // Non-Top-25 UI save feedback leaves scoreSavedThisRun false and shows amber.
  const fullTop25 =
      Array.from({length: 25}, (_, i) => ({
                                 id: `top_${i}`,
                                 name: `Pro${i}`,
                                 finderMode: 'country',
                                 gameMode: '10round',
                                 deck: '2',
                                 promptMode: 'name',
                                 score: 90000 + i * 10,
                                 foundCount: 10,
                                 totalRounds: 10,
                                 accuracyPct: 100,
                                 bestStreak: 10,
                                 avgTimeSec: 1.0,
                                 seed: String(600000 + i),
                                 createdAt: '2026-01-01T00:00:00.000Z',
                               }));
  const hFull = createHarness({
    seed: 22,
    initialStorage: {
      [GameExtrasModule.LEADERBOARD_STORAGE_KEY]: JSON.stringify(fullTop25),
    },
  });
  hFull.elements.get('select-target-type').value = 'country';
  hFull.sandbox.changeGameSettings();
  for (let r = 0; r < 10; r++) {
    hFull.sandbox.revealTarget();
    hFull.sandbox.nextRound();
  }
  hFull.elements.get('lb-player-name').value = 'Newbie';
  hFull.sandbox.saveCurrentScoreToLeaderboard();
  assert.strictEqual(hFull.getState().scoreSavedThisRun, false);
  assert.strictEqual(hFull.elements.get('btn-save-score').disabled, false);
  assert(
      hFull.elements.get('summary-save-status').textContent.includes('Top 25'));
  assert(
      hFull.elements.get('feedback-inner').className.includes('toast-amber'));

  // renderLeaderboardModalDom XSS safety on raw un-normalized Blitz entry.
  const xssHarness = createHarness({seed: 3});
  GameExtrasModule.renderLeaderboardModalDom(xssHarness.document, {
    entries: [{
      id: 'x1',
      name: '<script>x</script>',
      finderMode: 'city',
      gameMode: 'blitz',
      deck: '2',
      promptMode: 'riddle',
      score: '<img onerror=1>',
      foundCount: '<b>5</b>',
      totalRounds: 10,
      accuracyPct: '<svg>',
      bestStreak: '<i>',
      avgTimeSec: null,
      seed: '123456',
      createdAt: '<a href=x>',
    }],
    finderMode: 'city',
    gameMode: 'blitz',
    highlightId: 'x1',
  });
  const xssHtml = xssHarness.elements.get('leaderboard-list').innerHTML;
  assert(!xssHtml.includes('<script>'));
  assert(!xssHtml.includes('<img'));
  assert(!xssHtml.includes('<svg>'));
  assert(!xssHtml.includes('<b>5</b>'));
  assert(xssHtml.includes('— avg'));
  assert(xssHtml.includes('found'));

  // Reload harness with persisted storage: verify #lb-player-name prefill,
  // Passport/Leaderboard mutual exclusion, delegated [data-lb-seed] clicks,
  // and two-tap Clear confirmation.
  const persisted = Object.fromEntries(h.storage.entries());
  const h2 = createHarness({seed: 21, initialStorage: persisted});
  h2.sandbox.finishGame();
  assert.strictEqual(
      h2.elements.get('lb-player-name').value, '<Nikhil> & Co',
      'Reloaded harness must prefill #lb-player-name from saved player name');

  // Mutual exclusion between Passport and Leaderboard modals.
  h2.sandbox.openPassportModal();
  assert(!h2.elements.get('passport-modal').classList.contains('hidden'));
  h2.sandbox.openLeaderboardModal();
  assert(
      h2.elements.get('passport-modal').classList.contains('hidden'),
      'Opening Leaderboard must hide Passport modal');
  assert(!h2.elements.get('leaderboard-modal').classList.contains('hidden'));
  h2.sandbox.openPassportModal();
  assert(
      h2.elements.get('leaderboard-modal').classList.contains('hidden'),
      'Opening Passport must hide Leaderboard modal');

  h2.sandbox.openLeaderboardModal();
  h2.sandbox.setLeaderboardFilter('country', '10round');
  const lbHtml = h2.elements.get('leaderboard-list').innerHTML;
  assert(lbHtml.includes('&lt;Nikhil&gt; &amp; Co'));
  assert(!lbHtml.includes('<Nikhil>'));
  assert(!lbHtml.includes('onclick='));
  const targetSeed = h.getState().currentRunSeed;
  assert(lbHtml.includes(`data-lb-seed="${targetSeed}"`));

  // Delegated click with non-matching target is a safe no-op.
  const seedBeforeClick = h2.getState().currentRunSeed;
  h2.elements.get('leaderboard-list').dispatch('click', {
    target: {closest: () => null},
  });
  assert(!h2.elements.get('leaderboard-modal').classList.contains('hidden'));
  assert.strictEqual(h2.getState().currentRunSeed, seedBeforeClick);

  // Delegated click on [data-lb-seed] button closes modal and loads that seed.
  const attrs = {
    'data-lb-seed': targetSeed,
    'data-lb-target': 'country',
    'data-lb-mode': '10round',
    'data-lb-deck': '2',
    'data-lb-prompt': 'riddle',
  };
  h2.elements.get('leaderboard-list').dispatch('click', {
    target: {
      closest: (sel) => sel === '[data-lb-seed]' ?
          {getAttribute: (k) => attrs[k] || null} :
          null,
    },
  });
  assert(
      h2.elements.get('leaderboard-modal').classList.contains('hidden'),
      'Clicking Play on a leaderboard row must close Leaderboard modal');
  assert.strictEqual(h2.getState().currentRunSeed, targetSeed);
  assert.strictEqual(h2.getState().finderMode, 'country');
  assert.strictEqual(h2.getState().promptMode, 'riddle');

  // Two-tap Clear confirmation clears local leaderboard cleanly.
  h2.sandbox.openLeaderboardModal();
  h2.sandbox.handleClearLeaderboard();
  assert(h2.elements.get('btn-lb-clear').textContent.includes('Confirm'));
  assert.strictEqual(
      GameExtrasModule.loadLeaderboard(h2.window.localStorage).length, 1);
  h2.sandbox.handleClearLeaderboard();
  assert.strictEqual(
      GameExtrasModule.loadLeaderboard(h2.window.localStorage).length, 0);
}

/**
 * Verifies hybrid mobile multi-touch pinch-to-zoom (including mid-lerp freeze),
 * pointer state machine edge cases (right-click, drag, pointercancel, 2->1
 * lift), branch-isolated Country Mode smart auto-zoom, and live City Mode smart
 * auto-zoom plus unit cutoff/label-box coverage.
 */
function testMobilePinchZoomAndSmartAutoZoom() {
  assert(GameExtrasModule, 'game_extras.js module must exist');

  // Unit math for pinch-to-zoom covering both distPrev < 8 and distCurr < 8.
  const zoomIn = GameExtrasModule.computePinchStep(
      {x: 100, y: 200}, {x: 200, y: 200}, {x: 50, y: 200}, {x: 250, y: 200});
  assert.strictEqual(zoomIn.scaleFactor, 2);
  assert.strictEqual(zoomIn.currMidX, 150);
  const prevSmallGuard = GameExtrasModule.computePinchStep(
      {x: 100, y: 100}, {x: 102, y: 100}, {x: 100, y: 100}, {x: 150, y: 100});
  assert.strictEqual(prevSmallGuard.scaleFactor, 1);
  const currSmallGuard = GameExtrasModule.computePinchStep(
      {x: 100, y: 100}, {x: 150, y: 100}, {x: 100, y: 100}, {x: 102, y: 100});
  assert.strictEqual(currSmallGuard.scaleFactor, 1);

  // Mobile portrait viewport (390x660): two-finger pinch zooms without guess.
  const h = createHarness({seed: 12, viewportWidth: 390, viewportHeight: 660});
  h.elements.get('select-target-type').value = 'country';
  h.sandbox.changeGameSettings();
  h.stepFrame();

  const beforeZoom = h.getState().cam.zoom;
  h.pinchZoom([150, 300], [240, 300], [105, 300], [285, 300]);
  h.stepFrame();
  assert(
      h.getState().cam.zoom > beforeZoom * 1.4,
      `Expected pinch zoom > 1.4x, got ${h.getState().cam.zoom}`);
  assert.strictEqual(
      h.getState().totalClicks, 0,
      'Pinch-to-zoom release must NOT trigger a map guess');

  // Pinching while a smooth camera lerp is in flight freezes the rendered
  // camera rather than teleporting to the old lerp target.
  h.sandbox.jumpToRegion('world', true);
  h.stepFrame();
  h.sandbox.jumpToRegion('europe', false);
  h.stepFrame(16);
  const prePinchCam = h.getState().cam;
  assert(
      Math.abs(prePinchCam.targetZoom - prePinchCam.zoom) > 0.5,
      'Expected in-flight zoom lerp before pinch');
  h.pinchZoom([160, 320], [230, 320], [160, 320], [230, 320]);
  const postPinchCam = h.getState().cam;
  assert(
      Math.abs(postPinchCam.zoom - prePinchCam.zoom) < 0.05 &&
          Math.abs(postPinchCam.x - prePinchCam.x) < 5,
      'Pinching during lerp must freeze rendered view without teleporting');

  // Pointer state machine transitions: right-click, >5px drag, single-tap
  // pointercancel, mid-pinch pointercancel, and 2->1 finger lift + move/up.
  h.sandbox.jumpToRegion('world', true);
  h.stepFrame();
  const brazil = h.internals.COUNTRIES.find((c) => c.name === 'Brazil');
  const [brx0, bry0] = h.internals.worldToScreen(brazil.wx, brazil.wy);
  h.rightClickScreen(brx0, bry0);
  assert.strictEqual(h.getState().totalClicks, 0);

  h.sandbox.jumpToRegion('europe', true);
  h.stepFrame();
  const camBeforeDrag = h.getState().cam;
  h.dragScreen(180, 300, 230, 300, 'touch', 21);
  assert.strictEqual(h.getState().totalClicks, 0);
  assert(
      Math.abs(h.getState().cam.x - camBeforeDrag.x) > 5,
      'Single-finger drag >5px must pan camera');

  h.sandbox.jumpToRegion('world', true);
  h.stepFrame();
  h.cancelPointer(brx0, bry0, 22, 'touch');
  assert.strictEqual(h.getState().totalClicks, 0);

  // Mid-pinch pointercancel followed by clean recovery.
  const canvas = h.elements.get('map-canvas');
  canvas.dispatch('pointerdown', {
    button: 0,
    clientX: 150,
    clientY: 300,
    pointerId: 31,
    pointerType: 'touch',
  });
  canvas.dispatch('pointerdown', {
    button: 0,
    clientX: 230,
    clientY: 300,
    pointerId: 32,
    pointerType: 'touch',
  });
  canvas.dispatch('pointermove', {
    button: 0,
    clientX: 130,
    clientY: 300,
    pointerId: 31,
    pointerType: 'touch',
  });
  canvas.dispatch('pointercancel', {
    button: 0,
    clientX: 130,
    clientY: 300,
    pointerId: 31,
    pointerType: 'touch',
  });
  canvas.dispatch('pointerup', {
    button: 0,
    clientX: 230,
    clientY: 300,
    pointerId: 32,
    pointerType: 'touch',
  });
  assert.strictEqual(h.getState().totalClicks, 0);

  // 2->1 finger lift with subsequent move and final release.
  canvas.dispatch('pointerdown', {
    button: 0,
    clientX: 150,
    clientY: 300,
    pointerId: 41,
    pointerType: 'touch',
  });
  canvas.dispatch('pointerdown', {
    button: 0,
    clientX: 220,
    clientY: 300,
    pointerId: 42,
    pointerType: 'touch',
  });
  canvas.dispatch('pointerup', {
    button: 0,
    clientX: 220,
    clientY: 300,
    pointerId: 42,
    pointerType: 'touch',
  });
  canvas.dispatch('pointermove', {
    button: 0,
    clientX: 152,
    clientY: 301,
    pointerId: 41,
    pointerType: 'touch',
  });
  canvas.dispatch('pointerup', {
    button: 0,
    clientX: 152,
    clientY: 301,
    pointerId: 41,
    pointerType: 'touch',
  });
  assert.strictEqual(
      h.getState().totalClicks, 0,
      '2->1 finger lift sequence must NOT trigger a guess on final finger up');

  // Verify clean recovery on the very next valid tap: huge Brazil commits.
  h.sandbox.jumpToRegion('world', true);
  h.stepFrame();
  const [brx, bry] = h.internals.worldToScreen(brazil.wx, brazil.wy);
  h.touchTapScreen(brx, bry);
  assert.strictEqual(
      h.getState().totalClicks, 1,
      'Unambiguous giant country touch tap at 1.0x should commit immediately');

  // Country Mode branch isolation for shouldAutoZoomCountryTap:
  // (A) Large country border tap: !isSmallTarget && distinctIds.size >= 2.
  h.sandbox.restartGame();
  h.stepFrame();
  const bolivia = h.internals.COUNTRIES.find((c) => c.name === 'Bolivia');
  let borderPoint = null;
  for (let i = 1; i < 200; i++) {
    const t = i / 200;
    const wx = brazil.wx + (bolivia.wx - brazil.wx) * t;
    const wy = brazil.wy + (bolivia.wy - brazil.wy) * t;
    const wxNext = brazil.wx + (bolivia.wx - brazil.wx) * ((i + 1) / 200);
    const wyNext = brazil.wy + (bolivia.wy - brazil.wy) * ((i + 1) / 200);
    if (h.internals.findCountryAt(wx, wy) === brazil &&
        h.internals.findCountryAt(wxNext, wyNext) === bolivia) {
      borderPoint = h.internals.worldToScreen(wx, wy);
      break;
    }
  }
  assert(borderPoint, 'Expected interior Brazil point adjacent to Bolivia');
  const baseScale = Math.min(390 / 1440, 660 / 700);
  const brBox = brazil.largestRingBbox || brazil.bbox;
  const brDiagPx = Math.hypot(
      (brBox[2] - brBox[0]) * baseScale, (brBox[3] - brBox[1]) * baseScale);
  assert(brDiagPx >= 30, 'Brazil must NOT trigger isSmallTarget branch');
  const borderAuto = GameExtrasModule.shouldAutoZoomCountryTap({
    sx: borderPoint[0],
    sy: borderPoint[1],
    zoom: 1.0,
    scale: baseScale,
    hitCountry: brazil,
    findCountryAt: h.internals.findCountryAt,
    screenToWorld: (sx, sy) =>
        [720 + (sx - 195) / baseScale,
         350 + (sy - 330) / baseScale,
  ],
  });
  assert.strictEqual(
      borderAuto.shouldZoom, true,
      'Large country border tap must auto-zoom via distinctIds.size >= 2');

  // (B) Isolated small island tap: isSmallTarget && distinctIds.size === 1.
  const fiji = h.internals.COUNTRIES.find((c) => c.name === 'Fiji');
  const [fsx, fsy] = h.internals.worldToScreen(fiji.wx, fiji.wy);
  const fijiBox = fiji.largestRingBbox || fiji.bbox;
  const fijiDiagPx = Math.hypot(
      (fijiBox[2] - fijiBox[0]) * baseScale,
      (fijiBox[3] - fijiBox[1]) * baseScale);
  assert(fijiDiagPx < 30, 'Fiji must trigger isSmallTarget branch');
  h.touchTapScreen(fsx, fsy);
  assert.strictEqual(
      h.getState().totalClicks, 0,
      'Isolated small island Fiji tap at 1.0x must auto-zoom via isSmallTarget');
  assert(h.getState().cam.targetZoom >= 3.0);

  // Belgium at 1.0x auto-zooms, then commits immediately once zoomed in.
  h.sandbox.jumpToRegion('world', true);
  h.stepFrame();
  const belgium = h.internals.COUNTRIES.find((c) => c.name === 'Belgium');
  const [bsx, bsy] = h.internals.worldToScreen(belgium.wx, belgium.wy);
  h.touchTapScreen(bsx, bsy);
  assert.strictEqual(h.getState().totalClicks, 0);
  assert(h.getState().cam.targetZoom >= 3.0);
  for (let i = 0; i < 40; i++) h.stepFrame(32);
  const [bsx2, bsy2] = h.internals.worldToScreen(belgium.wx, belgium.wy);
  h.touchTapScreen(bsx2, bsy2);
  assert.strictEqual(
      h.getState().totalClicks, 1,
      'Zoomed-in touch tap must commit guess immediately');

  // Live City Mode smart auto-zoom on a real dense city pair at 1.0x, then
  // commit after settling frames.
  const hCity =
      createHarness({seed: 12, viewportWidth: 390, viewportHeight: 660});
  hCity.stepFrame();
  const boxes = hCity.getState().hitboxes;
  let denseCity = null;
  for (let i = 0; i < boxes.length && !denseCity; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (Math.hypot(boxes[i].sx - boxes[j].sx, boxes[i].sy - boxes[j].sy) <=
          18) {
        denseCity = boxes[i];
        break;
      }
    }
  }
  assert(denseCity, 'Expected a real dense pair of city hitboxes at 1.0x');
  hCity.touchTapScreen(denseCity.sx, denseCity.sy);
  assert.strictEqual(
      hCity.getState().totalClicks, 0,
      'Dense City Mode touch tap at 1.0x must auto-zoom without guessing');
  assert(
      hCity.getState().cam.targetZoom >= 3.0,
      `Expected City Mode auto-zoom >= 3.0, got ${
          hCity.getState().cam.targetZoom}`);
  for (let i = 0; i < 45; i++) hCity.stepFrame(32);
  const settledHit =
      hCity.getState().hitboxes.find((item) => item.id === denseCity.id);
  assert(settledHit, 'Expected zoomed-in city hitbox after settle');
  hCity.touchTapScreen(settledHit.sx, settledHit.sy);
  assert.strictEqual(
      hCity.getState().totalClicks, 1,
      'Zoomed-in City Mode touch tap must commit guess immediately');

  // Unit cases for shouldAutoZoomCityTap: item.box proximity and zoom >= 2.2
  // cutoff.
  assert.strictEqual(
      GameExtrasModule
          .shouldAutoZoomCityTap({
            sx: 100,
            sy: 100,
            zoom: 2.2,
            hitboxes: [
              {sx: 96, sy: 100, box: null},
              {sx: 104, sy: 100, box: null},
            ],
          })
          .shouldZoom,
      false, 'City auto-zoom must not fire once zoom >= 2.2');
  assert.strictEqual(
      GameExtrasModule
          .shouldAutoZoomCityTap({
            sx: 100,
            sy: 100,
            zoom: 1.0,
            hitboxes: [
              {sx: 10, sy: 10, box: [92, 92, 108, 106]},
              {sx: 200, sy: 200, box: [96, 94, 114, 108]},
            ],
          })
          .shouldZoom,
      true, 'Overlapping label boxes must trigger City auto-zoom');
  assert.strictEqual(
      GameExtrasModule
          .shouldAutoZoomCityTap({
            sx: 100,
            sy: 100,
            zoom: 1.0,
            hitboxes: [
              {sx: 100, sy: 100, box: null},
              {sx: 260, sy: 240, box: null},
            ],
          })
          .shouldZoom,
      false);
}

/**
 * Verifies Crosshair Pin-Drop in both Country Mode (ocean rejection,
 * non-spoiler unfound label, found-country label, same-frame hover sync, toggle
 * off) and City Mode (empty-target rejection, live city preview clearing
 * hoveredCountry, confirm guess), mobile Blitz countdown timer,
 * syncMobileTargetType(), and landscape/desktop resize auto-exit guards.
 */
function testMobileCrosshairPinDropAndDrawerControls() {
  const h = createHarness({seed: 31, viewportWidth: 390, viewportHeight: 660});
  h.stepFrame();

  // syncMobileTargetType() switches City -> Country and syncs desktop dropdown.
  assert(h.elements.get('btn-mobile-menu'), 'Expected #btn-mobile-menu');
  assert(h.elements.get('mobile-bottom-dock'), 'Expected #mobile-bottom-dock');
  h.elements.get('mobile-target-type').value = 'country';
  h.sandbox.syncMobileTargetType();
  assert.strictEqual(h.getState().finderMode, 'country');
  assert.strictEqual(h.elements.get('select-target-type').value, 'country');

  // Mobile 60s Blitz countdown renders and decrements in #mobile-mini-stats.
  h.elements.get('select-mode').value = 'blitz';
  h.sandbox.changeGameSettings();
  h.stepFrame(16);
  const blitzText1 = h.elements.get('mobile-mini-stats').textContent;
  assert(blitzText1.includes('⏱'), `Expected Blitz timer, got ${blitzText1}`);
  h.stepFrame(1500);
  const blitzText2 = h.elements.get('mobile-mini-stats').textContent;
  assert(blitzText2.includes('⏱') && blitzText2 !== blitzText1);
  h.elements.get('select-mode').value = '10round';
  h.sandbox.changeGameSettings();
  h.stepFrame();

  // Mobile settings drawer toggle works cleanly.
  h.sandbox.toggleMobileMenu();
  assert(h.elements.get('hud-right').classList.contains('mobile-drawer-open'));
  h.sandbox.toggleMobileMenu(false);
  assert(!h.elements.get('hud-right').classList.contains('mobile-drawer-open'));

  // Enable Crosshair Pin-Drop mode in Country Mode.
  h.sandbox.toggleCrosshairMode();
  assert.strictEqual(h.getState().crosshairMode, true);
  assert(!h.elements.get('btn-mobile-guess').classList.contains('hidden'));

  // Center over open South Pacific ocean -> exact ocean label & reject guess.
  const oceanWx = h.internals.lonToWx(-145);
  const oceanWy = h.internals.latToWy(-25);
  assert.strictEqual(h.internals.findCountryAt(oceanWx, oceanWy), null);
  const [osx, osy] = h.internals.worldToScreen(oceanWx, oceanWy);
  h.touchTapScreen(osx, osy);
  for (let i = 0; i < 45; i++) h.stepFrame(32);
  h.stepFrame(16);
  assert.strictEqual(h.getState().hoveredCountryName, null);
  const oceanLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  assert(
      oceanLabels.includes('🌊 Move map over land'),
      `Expected ocean guidance label, got ${JSON.stringify(oceanLabels)}`);
  h.sandbox.confirmCrosshairGuess();
  assert.strictEqual(h.getState().totalClicks, 0);
  assert(h.elements.get('feedback-inner').className.includes('toast-amber'));

  // Tapping target country recenters without accidental guess, highlights on
  // same frame, and displays non-spoiler '📍 Tap "Guess"' (NOT country name!).
  const target = h.getState().targetCountry;
  const [tsx, tsy] = h.internals.worldToScreen(target.wx, target.wy);
  h.touchTapScreen(tsx, tsy);
  assert.strictEqual(
      h.getState().totalClicks, 0,
      'Map tap in Crosshair mode must recenter, not submit an accidental guess');
  for (let i = 0; i < 45; i++) h.stepFrame(32);
  h.stepFrame(16);
  assert.strictEqual(h.getState().hoveredCountryName, target.name);
  const unfoundLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  assert(
      unfoundLabels.includes('📍 Tap "Guess"'),
      `Expected non-spoiler label, got ${JSON.stringify(unfoundLabels)}`);
  assert(
      !unfoundLabels.some((t) => t.includes(target.displayName)),
      'Unfound country under crosshair must NEVER spoil its displayName');

  // Confirm guess -> resolves round & awards score.
  h.sandbox.confirmCrosshairGuess();
  assert.strictEqual(h.getState().roundResolved, true);
  assert(h.getState().score > 0);
  assert(!h.elements.get('btn-mobile-next').classList.contains('hidden'));

  // Advance round and pan back onto the already-found country -> shows
  // '✓ <displayName>' label.
  h.sandbox.nextRound();
  h.stepFrame(16);
  const [ftx, fty] = h.internals.worldToScreen(target.wx, target.wy);
  h.touchTapScreen(ftx, fty);
  for (let i = 0; i < 45; i++) h.stepFrame(32);
  h.stepFrame(16);
  const foundLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  assert(
      foundLabels.includes(`✓ ${target.displayName}`),
      `Expected found-country badge, got ${JSON.stringify(foundLabels)}`);

  // Toggling Crosshair Mode OFF clears crosshairTarget & hover state cleanly.
  h.sandbox.toggleCrosshairMode(false);
  assert.strictEqual(h.getState().crosshairMode, false);
  assert.strictEqual(h.getState().hoveredCountryName, null);
  assert.strictEqual(h.getState().crosshairTargetName, null);
  assert(h.elements.get('btn-mobile-guess').classList.contains('hidden'));

  // City Mode Crosshair Pin-Drop: empty ocean rejection + live city preview
  // clearing hoveredCountry + confirmCrosshairGuess resolution.
  h.elements.get('mobile-target-type').value = 'city';
  h.sandbox.syncMobileTargetType();
  h.sandbox.toggleCrosshairMode(true);
  const [cosx, cosy] = h.internals.worldToScreen(oceanWx, oceanWy);
  h.touchTapScreen(cosx, cosy);
  for (let i = 0; i < 45; i++) h.stepFrame(32);
  h.stepFrame(16);
  assert.strictEqual(h.getState().hoveredCountryName, null);
  assert.strictEqual(h.getState().hoveredCityName, null);
  const cityEmptyLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  assert(
      cityEmptyLabels.includes('🎯 Move map over a city'),
      `Expected empty city crosshair label, got ${
          JSON.stringify(cityEmptyLabels)}`);
  h.sandbox.confirmCrosshairGuess();
  assert.strictEqual(h.getState().totalClicks, 0);
  assert(h.elements.get('feedback-inner').className.includes('toast-amber'));

  // Center on targetCity -> shows '📍 <city.name>' & confirms cleanly.
  const tc = h.getState().targetCity;
  const tcWx = h.internals.lonToWx(tc.lon);
  const tcWy = h.internals.latToWy(tc.lat);
  const [csx, csy] = h.internals.worldToScreen(tcWx, tcWy);
  h.touchTapScreen(csx, csy);
  for (let i = 0; i < 45; i++) h.stepFrame(32);
  h.stepFrame(16);
  assert.strictEqual(h.getState().hoveredCityName, tc.name);
  assert.strictEqual(h.getState().hoveredCountryName, null);
  const cityHitLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  assert(
      cityHitLabels.includes(`📍 ${tc.name}`),
      `Expected city preview label, got ${JSON.stringify(cityHitLabels)}`);
  h.sandbox.confirmCrosshairGuess();
  assert.strictEqual(h.getState().roundResolved, true);
  assert(h.getState().score > 0);

  // Rotating to landscape (> 768px) auto-exits Crosshair Mode & closes drawer
  // so controls are never soft-locked behind hidden mobile-only buttons.
  h.sandbox.toggleMobileMenu(true);
  assert(h.elements.get('hud-right').classList.contains('mobile-drawer-open'));
  assert(
      !h.elements.get('mobile-drawer-backdrop').classList.contains('hidden'));
  h.window.innerWidth = 844;
  h.window.innerHeight = 390;
  h.window.dispatch('resize');
  assert.strictEqual(h.getState().crosshairMode, false);
  assert.strictEqual(h.getState().hoveredCityName, null);
  assert(!h.elements.get('hud-right').classList.contains('mobile-drawer-open'));
  assert(h.elements.get('mobile-drawer-backdrop').classList.contains('hidden'));
}

const EXTRAS_TESTS = [
  testGameExtrasModuleAndSeededChallenges,
  testLocalLeaderboardPersistenceRankingAndDom,
  testMobilePinchZoomAndSmartAutoZoom,
  testMobileCrosshairPinDropAndDrawerControls,
];

(async () => {
  let passed = 0;
  for (const fn of EXTRAS_TESTS) {
    await fn();
    passed++;
    console.log(`PASS: ${fn.name}`);
  }
  console.log(`\nAll ${passed}/${EXTRAS_TESTS.length} extras tests passed.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
