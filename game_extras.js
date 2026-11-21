/**
 * @fileoverview Seeded challenge URLs, L1 local leaderboard persistence/UI,
 * and hybrid mobile interaction helpers (multi-touch pinch-to-zoom, smart
 * ambiguous-tap auto-zoom, and crosshair pin-drop overlay) for World Atlas
 * City & Country Finder. Loaded as a classic browser script (attaching
 * window.GameExtras) and via CommonJS in unit tests.
 */
(function(root) {
'use strict';

const LEADERBOARD_STORAGE_KEY = 'world_atlas_leaderboard_v1';
const PLAYER_NAME_STORAGE_KEY = 'world_atlas_player_name_v1';
const MAX_ENTRIES_PER_BUCKET = 25;

const DECK_LABELS = Object.freeze({
  '1': 'Standard Atlas',
  '2': 'Dense Atlas',
  '3': 'Mega Atlas',
  'silk': 'Silk Road',
  'extreme': 'Extreme Earth',
  'ports': 'Chokepoints & Ports',
  'americas': 'Americas',
  'europe': 'Europe',
  'africa': 'Africa',
  'asia_oceania': 'Asia & Oceania',
});

const validTargets = new Set(['city', 'country']);
const validGameModes = new Set(['10round', 'blitz', 'endless']);
const validPrompts = new Set(['name', 'riddle']);
const validDecks = new Set(Object.keys(DECK_LABELS));

/**
 * Escapes HTML special characters for safe template interpolation.
 * @param {*} value Value to escape.
 * @return {string} HTML-safe text.
 */
function escapeHtml(value) {
  return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

/**
 * Strictly parses a finite number, rejecting null, booleans, arrays, objects,
 * symbols, and blank strings (unlike bare Number()).
 * @param {*} value Candidate numeric value.
 * @return {?number} Finite number or null.
 */
function parseStrictFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  }
  return null;
}

/**
 * Returns a human-friendly short name for a deck key.
 * @param {string} deck Deck selection key.
 * @return {string} Short display label.
 */
function getDeckShortName(deck) {
  return (typeof deck === 'string' &&
          Object.prototype.hasOwnProperty.call(DECK_LABELS, deck)) ?
      DECK_LABELS[deck] :
      'Dense Atlas';
}

/**
 * Normalizes a challenge seed string/number to a clean positive integer string,
 * or returns null if invalid.
 * @param {*} raw Candidate seed value.
 * @return {?string} Normalized numeric seed string or null.
 */
function normalizeSeed(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const trimmed = String(raw).trim();
  if (!/^[0-9]{1,9}$/.test(trimmed)) return null;
  const num = Number(trimmed);
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  return String(num);
}

/**
 * Validates and normalizes a challenge params object. Returns null if the seed
 * is missing or invalid; unrecognized setting fields fall back to defaults.
 * @param {*} raw Candidate challenge settings.
 * @return {?Object} Validated challenge params or null.
 */
function normalizeChallengeParams(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const seed = normalizeSeed(raw.seed);
  if (!seed) return null;
  return {
    seed,
    target: validTargets.has(raw.target) ? raw.target : 'city',
    mode: validGameModes.has(raw.mode) ? raw.mode : '10round',
    deck: validDecks.has(raw.deck) ? raw.deck : '2',
    prompt: validPrompts.has(raw.prompt) ? raw.prompt : 'name',
  };
}

/**
 * Generates a compact 6-digit challenge seed string in [100000, 999999].
 * @param {function(): number=} rngFn Optional RNG returning [0, 1).
 * @return {string} 6-digit numeric seed string.
 */
function generateRunSeed(rngFn) {
  const rand = typeof rngFn === 'function' ? rngFn : Math.random;
  const val =
      100000 + Math.floor(Math.max(0, Math.min(0.999999, rand())) * 900000);
  return String(val);
}

/**
 * Creates a deterministic Mulberry32 PRNG from a seed string.
 * @param {string} seedStr Normalized seed string.
 * @return {function(): number} Deterministic RNG returning [0, 1).
 */
function createSeededRng(seedStr) {
  let state = (Number(normalizeSeed(seedStr) || '42') ^ 0x9e3779b9) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Returns a deterministically shuffled copy of an array using Fisher-Yates.
 * @param {!Array<*>} items Input array (not mutated).
 * @param {string} seedStr Seed string.
 * @return {!Array<*>} Shuffled shallow copy.
 */
function shuffleWithSeed(items, seedStr) {
  const out = [...items];
  const rng = createSeededRng(seedStr);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Parses and validates seeded challenge query parameters from a URL search
 * string (e.g.
 * "?seed=482913&target=country&mode=10round&deck=2&prompt=riddle").
 * @param {string} searchStr URL query string.
 * @return {?Object} Validated challenge params or null if absent/invalid.
 */
function parseChallengeParams(searchStr) {
  if (!searchStr || typeof searchStr !== 'string') return null;
  let params;
  try {
    params = new URLSearchParams(searchStr);
  } catch (_) {
    // Malformed query string falls back to standard unseeded startup.
    return null;
  }
  return normalizeChallengeParams({
    seed: params.get('seed'),
    target: params.get('target'),
    mode: params.get('mode'),
    deck: params.get('deck'),
    prompt: params.get('prompt'),
  });
}

/**
 * Builds a shareable seeded challenge URL from a base page href and settings.
 * Works cleanly for both http(s):// and file:// origins.
 * @param {string} baseHref Current page URL.
 * @param {!Object} params Seed and game settings.
 * @return {string} Shareable challenge URL.
 */
function buildChallengeUrl(baseHref, params) {
  const base = String(baseHref || '').split('?')[0].split('#')[0];
  const normalized = normalizeChallengeParams({
    ...(params && typeof params === 'object' ? params : {}),
    seed: normalizeSeed(params && params.seed) || '100000',
  });
  const qs = `seed=${encodeURIComponent(normalized.seed)}&target=${
      encodeURIComponent(normalized.target)}&mode=${
      encodeURIComponent(normalized.mode)}&deck=${
      encodeURIComponent(
          normalized.deck)}&prompt=${encodeURIComponent(normalized.prompt)}`;
  return base ? `${base}?${qs}` : `?${qs}`;
}

/**
 * Computes completed-run metrics matching CountryMode.renderSummaryModalDom:
 * averages only Found rounds (using numeric elapsedSec or strict parsing) and
 * defaults accuracy to 100% when totalClicks is 0.
 * @param {!Array<!Object>} roundHistory Completed round entries.
 * @param {number} totalClicks Total clicks recorded.
 * @param {number} correctClicks Correct clicks recorded.
 * @return {{foundCount: number, accuracyPct: number, avgTimeSec: ?number}}
 */
function computeRunMetrics(roundHistory, totalClicks, correctClicks) {
  const foundRows = (Array.isArray(roundHistory) ? roundHistory : [])
                        .filter((r) => r && r.status === 'Found');
  const foundCount = foundRows.length;
  const accuracyPct =
      totalClicks > 0 ? Math.round((correctClicks / totalClicks) * 100) : 100;
  let sumSec = 0;
  let timedCount = 0;
  for (const r of foundRows) {
    let sec = parseStrictFiniteNumber(r.elapsedSec);
    if (sec === null && typeof r.time === 'string') {
      sec = parseStrictFiniteNumber(r.time.replace(/s$/i, ''));
    }
    if (sec !== null && sec >= 0) {
      sumSec += sec;
      timedCount++;
    }
  }
  const avgTimeSec =
      timedCount > 0 ? Number((sumSec / timedCount).toFixed(1)) : null;
  return {foundCount, accuracyPct, avgTimeSec};
}

/**
 * Formats a compact Wordle-style shareable text summary for a completed run.
 * @param {!Object} summary Completed run metrics and challenge URL.
 * @return {string} Multi-line shareable summary string.
 */
function formatShareResultText(summary) {
  const modeTitle = summary.countryMode ? 'Country Mode' : 'City Mode';
  const deckLabel = summary.deckLabel || 'Dense Atlas';
  const promptTag = summary.promptMode === 'riddle' ? ' • 🕵️ Riddle' : '';
  const foundText = summary.gameMode === '10round' ?
      `${summary.foundCount}/${summary.totalRounds}` :
      `${summary.foundCount} (60s Blitz)`;
  const avgNum = parseStrictFiniteNumber(summary.avgTimeSec);
  const avgStr = avgNum !== null ? `${avgNum.toFixed(1)}s` : '—';
  const emojis = (summary.roundHistory || [])
                     .map((r) => {
                       if (r.status !== 'Found') return '⚪';
                       return r.wrong === 0 ? '🟢' : '🟡';
                     })
                     .join('');
  const lines = [
    `🌍 World Atlas — ${modeTitle} (${deckLabel}${promptTag})`,
    `Score: ${Number(summary.score || 0).toLocaleString()} pts | ` +
        `Found: ${foundText} | Accuracy: ${summary.accuracyPct}% | ` +
        `Streak: 🔥${summary.bestStreak} | Avg: ${avgStr}`,
  ];
  if (emojis) lines.push(emojis);
  if (summary.challengeUrl) {
    const label = summary.gameMode === '10round' ?
        'Challenge me (same 10 targets)' :
        'Play this exact seed';
    lines.push(`🎯 ${label}: ${summary.challengeUrl}`);
  }
  return lines.join('\n');
}

/**
 * Sanitizes a user-entered leaderboard display name.
 * @param {*} raw Raw input string.
 * @return {string} Cleaned display name (1-20 chars, defaults to 'Explorer').
 */
function sanitizePlayerName(raw) {
  const cleaned = String(raw ?? '')
                      .replace(/[\x00-\x1f\x7f]+/g, ' ')
                      .replace(/\s+/g, ' ')
                      .trim()
                      .slice(0, 20);
  return cleaned || 'Explorer';
}

/**
 * Loads the last remembered display name from storage, or empty string.
 * @param {?Storage} storage Browser storage or null.
 * @return {string} Previously saved display name.
 */
function loadSavedPlayerName(storage) {
  try {
    if (!storage) return '';
    const saved = storage.getItem(PLAYER_NAME_STORAGE_KEY);
    return typeof saved === 'string' ? saved.slice(0, 20) : '';
  } catch (_) {
    // Ignore storage access errors in restricted/private contexts.
    return '';
  }
}

/**
 * Saves the player's last display name for convenience across runs.
 * @param {?Storage} storage Browser storage or null.
 * @param {string} name Sanitized player name.
 */
function savePlayerName(storage, name) {
  try {
    if (!storage) return;
    storage.setItem(PLAYER_NAME_STORAGE_KEY, sanitizePlayerName(name));
  } catch (_) {
    // Ignore quota or storage security errors.
  }
}

/**
 * Validates and normalizes a raw leaderboard entry object.
 * @param {*} raw Candidate entry.
 * @return {?Object} Validated entry or null.
 */
function normalizeLeaderboardEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const finderMode = validTargets.has(raw.finderMode) ? raw.finderMode : null;
  const gameMode = (raw.gameMode === '10round' || raw.gameMode === 'blitz') ?
      raw.gameMode :
      null;
  if (!finderMode || !gameMode) return null;
  const score = parseStrictFiniteNumber(raw.score);
  if (score === null || score < 0) return null;
  const foundCount = parseStrictFiniteNumber(raw.foundCount);
  const totalRounds = parseStrictFiniteNumber(raw.totalRounds);
  const accuracyPct = parseStrictFiniteNumber(raw.accuracyPct);
  const bestStreak = parseStrictFiniteNumber(raw.bestStreak);
  const avgTimeSec = parseStrictFiniteNumber(raw.avgTimeSec);
  return {
    id: typeof raw.id === 'string' && raw.id ?
        raw.id :
        `${Date.now()}_${Math.floor(score)}`,
    name: sanitizePlayerName(raw.name),
    finderMode,
    gameMode,
    deck: validDecks.has(raw.deck) ? raw.deck : '2',
    promptMode: validPrompts.has(raw.promptMode) ? raw.promptMode : 'name',
    score: Math.round(score),
    foundCount: foundCount !== null ? Math.max(0, Math.round(foundCount)) : 0,
    totalRounds: totalRounds !== null ? Math.max(1, Math.round(totalRounds)) :
                                        10,
    accuracyPct: accuracyPct !== null ?
        Math.max(0, Math.min(100, Math.round(accuracyPct))) :
        0,
    bestStreak: bestStreak !== null ? Math.max(0, Math.round(bestStreak)) : 0,
    avgTimeSec: avgTimeSec !== null && avgTimeSec >= 0 ?
        Number(avgTimeSec.toFixed(1)) :
        null,
    seed: normalizeSeed(raw.seed) || '100000',
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ?
        raw.createdAt :
        new Date().toISOString(),
  };
}

/**
 * Compares two leaderboard entries: highest score first, then fastest avg time
 * (null/no-found runs sort after timed runs), then earliest timestamp.
 * @param {!Object} a First entry.
 * @param {!Object} b Second entry.
 * @return {number} Sort comparator value.
 */
function compareLeaderboardEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  const aTime = typeof a.avgTimeSec === 'number' ? a.avgTimeSec : Infinity;
  const bTime = typeof b.avgTimeSec === 'number' ? b.avgTimeSec : Infinity;
  if (aTime !== bTime) return aTime - bTime;
  return String(a.createdAt).localeCompare(String(b.createdAt));
}

/**
 * Loads validated local leaderboard entries from browser storage.
 * @param {?Storage} storage Browser storage or null.
 * @return {!Array<!Object>} Validated leaderboard entries.
 */
function loadLeaderboard(storage) {
  try {
    if (!storage) return [];
    const raw = storage.getItem(LEADERBOARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    for (const item of parsed) {
      const normalized = normalizeLeaderboardEntry(item);
      if (normalized) out.push(normalized);
    }
    return out;
  } catch (_) {
    // Ignore malformed JSON or blocked storage errors.
    return [];
  }
}

/**
 * Filters and sorts leaderboard entries for a given finderMode, gameMode, and
 * optional deck filter.
 * @param {!Array<!Object>} entries All saved entries.
 * @param {!Object} filter Filter criteria ({finderMode, gameMode, deck}).
 * @return {!Array<!Object>} Sorted matching entries.
 */
function filterLeaderboard(entries, filter) {
  const {finderMode, gameMode, deck} = filter;
  return entries
      .filter(
          (e) => e.finderMode === finderMode && e.gameMode === gameMode &&
              (!deck || deck === 'all' || e.deck === deck))
      .sort(compareLeaderboardEntries);
}

let nextEntrySeq = 1;

/**
 * Persists a new completed-run score into the local leaderboard, capping each
 * (finderMode, gameMode) bucket at MAX_ENTRIES_PER_BUCKET entries.
 * @param {?Storage} storage Browser storage or null.
 * @param {*} rawEntry Candidate entry fields.
 * @return {{saved: boolean, outsideTopBucket: boolean, entry: ?Object,
 *     rankInBucket: number, totalInBucket: number}} Persistence outcome.
 */
function saveLeaderboardEntry(storage, rawEntry) {
  if (!rawEntry || typeof rawEntry !== 'object' || !storage) {
    return {
      saved: false,
      outsideTopBucket: false,
      entry: null,
      rankInBucket: 0,
      totalInBucket: 0,
    };
  }
  const entry = normalizeLeaderboardEntry({
    ...rawEntry,
    id: `${Date.now()}_${nextEntrySeq++}`,
    createdAt: typeof rawEntry.createdAt === 'string' && rawEntry.createdAt ?
        rawEntry.createdAt :
        new Date().toISOString(),
  });
  if (!entry) {
    return {
      saved: false,
      outsideTopBucket: false,
      entry: null,
      rankInBucket: 0,
      totalInBucket: 0,
    };
  }
  const existing = loadLeaderboard(storage);
  existing.push(entry);

  // Partition by (finderMode, gameMode) bucket and retain top N per bucket.
  const buckets = new Map();
  for (const item of existing) {
    const key = `${item.finderMode}:${item.gameMode}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(item);
  }
  const pruned = [];
  for (const list of buckets.values()) {
    list.sort(compareLeaderboardEntries);
    pruned.push(...list.slice(0, MAX_ENTRIES_PER_BUCKET));
  }

  const bucketList = filterLeaderboard(pruned, {
    finderMode: entry.finderMode,
    gameMode: entry.gameMode,
    deck: 'all',
  });
  const rankIdx = bucketList.findIndex((e) => e.id === entry.id);
  if (rankIdx < 0) {
    return {
      saved: false,
      outsideTopBucket: true,
      entry,
      rankInBucket: 0,
      totalInBucket: bucketList.length,
    };
  }

  try {
    storage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(pruned));
    savePlayerName(storage, entry.name);
  } catch (_) {
    // Storage quota exceeded or blocked.
    return {
      saved: false,
      outsideTopBucket: false,
      entry,
      rankInBucket: 0,
      totalInBucket: 0,
    };
  }

  return {
    saved: true,
    outsideTopBucket: false,
    entry,
    rankInBucket: rankIdx + 1,
    totalInBucket: bucketList.length,
  };
}

/**
 * Clears all locally saved leaderboard scores.
 * @param {?Storage} storage Browser storage or null.
 */
function clearLeaderboard(storage) {
  try {
    if (storage) storage.removeItem(LEADERBOARD_STORAGE_KEY);
  } catch (_) {
    // Ignore blocked storage errors.
  }
}

/**
 * Renders the L1 Local Leaderboard modal DOM using escaped HTML and declarative
 * data attributes (no inline onclick handlers).
 * @param {!Document} doc Document instance.
 * @param {!Object} opts Entries, active filters, and highlight entry id.
 */
function renderLeaderboardModalDom(doc, opts) {
  const {entries, finderMode, gameMode, highlightId} = opts;
  const filtered =
      filterLeaderboard(entries, {finderMode, gameMode, deck: 'all'});

  const tabCity = doc.getElementById('lb-tab-city');
  const tabCountry = doc.getElementById('lb-tab-country');
  const tab10 = doc.getElementById('lb-tab-10round');
  const tabBlitz = doc.getElementById('lb-tab-blitz');
  if (tabCity) tabCity.classList.toggle('active-toggle', finderMode === 'city');
  if (tabCountry) {
    tabCountry.classList.toggle('active-toggle', finderMode === 'country');
  }
  if (tab10) tab10.classList.toggle('active-toggle', gameMode === '10round');
  if (tabBlitz)
    tabBlitz.classList.toggle('active-toggle', gameMode === 'blitz');

  const metaEl = doc.getElementById('leaderboard-meta');
  if (metaEl) {
    const modeLabel = finderMode === 'country' ? 'Country Mode' : 'City Mode';
    const gameLabel =
        gameMode === 'blitz' ? '60s Blitz' : '10-Round Expedition';
    metaEl.textContent =
        `${modeLabel} • ${gameLabel} — ${filtered.length} saved run${
            filtered.length === 1 ? '' : 's'} (stored locally on this device)`;
  }

  const listEl = doc.getElementById('leaderboard-list');
  if (listEl) {
    if (filtered.length === 0) {
      listEl.innerHTML =
          `<div style="padding:26px 14px; text-align:center;" class="muted-text">` +
          `No scores saved in this bucket yet. Finish a game and click ` +
          `<strong>Save Score</strong> to record your run!</div>`;
    } else {
      const medals = ['🥇', '🥈', '🥉'];
      listEl.innerHTML =
          filtered
              .map((e, i) => {
                const rankBadge = i < 3 ? medals[i] : `#${i + 1}`;
                const isNew = highlightId && e.id === highlightId;
                const safeFound = parseStrictFiniteNumber(e.foundCount) ?? 0;
                const safeTotal = parseStrictFiniteNumber(e.totalRounds) ?? 10;
                const safeAcc = parseStrictFiniteNumber(e.accuracyPct) ?? 0;
                const safeStreak = parseStrictFiniteNumber(e.bestStreak) ?? 0;
                const safeAvg = parseStrictFiniteNumber(e.avgTimeSec);
                const safeScore = parseStrictFiniteNumber(e.score) ?? 0;
                const foundStr = e.gameMode === '10round' ?
                    `${Math.round(safeFound)}/${Math.round(safeTotal)}` :
                    `${Math.round(safeFound)} found`;
                const avgStr =
                    safeAvg !== null ? `${safeAvg.toFixed(1)}s avg` : '— avg';
                const deckName = getDeckShortName(e.deck);
                const riddleBadge = e.promptMode === 'riddle' ?
                    ` <span class="lb-mini-badge lb-badge-riddle">🕵️ 1.5x</span>` :
                    '';
                const dateStr = String(e.createdAt || '').slice(0, 10);
                return `
          <div class="history-row${isNew ? ' lb-row-highlight' : ''}">
            <div style="display:flex; align-items:center; gap:9px; min-width:0;">
              <span style="font-weight:800; width:26px; text-align:center; flex-shrink:0;">${
                    escapeHtml(rankBadge)}</span>
              <div style="min-width:0;">
                <div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                  ${escapeHtml(e.name)}
                  <span class="lb-mini-badge">${escapeHtml(deckName)}</span>${
                    riddleBadge}
                </div>
                <div class="muted-text" style="font-size:11px;">
                  ${escapeHtml(foundStr)} • ${
                    escapeHtml(Math.round(safeAcc))}% acc • 🔥${
                    escapeHtml(Math.round(safeStreak))} • ${
                    escapeHtml(avgStr)} • ${escapeHtml(dateStr)}
                </div>
              </div>
            </div>
            <div style="display:flex; align-items:center; gap:8px; flex-shrink:0;">
              <span class="stat-val-emerald" style="font-size:14px;">${
                    escapeHtml(Math.round(safeScore).toLocaleString())}</span>
              <button type="button" class="hud-btn lb-replay-btn"
                data-lb-seed="${escapeHtml(e.seed)}"
                data-lb-target="${escapeHtml(e.finderMode)}"
                data-lb-mode="${escapeHtml(e.gameMode)}"
                data-lb-deck="${escapeHtml(e.deck)}"
                data-lb-prompt="${escapeHtml(e.promptMode)}"
                title="Replay this exact target sequence">🎯 Play</button>
            </div>
          </div>`;
              })
              .join('');
    }
  }
  const modal = doc.getElementById('leaderboard-modal');
  if (modal) modal.classList.remove('hidden');
}

/**
 * Computes the incremental two-finger pinch zoom factor and midpoint shift.
 * Guards against tiny initial finger separation (< 8px) to avoid wild jumps.
 * @param {{x: number, y: number}} p1Prev Previous finger 1 screen position.
 * @param {{x: number, y: number}} p2Prev Previous finger 2 screen position.
 * @param {{x: number, y: number}} p1Curr Current finger 1 screen position.
 * @param {{x: number, y: number}} p2Curr Current finger 2 screen position.
 * @return {{scaleFactor: number, prevMidX: number, prevMidY: number,
 *     currMidX: number, currMidY: number, distPrev: number, distCurr: number}}
 */
function computePinchStep(p1Prev, p2Prev, p1Curr, p2Curr) {
  const distPrev = Math.hypot(p2Prev.x - p1Prev.x, p2Prev.y - p1Prev.y);
  const distCurr = Math.hypot(p2Curr.x - p1Curr.x, p2Curr.y - p1Curr.y);
  const prevMidX = (p1Prev.x + p2Prev.x) / 2;
  const prevMidY = (p1Prev.y + p2Prev.y) / 2;
  const currMidX = (p1Curr.x + p2Curr.x) / 2;
  const currMidY = (p1Curr.y + p2Curr.y) / 2;
  const scaleFactor =
      (distPrev >= 8 && distCurr >= 8) ? (distCurr / distPrev) : 1;
  return {
    scaleFactor,
    prevMidX,
    prevMidY,
    currMidX,
    currMidY,
    distPrev,
    distCurr,
  };
}

/**
 * Determines whether a zoomed-out Country Mode touch tap is ambiguous (touch
 * patch overlaps >= 2 countries or hits a small polygon) and should smoothly
 * auto-zoom instead of risking a fat-finger wrong guess.
 * @param {!Object} opts Tap coordinates, zoom/scale, hitCountry, and helpers.
 * @return {{shouldZoom: boolean, targetZoom: number, centerWx: number,
 *     centerWy: number}} Auto-zoom decision.
 */
function shouldAutoZoomCountryTap(opts) {
  const {
    sx,
    sy,
    zoom,
    scale,
    hitCountry,
    findCountryAt,
    screenToWorld,
    touchRadiusPx = 9,
  } = opts;
  const [centerWx, centerWy] = screenToWorld(sx, sy);
  if (zoom >= 2.2) {
    return {shouldZoom: false, targetZoom: zoom, centerWx, centerWy};
  }
  const distinctIds = new Set();
  if (hitCountry) distinctIds.add(hitCountry.id);

  // Sample inner & outer rings of the core fingertip landing-error radius.
  const rings = [
    {r: touchRadiusPx * 0.5, count: 4},
    {r: touchRadiusPx, count: 8},
  ];
  for (const ring of rings) {
    for (let i = 0; i < ring.count; i++) {
      const ang = (i / ring.count) * Math.PI * 2;
      const [wx, wy] = screenToWorld(
          sx + Math.cos(ang) * ring.r, sy + Math.sin(ang) * ring.r);
      const found = findCountryAt(wx, wy);
      if (found) distinctIds.add(found.id);
    }
  }

  let isSmallTarget = false;
  if (hitCountry && scale > 0) {
    const box = hitCountry.largestRingBbox || hitCountry.bbox;
    if (box) {
      const diagPx =
          Math.hypot((box[2] - box[0]) * scale, (box[3] - box[1]) * scale);
      if (diagPx < 30) isSmallTarget = true;
    }
  }

  if (distinctIds.size >= 2 || isSmallTarget) {
    return {
      shouldZoom: true,
      targetZoom: Math.min(6.0, Math.max(zoom * 2.4, 3.4)),
      centerWx,
      centerWy,
    };
  }
  return {shouldZoom: false, targetZoom: zoom, centerWx, centerWy};
}

/**
 * Determines whether a zoomed-out City Mode touch tap overlaps >= 2 city
 * targets within a fingertip contact radius and should smoothly auto-zoom.
 * @param {!Object} opts Tap coordinates, zoom, rendered hitboxes, and radius.
 * @return {{shouldZoom: boolean, targetZoom: number}} Auto-zoom decision.
 */
function shouldAutoZoomCityTap(opts) {
  const {sx, sy, zoom, hitboxes, touchRadiusPx = 22} = opts;
  if (zoom >= 2.2 || !Array.isArray(hitboxes)) {
    return {shouldZoom: false, targetZoom: zoom};
  }
  let nearby = 0;
  for (const item of hitboxes) {
    const dDot = Math.hypot(sx - item.sx, sy - item.sy);
    if (dDot <= touchRadiusPx) {
      nearby++;
      if (nearby >= 2) break;
      continue;
    }
    if (item.box) {
      const [x1, y1, x2, y2] = item.box;
      const cx = Math.max(x1, Math.min(sx, x2));
      const cy = Math.max(y1, Math.min(sy, y2));
      if (Math.hypot(sx - cx, sy - cy) <= touchRadiusPx * 0.5) {
        nearby++;
        if (nearby >= 2) break;
      }
    }
  }
  if (nearby >= 2) {
    return {
      shouldZoom: true,
      targetZoom: Math.min(6.0, Math.max(zoom * 2.4, 3.4)),
    };
  }
  return {shouldZoom: false, targetZoom: zoom};
}

/**
 * Draws a sleek center crosshair pin-drop reticle and non-spoiler live target
 * label on the map canvas when Crosshair Mode is active.
 * @param {!CanvasRenderingContext2D} ctx Canvas 2D context.
 * @param {!Object} opts Canvas size, theme, and live center target status.
 */
function drawCrosshairOverlay(ctx, opts) {
  const {w, h, hasTarget, labelText, mapTheme} = opts;
  const cx = opts.cx !== undefined ? opts.cx : w / 2;
  const cy = opts.cy !== undefined ? opts.cy : h / 2;
  const accent = hasTarget ? '#10b981' : '#f59e0b';

  ctx.save();
  // Outer translucent ring + crisp inner crosshair ticks.
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.stroke();

  // Four cardinal ticks leaving the exact center crystal clear.
  const tickIn = 6;
  const tickOut = 24;
  ctx.beginPath();
  ctx.moveTo(cx - tickOut, cy);
  ctx.lineTo(cx - tickIn, cy);
  ctx.moveTo(cx + tickIn, cy);
  ctx.lineTo(cx + tickOut, cy);
  ctx.moveTo(cx, cy - tickOut);
  ctx.lineTo(cx, cy - tickIn);
  ctx.moveTo(cx, cy + tickIn);
  ctx.lineTo(cx, cy + tickOut);
  ctx.stroke();

  // Tiny precision center dot.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Live non-spoiler floating pill above reticle.
  if (labelText) {
    ctx.font =
        '700 11.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const textW = ctx.measureText(labelText).width;
    const pillW = textW + 18;
    const pillH = 22;
    const px = cx - pillW / 2;
    const py = Math.max(8, cy - 48);
    ctx.fillStyle = mapTheme === 'atlas' ? 'rgba(250, 248, 242, 0.94)' :
                                           'rgba(15, 23, 42, 0.90)';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(px, py, pillW, pillH, 999);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = mapTheme === 'atlas' ? '#0f172a' : '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, cx, py + pillH / 2 + 0.5);
  }
  ctx.restore();
}

/**
 * Creates a stateful controller encapsulating L1 local leaderboard UI,
 * shareable challenge links, mobile settings drawer/dock synchronization,
 * two-finger pinch-to-zoom, smart ambiguous-tap auto-zoom, and crosshair
 * pin-drop interactions so index.html stays lean.
 * @param {!Object} deps Dependency injection callbacks from index.html.
 * @return {!Object} Controller methods and state accessors.
 */
function createExtrasController(deps) {
  const {
    doc,
    win,
    canvas,
    cam,
    getState,
    setState,
    getSafeStorage,
    getBaseScale,
    getScreenCenter,
    screenToWorld,
    clampCamera,
    zoomBy,
    findCountryAt,
    findCountryHit,
    updateHoverState,
    handleGuess,
    openDiscoveryPostcard,
    showToast,
    restartGame,
    setPromptMode,
  } = deps;

  const activePointers = new Map();
  let hadMultiTouch = false;
  let isDragging = false;
  let dragStart = {x: 0, y: 0, camX: 0, camY: 0, down: false};

  let currentRunSeed = generateRunSeed(() => Math.random());
  let isChallengeRun = false;
  let scoreSavedThisRun = false;
  let lastSavedEntryId = null;
  let lbFilterFinder = 'city';
  let lbFilterGame = '10round';
  let clearLbConfirmTimer = null;
  let clearLbArmed = false;
  let crosshairMode = false;
  let crosshairTarget = null;

  function onRestart(forcedSeed) {
    toggleMobileMenu(false);
    closeLeaderboardModal();

    const normalizedForced = normalizeSeed(forcedSeed);
    currentRunSeed = normalizedForced || generateRunSeed(() => Math.random());
    isChallengeRun = Boolean(normalizedForced);
    scoreSavedThisRun = false;
    lastSavedEntryId = null;
    crosshairTarget = null;

    const st = getState();
    const mobileTargetEl = doc.getElementById('mobile-target-type');
    if (mobileTargetEl) mobileTargetEl.value = st.finderMode;

    const challengeBadge = doc.getElementById('challenge-badge');
    if (challengeBadge) {
      if (isChallengeRun) {
        challengeBadge.textContent = `🎯 Seed #${currentRunSeed}`;
        challengeBadge.classList.remove('hidden');
      } else {
        challengeBadge.classList.add('hidden');
      }
    }
    return currentRunSeed;
  }

  function getCurrentRunMetrics() {
    const st = getState();
    return computeRunMetrics(st.roundHistory, st.totalClicks, st.correctClicks);
  }

  function onFinishGame() {
    const st = getState();
    const saveRow = doc.getElementById('summary-save-row');
    const saveStatus = doc.getElementById('summary-save-status');
    const saveBtn = doc.getElementById('btn-save-score');
    const nameInput = doc.getElementById('lb-player-name');
    if (saveRow) {
      if (st.gameMode === 'endless') {
        saveRow.classList.add('hidden');
      } else {
        saveRow.classList.remove('hidden');
        if (nameInput && !nameInput.value) {
          nameInput.value = loadSavedPlayerName(getSafeStorage());
        }
        if (saveBtn) saveBtn.disabled = scoreSavedThisRun;
        if (saveStatus && !scoreSavedThisRun) {
          saveStatus.textContent = '';
          saveStatus.classList.add('hidden');
        }
      }
    }
    updateMobileActionDock();
  }

  function saveCurrentScoreToLeaderboard() {
    const st = getState();
    if (!st.gameEnded || st.gameMode === 'endless' || scoreSavedThisRun) return;
    const nameInput = doc.getElementById('lb-player-name');
    const saveBtn = doc.getElementById('btn-save-score');
    const saveStatus = doc.getElementById('summary-save-status');
    const {foundCount, accuracyPct, avgTimeSec} = getCurrentRunMetrics();
    const res = saveLeaderboardEntry(getSafeStorage(), {
      name: nameInput ? nameInput.value : '',
      finderMode: st.finderMode,
      gameMode: st.gameMode,
      deck: st.deckSelection,
      promptMode: st.promptMode,
      score: st.score,
      foundCount,
      totalRounds: st.totalRounds,
      accuracyPct,
      bestStreak: st.bestStreak,
      avgTimeSec,
      seed: currentRunSeed,
    });
    if (!res.saved) {
      lastSavedEntryId = null;
      if (res.outsideTopBucket) {
        const msg =
            `ℹ️ Score didn't crack the local Top ${MAX_ENTRIES_PER_BUCKET} ` +
            'for this mode.';
        if (saveStatus) {
          saveStatus.textContent = msg;
          saveStatus.classList.remove('hidden');
        }
        showToast(msg, 'amber');
      } else {
        showToast(
            '⚠️ Could not save score (browser storage unavailable).', 'amber');
      }
      return;
    }
    scoreSavedThisRun = true;
    lastSavedEntryId = res.entry ? res.entry.id : null;
    if (saveBtn) saveBtn.disabled = true;
    if (saveStatus) {
      const modeLabel =
          st.finderMode === 'country' ? 'Country Mode' : 'City Mode';
      saveStatus.textContent = `✅ Saved as ${res.entry.name}! Ranked #${
          res.rankInBucket} in ${modeLabel}.`;
      saveStatus.classList.remove('hidden');
    }
  }

  function getCurrentChallengeUrl() {
    const st = getState();
    const href = (win.location && win.location.href) ? win.location.href : '';
    return buildChallengeUrl(href, {
      seed: currentRunSeed,
      target: st.finderMode,
      mode: st.gameMode,
      deck: st.deckSelection,
      prompt: st.promptMode,
    });
  }

  function tryExecCommandCopy(text) {
    try {
      if (!doc.createElement || !doc.body || !doc.execCommand) return false;
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      if (ta.style) {
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
      }
      doc.body.appendChild(ta);
      if (typeof ta.select === 'function') ta.select();
      const ok = Boolean(doc.execCommand('copy'));
      if (typeof doc.body.removeChild === 'function') doc.body.removeChild(ta);
      return ok;
    } catch (_) {
      // Fallback copy can fail when execCommand is unavailable or blocked.
      return false;
    }
  }

  function copyTextSafe(text, successMsg) {
    const failMsg =
        '⚠️ Clipboard access unavailable — unable to copy automatically in ' +
        'this browser context.';
    const nav = deps.nav;
    if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
      Promise.resolve()
          .then(() => nav.clipboard.writeText(text))
          .then(() => {
            showToast(successMsg, 'emerald');
          })
          .catch(() => {
            if (tryExecCommandCopy(text)) {
              showToast(successMsg, 'emerald');
            } else {
              showToast(failMsg, 'amber');
            }
          });
      return;
    }
    if (tryExecCommandCopy(text)) {
      showToast(successMsg, 'emerald');
    } else {
      showToast(failMsg, 'amber');
    }
  }

  function copyShareResult() {
    const st = getState();
    const {foundCount, accuracyPct, avgTimeSec} = getCurrentRunMetrics();
    const text = formatShareResultText({
      countryMode: st.finderMode === 'country',
      gameMode: st.gameMode,
      deckLabel: getDeckShortName(st.deckSelection),
      promptMode: st.promptMode,
      score: st.score,
      foundCount,
      totalRounds: st.totalRounds,
      accuracyPct,
      bestStreak: st.bestStreak,
      avgTimeSec,
      roundHistory: st.roundHistory,
      challengeUrl: getCurrentChallengeUrl(),
    });
    copyTextSafe(text, '📋 Result card copied to clipboard!');
  }

  function copyChallengeLink() {
    copyTextSafe(
        getCurrentChallengeUrl(),
        '🎯 Seeded challenge link copied — friends get the exact same targets!');
  }

  function resetClearLbArm() {
    clearLbArmed = false;
    if (clearLbConfirmTimer) {
      deps.clearTimeoutFn(clearLbConfirmTimer);
      clearLbConfirmTimer = null;
    }
    const btn = doc.getElementById('btn-lb-clear');
    if (btn) btn.textContent = '🗑️ Clear';
  }

  function renderCurrentLeaderboard() {
    renderLeaderboardModalDom(doc, {
      entries: loadLeaderboard(getSafeStorage()),
      finderMode: lbFilterFinder,
      gameMode: lbFilterGame,
      highlightId: lastSavedEntryId,
    });
  }

  function openLeaderboardModal() {
    const st = getState();
    toggleMobileMenu(false);
    const passportModal = doc.getElementById('passport-modal');
    if (passportModal) passportModal.classList.add('hidden');
    lbFilterFinder = st.finderMode;
    lbFilterGame = st.gameMode === 'blitz' ? 'blitz' : '10round';
    resetClearLbArm();
    renderCurrentLeaderboard();
  }

  function closeLeaderboardModal() {
    resetClearLbArm();
    const modal = doc.getElementById('leaderboard-modal');
    if (modal) modal.classList.add('hidden');
  }

  function setLeaderboardFilter(newFinder, newGame) {
    if (newFinder) lbFilterFinder = newFinder;
    if (newGame) lbFilterGame = newGame;
    renderCurrentLeaderboard();
  }

  function handleClearLeaderboard() {
    const btn = doc.getElementById('btn-lb-clear');
    if (!clearLbArmed) {
      clearLbArmed = true;
      if (btn) btn.textContent = '⚠️ Confirm Clear?';
      clearLbConfirmTimer = deps.setTimeoutFn(resetClearLbArm, 3500);
      return;
    }
    clearLeaderboard(getSafeStorage());
    resetClearLbArm();
    renderCurrentLeaderboard();
    showToast('🗑️ Cleared locally saved scores.', 'amber');
  }

  function launchSeededChallenge(rawParams) {
    const params = normalizeChallengeParams(rawParams);
    if (!params) return;
    const targetEl = doc.getElementById('select-target-type');
    const mobileTargetEl = doc.getElementById('mobile-target-type');
    const modeEl = doc.getElementById('select-mode');
    const densityEl = doc.getElementById('select-density');
    if (targetEl) targetEl.value = params.target;
    if (mobileTargetEl) mobileTargetEl.value = params.target;
    if (modeEl) modeEl.value = params.mode;
    if (densityEl) densityEl.value = params.deck;
    setPromptMode(params.prompt);
    restartGame(params.seed);
    showToast(`🎯 Seeded Challenge #${params.seed} loaded!`, 'emerald');
  }

  function toggleMobileMenu(forceOpen) {
    const drawer = doc.getElementById('hud-right');
    const backdrop = doc.getElementById('mobile-drawer-backdrop');
    if (!drawer || !backdrop) return;
    const shouldOpen = forceOpen !== undefined ?
        Boolean(forceOpen) :
        !drawer.classList.contains('mobile-drawer-open');
    drawer.classList.toggle('mobile-drawer-open', shouldOpen);
    backdrop.classList.toggle('hidden', !shouldOpen);
  }

  function getCrosshairCenterTarget() {
    const st = getState();
    const [cx, cy] = getScreenCenter();
    const [wx, wy] = screenToWorld(cx, cy);
    if (st.finderMode === 'country') {
      const c = findCountryHit(cx, cy, wx, wy);
      return {kind: 'country', item: c, wx, wy, cx, cy};
    }
    let bestCity = null;
    let bestDist = Infinity;
    for (const h of st.renderedCityHitboxes) {
      const d = Math.hypot(cx - h.sx, cy - h.sy);
      if (d <= 28 && d < bestDist) {
        bestDist = d;
        bestCity = h.city;
      }
    }
    return {kind: 'city', item: bestCity, wx, wy, cx, cy};
  }

  function toggleCrosshairMode(forceState) {
    crosshairMode =
        forceState !== undefined ? Boolean(forceState) : !crosshairMode;
    const drawerBtn = doc.getElementById('btn-crosshair-mode');
    const dockBtn = doc.getElementById('btn-mobile-pin');
    if (drawerBtn) {
      drawerBtn.textContent =
          crosshairMode ? '🎯 Pin-Drop: On' : '🎯 Pin-Drop: Off';
      drawerBtn.classList.toggle('active-toggle', crosshairMode);
    }
    if (dockBtn) dockBtn.classList.toggle('active-toggle', crosshairMode);
    if (!crosshairMode) {
      crosshairTarget = null;
      setState({hoveredCountry: null, hoveredCity: null});
    } else if (cam.targetZoom < 2.2) {
      cam.targetZoom = 2.2;
      clampCamera();
    }
    updateMobileActionDock();
  }

  function confirmCrosshairGuess() {
    const st = getState();
    if (!crosshairMode || st.gameEnded || st.roundResolved) return;
    const res = getCrosshairCenterTarget();
    if (!res.item) {
      showToast(
          st.finderMode === 'country' ?
              '🌊 Pan a country under the center crosshair first!' :
              '🎯 Pan a city dot under the center crosshair first!',
          'amber');
      return;
    }
    if (res.kind === 'country') {
      handleGuess(res.item, 'country', res.wx, res.wy);
    } else {
      handleGuess(res.item, 'city');
    }
  }

  function updateMobileBlitzTimer(blitzRemaining) {
    const st = getState();
    const miniStats = doc.getElementById('mobile-mini-stats');
    if (!miniStats || st.gameMode !== 'blitz') return;
    const secs = Math.max(0, Number(blitzRemaining) || 0).toFixed(1);
    miniStats.textContent =
        `⏱ ${secs}s • ${st.correctClicks}✓ • ${st.score.toLocaleString()}`;
  }

  function updateMobileActionDock() {
    const st = getState();
    const miniStats = doc.getElementById('mobile-mini-stats');
    if (miniStats) {
      if (st.gameMode === 'blitz') {
        updateMobileBlitzTimer(st.blitzRemaining);
      } else {
        const roundPart = st.gameMode === '10round' ?
            `${st.roundIndex}/${st.totalRounds}` :
            `#${st.roundIndex}`;
        miniStats.textContent = `${roundPart} • ${st.score.toLocaleString()}`;
      }
    }
    const mClue = doc.getElementById('btn-mobile-clue');
    const mRadar = doc.getElementById('btn-mobile-radar');
    const mSkip = doc.getElementById('btn-mobile-skip');
    const mRevName = doc.getElementById('btn-mobile-reveal-name');
    const mGuess = doc.getElementById('btn-mobile-guess');
    const mNext = doc.getElementById('btn-mobile-next');
    if (mClue) mClue.disabled = st.clueUsed || st.roundResolved || st.gameEnded;
    if (mRadar) {
      mRadar.disabled = st.radarUsed || st.roundResolved || st.gameEnded;
    }
    if (mSkip) {
      mSkip.classList.toggle(
          'hidden', st.roundResolved || st.gameEnded || crosshairMode);
    }
    if (mRevName) {
      const showRevName = st.promptMode === 'riddle' &&
          !st.nameRevealedInRiddle && !st.roundResolved && !st.gameEnded;
      mRevName.classList.toggle('hidden', !showRevName);
    }
    if (mGuess) {
      mGuess.classList.toggle(
          'hidden', !crosshairMode || st.roundResolved || st.gameEnded);
    }
    if (mNext) {
      mNext.classList.toggle('hidden', !st.roundResolved || st.gameEnded);
      mNext.textContent =
          st.finderMode === 'country' ? 'Next Country →' : 'Next City →';
    }
  }

  function syncCrosshairCountryTarget() {
    const st = getState();
    if (!crosshairMode || st.gameEnded || st.finderMode !== 'country') return;
    const ch = getCrosshairCenterTarget();
    crosshairTarget = ch.item;
    setState({hoveredCountry: ch.item, hoveredCity: null});
  }

  function syncCrosshairCityTarget() {
    const st = getState();
    if (!crosshairMode || st.gameEnded || st.finderMode === 'country') return;
    const ch = getCrosshairCenterTarget();
    crosshairTarget = ch.item;
    setState({hoveredCity: ch.item, hoveredCountry: null});
  }

  function renderCrosshairFrame(ctx, w, h) {
    const st = getState();
    if (!crosshairMode || st.gameEnded) return;
    const [cx, cy] = getScreenCenter();
    const item = crosshairTarget;
    let labelText = '';
    if (!st.roundResolved) {
      if (st.finderMode === 'country') {
        if (item) {
          labelText = st.foundCountryIds.has(item.id) ?
              `✓ ${item.displayName}` :
              '📍 Tap "Guess"';
        } else {
          labelText = '🌊 Move map over land';
        }
      } else {
        labelText = item ? `📍 ${item.name}` : '🎯 Move map over a city';
      }
    }
    drawCrosshairOverlay(ctx, {
      w,
      h,
      cx,
      cy,
      hasTarget: Boolean(item),
      labelText,
      mapTheme: st.mapTheme,
    });
  }

  function releasePointer(e, isCancel) {
    const pid = e.pointerId !== undefined ? e.pointerId : 1;
    activePointers.delete(pid);
    try {
      canvas.releasePointerCapture(pid);
    } catch (_) {
      // Synthetic or already-released pointer captures can throw safely.
    }

    if (activePointers.size > 0) {
      dragStart.down = false;
      return;
    }

    const wasMultiTouch = hadMultiTouch;
    hadMultiTouch = false;
    const wasDown = dragStart.down;
    dragStart.down = false;

    if (isCancel || wasMultiTouch || !wasDown) {
      isDragging = false;
      setState({isDragging: false});
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    if (!isDragging) {
      updateHoverState(sx, sy);
      const st = getState();
      if (crosshairMode && !st.roundResolved && !st.gameEnded) {
        const [wx, wy] = screenToWorld(sx, sy);
        cam.targetX = wx;
        cam.targetY = wy;
        clampCamera();
        isDragging = false;
        setState({isDragging: false});
        return;
      }

      if (e.pointerType === 'touch' && !st.roundResolved && !st.gameEnded) {
        if (st.finderMode === 'country') {
          const autoZoom = shouldAutoZoomCountryTap({
            sx,
            sy,
            zoom: cam.zoom,
            scale: getBaseScale() * cam.zoom,
            hitCountry: st.hoveredCountry,
            findCountryAt,
            screenToWorld,
          });
          if (autoZoom.shouldZoom) {
            cam.targetX = autoZoom.centerWx;
            cam.targetY = autoZoom.centerWy;
            cam.targetZoom = autoZoom.targetZoom;
            clampCamera();
            showToast('🔍 Zoomed in — tap again to confirm!', 'amber');
            isDragging = false;
            setState({isDragging: false});
            return;
          }
        } else {
          const autoZoom = shouldAutoZoomCityTap({
            sx,
            sy,
            zoom: cam.zoom,
            hitboxes: st.renderedCityHitboxes,
          });
          if (autoZoom.shouldZoom) {
            const [wx, wy] = screenToWorld(sx, sy);
            cam.targetX = wx;
            cam.targetY = wy;
            cam.targetZoom = autoZoom.targetZoom;
            clampCamera();
            showToast('🔍 Zoomed in — tap city to confirm!', 'amber');
            isDragging = false;
            setState({isDragging: false});
            return;
          }
        }
      }

      if (st.finderMode === 'country') {
        if (st.hoveredCountry) {
          if (st.roundResolved && !st.gameEnded) {
            openDiscoveryPostcard(
                st.hoveredCountry, 'country', 'explore', 0, false);
          } else {
            const [wx, wy] = screenToWorld(sx, sy);
            handleGuess(st.hoveredCountry, 'country', wx, wy);
          }
        }
      } else if (st.hoveredCity) {
        if (st.roundResolved && !st.gameEnded) {
          openDiscoveryPostcard(st.hoveredCity, 'city', 'explore', 0, false);
        } else {
          handleGuess(st.hoveredCity, 'city');
        }
      }
    }
    isDragging = false;
    setState({isDragging: false});
  }

  function bindEventListeners() {
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType !== 'touch') return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const pid = e.pointerId !== undefined ? e.pointerId : 1;
      activePointers.set(pid, {x: sx, y: sy});
      try {
        canvas.setPointerCapture(pid);
      } catch (_) {
        // Synthetic test events may omit pointer capture support.
      }

      if (activePointers.size >= 2) {
        // Freeze any in-flight camera lerp so pinching starts from the rendered
        // view.
        cam.targetX = cam.x;
        cam.targetY = cam.y;
        cam.targetZoom = cam.zoom;
        hadMultiTouch = true;
        isDragging = true;
        setState({isDragging: true});
        dragStart.down = false;
        return;
      }

      isDragging = false;
      setState({isDragging: false});
      dragStart = {
        x: sx,
        y: sy,
        camX: cam.x,
        camY: cam.y,
        down: true,
      };
    });

    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const pid = e.pointerId !== undefined ? e.pointerId : 1;
      setState({mouseScreen: {x: sx, y: sy, inside: true}});

      if (activePointers.has(pid) && activePointers.size >= 2) {
        const ids = Array.from(activePointers.keys());
        const p1Prev = activePointers.get(ids[0]);
        const p2Prev = activePointers.get(ids[1]);
        activePointers.set(pid, {x: sx, y: sy});
        const p1Curr = activePointers.get(ids[0]);
        const p2Curr = activePointers.get(ids[1]);
        const step = computePinchStep(p1Prev, p2Prev, p1Curr, p2Curr);
        const scale = getBaseScale() * cam.zoom;
        cam.targetX -= (step.currMidX - step.prevMidX) / scale;
        cam.targetY -= (step.currMidY - step.prevMidY) / scale;
        cam.x = cam.targetX;
        cam.y = cam.targetY;
        if (Math.abs(step.scaleFactor - 1) > 0.001) {
          zoomBy(step.scaleFactor, step.currMidX, step.currMidY);
          cam.zoom = cam.targetZoom;
          cam.x = cam.targetX;
          cam.y = cam.targetY;
        } else {
          clampCamera();
        }
        return;
      }

      if (activePointers.has(pid)) activePointers.set(pid, {x: sx, y: sy});

      if (dragStart.down) {
        const dx = sx - dragStart.x;
        const dy = sy - dragStart.y;
        if (!isDragging && Math.hypot(dx, dy) > 5) {
          isDragging = true;
          setState({isDragging: true});
          dragStart.camX = cam.x;
          dragStart.camY = cam.y;
          cam.targetX = cam.x;
          cam.targetY = cam.y;
        }
        if (isDragging) {
          const scale = getBaseScale() * cam.zoom;
          cam.targetX = dragStart.camX - (sx - dragStart.x) / scale;
          cam.targetY = dragStart.camY - (sy - dragStart.y) / scale;
          cam.x = cam.targetX;
          cam.y = cam.targetY;
          clampCamera();
          return;
        }
      }

      updateHoverState(sx, sy);
    });

    canvas.addEventListener('pointerup', (e) => releasePointer(e, false));
    canvas.addEventListener('pointercancel', (e) => releasePointer(e, true));

    win.addEventListener('resize', () => {
      if (win.innerWidth > 768) {
        if (crosshairMode) toggleCrosshairMode(false);
        toggleMobileMenu(false);
      }
    });

    const lbList = doc.getElementById('leaderboard-list');
    if (lbList) {
      lbList.addEventListener('click', (e) => {
        const btn = e.target && e.target.closest ?
            e.target.closest('[data-lb-seed]') :
            null;
        if (!btn) return;
        launchSeededChallenge({
          seed: btn.getAttribute('data-lb-seed'),
          target: btn.getAttribute('data-lb-target') || 'city',
          mode: btn.getAttribute('data-lb-mode') || '10round',
          deck: btn.getAttribute('data-lb-deck') || '2',
          prompt: btn.getAttribute('data-lb-prompt') || 'name',
        });
      });
    }
  }

  function getDebugSnapshot() {
    return {
      currentRunSeed,
      isChallengeRun,
      scoreSavedThisRun,
      crosshairMode,
      crosshairTargetName: crosshairTarget ?
          (crosshairTarget.displayName || crosshairTarget.name) :
          null,
    };
  }

  return {
    onRestart,
    onFinishGame,
    saveCurrentScoreToLeaderboard,
    copyShareResult,
    copyChallengeLink,
    openLeaderboardModal,
    closeLeaderboardModal,
    setLeaderboardFilter,
    handleClearLeaderboard,
    launchSeededChallenge,
    toggleMobileMenu,
    toggleCrosshairMode,
    confirmCrosshairGuess,
    updateMobileBlitzTimer,
    updateMobileActionDock,
    syncCrosshairCountryTarget,
    syncCrosshairCityTarget,
    renderCrosshairFrame,
    bindEventListeners,
    getCurrentRunSeed: () => currentRunSeed,
    getDebugSnapshot,
  };
}

const exported = {
  LEADERBOARD_STORAGE_KEY,
  PLAYER_NAME_STORAGE_KEY,
  MAX_ENTRIES_PER_BUCKET,
  escapeHtml,
  parseStrictFiniteNumber,
  getDeckShortName,
  normalizeSeed,
  normalizeChallengeParams,
  generateRunSeed,
  createSeededRng,
  shuffleWithSeed,
  parseChallengeParams,
  buildChallengeUrl,
  computeRunMetrics,
  formatShareResultText,
  sanitizePlayerName,
  loadSavedPlayerName,
  savePlayerName,
  loadLeaderboard,
  filterLeaderboard,
  saveLeaderboardEntry,
  clearLeaderboard,
  renderLeaderboardModalDom,
  computePinchStep,
  shouldAutoZoomCountryTap,
  shouldAutoZoomCityTap,
  drawCrosshairOverlay,
  createExtrasController,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exported;
}
if (root) {
  root.GameExtras = exported;
}
})(typeof window !== 'undefined' ? window : globalThis);
