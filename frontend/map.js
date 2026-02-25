/**
 * Map module — Leaflet map setup, route rendering, and simulation.
 */

const MapModule = (() => {
  // Singapore Strait default view
  const DEFAULT_CENTER = [3.0, 115.0];
  const DEFAULT_ZOOM = 5;

  let map = null;
  let routeLayer = null;
  let markerLayer = null;
  let labelLayer = null;
  let seaMarkLayer = null;
  let xtdLayer = null;
  let vesselLayer = null;
  
  // State
  let currentWaypoints = [];
  let labelsVisible = true;
  let xtdVisible = true;

  // Simulation state
  let simState = {
    active: false,
    startTime: 0,
    pausedAt: 0,
    speedFactor: 300, // 1 real sec = 300 sim sec
    progress: 0, // 0 to 1 along total distance
    rafId: null,
    totalDistance: 0,
    currentLegIndex: 0,
    vesselMarker: null
  };

  // Event callbacks
  let onSpeedUpdate = null;

  /** Initialize the Leaflet map. */
  function init() {
    map = L.map('map', {
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: true,
      attributionControl: true,
    });

    // Base tile layer — clean light style
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    // OpenSeaMap overlay (hidden by default)
    seaMarkLayer = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openseamap.org">OpenSeaMap</a>',
      maxZoom: 18,
      opacity: 0.8,
    });

    // Layer groups for route elements
    xtdLayer = L.layerGroup().addTo(map);
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

  /**
   * Render a route on the map.
   * @param {Array} waypoints — parsed waypoint array from the API
   * @param {Function} onWaypointClick — callback(waypointIndex) when a marker is clicked
   */
  function renderRoute(waypoints, onWaypointClick) {
    // Clear existing layers
    routeLayer.clearLayers();
    markerLayer.clearLayers();
    labelLayer.clearLayers();
    xtdLayer.clearLayers();
    vesselLayer.clearLayers();

    currentWaypoints = waypoints;
    simState.totalDistance = calculateTotalDistance(waypoints);

    if (!waypoints || waypoints.length === 0) return;

    const coords = waypoints.map(wp => [wp.lat, wp.lon]);

    // 1. Render XTD (Safety Corridor)
    renderXTD(waypoints);

    // 2. Route polyline
    const routeLine = L.polyline(coords, {
      color: '#0077b6',
      weight: 3.5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    });
    routeLayer.addLayer(routeLine);

    // Route direction decorators — dashed overlay
    const routeDash = L.polyline(coords, {
      color: '#00b4d8',
      weight: 1.5,
      opacity: 0.5,
      dashArray: '8, 12',
      lineCap: 'round',
    });
    routeLayer.addLayer(routeDash);

    // 3. Waypoint markers
    waypoints.forEach((wp, idx) => {
      const isStart = idx === 0;
      const isEnd = idx === waypoints.length - 1;

      // Custom numbered marker
      let markerClass = 'wp-marker-icon';
      if (isStart) markerClass += ' wp-start';
      if (isEnd) markerClass += ' wp-end';

      const icon = L.divIcon({
        className: '',
        html: `<div class="${markerClass}">${wp.id}</div>`,
        iconSize: [isStart || isEnd ? 32 : 28, isStart || isEnd ? 32 : 28],
        iconAnchor: [isStart || isEnd ? 16 : 14, isStart || isEnd ? 16 : 14],
      });

      const marker = L.marker([wp.lat, wp.lon], { icon });

      // Popup content
      marker.bindPopup(buildPopupContent(wp), {
        maxWidth: 280,
        className: 'wp-popup-container',
      });

      marker.on('click', () => {
        if (onWaypointClick) onWaypointClick(idx);
      });

      markerLayer.addLayer(marker);

      // Waypoint name label
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

    // Fit map to route bounds
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [50, 50] });

    // Initialize simulation vessel at start
    initVesselMarker(waypoints[0]);
  }

  /** Render XTD Polygons using Turf.js */
  function renderXTD(waypoints) {
    if (!xtdVisible || waypoints.length < 2) return;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const wp1 = waypoints[i];
      const wp2 = waypoints[i+1];
      const leg = wp1.leg || {};

      // Default XTD to 0.1NM if not specified
      const portXTD = (leg.portsideXTD || 0.1) * 1852; // Convert NM to meters
      const stbdXTD = (leg.starboardXTD || 0.1) * 1852;

      // Create Turf points
      const p1 = turf.point([wp1.lon, wp1.lat]);
      const p2 = turf.point([wp2.lon, wp2.lat]);

      // Calculate bearing
      const bearing = turf.bearing(p1, p2);

      // Calculate offset points (90 deg for starboard, -90 for port)
      const p1_stbd = turf.destination(p1, stbdXTD / 1000, bearing + 90, { units: 'kilometers' });
      const p1_port = turf.destination(p1, portXTD / 1000, bearing - 90, { units: 'kilometers' });
      
      const p2_stbd = turf.destination(p2, stbdXTD / 1000, bearing + 90, { units: 'kilometers' });
      const p2_port = turf.destination(p2, portXTD / 1000, bearing - 90, { units: 'kilometers' });

      // Create polygon coordinates: P1_Port -> P2_Port -> P2_Stbd -> P1_Stbd -> P1_Port
      const latlngs = [
        [p1_port.geometry.coordinates[1], p1_port.geometry.coordinates[0]],
        [p2_port.geometry.coordinates[1], p2_port.geometry.coordinates[0]],
        [p2_stbd.geometry.coordinates[1], p2_stbd.geometry.coordinates[0]],
        [p1_stbd.geometry.coordinates[1], p1_stbd.geometry.coordinates[0]]
      ];

      const polygon = L.polygon(latlngs, {
        color: '#e74c3c', // Red warning color
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
      const to = turf.point([waypoints[i+1].lon, waypoints[i+1].lat]);
      total += turf.distance(from, to, { units: 'nauticalmiles' });
    }
    return total;
  }

  // --- Simulation Logic ---

  function initVesselMarker(startWp) {
    if (simState.vesselMarker) {
      vesselLayer.removeLayer(simState.vesselMarker);
    }
    
    // Simple boat shape SVG
    const boatSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="feather feather-navigation">
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
    
    // Find starting leg based on progress if restarting
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

    // Time delta
    // In a real app, we'd base this on the leg speed. 
    // For demo, we'll advance distance based on a fixed "demo speed" or the leg's speed.
    // Let's use the leg's planned speed.
    
    const now = performance.now();
    // This isn't quite right for a "loop" without persistent state, 
    // but good enough for a simple visual update per frame.
    // Actually, let's just move the boat along the route.

    moveVesselStep();
    
    simState.rafId = requestAnimationFrame(animate);
  }

  function moveVesselStep() {
    // Determine current leg
    let distSoFar = 0;
    let targetLeg = null;
    let legProgress = 0;
    
    // We need a global "distance travelled" state to enable pause/resume accurately.
    // Let's simulate: Distance Travelled += Speed * TimeDelta
    // Speed = Leg Speed (e.g., 15kn)
    // Scale factor: 1 real second = X simulated minutes?
    // Let's say we want to cross the route in ~30 seconds for the demo.
    
    // Simplified demo movement:
    const totalDist = simState.totalDistance; // NM
    const demoDurationSeconds = 30; // 30s to cross the whole map
    const speedNMPerFrame = totalDist / (demoDurationSeconds * 60); // approx
    
    simState.progress += speedNMPerFrame;
    if (simState.progress >= totalDist) {
      simState.progress = 0; // Loop or stop? Let's loop.
    }

    // Find position for current distance
    let currentDist = 0;
    let found = false;

    for (let i = 0; i < currentWaypoints.length - 1; i++) {
      const wp1 = currentWaypoints[i];
      const wp2 = currentWaypoints[i+1];
      const p1 = turf.point([wp1.lon, wp1.lat]);
      const p2 = turf.point([wp2.lon, wp2.lat]);
      const legDist = turf.distance(p1, p2, { units: 'nauticalmiles' });

      if (currentDist + legDist >= simState.progress) {
        // We are on this leg
        const legTravel = simState.progress - currentDist;
        const ratio = legTravel / legDist;
        
        // Interpolate position
        const bearing = turf.bearing(p1, p2);
        const pos = turf.destination(p1, legTravel, bearing, { units: 'nauticalmiles' });
        
        // Update marker
        const lat = pos.geometry.coordinates[1];
        const lon = pos.geometry.coordinates[0];
        simState.vesselMarker.setLatLng([lat, lon]);
        
        // Update rotation (bearing) - subtract 45deg because the icon is rotated 45deg in CSS/SVG
        // Actually, let's rotate the div.
        const iconDiv = simState.vesselMarker.getElement().querySelector('div');
        if (iconDiv) {
           // Basic boat icon points up (0 deg). Turf bearing is -180 to 180 (0 is North).
           // CSS rotation 45deg was initial.
           iconDiv.style.transform = `rotate(${bearing}deg)`;
        }

        // Update speed display (use leg speed)
        const speed = wp1.leg?.speedMax || 15.0;
        if (onSpeedUpdate) onSpeedUpdate(speed);

        found = true;
        break;
      }
      currentDist += legDist;
    }
  }

  /** Build HTML popup content for a waypoint. */
  function buildPopupContent(wp) {
    const leg = wp.leg || {};
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
    html += `</div>`;
    return html;
  }

  function infoRow(label, value) {
    return `<div class="info-row"><span class="info-label">${label}</span><span class="info-value">${value}</span></div>`;
  }

  /** Format a decimal degree to a readable coordinate string. */
  function formatCoord(decimal, posChar, negChar) {
    const dir = decimal >= 0 ? posChar : negChar;
    const abs = Math.abs(decimal);
    const deg = Math.floor(abs);
    const min = ((abs - deg) * 60).toFixed(3);
    return `${deg}° ${min}' ${dir}`;
  }

  /** Format an ISO ETA string to a readable format. */
  function formatETA(isoStr) {
    try {
      const d = new Date(isoStr);
      return d.toUTCString().replace('GMT', 'UTC');
    } catch {
      return isoStr;
    }
  }

  /** Open the popup for a specific waypoint by index with smooth animation. */
  function openWaypointPopup(index) {
    const layers = markerLayer.getLayers();
    if (layers[index]) {
      const latlng = layers[index].getLatLng();
      const targetZoom = Math.max(map.getZoom(), 6);
      map.flyTo(latlng, targetZoom, { duration: 0.8, easeLinearity: 0.4 });
      setTimeout(() => layers[index].openPopup(), 400);
    }
  }

  /** Get the Leaflet map instance (for external modules). */
  function getMap() {
    return map;
  }

  return {
    init,
    toggleSeaMarks,
    toggleLabels,
    toggleXTD,
    renderRoute,
    openWaypointPopup,
    getMap,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    setSpeedUpdateCallback,
  };
})();
