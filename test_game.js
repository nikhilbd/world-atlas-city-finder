'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = path.join(__dirname, 'index.html');
const HTML_SOURCE = fs.readFileSync(HTML_PATH, 'utf8');
const COUNTRY_DATA_SOURCE =
    fs.readFileSync(path.join(__dirname, 'country_data.js'), 'utf8');
const COUNTRY_MODE_SOURCE =
    fs.readFileSync(path.join(__dirname, 'country_mode.js'), 'utf8');
const GAME_EXTRAS_SOURCE =
    fs.readFileSync(path.join(__dirname, 'game_extras.js'), 'utf8');
const CountryModeModule = require('./country_mode.js');
const CountryDataModule = require('./country_data.js');

/**
 * Extracts the inline script source from an HTML document string.
 * @param {string} html Full HTML document text.
 * @return {string} Extracted JavaScript source.
 */
function extractScript(html) {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(match, 'Expected inline <script> block in index.html');
  return match[1];
}

/**
 * Creates a deterministic Mulberry32 PRNG function returning values in [0, 1).
 * @param {number} seed Integer PRNG seed.
 * @return {function(): number} Deterministic random generator.
 */
function makeSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Creates a lightweight DOMTokenList mock backed by a Set.
 * @param {!Array<string>=} initial Initial CSS class names.
 * @return {!Object} Mock classList object.
 */
function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add(...cls) {
      cls.forEach((c) => set.add(c));
    },
    remove(...cls) {
      cls.forEach((c) => set.delete(c));
    },
    toggle(c, force) {
      if (force === undefined) {
        if (set.has(c)) {
          set.delete(c);
          return false;
        }
        set.add(c);
        return true;
      }
      if (force) {
        set.add(c);
      } else {
        set.delete(c);
      }
      return !!force;
    },
    contains(c) {
      return set.has(c);
    },
  };
}

/**
 * Creates a minimal CanvasRenderingContext2D mock recording text and
 * fill/stroke operations so canvas behavior can be asserted directly.
 * @return {!Object} Mock 2D canvas context.
 */
function makeMockContext2D() {
  const drawOps = [];
  const ctx = {
    drawOps,
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'miter',
    lineCap: 'butt',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    save() {},
    restore() {},
    scale() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    roundRect() {},
    fill(rule) {
      drawOps.push({op: 'fill', rule: rule || 'nonzero', style: ctx.fillStyle});
    },
    stroke() {
      drawOps.push(
          {op: 'stroke', style: ctx.strokeStyle, width: ctx.lineWidth});
    },
    fillRect() {},
    strokeRect() {},
    setLineDash() {},
    createRadialGradient() {
      return {addColorStop() {}};
    },
    measureText(str) {
      return {width: String(str).length * 6.5};
    },
    fillText(text, x, y) {
      drawOps.push({op: 'fillText', text, x, y});
    },
  };
  return ctx;
}

/**
 * Instantiates index.html, country_data.js, country_mode.js, and game_extras.js
 * inside an isolated Node vm context with deterministic PRNG and HTML-parsed
 * DOM mocks.
 * @param {!Object=} options Optional overrides (seed, initialStorage,
 *     throwLocalStorageGetter, fetchImpl, viewportWidth, viewportHeight,
 *     search, clipboardImpl, execCommandResult).
 * @return {!Object} Test harness exposing game state, DOM mocks, and helpers.
 */
function createHarness(options = {}) {
  const elements = new Map();
  const listeners = new Map();
  const storage = new Map(Object.entries(options.initialStorage || {}));
  let fakeNow = 10000;
  let nextTimerId = 1;
  const timers = new Map();
  const rafQueue = [];

  const mockCtx = makeMockContext2D();

  const vw = options.viewportWidth || 1280;
  const vh = options.viewportHeight || 720;
  const copiedTexts = [];

  function makeElement(id, tagName = 'DIV', opts = {}) {
    const elListeners = new Map();
    const children = [];
    let rawText = opts.textContent || '';
    const el = {
      id,
      tagName,
      value: opts.value || '',
      checked: false,
      disabled: false,
      children,
      get textContent() {
        if (children.length === 0) return rawText;
        return children.map((c) => c.textContent).join('');
      },
      set textContent(v) {
        children.length = 0;
        rawText = String(v);
      },
      innerHTML: '',
      title: '',
      href: '',
      src: '',
      className: (opts.classes || []).join(' '),
      style: {},
      clientWidth: vw,
      clientHeight: vh,
      width: vw,
      height: vh,
      options: opts.options || [],
      parentElement: {clientWidth: vw, clientHeight: vh},
      classList: makeClassList(opts.classes || []),
      attrs: {},
      setAttribute(k, v) {
        this.attrs[k] = String(v);
      },
      getAttribute(k) {
        return Object.prototype.hasOwnProperty.call(this.attrs, k) ?
            this.attrs[k] :
            null;
      },
      removeAttribute(k) {
        delete this.attrs[k];
        if (k === 'src') this.src = '';
      },
      appendChild(child) {
        children.push(child);
        return child;
      },
      select() {},
      getBoundingClientRect() {
        return {left: 0, top: 0, width: vw, height: vh};
      },
      setPointerCapture() {},
      releasePointerCapture() {},
      getContext() {
        return mockCtx;
      },
      addEventListener(ev, fn) {
        if (!elListeners.has(ev)) elListeners.set(ev, []);
        elListeners.get(ev).push(fn);
      },
      dispatch(ev, eventObj = {}) {
        for (const fn of elListeners.get(ev) || []) {
          fn(eventObj);
        }
      },
      querySelector(sel) {
        const m = sel.match(/option\[value="([^"]+)"\]/);
        if (m) {
          return this.options.find((o) => o.value === m[1]) || null;
        }
        return null;
      },
    };
    return el;
  }

  // Parse all declared element IDs and initial CSS classes from index.html
  // outside <script> blocks so undeclared IDs return null (matching browsers).
  const htmlMarkupOnly = HTML_SOURCE.replace(/<script[\s\S]*?<\/script>/g, '');
  const tagWithIdRegex =
      /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g;
  let tm;
  while ((tm = tagWithIdRegex.exec(htmlMarkupOnly)) !== null) {
    const [, tagName, attrs, elId] = tm;
    const clsM = attrs.match(/\bclass="([^"]*)"/);
    const classes = clsM ? clsM[1].trim().split(/\s+/).filter(Boolean) : [];
    elements.set(elId, makeElement(elId, tagName.toUpperCase(), {classes}));
  }

  // Populate <select> options from index.html.
  const selectRegex = /<select\s+[^>]*id="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g;
  let sm;
  while ((sm = selectRegex.exec(htmlMarkupOnly)) !== null) {
    const [, selId, body] = sm;
    const opts = [];
    let selectedVal = '';
    const optRegex = /<option\s+([^>]*)>([\s\S]*?)<\/option>/g;
    let om;
    while ((om = optRegex.exec(body)) !== null) {
      const attrs = om[1];
      const text = om[2].trim();
      const valM = attrs.match(/value="([^"]+)"/);
      const value = valM ? valM[1] : text;
      const isSelected = /\bselected\b/.test(attrs);
      opts.push({value, textContent: text});
      if (isSelected || !selectedVal) selectedVal = value;
    }
    const existing = elements.get(selId);
    existing.options = opts;
    existing.value = selectedVal;
  }

  const documentMock = {
    documentElement: {classList: makeClassList([])},
    body: {
      appendChild() {},
      removeChild() {},
    },
    activeElement: null,
    getElementById(id) {
      return elements.has(id) ? elements.get(id) : null;
    },
    createElement(tagName) {
      return makeElement('', tagName.toUpperCase());
    },
    createTextNode(text) {
      return {nodeType: 3, textContent: String(text)};
    },
    execCommand(cmd) {
      return cmd === 'copy' && Boolean(options.execCommandResult);
    },
  };

  const storageImpl = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  const searchStr = options.search || '';
  const windowMock = {
    devicePixelRatio: 1,
    innerWidth: vw,
    innerHeight: vh,
    location: {
      origin: 'https://nikhilbd.github.io',
      pathname: '/world-atlas-city-finder/',
      search: searchStr,
      href: `https://nikhilbd.github.io/world-atlas-city-finder/${searchStr}`,
    },
    addEventListener(ev, fn) {
      if (!listeners.has(ev)) listeners.set(ev, []);
      listeners.get(ev).push(fn);
    },
    dispatch(ev, eventObj = {}) {
      for (const fn of listeners.get(ev) || []) {
        fn(eventObj);
      }
    },
  };
  if (options.throwLocalStorageGetter) {
    Object.defineProperty(windowMock, 'localStorage', {
      get() {
        throw new Error('SecurityError: storage blocked');
      },
    });
  } else {
    windowMock.localStorage = storageImpl;
  }

  const seededRand =
      makeSeededRandom(options.seed !== undefined ? options.seed : 42);
  const mathMock = Object.create(Math);
  mathMock.random = seededRand;

  let navigatorMock;
  if (options.clipboardImpl === null) {
    navigatorMock = {};
  } else if (typeof options.clipboardImpl === 'function') {
    navigatorMock = {
      clipboard: {
        writeText(text) {
          copiedTexts.push(String(text));
          return options.clipboardImpl(String(text));
        },
      },
    };
  } else {
    navigatorMock = {
      clipboard: {
        writeText(text) {
          copiedTexts.push(String(text));
          return Promise.resolve();
        },
      },
    };
  }

  const sandbox = {
    console,
    Math: mathMock,
    Date,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    JSON,
    RegExp,
    Error,
    URL,
    URLSearchParams,
    Infinity,
    NaN,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    window: windowMock,
    document: documentMock,
    navigator: navigatorMock,
    performance: {
      now: () => fakeNow,
    },
    fetch: options.fetchImpl ||
        (() => Promise.reject(new Error('offline in test'))),
    setTimeout(fn, ms) {
      const id = nextTimerId++;
      timers.set(id, {fn, runAt: fakeNow + ms});
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    requestAnimationFrame(fn) {
      rafQueue.push(fn);
      return rafQueue.length;
    },
  };
  if (!options.throwLocalStorageGetter) {
    sandbox.localStorage = storageImpl;
  }
  sandbox.globalThis = sandbox;
  const vmCtx = vm.createContext(sandbox);

  const scriptSrc = extractScript(HTML_SOURCE);
  vm.runInContext(COUNTRY_DATA_SOURCE, vmCtx, {filename: 'country_data.js'});
  vm.runInContext(COUNTRY_MODE_SOURCE, vmCtx, {filename: 'country_mode.js'});
  vm.runInContext(GAME_EXTRAS_SOURCE, vmCtx, {filename: 'game_extras.js'});
  sandbox.GameExtras = windowMock.GameExtras;
  sandbox.COUNTRY_META_BY_NAME = windowMock.COUNTRY_META_BY_NAME;
  sandbox.CountryMode = windowMock.CountryMode;

  const instrumented = scriptSrc + `
    window.__TEST_INTERNALS__ = {
      COUNTRIES,
      COUNTRIES_DRAW_ORDER,
      findCountryAt,
      lonToWx,
      latToWy,
      worldToScreen,
      fetchWikiThumb,
    };
  `;
  vm.runInContext(instrumented, vmCtx, {filename: 'index.html'});

  function stepFrame(deltaMs = 16) {
    fakeNow += deltaMs;
    mockCtx.drawOps.length = 0;
    const fn = rafQueue.shift();
    if (fn) fn(fakeNow);
  }

  function flushTimers(advanceMs = 5000) {
    fakeNow += advanceMs;
    const due = Array.from(timers.entries())
                    .filter(([, t]) => t.runAt <= fakeNow)
                    .sort((a, b) => a[1].runAt - b[1].runAt);
    for (const [id, t] of due) {
      if (!timers.has(id)) continue;
      timers.delete(id);
      t.fn();
    }
  }

  function clickScreen(sx, sy, pointerType = 'mouse') {
    const canvas = elements.get('map-canvas');
    canvas.dispatch(
        'pointerdown',
        {button: 0, clientX: sx, clientY: sy, pointerId: 1, pointerType});
    canvas.dispatch(
        'pointermove',
        {button: 0, clientX: sx, clientY: sy, pointerId: 1, pointerType});
    canvas.dispatch(
        'pointerup',
        {button: 0, clientX: sx, clientY: sy, pointerId: 1, pointerType});
  }

  function touchTapScreen(sx, sy) {
    clickScreen(sx, sy, 'touch');
  }

  function pinchZoom(p1Start, p2Start, p1End, p2End) {
    const canvas = elements.get('map-canvas');
    canvas.dispatch('pointerdown', {
      button: 0,
      clientX: p1Start[0],
      clientY: p1Start[1],
      pointerId: 11,
      pointerType: 'touch',
    });
    canvas.dispatch('pointerdown', {
      button: 0,
      clientX: p2Start[0],
      clientY: p2Start[1],
      pointerId: 12,
      pointerType: 'touch',
    });
    canvas.dispatch('pointermove', {
      button: 0,
      clientX: p1End[0],
      clientY: p1End[1],
      pointerId: 11,
      pointerType: 'touch',
    });
    canvas.dispatch('pointermove', {
      button: 0,
      clientX: p2End[0],
      clientY: p2End[1],
      pointerId: 12,
      pointerType: 'touch',
    });
    canvas.dispatch('pointerup', {
      button: 0,
      clientX: p1End[0],
      clientY: p1End[1],
      pointerId: 11,
      pointerType: 'touch',
    });
    canvas.dispatch('pointerup', {
      button: 0,
      clientX: p2End[0],
      clientY: p2End[1],
      pointerId: 12,
      pointerType: 'touch',
    });
  }

  function hoverScreen(sx, sy) {
    const canvas = elements.get('map-canvas');
    canvas.dispatch('pointermove', {
      button: 0,
      clientX: sx,
      clientY: sy,
      pointerId: 1,
      pointerType: 'mouse'
    });
  }

  function dragScreen(
      sx1, sy1, sx2, sy2, pointerType = 'touch', pointerId = 1) {
    const canvas = elements.get('map-canvas');
    canvas.dispatch(
        'pointerdown',
        {button: 0, clientX: sx1, clientY: sy1, pointerId, pointerType});
    canvas.dispatch(
        'pointermove',
        {button: 0, clientX: sx2, clientY: sy2, pointerId, pointerType});
    canvas.dispatch(
        'pointerup',
        {button: 0, clientX: sx2, clientY: sy2, pointerId, pointerType});
  }

  function rightClickScreen(sx, sy) {
    const canvas = elements.get('map-canvas');
    canvas.dispatch('pointerdown', {
      button: 2,
      clientX: sx,
      clientY: sy,
      pointerId: 1,
      pointerType: 'mouse',
    });
    canvas.dispatch('pointerup', {
      button: 2,
      clientX: sx,
      clientY: sy,
      pointerId: 1,
      pointerType: 'mouse',
    });
  }

  function cancelPointer(sx, sy, pointerId = 1, pointerType = 'touch') {
    const canvas = elements.get('map-canvas');
    canvas.dispatch(
        'pointerdown',
        {button: 0, clientX: sx, clientY: sy, pointerId, pointerType});
    canvas.dispatch(
        'pointercancel',
        {button: 0, clientX: sx, clientY: sy, pointerId, pointerType});
  }

  return {
    sandbox,
    window: windowMock,
    document: documentMock,
    elements,
    storage,
    copiedTexts,
    mockCtx,
    getState: () => windowMock.__GAME_DEBUG__.getState(),
    internals: windowMock.__TEST_INTERNALS__,
    stepFrame,
    flushTimers,
    clickScreen,
    touchTapScreen,
    pinchZoom,
    hoverScreen,
    dragScreen,
    rightClickScreen,
    cancelPointer,
  };
}

// --- TEST SUITE ---

function testExtractedModulesAndScoringOracles() {
  assert(
      HTML_SOURCE.includes('<script src="country_data.js"></script>'),
      'index.html must load country_data.js');
  assert(
      HTML_SOURCE.includes('<script src="country_mode.js"></script>'),
      'index.html must load country_mode.js');
  assert.strictEqual(
      Object.keys(CountryDataModule).length, 176,
      'country_data.js must export 176 named entries');

  // Exact literal oracles covering independent predicate branches and clamps:
  // elapsedSec=2 -> speed=200, streak=2 -> streakBonus=50, base=1000 => 1250.
  assert.strictEqual(
      CountryModeModule.computeRoundScore({
        elapsedSec: 2,
        streak: 2,
        roundWrongClicks: 0,
        clueUsed: false,
        radarUsed: false,
        promptMode: 'name',
        nameRevealedInRiddle: false,
      }),
      1250);
  // Riddle mode without Show Name applies 1.5x -> Math.round(1250 * 1.5) =
  // 1875.
  assert.strictEqual(
      CountryModeModule.computeRoundScore({
        elapsedSec: 2,
        streak: 2,
        roundWrongClicks: 0,
        clueUsed: false,
        radarUsed: false,
        promptMode: 'riddle',
        nameRevealedInRiddle: false,
      }),
      1875);
  // Riddle mode after Show Name drops multiplier back to 1.0x -> 1250.
  assert.strictEqual(
      CountryModeModule.computeRoundScore({
        elapsedSec: 2,
        streak: 2,
        roundWrongClicks: 0,
        clueUsed: false,
        radarUsed: false,
        promptMode: 'riddle',
        nameRevealedInRiddle: true,
      }),
      1250);
  // Heavy penalties clamp to 150 floor (225 with 1.5x detective bonus).
  assert.strictEqual(
      CountryModeModule.computeRoundScore({
        elapsedSec: 15,
        streak: 1,
        roundWrongClicks: 6,
        clueUsed: true,
        radarUsed: true,
        promptMode: 'name',
        nameRevealedInRiddle: false,
      }),
      150);
  assert.strictEqual(
      CountryModeModule.computeRoundScore({
        elapsedSec: 15,
        streak: 1,
        roundWrongClicks: 6,
        clueUsed: true,
        radarUsed: true,
        promptMode: 'riddle',
        nameRevealedInRiddle: false,
      }),
      225);
  // Speed bonus clamps at elapsedSec >= 12 (0) and streakBonus caps at 300.
  assert.strictEqual(
      CountryModeModule.computeRoundScore({
        elapsedSec: 20,
        streak: 10,
        roundWrongClicks: 0,
        clueUsed: false,
        radarUsed: false,
        promptMode: 'name',
        nameRevealedInRiddle: false,
      }),
      1300);

  // buildCountries rejects missing keys, extra keys, and empty ring lists.
  const proj = {
    lonToWx: (lon) => lon,
    latToWy: (lat) => lat,
    wxToLon: (wx) => wx,
    wyToLat: (wy) => wy,
    baseW: 1440,
    baseH: 700,
  };
  assert.throws(
      () => CountryModeModule.buildCountries(
          [['Alpha', 0, [[0, 0, 10, 0, 0, 10]]]], {}, proj),
      /Missing country metadata/);
  assert.throws(
      () => CountryModeModule.buildCountries(
          [['Alpha', 0, [[0, 0, 10, 0, 0, 10]]]],
          {Alpha: Array(17).fill('x'), Extra: Array(17).fill('x')}, proj),
      /Unexpected extra country metadata/);
  assert.throws(
      () => CountryModeModule.buildCountries(
          [['Alpha', 0, []]], {Alpha: Array(17).fill('x')}, proj),
      /no rings/);
}

function testDropdownAndStrictDomIdValidation() {
  const h = createHarness();
  assert.strictEqual(
      h.document.getElementById('nonexistent-id-xyz'), null,
      'getElementById must return null for undeclared HTML IDs');

  const sel = h.elements.get('select-target-type');
  assert(sel, 'Expected #select-target-type dropdown in index.html');
  assert.deepStrictEqual(sel.options.map((o) => o.value), ['city', 'country']);
  assert(/city mode/i.test(sel.options[0].textContent));
  assert(/country mode/i.test(sel.options[1].textContent));
  assert.strictEqual(sel.value, 'city');
}

function testCountryDataGeometryAndEnclaveLayering() {
  const h = createHarness();
  const {COUNTRIES, COUNTRIES_DRAW_ORDER, findCountryAt} = h.internals;
  assert.strictEqual(COUNTRIES.length, 176);
  assert.strictEqual(COUNTRIES_DRAW_ORDER.length, 176);

  const lesotho = COUNTRIES.find((c) => c.name === 'Lesotho');
  const southAfrica = COUNTRIES.find((c) => c.name === 'South Africa');
  assert(
      COUNTRIES_DRAW_ORDER.indexOf(lesotho) >
          COUNTRIES_DRAW_ORDER.indexOf(southAfrica),
      'Lesotho must be drawn after South Africa');

  // Even-odd hole check: South Africa alone must NOT match Lesotho's interior!
  assert.strictEqual(
      CountryModeModule.findCountryAt([southAfrica], lesotho.wx, lesotho.wy),
      null, 'South Africa polygon hole must exclude points inside Lesotho');

  // Highlighting South Africa must use evenodd fill and stroke-only highlight
  // pass so Lesotho is never painted over.
  const ctx = makeMockContext2D();
  CountryModeModule.drawCountriesLayer(ctx, {
    drawOrder: [southAfrica, lesotho],
    cam: {x: 720, y: 350, zoom: 1},
    scale: 1,
    cx: 640,
    cy: 360,
    pal: {landHover: '#fff', landFills: ['#aaa', '#bbb'], border: '#333'},
    mapTheme: 'atlas',
    countryMode: true,
    hoveredCountry: southAfrica,
    foundCountryIds: new Set([lesotho.id]),
    roundResolved: false,
    targetCountry: null,
    wrongCountryFlashes: new Map(),
    now: 1000,
  });
  const fills = ctx.drawOps.filter((o) => o.op === 'fill');
  assert.strictEqual(
      fills.length, 2,
      'Highlight pass must be stroke-only (no extra fill over Lesotho)');
  assert(
      fills.every((f) => f.rule === 'evenodd'),
      'Country fills must use evenodd rule');

  const validContinents =
      new Set(['Americas', 'Europe', 'Africa', 'Asia', 'Oceania']);
  const requiredFields = [
    'displayName',
    'continent',
    'flag',
    'capital',
    'pop',
    'areaStr',
    'subregion',
    'wiki',
    'photoWiki',
    'landmarkWiki',
    'landmarkCaption',
    'clue',
    'significance',
    'riddle',
    'climate',
  ];

  for (const c of COUNTRIES) {
    assert(validContinents.has(c.continent), `${c.name}: invalid continent`);
    assert([1, 2, 3].includes(c.tier), `${c.name}: invalid tier`);
    for (const f of requiredFields) {
      assert(
          typeof c[f] === 'string' && c[f].trim().length > 0, `${c.name}.${f}`);
    }
    assert(Number.isFinite(c.wx) && Number.isFinite(c.wy));
    assert(c.idealZoom >= 1.2 && c.idealZoom <= 5.0);

    const hit = findCountryAt(c.wx, c.wy);
    assert(
        hit && hit.name === c.name,
        `${c.name}: anchor hit ${hit ? hit.name : 'null'}`);

    const forbidden = [c.name, c.displayName].map(
        (s) => s.toLowerCase().replace(/^the /, ''));
    for (const term of new Set(forbidden)) {
      const re = new RegExp(
          `\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      assert(!re.test(c.riddle), `${c.name}: riddle leaks '${term}'`);
      assert(!re.test(c.clue), `${c.name}: clue leaks '${term}'`);
    }
  }
}

function testPassportStoragePersistenceAndErrors() {
  // 1. Cross-reload hydration & City/Country key isolation.
  const h1 = createHarness({
    initialStorage: {
      world_atlas_passport_v1: JSON.stringify(['Paris', 123, null]),
      world_atlas_country_passport_v1: JSON.stringify(['France', 'Japan']),
    },
  });
  assert.strictEqual(
      h1.getState().passportCount, 1,
      'Non-string stored entries must be ignored');
  assert.strictEqual(h1.getState().countryPassportCount, 2);

  // 2. savePassportEntry returns true once, false on duplicate.
  const fakeMap = new Map();
  const fakeStore = {
    getItem: (k) => (fakeMap.has(k) ? fakeMap.get(k) : null),
    setItem: (k, v) => fakeMap.set(k, v),
  };
  const set = CountryModeModule.loadPassportSet(fakeStore, 'k');
  assert.strictEqual(
      CountryModeModule.savePassportEntry(fakeStore, 'k', set, 'Brazil'), true);
  assert.strictEqual(
      CountryModeModule.savePassportEntry(fakeStore, 'k', set, 'Brazil'),
      false);
  assert.deepStrictEqual(JSON.parse(fakeMap.get('k')), ['Brazil']);

  // 3. Malformed JSON, non-array JSON, null storage, and throwing storage.
  const badJsonStore = {getItem: () => '{bad'};
  assert.strictEqual(
      CountryModeModule.loadPassportSet(badJsonStore, 'k').size, 0);
  const nonArrayStore = {getItem: () => '{"a":1}'};
  assert.strictEqual(
      CountryModeModule.loadPassportSet(nonArrayStore, 'k').size, 0);
  assert.strictEqual(CountryModeModule.loadPassportSet(null, 'k').size, 0);
  const throwingStore = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.strictEqual(
      CountryModeModule.loadPassportSet(throwingStore, 'k').size, 0);
  assert.strictEqual(
      CountryModeModule.savePassportEntry(
          throwingStore, 'k', new Set(), 'Peru'),
      true);

  // 4. Restricted iframe where accessing window.localStorage itself throws.
  const hRestricted = createHarness({throwLocalStorageGetter: true});
  assert.strictEqual(hRestricted.getState().finderMode, 'city');
  assert(
      hRestricted.getState().targetCity,
      'Game must initialize even when localStorage getter throws');
}

function testCityModeRegressionAndAmericasFix() {
  const h = createHarness();
  h.stepFrame();
  assert.strictEqual(h.getState().finderMode, 'city');
  assert(h.getState().targetCity);
  assert.strictEqual(
      h.elements.get('target-badge-label').textContent, 'Find City');

  const decks = [
    '1', '2', '3', 'silk', 'extreme', 'ports', 'americas', 'europe', 'africa',
    'asia_oceania'
  ];
  for (const d of decks) {
    h.elements.get('select-density').value = d;
    h.sandbox.changeGameSettings();
    const st = h.getState();
    assert(st.targetCity, `City deck '${d}' must pick a target`);
    assert(st.activeCount > 0);
    if (d === 'americas') assert.strictEqual(st.activeCount, 51);
  }

  h.elements.get('select-density').value = '2';
  h.sandbox.changeGameSettings();
  h.stepFrame();
  const target = h.getState().targetCity;
  const wrongHit = h.getState().hitboxes.find((b) => b.id !== target.id);
  const targetHit = h.getState().hitboxes.find((b) => b.id === target.id);
  h.clickScreen(wrongHit.sx, wrongHit.sy);
  assert.strictEqual(h.getState().roundResolved, false);
  h.clickScreen(targetHit.sx, targetHit.sy);
  const st1 = h.getState();
  assert.strictEqual(st1.roundResolved, true);
  assert.strictEqual(st1.passportCount, 1);
  assert.strictEqual(st1.postcardVisible, true);
  assert.strictEqual(
      h.elements.get('pc-vital-label-1').textContent, '👥 Metro Pop');
}

function testCountryModeCoreGameplayNoSpoilersAndEscaping() {
  const h = createHarness();
  h.elements.get('select-target-type').value = 'country';
  h.sandbox.changeGameSettings();
  h.stepFrame();

  const st0 = h.getState();
  assert.strictEqual(st0.finderMode, 'country');
  assert(st0.targetCountry);
  assert.strictEqual(
      h.elements.get('target-badge-label').textContent, 'Find Country');
  assert.strictEqual(
      h.elements.get('target-city-name').textContent,
      st0.targetCountry.displayName.toUpperCase());
  assert(
      /10-Country/i.test(h.elements.get('select-mode').options[0].textContent));
  assert(
      /Countries/i.test(
          h.elements.get('select-density').options[0].textContent));
  assert.strictEqual(h.elements.get('passport-count').textContent, '0/176');

  const decks = [
    '1', '2', '3', 'silk', 'extreme', 'ports', 'americas', 'europe', 'africa',
    'asia_oceania'
  ];
  for (const d of decks) {
    h.elements.get('select-density').value = d;
    h.sandbox.changeGameSettings();
    assert(h.getState().targetCountry);
    assert(h.getState().activeCount >= 10);
  }

  h.elements.get('select-density').value = '3';
  h.sandbox.changeGameSettings();
  h.stepFrame();

  const target = h.getState().targetCountry;
  const [tsx, tsy] = h.internals.worldToScreen(target.wx, target.wy);
  h.hoverScreen(tsx, tsy);
  assert.strictEqual(
      h.elements.get('status-country').textContent, '🗺️ Click to guess country');

  // Direct branch verification of formatCountryHoverStatus (independent flags).
  assert.strictEqual(
      CountryModeModule.formatCountryHoverStatus(null, false, false, false),
      '🌊 Ocean');
  assert.strictEqual(
      CountryModeModule.formatCountryHoverStatus(target, true, false, false),
      `✓ ${target.displayName}`);
  assert.strictEqual(
      CountryModeModule.formatCountryHoverStatus(target, false, false, true),
      `🗺️ ${target.displayName}`);

  // Clicking open ocean must NOT count as a guess (uses real lonToWx/latToWy).
  const [oceanSx, oceanSy] = h.internals.worldToScreen(
      h.internals.lonToWx(-135), h.internals.latToWy(-35));
  h.clickScreen(oceanSx, oceanSy);
  assert.strictEqual(h.getState().totalClicks, 0);

  // Wrong country click gives directional feedback.
  const wrongCountry = h.internals.COUNTRIES.find(
      (c) => c.name !== target.name && c.continent !== target.continent);
  const [wsx, wsy] =
      h.internals.worldToScreen(wrongCountry.wx, wrongCountry.wy);
  h.clickScreen(wsx, wsy);
  assert.strictEqual(h.getState().totalClicks, 1);
  assert.strictEqual(h.getState().roundResolved, false);
  assert(h.elements.get('feedback-inner')
             .textContent.includes(wrongCountry.displayName));

  // Target click resolves round, updates status bar immediately, opens Country
  // Postcard.
  h.clickScreen(tsx, tsy);
  const stWin = h.getState();
  assert.strictEqual(stWin.roundResolved, true);
  assert.strictEqual(stWin.countryPassportCount, 1);
  assert.strictEqual(stWin.passportCount, 0);
  assert.strictEqual(stWin.postcardTitle, target.displayName);
  assert.strictEqual(
      h.elements.get('pc-vital-label-1').textContent, '🏛️ Capital');
  assert.strictEqual(h.elements.get('pc-pop').textContent, target.capital);
  assert.strictEqual(h.elements.get('pc-elev').textContent, target.pop);
  assert.strictEqual(h.elements.get('pc-utc').textContent, target.areaStr);
  assert.strictEqual(
      h.elements.get('pc-climate').textContent, target.subregion);
  assert(h.elements.get('status-country')
             .textContent.includes(target.displayName));

  // Inspecting an undiscovered country post-round shows 'Not Yet in Passport'.
  h.clickScreen(wsx, wsy);
  assert.strictEqual(h.getState().postcardTitle, wrongCountry.displayName);
  assert.strictEqual(
      h.elements.get('pc-passport-badge').textContent,
      '🛂 Not Yet in Passport');

  // Advance to round 2 and verify mid-round Passport inspection CANNOT skip
  // round.
  h.sandbox.nextRound();
  assert.strictEqual(h.getState().roundIndex, 2);
  assert.strictEqual(h.getState().roundResolved, false);
  h.sandbox.inspectPassportItem(target.id);
  assert(
      h.elements.get('btn-postcard-next').classList.contains('hidden'),
      'Next button on postcard must hide when inspecting passport during an active round');
  h.sandbox.nextRound();
  assert.strictEqual(
      h.getState().roundIndex, 2,
      'nextRound() must be a no-op while roundResolved is false');

  // HTML escaping check for modal templates.
  assert.strictEqual(
      CountryModeModule.escapeHtml('<img src=x onerror="alert(1)">&\''),
      '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;');
}

function testCountryModeRiddleClueRadarRevealAndLabelsDeterministic() {
  const h = createHarness({seed: 7});
  h.elements.get('select-target-type').value = 'country';
  h.sandbox.changeGameSettings();
  h.stepFrame();

  h.sandbox.togglePromptMode();
  const target1 = h.getState().targetCountry;
  assert.strictEqual(h.getState().promptMode, 'riddle');
  assert.strictEqual(
      h.elements.get('target-city-name').textContent, target1.riddle);

  // Wrong click in riddle mode must not spoil target country name.
  const wrong = h.internals.COUNTRIES.find((c) => c.name !== target1.name);
  const [wsx, wsy] = h.internals.worldToScreen(wrong.wx, wrong.wy);
  h.clickScreen(wsx, wsy);
  const toast = h.elements.get('feedback-inner').textContent;
  assert(toast.includes('Target country'));
  assert(!toast.toLowerCase().includes(target1.displayName.toLowerCase()));

  // Clue uses safe DOM nodes (no raw innerHTML) and includes capital/continent.
  h.sandbox.useClue();
  const clueEl = h.elements.get('clue-text');
  assert.strictEqual(
      clueEl.innerHTML, '',
      'useClue must build DOM nodes rather than innerHTML');
  assert(clueEl.textContent.includes(target1.capital));
  assert(clueEl.textContent.includes(target1.continent));

  h.sandbox.useRadar();
  assert(h.elements.get('btn-radar').disabled);

  // Solve target1: elapsed=0s (speed=240), streak=1 (0), 1 wrong (-150), clue
  // (-150), radar (-300) => raw = 1000 + 240 - 600 = 640; * 1.5 detective =
  // 960.
  const [tsx, tsy] = h.internals.worldToScreen(target1.wx, target1.wy);
  h.clickScreen(tsx, tsy);
  assert.strictEqual(h.getState().score, 960);

  // Advance to round 2 at settled world zoom to test ALL 3 country label modes
  // cleanly!
  h.sandbox.nextRound();
  h.stepFrame();
  const target2 = h.getState().targetCountry;
  const unfoundSample =
      h.internals.COUNTRIES
          .filter(
              (c) => c.id !== target1.id && c.id !== target2.id && c.tier <= 2)
          .sort((a, b) => b.area - a.area)[0];
  const allCountryNames =
      new Set(h.internals.COUNTRIES.map((c) => c.displayName));

  // Mode 'found': draws target1 (already found), does NOT draw unfound
  // countries!
  const foundLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  assert(
      foundLabels.includes(target1.displayName),
      'Found mode must draw already-found country');
  assert(
      !foundLabels.includes(target2.displayName),
      'Found mode must NOT spoil unfound target');
  assert(
      !foundLabels.includes(unfoundSample.displayName),
      'Found mode must NOT draw unfound countries');

  // Mode 'all': draws unfound active countries on map!
  h.sandbox.toggleLabelMode();
  assert.strictEqual(h.getState().countryLabelMode, 'all');
  h.stepFrame();
  const allLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  assert(
      allLabels.includes(unfoundSample.displayName),
      'All mode must draw unfound active country');
  const allCountryLabels = allLabels.filter((t) => allCountryNames.has(t));
  assert(
      allCountryLabels.length > 20,
      `Expected >20 country labels in all mode, got ${
          allCountryLabels.length}`);

  // Mode 'none': draws ZERO country labels even for found countries!
  h.sandbox.toggleLabelMode();
  assert.strictEqual(h.getState().countryLabelMode, 'none');
  h.stepFrame();
  const noneLabels =
      h.mockCtx.drawOps.filter((op) => op.op === 'fillText').map((o) => o.text);
  const noneCountryLabels = noneLabels.filter((t) => allCountryNames.has(t));
  assert.strictEqual(
      noneCountryLabels.length, 0,
      `None mode must draw 0 country labels, got ${
          noneCountryLabels.join(', ')}`);

  // Back to 'found', test Show Name + Reveal.
  h.sandbox.toggleLabelMode();
  assert.strictEqual(h.getState().countryLabelMode, 'found');
  h.sandbox.revealDetectiveName();
  assert.strictEqual(
      h.elements.get('target-city-name').textContent,
      target2.displayName.toUpperCase());
  h.sandbox.revealTarget();
  assert.strictEqual(h.getState().roundResolved, true);
  assert.strictEqual(h.getState().streak, 0);
}

function testCountryMode10RoundSummaryPassportBlitzAndModeSwitch() {
  const h = createHarness({seed: 99});
  h.elements.get('select-target-type').value = 'country';
  h.elements.get('select-mode').value = '10round';
  h.elements.get('select-density').value = '1';
  h.sandbox.changeGameSettings();

  for (let r = 1; r <= 10; r++) {
    h.stepFrame();
    const target = h.getState().targetCountry;
    const [sx, sy] = h.internals.worldToScreen(target.wx, target.wy);
    h.clickScreen(sx, sy);
    assert.strictEqual(h.getState().roundResolved, true);
    h.sandbox.nextRound();
  }

  assert.strictEqual(h.getState().gameEnded, true);
  assert(!h.elements.get('summary-modal').classList.contains('hidden'));
  assert.strictEqual(h.elements.get('summary-found').textContent, '10 / 10');
  assert.strictEqual(
      h.elements.get('summary-found-label').textContent, 'Countries Found');
  assert(h.elements.get('summary-history')
             .innerHTML.includes('data-history-idx="0"'));
  assert(!h.elements.get('summary-history').innerHTML.includes('onclick='));

  // Clicking a history row via inspectHistoryItem opens its Country Postcard.
  h.sandbox.inspectHistoryItem(0);
  assert(h.elements.get('summary-modal').classList.contains('hidden'));
  assert.strictEqual(h.getState().postcardVisible, true);

  // Open Country Passport modal and verify declarative data-item-id attributes.
  h.sandbox.openPassportModal();
  assert(!h.elements.get('passport-modal').classList.contains('hidden'));
  assert.strictEqual(
      h.elements.get('passport-modal-title').textContent,
      'Discovered Countries Collection');
  assert(h.elements.get('passport-grid').innerHTML.includes('data-item-id='));
  assert(!h.elements.get('passport-grid').innerHTML.includes('onclick='));

  // Blitz mode: drop clock from 60.0 -> 55.0, verify exact +2.0s -> 57.0, then
  // timeout!
  h.elements.get('select-mode').value = 'blitz';
  h.sandbox.changeGameSettings();
  for (let i = 0; i < 50; i++) h.stepFrame(100);
  assert(Math.abs(h.getState().blitzRemaining - 55.0) < 1e-6);

  const blitzTarget = h.getState().targetCountry;
  const [bsx, bsy] = h.internals.worldToScreen(blitzTarget.wx, blitzTarget.wy);
  h.clickScreen(bsx, bsy);
  assert(
      Math.abs(h.getState().blitzRemaining - 57.0) < 1e-6,
      `Expected exact +2.0s bonus to 57.0, got ${h.getState().blitzRemaining}`);
  assert.strictEqual(h.getState().postcardVisible, false);
  h.flushTimers(1000);
  assert.strictEqual(h.getState().roundResolved, false);

  // Tick remaining 57.0s down to 0 and verify Blitz finishes cleanly.
  for (let i = 0; i < 575; i++) h.stepFrame(100);
  assert.strictEqual(h.getState().gameEnded, true);
  assert.strictEqual(
      h.elements.get('summary-found').textContent, '1 Countries');

  // Switch back to City Mode and confirm clean reset.
  h.elements.get('select-target-type').value = 'city';
  h.elements.get('select-mode').value = '10round';
  h.sandbox.changeGameSettings();
  h.stepFrame();
  assert.strictEqual(h.getState().finderMode, 'city');
  assert(h.getState().targetCity);
  assert.strictEqual(h.elements.get('passport-count').textContent, '0/199');
}

function testSmallIslandForgivenessAndStaleWikiGuard() {
  const h = createHarness();
  h.elements.get('select-target-type').value = 'country';
  h.elements.get('select-density').value = '3';
  h.sandbox.changeGameSettings();
  h.stepFrame();

  const fiji = h.internals.COUNTRIES.find((c) => c.name === 'Fiji');
  const [fsx, fsy] = h.internals.worldToScreen(fiji.wx, fiji.wy);
  // Positive boundary: 5px off Fiji snaps to Fiji for both hover and click.
  h.hoverScreen(fsx + 5, fsy + 5);
  assert.strictEqual(h.getState().hoveredCountryName, 'Fiji');
  // Negative boundary: 20px off Fiji in open ocean returns null.
  h.hoverScreen(fsx + 20, fsy + 20);
  assert.strictEqual(h.getState().hoveredCountryName, null);

  // Verify fetchWikiThumb ignores stale async response when slug changes.
  let resolveFirst;
  const firstPromise = new Promise((res) => {
    resolveFirst = res;
  });
  const hAsync = createHarness({
    fetchImpl: (url) => {
      if (url.includes('OldSlug')) {
        return firstPromise;
      }
      return Promise.resolve({
        ok: true,
        json: () =>
            Promise.resolve({thumbnail: {source: 'https://img/new.jpg'}}),
      });
    },
  });
  const img = {src: '', classList: makeClassList([]), onload: null};
  const pOld = hAsync.internals.fetchWikiThumb('OldSlug', img);
  const pNew = hAsync.internals.fetchWikiThumb('NewSlug', img);
  return pNew
      .then(() => {
        assert.strictEqual(img.src, 'https://img/new.jpg');
        resolveFirst({
          ok: true,
          json: () =>
              Promise.resolve({thumbnail: {source: 'https://img/old.jpg'}}),
        });
        return pOld;
      })
      .then(() => {
        assert.strictEqual(
            img.src, 'https://img/new.jpg',
            'Stale Wikipedia response must not overwrite newer postcard thumbnail');
      });
}

const TESTS = [
  testExtractedModulesAndScoringOracles,
  testDropdownAndStrictDomIdValidation,
  testCountryDataGeometryAndEnclaveLayering,
  testPassportStoragePersistenceAndErrors,
  testCityModeRegressionAndAmericasFix,
  testCountryModeCoreGameplayNoSpoilersAndEscaping,
  testCountryModeRiddleClueRadarRevealAndLabelsDeterministic,
  testCountryMode10RoundSummaryPassportBlitzAndModeSwitch,
  testSmallIslandForgivenessAndStaleWikiGuard,
];

module.exports = {
  createHarness,
  HTML_SOURCE,
};

if (require.main === module) {
  (async () => {
    let passed = 0;
    for (const fn of TESTS) {
      await fn();
      passed++;
      console.log(`PASS: ${fn.name}`);
    }
    console.log(`\nAll ${passed}/${TESTS.length} tests passed.`);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
