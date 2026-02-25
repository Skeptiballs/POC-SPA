/**
 * App module — Main application logic, data fetching, and event wiring.
 * Phase 2: adds hotspot loading, route analysis, and advisory interactions.
 */

const App = (() => {
  const API_BASE = '';  // Same origin

  // Cached analysis data so advisories can resolve advisory objects by ID
  let _analysisData = null;

  /** Initialize the application. */
  async function init() {
    MapModule.init();

    // Map layer toggles
    document.getElementById('toggle-seamark').addEventListener('change', (e) => {
      MapModule.toggleSeaMarks(e.target.checked);
    });

    document.getElementById('toggle-labels').addEventListener('change', (e) => {
      MapModule.toggleLabels(e.target.checked);
    });

    document.getElementById('toggle-xtd').addEventListener('change', (e) => {
      MapModule.toggleXTD(e.target.checked);
    });

    document.getElementById('toggle-hotspots').addEventListener('change', (e) => {
      MapModule.toggleHotspots(e.target.checked);
    });

    // Simulation controls
    const btnPlay = document.getElementById('btn-play');
    const btnPause = document.getElementById('btn-pause');
    const btnReset = document.getElementById('btn-reset');
    const speedEl = document.getElementById('sim-speed');

    btnPlay.addEventListener('click', () => {
      MapModule.startSimulation();
      btnPlay.style.display = 'none';
      btnPause.style.display = 'flex';
    });

    btnPause.addEventListener('click', () => {
      MapModule.pauseSimulation();
      btnPause.style.display = 'none';
      btnPlay.style.display = 'flex';
    });

    btnReset.addEventListener('click', () => {
      MapModule.resetSimulation();
      btnPause.style.display = 'none';
      btnPlay.style.display = 'flex';
      speedEl.textContent = '0.0';
    });

    MapModule.setSpeedUpdateCallback((speed) => {
      speedEl.textContent = speed.toFixed(1);
    });

    // Advisory-to-map interaction: clicking an advisory focuses the map leg
    RTZDisplay.setOnAdvisoryFocus((advisoryId) => {
      if (!_analysisData) return;
      const adv = (_analysisData.advisories || []).find(a => a.id === advisoryId);
      if (adv) MapModule.focusAdvisory(adv);
    });

    // Transmit advisory
    RTZDisplay.setOnTransmitAdvisory(transmitAdvisory);

    // Map hotspot click → highlight advisory in sidebar
    MapModule.setOnHotspotClick((hotspotId) => {
      RTZDisplay.focusAdvisoryByHotspot(hotspotId);
    });

    // File upload
    document.getElementById('rtz-upload').addEventListener('change', handleFileUpload);

    // Load initial data
    await loadRouteData();
    await loadStatus();
  }

  /** Fetch route data from the backend, then run analysis. */
  async function loadRouteData() {
    try {
      const resp = await fetch(`${API_BASE}/api/route`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      await renderAll(data);
    } catch (err) {
      console.error('Failed to load route data:', err);
      RTZDisplay.updateConnectionStatus('error', false);
    }
  }

  /** Render all UI components with route data, then load intelligence layer. */
  async function renderAll(data) {
    // Phase 1: basic panels
    RTZDisplay.renderVesselInfo(data);
    RTZDisplay.renderRouteSummary(data);

    // Show intelligence badge
    const badge = document.getElementById('intelligence-badge');
    const badgeText = document.getElementById('intelligence-text');
    if (badge) {
      badge.style.display = 'flex';
      badgeText.textContent = 'Analysing route...';
    }

    // Phase 2: load hotspots and run analysis in parallel
    let hotspotsData = null;
    let analysisData = null;

    try {
      const [hotspotsResp, analysisResp] = await Promise.all([
        fetch(`${API_BASE}/api/hotspots`).then(r => r.json()),
        fetch(`${API_BASE}/api/analyze-route`, { method: 'POST' }).then(r => r.json()),
      ]);
      hotspotsData = hotspotsResp;
      analysisData = analysisResp;
      _analysisData = analysisData;
    } catch (err) {
      console.warn('Intelligence layer unavailable — displaying base route:', err);
    }

    // Render map: use enriched waypoints if available, else original
    const waypoints = (analysisData && analysisData.enrichedWaypoints) || data.waypoints;
    MapModule.renderRoute(waypoints, (idx) => {
      RTZDisplay.onWaypointClick(idx);
    });

    // Render hotspot polygons
    if (hotspotsData && hotspotsData.features) {
      MapModule.renderHotspots(hotspotsData.features);
    }

    // Render waypoint list with risk dots
    RTZDisplay.renderWaypointList(waypoints, (idx) => {
      MapModule.openWaypointPopup(idx);
    });

    // Render Phase 2 panels
    if (analysisData) {
      RTZDisplay.renderRiskSummary(analysisData.riskSummary, analysisData.enrichedWaypoints);
      RTZDisplay.renderAdvisories(analysisData.advisories || []);

      if (badge) {
        const risk = analysisData.riskSummary || {};
        const count = (analysisData.advisories || []).length;
        badgeText.textContent = `${count} advisor${count === 1 ? 'y' : 'ies'} · Risk: ${(risk.overallRisk || 'low').toUpperCase()}`;
      }
    } else {
      if (badge) badge.style.display = 'none';
    }
  }

  /** Load app/MCSSE status and update footer. */
  async function loadStatus() {
    try {
      const resp = await fetch(`${API_BASE}/api/status`);
      if (!resp.ok) return;
      const status = await resp.json();
      RTZDisplay.updateConnectionStatus(status.dataSource, status.hasRouteData);
      RTZDisplay.renderMCSSEStatus(status.mcsse);
      RTZDisplay.updateFooter(status);
    } catch (err) {
      console.error('Failed to load status:', err);
    }
  }

  /** Handle RTZ file upload. */
  async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('upload-status');
    statusEl.textContent = 'Uploading...';
    statusEl.className = 'upload-status';

    const formData = new FormData();
    formData.append('file', file);

    try {
      const resp = await fetch(`${API_BASE}/api/route/upload`, {
        method: 'POST',
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }
      const data = await resp.json();
      await renderAll(data);
      RTZDisplay.updateConnectionStatus('file', true);

      statusEl.textContent = `Loaded: ${file.name}`;
      statusEl.className = 'upload-status success';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'upload-status error';
    }

    e.target.value = '';
  }

  /** Push route data to MCSSE. */
  async function pushToMCSSE() {
    try {
      const resp = await fetch(`${API_BASE}/api/mcsse/push`, { method: 'POST' });
      const result = await resp.json();
      await loadStatus();
      console.log('MCSSE push result:', result);
    } catch (err) {
      console.error('MCSSE push failed:', err);
    }
  }

  /**
   * Transmit a specific advisory via the backend API.
   * Shows a confirmation modal and updates the transmission log.
   */
  async function transmitAdvisory(advisoryId) {
    try {
      const resp = await fetch(`${API_BASE}/api/advisories/${advisoryId}/transmit`, {
        method: 'POST',
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const result = await resp.json();

      // Mark advisory as queued in the UI
      RTZDisplay.markAdvisoryQueued(advisoryId);

      // Show confirmation modal
      const modal = document.getElementById('transmit-modal');
      const msgEl = document.getElementById('transmit-modal-msg');
      if (modal && msgEl) {
        msgEl.textContent = `Advisory queued as ${result.messageId}.`;
        modal.style.display = 'flex';
      }

      // Refresh transmission log
      await loadTransmissionLog();
    } catch (err) {
      console.error('Transmit advisory failed:', err);
      alert('Failed to queue advisory. Please try again.');
    }
  }

  /** Fetch and render the transmission log. */
  async function loadTransmissionLog() {
    try {
      const resp = await fetch(`${API_BASE}/api/transmission-log`);
      if (!resp.ok) return;
      const data = await resp.json();
      RTZDisplay.renderTransmissionLog(data.log || []);
    } catch (err) {
      console.warn('Failed to load transmission log:', err);
    }
  }

  return { init, pushToMCSSE };
})();

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
