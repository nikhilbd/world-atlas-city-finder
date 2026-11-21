# World Atlas City & Country Finder

An interactive, standalone point-and-click geography and discovery game built
with HTML5 Canvas.

-   **Live Deployment**: https://nikhilbd.github.io/world-atlas-city-finder/
-   **GitHub Repository**: https://github.com/nikhilbd/world-atlas-city-finder

--------------------------------------------------------------------------------

## Overview

**World Atlas City & Country Finder** renders a vector world map populated with
199 global cities and 176 country polygons. Switch seamlessly between **City
Mode** and **Country Mode** from the top toolbar dropdown to locate target
cities or countries by name or geographic riddle. Upon discovering a target,
players unlock a **Discovery Postcard** with visual cards, vital statistics, and
historical significance.

### Key Features

1.  **City Mode (199 Cities) & Country Mode (176 Countries)**:
    -   Switch modes directly from the **City Mode / Country Mode** dropdown
        while keeping all game modes (`10-City` / `10-Country Expedition`,
        `60s Blitz`, `Endless Explorer`), hints, overlays, and scoring
        consistent.
    -   Three selectable atlas density tiers in both modes: **Standard Atlas**
        (85 Cities / 77 Countries), **Dense Atlas** (148 Cities / 137
        Countries), and **Mega Atlas** (199 Cities / 176 Countries).
    -   5-ring non-overlapping cartographic label placement engine in City Mode,
        and non-spoiler country polygon clicking (with enclave layering and
        small-island click forgiveness) plus `Found` / `All` / `Off` label
        cycling in Country Mode.
2.  **Post-Find "Discovery Postcard"**:
    -   **2 Visual Cards**: Displays a city/capital panorama and an iconic
        landmark card with instant procedural SVG illustrations that fade in
        live **Wikipedia Commons** photography when online.
    -   **Vital Geography Strip**: Displays the country flag in the header
        alongside four vital metrics: metropolitan population, elevation, UTC
        timezone, and climate (City Mode), or capital, population, area, and
        region (Country Mode).
    -   **Geographic & Historical Significance**: 2–3 curated lines explaining
        each city or country's geographic setting and global role, plus a direct
        link to the full Wikipedia article.
3.  **Geo-Detective Riddle Mode (`1.5×` Points)**:
    -   Switches prompts from city or country names to non-spoiling geographic
        and historical riddles, with a `Show Name` fallback button.
4.  **Curated Themed Expeditions & Regional Focus Decks**:
    -   **Silk Road & Ancient Capitals / Empires**
    -   **Extreme Earth: High, Cold, Remote & Deserts**
    -   **Global Chokepoints, Ports & Island Nations**
    -   **Regional Focus Decks**: Americas, Europe, Africa, and Asia & Oceania.
5.  **Smarter Wrong-Click Feedback**:
    -   Draws a curved **Great-Circle Flight Arc** with an animated directional
        pulse from the clicked city or country toward the target.
    -   Displays a **Hot/Cold proximity badge** (`SCORCHING`, `WARM`, `COOL`,
        `FREEZING`) alongside **latitude and timezone deltas**.
6.  **Physical Geography Overlay (`Rivers & Peaks`)**:
    -   Toggleable vector layer rendering **16 major world rivers** and **8
        major mountain ranges**.
7.  **Persistent World Passports & Expedition Flight Trail**:
    -   Tracks discovered cities and discovered countries independently in
        `localStorage` across sessions and plots the connected 10-stop geodesic
        flight path at the end of each expedition.

--------------------------------------------------------------------------------

## Running Locally & Testing

The game has zero external build steps or library dependencies (`index.html`
loads sibling modules `country_data.js` and `country_mode.js`). Open
`index.html` directly in any browser or serve the directory over HTTP:

```bash
python3 -m http.server 8765
```

Run the automated unit test suite with Node.js:

```bash
node test_game.js
```
