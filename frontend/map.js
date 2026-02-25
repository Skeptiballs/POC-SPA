/**
 * Map module — Leaflet map setup, route rendering, hotspot overlays, and simulation.
 */

const MapModule = (() => {
  // Singapore Strait default view
  const DEFAULT_CENTER = [3.0, 115.0];
  const DEFAULT_ZOOM = 5;

  // Risk level colours matching the spec and CSS variables
  const RISK_COLORS = {
    high:    '#ef4444',
    medium:  '#f59e0b',
    low:     '#22c55e',
    default: '#0077b6',
  };

  // Hotspot type → human readable label
  const HOTSPOT_TYPE_LABELS = {
    high_traffic_density: 'High Traffic Density',
    crossing_traffic: 'Crossing Traffic',
    congestion: 'Congestion Zone',
    fishing_activity: 'Fishing Activity',
  };

  let map = null;
  let routeLayer = null;
  let markerLayer = null;
  let labelLayer = null;
  let seaMarkLayer = null;
  let xtdLayer = null;
  let hotspotLayer = null;
  let vesselLayer = null;

  // Per-leg polylines for risk coloring and highlighting
  let legPolylines = [];

  // State
  let currentWaypoints = [];
  let labelsVisible = true;
  let xtdVisible = true;
  let hotspotsVisible = true;

  // Simulation state
  let simState = {
    active: false,
    startTime: 0,
    pausedAt: 0,
    speedFactor: 300,
    progress: 0,
    rafId: null,
    totalDistance: 0,
    currentLegIndex: 0,
    vesselMarker: null
  };

  // Event callbacks
  let onSpeedUpdate = null;
  let onHotspotClick = null;

  /** Initialize the Leaflet map. */
  function init() {
    map = L.map('map', {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    seaMarkLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>',
      maxZoom: 18,
      opacity: 0.8,
    });

    // Layer order: xtd → hotspots → route → labels → markers → vessel
    xtdLayer = L.layerGroup().addTo(map);
    hotspotLayer = L.layerGroup().addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    labelLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    vesselLayer = L.layerGroup().addTo(map);

    return map;
  }

  /** Toggle the OpenSeaMap overlay. */
  function toggleSeaMarks(show) {
    if (show) seaMarkLayer.addTo(map);
    else map.removeLayer(seaMarkLayer);
  }

  /** Toggle waypoint labels. */
  function toggleLabels(show) {
    labelsVisible = show;
    if (show) labelLayer.addTo(map);
    else map.removeLayer(labelLayer);
  }

  /** Toggle safety corridor. */
  function toggleXTD(show) {
    xtdVisible = show;
    if (show) xtdLayer.addTo(map);
    else map.removeLayer(xtdLayer);
  }

  /** Toggle hotspot overlay. */
  function toggleHotspots(show) {
    hotspotsVisible = show;
    if (show) hotspotLayer.addTo(map);
    else map.removeLayer(hotspotLayer);
  }

  /**
   * Render hotspot zones from a GeoJSON FeatureCollection.features array.
   * Each feature gets a semi-transparent coloured polygon and a popup.
   */
  function renderHotspots(features) {
    hotspotLayer.clearLayers();
    if (!features || features.length === 0) return;

    features.forEach(feature => {
      const props = feature.properties || {};
      const severity = props.severity || 'low';

      const fillColor = RISK_COLORS[severity] || RISK_COLORS.default;

      const poly = L.geoJSON(feature, {
        style: {
          color: fillColor,
          weight: 1.5,
          opacity: 0.7,
          fillColor: fillColor,
          fillOpacity: 0.18,
        },
      });

      poly.bindPopup(() => buildHotspotPopup(props), {
        maxWidth: 300,
        className: 'wp-popup-container',
      });

      poly.on('click', () => {
        if (onHotspotClick) onHotspotClick(props.id);
      });

      hotspotLayer.addLayer(poly);
    });
  }

  /** Build HTML popup for a hotspot zone. */
  function buildHotspotPopup(props) {
    const meta = props.metadata || {};
    const severity = props.severity || 'low';
    const severityLabel = severity.charAt(0).toUpperCase() + severity.slice(1);
    const typeLabel = HOTSPOT_TYPE_LABELS[props.type] || props.type;

    let html = `<div class="hotspot-popup">`;
    html += `<div class="hotspot-popup-title">${props.name || 'Hotspot'}</div>`;
    html += `<div class="hotspot-popup-type">${typeLabel} — Severity: <strong>${severityLabel}</strong></div>`;

    if (meta.avg_vessels_per_hour) {
      html += infoRow('Avg Traffic', `${meta.avg_vessels_per_hour} vessels/hour`);
    }
    if (meta.peak_hours_utc && meta.peak_hours_utc.length) {
      html += infoRow('Peak Hours', meta.peak_hours_utc.join(', ') + ' UTC');
    }
    if (meta.dominant_vessel_types && meta.dominant_vessel_types.length) {
      html += infoRow('Vessel Types', meta.dominant_vessel_types.join(', '));
    }
    if (meta.historical_incident_rate) {
      html += infoRow('Incident Rate', meta.historical_incident_rate);
    }
    if (meta.notes) {
      html += `<div class="hotspot-popup-notes">${meta.notes}</div>`;
    }
    html += `</div>`;
    return html;
  }

  /**
   * Render the route on the map with per-leg risk colouring.
   * @param {Array}    waypoints        Enriched waypoint array (may include leg.riskAssessment)
   * @param {Function} onWaypointClick  Callback(waypointIndex) when a marker is clicked
   */
  function renderRoute(waypoints, onWaypointClick) {
    routeLayer.clearLayers();
    markerLayer.clearLayers();
    labelLayer.clearLayers();
    xtdLayer.clearLayers();
    vesselLayer.clearLayers();
    legPolylines = [];

    currentWaypoints = waypoints;
    simState.totalDistance = calculateTotalDistance(waypoints);

    if (!waypoints || waypoints.length === 0) return;

    const coords = waypoints.map(wp => [wp.lat, wp.lon]);

    // 1. Safety corridor (XTD)
    renderXTD(waypoints);

    // 2. Per-leg coloured polylines (replaces single-colour polyline)
    for (let i = 0; i < waypoints.length - 1; i++) {
      const wp1 = waypoints[i];
      const wp2 = waypoints[i + 1];
      const risk = (wp1.leg || {}).riskAssessment;
      const riskLevel = risk ? risk.level : null;
      const color = riskLevel ? (RISK_COLORS[riskLevel] || RISK_COLORS.default) : RISK_COLORS.default;

      const legCoords = [[wp1.lat, wp1.lon], [wp2.lat, wp2.lon]];

      const legLine = L.polyline(legCoords, {
        color: color,
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      });
      routeLayer.addLayer(legLine);
      legPolylines.push(legLine);

      // Subtle direction dash overlay
      const dashLine = L.polyline(legCoords, {
        color: color,
        weight: 1.5,
        opacity: 0.4,
        dashArray: '8, 12',
        lineCap: 'round',
      });
      routeLayer.addLayer(dashLine);
    }

    // 3. Waypoint markers
    waypoints.forEach((wp, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === waypoints.length - 1;

      const risk = (wp.leg || {}).riskAssessment;
      const riskLevel = risk ? risk.level : null;

      let markerClass = 'wp-marker-icon';
      if (isStart) markerClass += ' wp-start';
      else if (isEnd) markerClass += ' wp-end';
      else if (riskLevel) markerClass += ` risk-${riskLevel}`;

      const icon = L.divIcon({
        className: '',
        html: `<div class="${markerClass}">${wp.id}</div>`,
        iconSize: [isStart || isEnd ? 32 : 28, isStart || isEnd ? 32 : 28],
        iconAnchor: [isStart || isEnd ? 16 : 14, isStart || isEnd ? 16 : 14],
      });

      const marker = L.marker([wp.lat, wp.lon], { icon });

      marker.bindPopup(buildPopupContent(wp), {
        maxWidth: 280,
        className: 'wp-popup-container',
      });

      marker.on('click', () => {
        if (onWaypointClick) onWaypointClick(idx);
      });

      markerLayer.addLayer(marker);

      // Label
      const labelMarker = L.marker([wp.lat, wp.lon], {
        icon: L.divIcon({ className: '', html: '', iconSize: [0, 0] }),
      });
      labelMarker.bindTooltip(wp.name, {
        permanent: true,
        direction: 'right',
        offset: [16, 0],
        className: 'wp-label',
      });
      labelLayer.addLayer(labelMarker);
    });

    // Fit map to route
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [50, 50] });

    initVesselMarker(waypoints[0]);
  }

  /**
   * Highlight a specific route leg (by leg index, 0 = first leg).
   * Zooms to the leg and applies a temporary visual pulse.
   */
  function highlightLeg(legIndex, zoomTo) {
    if (legIndex < 0 || legIndex >= legPolylines.length) return;

    const line = legPolylines[legIndex];
    if (!line) return;

    if (zoomTo) {
      map.fitBounds(line.getBounds(), { padding: [60, 60], maxZoom: 11 });
    }

    // Temporarily thicken and animate the line
    const origWeight = 4;
    line.setStyle({ weight: 8, opacity: 1 });
    line.bringToFront();

    const el = line.getElement && line.getElement();
    if (el) el.classList.add('leaflet-highlighted-leg');

    setTimeout(() => {
      line.setStyle({ weight: origWeight, opacity: 0.9 });
      if (el) el.classList.remove('leaflet-highlighted-leg');
    }, 3200);
  }

  /**
   * Focus the map on the legs described by an advisory's relatedWaypoints.
   * Accepts an advisory object { relatedWaypoints: [wpId1, wpId2] }.
   */
  function focusAdvisory(advisory) {
    if (!advisory || !advisory.relatedWaypoints || advisory.relatedWaypoints.length < 2) return;
    const startId = advisory.relatedWaypoints[0];

    // Find the leg index: leg i goes from waypoint[i] to waypoint[i+1]
    const legIdx = currentWaypoints.findIndex(wp => wp.id === startId);
    if (legIdx >= 0) {
      highlightLeg(legIdx, true);
    }
  }

  /** Set callback for hotspot polygon clicks (id: string). */
  function setOnHotspotClick(cb) {
    onHotspotClick = cb;
  }

  /** Render XTD Polygons using Turf.js */
  function renderXTD(waypoints) {
    if (!xtdVisible || waypoints.length < 2) return;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const wp1 = waypoints[i];
      const wp2 = waypoints[i + 1];
      const leg = wp1.leg || {};

      const portXTD = (leg.portsideXTD || 0.1) * 1852;
      const stbdXTD = (leg.starboardXTD || 0.1) * 1852;

      const p1 = turf.point([wp1.lon, wp1.lat]);
      const p2 = turf.point([wp2.lon, wp2.lat]);
      const bearing = turf.bearing(p1, p2);

      const p1_stbd = turf.destination(p1, stbdXTD / 1000, bearing + 90, { units: 'kilometers' });
      const p1_port = turf.destination(p1, portXTD / 1000, bearing - 90, { units: 'kilometers' });
      const p2_stbd = turf.destination(p2, stbdXTD / 1000, bearing + 90, { units: 'kilometers' });
      const p2_port = turf.destination(p2, portXTD / 1000, bearing - 90, { units: 'kilometers' });

      const latlngs = [
        [p1_port.geometry.coordinates[1], p1_port.geometry.coordinates[0]],
        [p2_port.geometry.coordinates[1], p2_port.geometry.coordinates[0]],
        [p2_stbd.geometry.coordinates[1], p2_stbd.geometry.coordinates[0]],
        [p1_stbd.geometry.coordinates[1], p1_stbd.geometry.coordinates[0]]
      ];

      const polygon = L.polygon(latlngs, {
        color: '#e74c3c',
        weight: 1,
        opacity: 0.3,
        fillColor: '#e74c3c',
        fillOpacity: 0.05,
        interactive: false
      });

      xtdLayer.addLayer(polygon);
    }
  }

  /** Calculate total route distance in NM */
  function calculateTotalDistance(waypoints) {
    let total = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      const from = turf.point([waypoints[i].lon, waypoints[i].lat]);
      const to = turf.point([waypoints[i + 1].lon, waypoints[i + 1].lat]);
      total += turf.distance(from, to, { units: 'nauticalmiles' });
    }
    return total;
  }

  // --- Simulation Logic ---

  function initVesselMarker(startWp) {
    if (simState.vesselMarker) {
      vesselLayer.removeLayer(simState.vesselMarker);
    }

    const boatSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
      </svg>
    `;

    const icon = L.divIcon({
      className: 'vessel-icon',
      html: `<div style="transform: rotate(45deg); color: #e67e22; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));">${boatSvg}</div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });

    simState.vesselMarker = L.marker([startWp.lat, startWp.lon], { icon }).addTo(vesselLayer);
  }

  function setSpeedUpdateCallback(cb) {
    onSpeedUpdate = cb;
  }

  function startSimulation() {
    if (simState.active) return;
    simState.active = true;
    simState.startTime = performance.now() - simState.pausedAt;
    animate();
  }

  function pauseSimulation() {
    simState.active = false;
    simState.pausedAt = performance.now() - simState.startTime;
    if (simState.rafId) cancelAnimationFrame(simState.rafId);
  }

  function resetSimulation() {
    pauseSimulation();
    simState.pausedAt = 0;
    simState.progress = 0;
    simState.currentLegIndex = 0;
    if (currentWaypoints.length > 0) {
      initVesselMarker(currentWaypoints[0]);
    }
    if (onSpeedUpdate) onSpeedUpdate(0);
  }

  function animate() {
    if (!simState.active) return;
    moveVesselStep();
    simState.rafId = requestAnimationFrame(animate);
  }

  function moveVesselStep() {
    const totalDist = simState.totalDistance;
    const demoDurationSeconds = 30;
    const speedNMPerFrame = totalDist / (demoDurationSeconds * 60);

    simState.progress += speedNMPerFrame;
    if (simState.progress >= totalDist) {
      simState.progress = 0;
    }

    let currentDist = 0;

    for (let i = 0; i < currentWaypoints.length - 1; i++) {
      const wp1 = currentWaypoints[i];
      const wp2 = currentWaypoints[i + 1];
      const p1 = turf.point([wp1.lon, wp1.lat]);
      const p2 = turf.point([wp2.lon, wp2.lat]);
      const legDist = turf.distance(p1, p2, { units: 'nauticalmiles' });

      if (currentDist + legDist >= simState.progress) {
        const legTravel = simState.progress - currentDist;
        const bearing = turf.bearing(p1, p2);
        const pos = turf.destination(p1, legTravel, bearing, { units: 'nauticalmiles' });

        const lat = pos.geometry.coordinates[1];
        const lon = pos.geometry.coordinates[0];
        simState.vesselMarker.setLatLng([lat, lon]);

        const iconDiv = simState.vesselMarker.getElement().querySelector('div');
        if (iconDiv) {
          iconDiv.style.transform = `rotate(${bearing}deg)`;
        }

        const speed = wp1.leg?.speedMax || 15.0;
        if (onSpeedUpdate) onSpeedUpdate(speed);
        break;
      }
      currentDist += legDist;
    }
  }

  /** Build HTML popup content for a waypoint. */
  function buildPopupContent(wp) {
    const leg = wp.leg || {};
    const risk = leg.riskAssessment;

    let html = `<div class="wp-popup">`;
    html += `<div class="wp-popup-title">WP ${wp.id} — ${wp.name}</div>`;
    html += infoRow('Latitude', formatCoord(wp.lat, 'N', 'S'));
    html += infoRow('Longitude', formatCoord(wp.lon, 'E', 'W'));
    if (leg.speedMax) html += infoRow('Planned Speed', `${leg.speedMax} kn`);
    if (leg.portsideXTD) html += infoRow('XTD Port', `${leg.portsideXTD} NM`);
    if (leg.starboardXTD) html += infoRow('XTD Stbd', `${leg.starboardXTD} NM`);
    if (leg.geometryType) html += infoRow('Geometry', leg.geometryType);
    if (wp.legDistanceNm) html += infoRow('Leg Distance', `${wp.legDistanceNm} NM`);
    if (wp.eta) html += infoRow('ETA', formatETA(wp.eta));
    if (risk) {
      const riskLabel = risk.level.charAt(0).toUpperCase() + risk.level.slice(1);
      html += infoRow('Leg Risk', `<span style="color:${RISK_COLORS[risk.level] || '#333'};font-weight:700">${riskLabel}</span>`);
    }
    html += `</div>`;
    return html;
  }

  function infoRow(label, value) {
    return `<div class="info-row"><span class="info-label">${label}</span><span class="info-value">${value}</span></div>`;
  }

  function formatCoord(decimal, posChar, negChar) {
    const dir = decimal >= 0 ? posChar : negChar;
    const abs = Math.abs(decimal);
    const deg = Math.floor(abs);
    const min = ((abs - deg) * 60).toFixed(3);
    return `${deg}° ${min}' ${dir}`;
  }

  function formatETA(isoStr) {
    try {
      const d = new Date(isoStr);
      return d.toUTCString().replace('GMT', 'UTC');
    } catch {
      return isoStr;
    }
  }

  /** Open the popup for a specific waypoint by index. */
  function openWaypointPopup(index) {
    const layers = markerLayer.getLayers();
    if (layers[index]) {
      map.setView(layers[index].getLatLng(), map.getZoom());
      layers[index].openPopup();
    }
  }

  return {
    init,
    toggleSeaMarks,
    toggleLabels,
    toggleXTD,
    toggleHotspots,
    renderRoute,
    renderHotspots,
    highlightLeg,
    focusAdvisory,
    setOnHotspotClick,
    openWaypointPopup,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    setSpeedUpdateCallback,
  };
})();
