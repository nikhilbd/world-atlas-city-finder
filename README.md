# World Atlas City Finder

An interactive, standalone point-and-click geography and discovery game built
with HTML5 Canvas.

-   **Live Deployment**: https://nikhilbd.github.io/world-atlas-city-finder/
-   **GitHub Repository**: https://github.com/nikhilbd/world-atlas-city-finder

--------------------------------------------------------------------------------

## Overview

**World Atlas City Finder** renders a vector world map populated with labeled
global cities and challenges players to locate target cities by name or
geographic riddle. Upon discovering a city, players unlock a **City Discovery
Postcard** with visual cards, vital statistics, and historical significance.

### Key Features

1.  **199 Global Cities & 176 Country Polygons**:
    -   Three selectable atlas density tiers: **Standard Atlas (85 Cities)**,
        **Dense Atlas (148 Cities)**, and **Mega Atlas (199 Cities)**.
    -   5-ring non-overlapping cartographic label placement engine with leader
        lines and viewport boundary clamping.
2.  **Post-Find "City Discovery Postcard"**:
    -   **2 Visual Cards**: Displays a city skyline panorama and an iconic
        landmark card with instant procedural SVG illustrations that fade in
        live **Wikipedia Commons** photography when online.
    -   **Vital Geography Strip**: Displays country flag, metropolitan
        population, elevation, UTC timezone offset, and climate classification.
    -   **Geographic & Historical Significance**: 2–3 curated lines explaining
        why each city was founded where it is and its global role, plus a direct
        link to the full Wikipedia article.
3.  **Geo-Detective Riddle Mode (`1.5×` Points)**:
    -   Switches prompts from city names to geographic and historical riddles,
        with a `Show Name` fallback button.
4.  **Curated Themed Expeditions**:
    -   **Silk Road & Ancient Capitals (58 Cities)**
    -   **Extreme Earth: High, Cold & Remote (45 Cities)**
    -   **Global Chokepoints & Great Ports (87 Cities)**
    -   **Regional Focus Decks**: Americas (45), Europe (43), Africa (35), and
        Asia & Oceania (76).
5.  **Smarter Wrong-Click Feedback**:
    -   Draws a curved **Great-Circle Flight Arc** with an animated directional
        pulse from the clicked city toward the target city.
    -   Displays a **Hot/Cold proximity badge** (`SCORCHING`, `WARM`, `COOL`,
        `FREEZING`) alongside **latitude and timezone deltas**.
6.  **Physical Geography Overlay (`Rivers & Peaks`)**:
    -   Toggleable vector layer rendering **16 major world rivers** and **8
        major mountain ranges**.
7.  **Persistent World Passport & Expedition Flight Trail**:
    -   Tracks discovered cities in `localStorage` across sessions and plots the
        connected 10-city geodesic flight path at the end of each expedition.

--------------------------------------------------------------------------------

## Running Locally

`index.html` is 100% self-contained with zero external build steps or library
dependencies. Open `index.html` directly in any browser or serve the directory
over HTTP:

```bash
python3 -m http.server 8765
```
