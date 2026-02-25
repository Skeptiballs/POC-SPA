/**
 * Map module — Leaflet map setup and route rendering.
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
  let labelsVisible = true;

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
    routeLayer = L.layerGroup().addTo(map);
    markerLayer = L.layerGroup().addTo(map);
    labelLayer = L.layerGroup().addTo(map);

    return map;
  }

  /** Toggle the OpenSeaMap overlay. */
  function toggleSeaMarks(show) {
    if (show) {
      seaMarkLayer.addTo(map);
    } else {
      map.removeLayer(seaMarkLayer);
    }
  }

  /** Toggle waypoint labels. */
  function toggleLabels(show) {
    labelsVisible = show;
    if (show) {
      labelLayer.addTo(map);
    } else {
      map.removeLayer(labelLayer);
    }
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

    if (!waypoints || waypoints.length === 0) return;

    const coords = waypoints.map(wp => [wp.lat, wp.lon]);

    // Route polyline
    const routeLine = L.polyline(coords, {
      color: '#0077b6',
      weight: 3.5,
      opacity: 0.85,
      lineCap: 'round',
      lineJoin: 'round',
    });
    routeLayer.addLayer(routeLine);

    // Route direction decorators — dashed overlay for visual direction
    const routeDash = L.polyline(coords, {
      color: '#00b4d8',
      weight: 1.5,
      opacity: 0.5,
      dashArray: '8, 12',
      lineCap: 'round',
    });
    routeLayer.addLayer(routeDash);

    // Waypoint markers
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
      const label = L.tooltip({
        permanent: true,
        direction: 'right',
        offset: [16, 0],
        className: 'wp-label',
      });
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

    // Fit map to route bounds with padding
    const bounds = L.latLngBounds(coords);
    map.fitBounds(bounds, { padding: [50, 50] });
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
    renderRoute,
    openWaypointPopup,
  };
})();
