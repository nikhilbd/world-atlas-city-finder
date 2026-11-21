/**
 * @fileoverview Country Mode geometry, deck filtering, postcard metadata,
 * passport persistence, and canvas rendering helpers for World Atlas City &
 * Country Finder.
 */
(function(globalScope) {
'use strict';

/**
 * Tests whether a 2D world point lies inside a polygon ring via ray casting.
 * @param {number} x World X coordinate.
 * @param {number} y World Y coordinate.
 * @param {!Array<!Array<number>>} ring Polygon vertices as [wx, wy] pairs.
 * @return {boolean} True when (x, y) is inside the ring.
 */
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Computes absolute shoelace area and centroid of a polygon ring.
 * @param {!Array<!Array<number>>} ring Polygon vertices as [wx, wy] pairs.
 * @return {{area: number, cx: number, cy: number}} Area and centroid.
 */
function ringAreaAndCentroid(ring) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const p0 = ring[i];
    const p1 = ring[(i + 1) % n];
    const cross = p0[0] * p1[1] - p1[0] * p0[1];
    area += cross;
    cx += (p0[0] + p1[0]) * cross;
    cy += (p0[1] + p1[1]) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p[0];
      sy += p[1];
    }
    return {area: 0, cx: sx / (n || 1), cy: sy / (n || 1)};
  }
  return {area: Math.abs(area), cx: cx / (6 * area), cy: cy / (6 * area)};
}

/**
 * Finds a guaranteed interior anchor point inside a polygon ring, falling
 * back to the widest horizontal scanline chord for concave polygons.
 * @param {!Array<!Array<number>>} ring Polygon vertices as [wx, wy] pairs.
 * @return {!Array<number>} Interior [wx, wy] point.
 */
function findInteriorPoint(ring) {
  const {cx, cy} = ringAreaAndCentroid(ring);
  if (pointInRing(cx, cy, ring)) return [cx, cy];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of ring) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  let bestSpan = -1;
  let bestPt = [cx, cy];
  for (let k = 1; k < 20; k++) {
    const y = minY + (maxY - minY) * (k / 20);
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if ((yi > y) !== (yj > y)) {
        xs.push((xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi);
      }
    }
    xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const span = xs[m + 1] - xs[m];
      if (span > bestSpan) {
        const midX = 0.5 * (xs[m] + xs[m + 1]);
        if (pointInRing(midX, y, ring)) {
          bestSpan = span;
          bestPt = [midX, y];
        }
      }
    }
  }
  return bestPt;
}

/**
 * Decodes raw country polygons and merges curated Country Mode metadata keyed
 * by exact WORLD_COUNTRIES_RAW country name.
 * @param {!Array<!Array<*>>} rawCountries Encoded WORLD_COUNTRIES_RAW array.
 * @param {!Object<string, !Array<*>>} metaByName Map of country name to
 *     17-tuple.
 * @param {!Object} proj Projection functions and map dimensions.
 * @return {{countries: !Array<!Object>, drawOrder: !Array<!Object>}} Decoded
 *     countries and largest-first draw order so enclaves stay visible.
 */
function buildCountries(rawCountries, metaByName, proj) {
  if (!metaByName || typeof metaByName !== 'object' ||
      Array.isArray(metaByName)) {
    throw new Error(
        'COUNTRY_META_BY_NAME must be a plain object keyed by name');
  }
  const seenNames = new Set();
  const countries = rawCountries.map(([name, colorIdx, rawRings], id) => {
    if (seenNames.has(name)) {
      throw new Error(`Duplicate country polygon name: ${name}`);
    }
    seenNames.add(name);
    if (!Object.prototype.hasOwnProperty.call(metaByName, name)) {
      throw new Error(`Missing country metadata for: ${name}`);
    }
    if (!Array.isArray(rawRings) || rawRings.length === 0) {
      throw new Error(`Country polygon has no rings: ${name}`);
    }
    let minWx = Infinity;
    let minWy = Infinity;
    let maxWx = -Infinity;
    let maxWy = -Infinity;
    let bestRing = null;
    let bestArea = -1;
    const rings = rawRings.map((flat) => {
      const pts = [];
      let qx = flat[0];
      let qy = flat[1];
      for (let i = 0; i < flat.length; i += 2) {
        if (i > 0) {
          qx += flat[i];
          qy += flat[i + 1];
        }
        const wx = proj.lonToWx(qx / 10.0);
        const wy = proj.latToWy(qy / 10.0);
        if (wx < minWx) minWx = wx;
        if (wx > maxWx) maxWx = wx;
        if (wy < minWy) minWy = wy;
        if (wy > maxWy) maxWy = wy;
        pts.push([wx, wy]);
      }
      const {area} = ringAreaAndCentroid(pts);
      if (area > bestArea) {
        bestArea = area;
        bestRing = pts;
      }
      return pts;
    });

    if (!bestRing || bestRing.length === 0) {
      throw new Error(`Country polygon has no valid vertices: ${name}`);
    }
    const [wx, wy] = findInteriorPoint(bestRing);
    let rMinX = Infinity;
    let rMinY = Infinity;
    let rMaxX = -Infinity;
    let rMaxY = -Infinity;
    for (const p of bestRing) {
      if (p[0] < rMinX) rMinX = p[0];
      if (p[0] > rMaxX) rMaxX = p[0];
      if (p[1] < rMinY) rMinY = p[1];
      if (p[1] > rMaxY) rMaxY = p[1];
    }
    const bw = Math.max(12, rMaxX - rMinX);
    const bh = Math.max(12, rMaxY - rMinY);
    const fitZoom =
        Math.min((proj.baseW * 0.25) / bw, (proj.baseH * 0.25) / bh);
    const idealZoom = Math.max(1.25, Math.min(4.2, fitZoom));
    const meta = metaByName[name];
    return {
      id,
      name,
      displayName: meta[0],
      continent: meta[1],
      tier: meta[2],
      flag: meta[3],
      capital: meta[4],
      pop: meta[5],
      areaStr: meta[6],
      subregion: meta[7],
      wiki: meta[8],
      photoWiki: meta[9],
      landmarkWiki: meta[10],
      landmarkCaption: meta[11],
      clue: meta[12],
      significance: meta[13],
      riddle: meta[14],
      tags: meta[15] || [],
      climate: meta[16],
      colorIdx,
      rings,
      bbox: [minWx, minWy, maxWx, maxWy],
      largestRingBbox: [rMinX, rMinY, rMaxX, rMaxY],
      area: bestArea,
      wx,
      wy,
      lat: proj.wyToLat(wy),
      lon: proj.wxToLon(wx),
      idealZoom,
      labelWidth: 0,
    };
  });

  for (const key of Object.keys(metaByName)) {
    if (!seenNames.has(key)) {
      throw new Error(`Unexpected extra country metadata key: ${key}`);
    }
  }

  const drawOrder = [...countries].sort((a, b) => b.area - a.area);
  return {countries, drawOrder};
}

/**
 * Returns the smallest-area country polygon containing world point (wx, wy),
 * using even-odd ring parity so interior holes (e.g. Lesotho inside South
 * Africa) are excluded from the surrounding country.
 * @param {!Array<!Object>} countries Decoded countries array.
 * @param {number} wx World X coordinate.
 * @param {number} wy World Y coordinate.
 * @return {?Object} Matching country or null over open water.
 */
function findCountryAt(countries, wx, wy) {
  let bestMatch = null;
  let bestArea = Infinity;
  for (const country of countries) {
    const [minX, minY, maxX, maxY] = country.bbox;
    if (wx < minX || wx > maxX || wy < minY || wy > maxY) continue;
    let inside = false;
    for (const ring of country.rings) {
      if (pointInRing(wx, wy, ring)) inside = !inside;
    }
    if (inside && country.area < bestArea) {
      bestArea = country.area;
      bestMatch = country;
    }
  }
  return bestMatch;
}

/**
 * Resolves a country click/hover with exact polygon priority plus small-island
 * screen-space forgiveness when the pointer is just off tiny coastlines.
 * @param {!Array<!Object>} countries Decoded countries array.
 * @param {number} sx Screen X coordinate.
 * @param {number} sy Screen Y coordinate.
 * @param {number} wx World X coordinate.
 * @param {number} wy World Y coordinate.
 * @param {number} scale Active world-to-screen scale factor.
 * @param {function(number, number): !Array<number>} worldToScreen Projector.
 * @return {?Object} Matching country or null.
 */
function findCountryHit(countries, sx, sy, wx, wy, scale, worldToScreen) {
  const exact = findCountryAt(countries, wx, wy);
  if (exact) return exact;
  let bestCountry = null;
  let bestDist = 12;
  for (const country of countries) {
    const [rMinX, rMinY, rMaxX, rMaxY] = country.largestRingBbox;
    const diagPx = Math.hypot((rMaxX - rMinX) * scale, (rMaxY - rMinY) * scale);
    if (diagPx >= 28) continue;
    const [ax, ay] = worldToScreen(country.wx, country.wy);
    const dist = Math.hypot(sx - ax, sy - ay);
    if (dist <= bestDist) {
      bestDist = dist;
      bestCountry = country;
    }
  }
  return bestCountry;
}

/**
 * Filters cities or countries by the active density/themed/regional deck.
 * @param {!Array<!Object>} items City or country collection.
 * @param {string} deck Value from #select-density.
 * @return {!Array<!Object>} Filtered pool.
 */
function filterByDeck(items, deck) {
  if (deck === '1' || deck === '2' || deck === '3') {
    const tierNum = parseInt(deck, 10);
    return items.filter((item) => item.tier <= tierNum);
  }
  if (deck === 'silk' || deck === 'extreme' || deck === 'ports') {
    return items.filter((item) => item.tags.includes(deck));
  }
  if (deck === 'americas') {
    return items.filter(
        (item) => item.continent === 'Americas' ||
            item.continent === 'North America' ||
            item.continent === 'South America');
  }
  if (deck === 'europe') {
    return items.filter((item) => item.continent === 'Europe');
  }
  if (deck === 'africa') {
    return items.filter((item) => item.continent === 'Africa');
  }
  if (deck === 'asia_oceania') {
    return items.filter(
        (item) => item.continent === 'Asia' || item.continent === 'Oceania');
  }
  return items.filter((item) => item.tier <= 2);
}

/**
 * Computes dropdown option labels with live item counts for City or Country
 * mode.
 * @param {boolean} countryMode Whether Country Mode is active.
 * @param {!Array<!Object>} source Active full collection (COUNTRIES or CITIES).
 * @return {!Object<string, string>} Option value -> display label map.
 */
function getDensityOptionLabels(countryMode, source) {
  const unit = countryMode ? 'Countries' : 'Cities';
  const c = (deck) => filterByDeck(source, deck).length;
  if (countryMode) {
    return {
      '1': `🌍 Standard Atlas (${c('1')} ${unit})`,
      '2': `🌍 Dense Atlas (${c('2')} ${unit})`,
      '3': `🌍 Mega Atlas (${c('3')} ${unit})`,
      'silk': `🏺 Silk Road & Ancient Empires (${c('silk')})`,
      'extreme': `🏔️ Extreme Earth: Peaks & Deserts (${c('extreme')})`,
      'ports': `⚓ Islands & Maritime Chokepoints (${c('ports')})`,
      'americas': `🌎 Americas (${c('americas')})`,
      'europe': `🏰 Europe (${c('europe')})`,
      'africa': `🦁 Africa (${c('africa')})`,
      'asia_oceania': `🏯 Asia & Oceania (${c('asia_oceania')})`,
    };
  }
  return {
    '1': `🌍 Standard Atlas (${c('1')} ${unit})`,
    '2': `🌍 Dense Atlas (${c('2')} ${unit})`,
    '3': `🌍 Mega Atlas (${c('3')} ${unit})`,
    'silk': `🏺 Silk Road & Ancient Capitals (${c('silk')})`,
    'extreme': `🏔️ Extreme Earth: High & Remote (${c('extreme')})`,
    'ports': `⚓ Global Chokepoints & Ports (${c('ports')})`,
    'americas': `🌎 Americas (${c('americas')})`,
    'europe': `🏰 Europe (${c('europe')})`,
    'africa': `🦁 Africa (${c('africa')})`,
    'asia_oceania': `🏯 Asia & Oceania (${c('asia_oceania')})`,
  };
}

/**
 * Returns button text and tooltip for the label-display cycle button.
 * @param {boolean} countryMode Whether Country Mode is active.
 * @param {string} labelMode City label mode ('smart'|'compact'|'dots').
 * @param {string} countryLabelMode Country label mode ('found'|'all'|'none').
 * @return {{text: string, title: string}} Button display specification.
 */
function getLabelButtonSpec(countryMode, labelMode, countryLabelMode) {
  if (countryMode) {
    const labels = {
      found: '🏷️ Labels: Found',
      all: '🏷️ Labels: All',
      none: '📍 Labels: Off',
    };
    return {
      text: labels[countryLabelMode] || labels.found,
      title: 'Cycle Country Name Label Display',
    };
  }
  const labels = {
    smart: '🏷️ Names: Smart',
    compact: '🏷️ Names: Auto-Zoom',
    dots: '📍 Dots Only (Pro)',
  };
  return {
    text: labels[labelMode] || labels.smart,
    title: 'Cycle City Name Label Display',
  };
}

/**
 * Builds normalized display fields for the Discovery Postcard DOM.
 * @param {!Object} item City or Country record.
 * @param {string} kind 'city' or 'country'.
 * @return {!Object} Normalized postcard fields and vital strip rows.
 */
function buildPostcardSpec(item, kind) {
  const isCountry = kind === 'country';
  const latStr =
      `${Math.abs(item.lat).toFixed(1)}° ${item.lat >= 0 ? 'N' : 'S'}`;
  const lonStr =
      `${Math.abs(item.lon).toFixed(1)}° ${item.lon >= 0 ? 'E' : 'W'}`;
  if (isCountry) {
    return {
      title: item.displayName,
      subtitle:
          `${item.continent} • Capital: ${item.capital} • ${latStr}, ${lonStr}`,
      cap1: `${item.flag} ${item.capital} (${item.displayName})`,
      cap2: `🏛️ ${item.landmarkCaption}`,
      photo1Slug: item.photoWiki,
      photo2Slug: item.landmarkWiki,
      vitals: [
        {label: '🏛️ Capital', value: item.capital},
        {label: '👥 Population', value: item.pop},
        {label: '📐 Area', value: item.areaStr},
        {label: '🌍 Region', value: item.subregion},
      ],
    };
  }
  return {
    title: `${item.name}, ${item.country}`,
    subtitle: `${item.continent} • ${latStr}, ${lonStr}`,
    cap1: `${item.flag} ${item.name} Skyline & Overview`,
    cap2: `🏛️ ${item.landmarkCaption}`,
    photo1Slug: item.wiki,
    photo2Slug: item.landmarkWiki,
    vitals: [
      {label: '👥 Metro Pop', value: item.pop},
      {label: '⛰️ Elevation', value: item.elev},
      {label: '🕒 Timezone', value: item.utcStr},
      {label: '🌡️ Climate', value: item.climate},
    ],
  };
}

/**
 * Escapes HTML special characters for safe interpolation into modal templates.
 * @param {*} value Value to escape.
 * @return {string} HTML-escaped string.
 */
function escapeHtml(value) {
  return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
}

/**
 * Loads a persisted Set of string names from localStorage safely.
 * @param {?Storage} storage Web Storage object.
 * @param {string} key Storage key.
 * @return {!Set<string>} Loaded name set.
 */
function loadPassportSet(storage, key) {
  const set = new Set();
  try {
    const saved = JSON.parse((storage && storage.getItem(key)) || '[]');
    if (Array.isArray(saved)) {
      for (const n of saved) {
        if (typeof n === 'string') set.add(n);
      }
    }
  } catch (_) {
    // Ignore corrupted JSON or restricted browser storage errors.
  }
  return set;
}

/**
 * Adds a discovered name to a passport Set and persists it to localStorage.
 * @param {?Storage} storage Web Storage object.
 * @param {string} key Storage key.
 * @param {!Set<string>} set Target passport Set.
 * @param {string} name Discovered city or country name.
 * @return {boolean} True if this is a newly unlocked stamp.
 */
function savePassportEntry(storage, key, set, name) {
  const isNew = !set.has(name);
  set.add(name);
  try {
    if (storage) storage.setItem(key, JSON.stringify([...set]));
  } catch (_) {
    // Ignore QuotaExceededError or SecurityError in restricted storage modes.
  }
  return isNew;
}

/**
 * Renders all country polygons in largest-first enclave order using even-odd
 * ring fills (preserving holes like Lesotho inside South Africa) and a
 * stroke-only highlight pass so highlights never occlude enclaves.
 * @param {!CanvasRenderingContext2D} ctx Canvas 2D context.
 * @param {!Object} opts Rendering parameters and game state references.
 */
function drawCountriesLayer(ctx, opts) {
  const {
    drawOrder,
    cam,
    scale,
    cx,
    cy,
    pal,
    mapTheme,
    countryMode,
    hoveredCountry,
    foundCountryIds,
    roundResolved,
    targetCountry,
    wrongCountryFlashes,
    now,
  } = opts;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const baseBorderWidth =
      Math.max(0.6, Math.min(1.4, 0.75 * Math.sqrt(cam.zoom)));
  const strokeHighlights = [];

  const traceCountryPath = (country) => {
    ctx.beginPath();
    for (const ring of country.rings) {
      for (let i = 0; i < ring.length; i++) {
        const sx = (ring[i][0] - cam.x) * scale + cx;
        const sy = (ring[i][1] - cam.y) * scale + cy;
        if (i === 0) {
          ctx.moveTo(sx, sy);
        } else {
          ctx.lineTo(sx, sy);
        }
      }
      ctx.closePath();
    }
  };

  for (const country of drawOrder) {
    const isHovered = hoveredCountry === country;
    const isFound = countryMode && foundCountryIds.has(country.id);
    const isRevealed = countryMode && roundResolved && targetCountry &&
        country.id === targetCountry.id;
    const wrongTs = countryMode ? wrongCountryFlashes.get(country.id) : null;
    let isWrongFlash = false;
    let flashAlpha = 0;
    if (wrongTs != null) {
      const wrongAge = Math.max(0, now - wrongTs);
      if (wrongAge < 1200) {
        isWrongFlash = true;
        flashAlpha = Math.max(0, Math.min(1, 1 - wrongAge / 1200));
      } else {
        wrongCountryFlashes.delete(country.id);
      }
    }

    if (isRevealed && !isFound) {
      ctx.fillStyle = mapTheme === 'atlas' ? '#fde68a' : '#92400e';
      ctx.strokeStyle = '#d97706';
      ctx.lineWidth = Math.max(1.6, baseBorderWidth * 1.6);
      strokeHighlights.push({
        country,
        stroke: '#d97706',
        width: Math.max(2.0, baseBorderWidth * 1.8),
      });
    } else if (isFound) {
      ctx.fillStyle = (isHovered || isRevealed) ?
          (mapTheme === 'atlas' ? '#6ee7b7' : '#047857') :
          (mapTheme === 'atlas' ? '#a7f3d0' : '#065f46');
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = Math.max(1.2, baseBorderWidth * 1.3);
      if (isHovered || isRevealed) {
        strokeHighlights.push({
          country,
          stroke: '#059669',
          width: Math.max(2.0, baseBorderWidth * 1.8),
        });
      }
    } else {
      ctx.fillStyle =
          isHovered ? pal.landHover : pal.landFills[country.colorIdx];
      ctx.strokeStyle = pal.border;
      ctx.lineWidth = baseBorderWidth;
      if (countryMode && isHovered) {
        strokeHighlights.push({
          country,
          stroke: mapTheme === 'atlas' ? '#059669' : '#34d399',
          width: Math.max(1.8, baseBorderWidth * 1.7),
        });
      }
    }

    traceCountryPath(country);
    ctx.fill('evenodd');
    ctx.stroke();

    if (isWrongFlash) {
      ctx.fillStyle = `rgba(244, 63, 94, ${(0.55 * flashAlpha).toFixed(3)})`;
      ctx.fill('evenodd');
      strokeHighlights.push({
        country,
        stroke: `rgba(225, 29, 72, ${(0.95 * flashAlpha).toFixed(3)})`,
        width: Math.max(1.8, baseBorderWidth * 1.7),
      });
    }
  }

  // Stroke-only highlight pass keeps borders crisp without painting over
  // smaller enclaves drawn inside larger neighbors.
  for (const hl of strokeHighlights) {
    ctx.strokeStyle = hl.stroke;
    ctx.lineWidth = hl.width;
    traceCountryPath(hl.country);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders non-overlapping Country Mode pill labels for found, revealed, or
 * all active countries depending on countryLabelMode.
 * @param {!CanvasRenderingContext2D} ctx Canvas 2D context.
 * @param {!Object} opts Label rendering options and bounds.
 */
function drawCountryLabelsLayer(ctx, opts) {
  const {
    countryLabelMode,
    countries,
    activeCountries,
    foundCountryIds,
    roundResolved,
    targetCountry,
    worldToScreen,
    w,
    h,
    mapLeft,
    mapRight,
    mapTop,
    mapBottom,
    pal,
  } = opts;
  if (countryLabelMode === 'none') return;

  const candidates = [];
  const seenIds = new Set();
  const addCandidate = (c, priority) => {
    if (!c || seenIds.has(c.id)) return;
    seenIds.add(c.id);
    candidates.push({country: c, priority});
  };

  if (roundResolved && targetCountry) addCandidate(targetCountry, 3);
  for (const id of foundCountryIds) addCandidate(countries[id], 2);
  if (countryLabelMode === 'all') {
    for (const c of activeCountries) addCandidate(c, 1);
  }

  candidates.sort(
      (a, b) => (b.priority - a.priority) || (b.country.area - a.country.area));

  const occupiedBoxes = [];
  const boundLeft = Math.max(4, mapLeft + 3);
  const boundRight = Math.min(w - 4, mapRight - 3);
  const boundTop = Math.max(4, mapTop + 3);
  const boundBottom = Math.min(h - 46, mapBottom - 3);
  const th = 15;

  ctx.save();
  ctx.font =
      '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';

  for (const entry of candidates) {
    const c = entry.country;
    const [sx, sy] = worldToScreen(c.wx, c.wy);
    if (sx < -60 || sx > w + 60 || sy < -30 || sy > h + 30) continue;
    const tw = c.labelWidth;
    const x1 = sx - tw / 2;
    const x2 = sx + tw / 2;
    const y1 = sy - th / 2;
    const y2 = sy + th / 2;

    const isForced = entry.priority >= 2;
    if (!isForced) {
      if (x1 < boundLeft || x2 > boundRight || y1 < boundTop ||
          y2 > boundBottom) {
        continue;
      }
      let overlaps = false;
      for (const [bx1, by1, bx2, by2] of occupiedBoxes) {
        if (x1 < bx2 && x2 > bx1 && y1 < by2 && y2 > by1) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
    }
    occupiedBoxes.push([x1, y1, x2, y2]);

    const isRevealed =
        roundResolved && targetCountry && c.id === targetCountry.id;
    const isFound = foundCountryIds.has(c.id);
    if (isRevealed && !isFound) {
      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#d97706';
    } else if (isFound) {
      ctx.fillStyle = '#059669';
      ctx.strokeStyle = '#047857';
    } else {
      ctx.fillStyle = pal.labelBg;
      ctx.strokeStyle = pal.labelBorder;
    }
    ctx.lineWidth = isForced ? 1.4 : 0.8;
    ctx.beginPath();
    ctx.roundRect(x1, y1, x2 - x1, y2 - y1, 3.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = isForced ? '#ffffff' : pal.labelText;
    ctx.fillText(c.displayName, sx, sy + 0.5);
  }
  ctx.restore();
}

/**
 * Computes round points using identical rules for both City and Country mode.
 * @param {!Object} opts Scoring inputs (elapsedSec, streak, penalties, riddle).
 * @return {number} Final rounded score for the round.
 */
function computeRoundScore(opts) {
  const speedBonus =
      Math.max(0, Math.round((12 - Math.min(12, opts.elapsedSec)) * 20));
  const streakBonus = Math.min(300, (opts.streak - 1) * 50);
  const penalty = opts.roundWrongClicks * 150 + (opts.clueUsed ? 150 : 0) +
      (opts.radarUsed ? 300 : 0);
  const rawPts = Math.max(150, 1000 + speedBonus + streakBonus - penalty);
  const multiplier =
      (opts.promptMode === 'riddle' && !opts.nameRevealedInRiddle) ? 1.5 : 1.0;
  return Math.round(rawPts * multiplier);
}

/**
 * Updates mode-dependent HUD dropdown labels, buttons, and tooltips.
 * @param {!Document} doc Document instance.
 * @param {!Object} opts Mode state and source collections.
 */
function syncFinderModeDom(doc, opts) {
  const {countryMode, countries, cities, labelMode, countryLabelMode} = opts;
  const source = countryMode ? countries : cities;
  const unitPlural = countryMode ? 'Countries' : 'Cities';
  const unitSingular = countryMode ? 'Country' : 'City';

  const modeSel = doc.getElementById('select-mode');
  const roundOpt = modeSel && modeSel.querySelector('option[value="10round"]');
  if (roundOpt) roundOpt.textContent = `🎯 10-${unitSingular} Expedition`;

  const densitySel = doc.getElementById('select-density');
  if (densitySel) {
    const labels = getDensityOptionLabels(countryMode, source);
    for (const [val, text] of Object.entries(labels)) {
      const opt = densitySel.querySelector(`option[value="${val}"]`);
      if (opt) opt.textContent = text;
    }
  }

  doc.getElementById('btn-next').textContent = `Next ${unitSingular} →`;
  doc.getElementById('btn-postcard-next').innerHTML =
      `Next ${unitSingular} → ` +
      '<span style="opacity:0.8; font-weight:500; font-size:11px;">(Space)</span>';
  doc.getElementById('btn-reveal-name').title = `Show the ${
      unitSingular.toLowerCase()} name (reduces 1.5x Detective bonus to 1.0x)`;
  doc.getElementById('btn-clue').title = countryMode ?
      'Reveal Continent, Capital & Clue (-150 pts)' :
      'Reveal Country, Continent & Clue (-150 pts)';
  doc.getElementById('btn-skip').title = `Zoom to target ${
      unitSingular.toLowerCase()} and open discovery postcard`;
  doc.getElementById('btn-prompt-mode').title = `Switch between ${
      unitSingular} Name and Geo-Detective Riddle Mode (1.5x points)`;
  doc.getElementById('btn-passport').title =
      `View Discovered ${unitPlural} in Your World Passport`;

  const lblBtn = doc.getElementById('btn-labels');
  const lblSpec = getLabelButtonSpec(countryMode, labelMode, countryLabelMode);
  lblBtn.textContent = lblSpec.text;
  lblBtn.title = lblSpec.title;
}

/**
 * Formats the bottom-left status bar label in Country Mode without spoiling
 * unfound countries during active rounds.
 * @param {?Object} country Hovered country or null over ocean.
 * @param {boolean} isFound Whether the hovered country was already found.
 * @param {boolean} roundResolved Whether the current round has ended.
 * @param {boolean} gameEnded Whether the full game has ended.
 * @return {string} Status bar display string.
 */
function formatCountryHoverStatus(country, isFound, roundResolved, gameEnded) {
  if (!country) return '🌊 Ocean';
  if (roundResolved || gameEnded || isFound) {
    return `${isFound ? '✓ ' : '🗺️ '}${country.displayName}`;
  }
  return '🗺️ Click to guess country';
}

/**
 * Populates and reveals the Discovery Postcard DOM for a city or country.
 * @param {!Document} doc Document instance.
 * @param {!Object} opts Postcard rendering parameters and callbacks.
 */
function applyPostcardDom(doc, opts) {
  const {
    item,
    kind,
    statusType,
    ptsAwarded,
    isNewPassport,
    inPassport,
    canAdvance,
    buildPostcardSvg,
    fetchWikiThumb,
  } = opts;
  const card = doc.getElementById('city-postcard');
  const statusBadge = doc.getElementById('pc-status-badge');
  const passportBadge = doc.getElementById('pc-passport-badge');

  if (statusType === 'found') {
    statusBadge.className = 'postcard-badge badge-found';
    statusBadge.textContent =
        ptsAwarded ? `✓ Found (+${ptsAwarded} pts)` : '✓ Discovered';
  } else if (statusType === 'passport') {
    statusBadge.className = 'postcard-badge badge-found';
    statusBadge.textContent = '🛂 Passport Archive';
  } else if (statusType === 'explore') {
    statusBadge.className = 'postcard-badge badge-found';
    statusBadge.textContent = '🗺️ Map Inspection';
  } else {
    statusBadge.className = 'postcard-badge badge-revealed';
    statusBadge.textContent = '👁️ Location Revealed';
  }
  const stamped = inPassport !== undefined ? inPassport : true;
  if (isNewPassport) {
    passportBadge.textContent = '🛂 New Passport Stamp!';
  } else if (stamped) {
    passportBadge.textContent = '🛂 In World Passport';
  } else {
    passportBadge.textContent = '🛂 Not Yet in Passport';
  }

  const nextBtn = doc.getElementById('btn-postcard-next');
  const autoAdvLabel = doc.getElementById('pc-auto-adv-label');
  const allowAdvance = canAdvance !== false;
  if (nextBtn) nextBtn.classList.toggle('hidden', !allowAdvance);
  if (autoAdvLabel) autoAdvLabel.classList.toggle('hidden', !allowAdvance);

  const spec = buildPostcardSpec(item, kind);
  doc.getElementById('pc-flag').textContent = item.flag;
  doc.getElementById('pc-city-title').textContent = spec.title;
  doc.getElementById('pc-coords-sub').textContent = spec.subtitle;

  const img1 = doc.getElementById('pc-img-1');
  const img2 = doc.getElementById('pc-img-2');
  img1.classList.remove('loaded');
  img2.classList.remove('loaded');
  img1.removeAttribute('src');
  img2.removeAttribute('src');

  doc.getElementById('pc-svg-1').innerHTML = buildPostcardSvg(item, 1, kind);
  doc.getElementById('pc-svg-2').innerHTML = buildPostcardSvg(item, 2, kind);
  doc.getElementById('pc-cap-1').textContent = spec.cap1;
  doc.getElementById('pc-cap-2').textContent = spec.cap2;
  fetchWikiThumb(spec.photo1Slug, img1);
  fetchWikiThumb(spec.photo2Slug, img2);

  const valIds = ['pc-pop', 'pc-elev', 'pc-utc', 'pc-climate'];
  for (let i = 0; i < 4; i++) {
    doc.getElementById(`pc-vital-label-${i + 1}`).textContent =
        spec.vitals[i].label;
    const valEl = doc.getElementById(valIds[i]);
    valEl.textContent = spec.vitals[i].value;
    valEl.title = spec.vitals[i].value;
  }

  doc.getElementById('pc-significance').textContent = item.significance;
  doc.getElementById('pc-wiki-link').href =
      `https://en.wikipedia.org/wiki/${item.wiki}`;
  card.classList.remove('hidden');
}

/**
 * Populates and opens the World Explorer Passport modal for Cities or
 * Countries.
 * @param {!Document} doc Document instance.
 * @param {!Object} opts Collection, unlocked Set, and active mode flag.
 */
function renderPassportModalDom(doc, opts) {
  const {countryMode, collection, unlockedSet} = opts;
  doc.getElementById('passport-modal-title').textContent = countryMode ?
      'Discovered Countries Collection' :
      'Discovered Cities Collection';

  const continents = ['Americas', 'Europe', 'Africa', 'Asia', 'Oceania'];
  doc.getElementById('passport-stats-row').innerHTML =
      continents
          .map((cont) => {
            const total =
                collection.filter((item) => item.continent === cont).length;
            const unlocked = collection
                                 .filter(
                                     (item) => item.continent === cont &&
                                         unlockedSet.has(item.name))
                                 .length;
            return `<div class="kpi-box" style="padding:5px 10px; font-size:11.5px;">` +
                `<span class="muted-text">${escapeHtml(cont)}:</span>` +
                `<strong style="color:${
                       unlocked > 0 ? '#10b981' :
                                      'inherit'}; margin-left:4px;">${
                       unlocked}/${total}</strong>` +
                `</div>`;
          })
          .join('');

  doc.getElementById('passport-grid').innerHTML =
      collection
          .map((item) => {
            if (unlockedSet.has(item.name)) {
              const title = countryMode ? item.displayName : item.name;
              const subtitle = countryMode ?
                  `${item.capital} • ${item.subregion}` :
                  `${item.country} • ${item.climate}`;
              return `<div class="passport-item unlocked" data-item-id="${
                         Number(item.id)}">` +
                  `<span style="font-size:18px;">${
                         escapeHtml(item.flag)}</span>` +
                  `<div style="min-width:0;">` +
                  `<div style="font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${
                         escapeHtml(title)}</div>` +
                  `<div class="muted-text" style="font-size:10.5px;">${
                         escapeHtml(subtitle)}</div>` +
                  `</div></div>`;
            }
            const lockedHint = countryMode ?
                item.continent :
                `${item.country} (${item.continent})`;
            return `<div class="passport-item locked">` +
                `<span style="font-size:16px;">🔒</span>` +
                `<div style="min-width:0;"><div style="font-weight:600;">???</div>` +
                `<div class="muted-text" style="font-size:10.5px;">${
                       escapeHtml(lockedHint)}</div>` +
                `</div></div>`;
          })
          .join('');

  doc.getElementById('passport-modal').classList.remove('hidden');
}

/**
 * Populates and displays the End-of-Game Summary modal for Cities or
 * Countries.
 * @param {!Document} doc Document instance.
 * @param {!Object} opts Summary metrics, roundHistory, and distance helper.
 */
function renderSummaryModalDom(doc, opts) {
  const {
    countryMode,
    gameMode,
    totalRounds,
    score,
    totalClicks,
    correctClicks,
    roundHistory,
    computeGeoDistanceAndBearing,
  } = opts;
  const unitPlural = countryMode ? 'Countries' : 'Cities';
  const unitSingular = countryMode ? 'country' : 'city';

  const foundCount = roundHistory.filter((r) => r.status === 'Found').length;
  const acc =
      totalClicks > 0 ? Math.round((correctClicks / totalClicks) * 100) : 100;
  const foundTimes = roundHistory.filter((r) => r.status === 'Found')
                         .map((r) => parseFloat(r.time));
  const avgTime = foundTimes.length > 0 ?
      (foundTimes.reduce((a, b) => a + b, 0) / foundTimes.length).toFixed(1) +
          's' :
      '—';

  let totalFlightKm = 0;
  for (let i = 1; i < roundHistory.length; i++) {
    const prev = roundHistory[i - 1];
    const curr = roundHistory[i];
    totalFlightKm +=
        computeGeoDistanceAndBearing(prev.lat, prev.lon, curr.lat, curr.lon).km;
  }

  let rank = 'Globe Trotter';
  if (score >= 9500)
    rank = '🏆 Grand Atlas Master';
  else if (score >= 7500)
    rank = '🧭 Royal Cartographer';
  else if (score >= 5000)
    rank = '✈️ World Navigator';

  doc.getElementById('summary-rank-badge').textContent = rank;
  doc.getElementById('summary-score').textContent = score.toLocaleString();
  doc.getElementById('summary-found-label').textContent = `${unitPlural} Found`;
  doc.getElementById('summary-found').textContent = gameMode === '10round' ?
      `${foundCount} / ${totalRounds}` :
      `${foundCount} ${unitPlural}`;
  doc.getElementById('summary-accuracy').textContent = `${acc}%`;
  doc.getElementById('summary-avgtime').textContent = avgTime;
  doc.getElementById('summary-flight-km').textContent =
      `${totalFlightKm.toLocaleString()} km`;
  doc.getElementById('summary-history-hint').textContent = `💡 Click any ${
      unitSingular} row below to inspect its Discovery Postcard & flight stop on the map:`;

  doc.getElementById('summary-history').innerHTML =
      roundHistory
          .map(
              (r, i) =>
                  `<div class="history-row" data-history-idx="${Number(i)}">` +
                  `<div style="display:flex; align-items:center; gap:8px;">` +
                  `<span class="muted-text stat-val-mono" style="width:20px; margin:0;">${
                      i + 1}.</span>` +
                  `<span>${escapeHtml(r.flag)}</span>` +
                  `<span style="font-weight:700;">${
                      escapeHtml(r.name)}</span>` +
                  `<span class="muted-text">(${
                      escapeHtml(r.sublabel)})</span>` +
                  `</div>` +
                  `<div class="stat-val-mono" style="display:flex; align-items:center; gap:12px;">` +
                  `<span class="muted-text">${escapeHtml(r.time)}</span>` +
                  (r.wrong > 0 ? `<span style="color:#fb7185;">${
                                     Number(r.wrong)} miss</span>` :
                                 '') +
                  `<span style="font-weight:700; color:${
                      r.points > 0 ? '#10b981' : '#f59e0b'};">` +
                  `${
                      r.points > 0 ? '+' + Number(r.points) :
                                     escapeHtml(r.status)}</span>` +
                  `</div></div>`)
          .join('');

  doc.getElementById('summary-modal').classList.remove('hidden');
}

const CountryMode = {
  escapeHtml,
  pointInRing,
  ringAreaAndCentroid,
  findInteriorPoint,
  buildCountries,
  findCountryAt,
  findCountryHit,
  filterByDeck,
  getDensityOptionLabels,
  getLabelButtonSpec,
  buildPostcardSpec,
  loadPassportSet,
  savePassportEntry,
  computeRoundScore,
  syncFinderModeDom,
  formatCountryHoverStatus,
  applyPostcardDom,
  renderPassportModalDom,
  renderSummaryModalDom,
  drawCountriesLayer,
  drawCountryLabelsLayer,
};

globalScope.CountryMode = CountryMode;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CountryMode;
}
})(typeof window !== 'undefined' ? window : globalThis);
