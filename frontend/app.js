/**
 * App module — Main application logic, data fetching, and event wiring.
 */

const App = (() => {
  const API_BASE = '';  // Same origin

  /** Initialize the application. */
  async function init() {
    // Init map
    MapModule.init();

    // Wire up controls
    document.getElementById('toggle-seamark').addEventListener('change', (e) => {
      MapModule.toggleSeaMarks(e.target.checked);
    });

    document.getElementById('toggle-labels').addEventListener('change', (e) => {
      MapModule.toggleLabels(e.target.checked);
    });

    document.getElementById('toggle-xtd').addEventListener('change', (e) => {
      MapModule.toggleXTD(e.target.checked);
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

    // Wire up file upload
    document.getElementById('rtz-upload').addEventListener('change', handleFileUpload);

    // Load initial data
    await loadRouteData();
    await loadStatus();
  }

  /** Fetch route data from the backend and render everything. */
  async function loadRouteData() {
    try {
      const resp = await fetch(`${API_BASE}/api/route`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      renderAll(data);
    } catch (err) {
      console.error('Failed to load route data:', err);
      RTZDisplay.updateConnectionStatus('error', false);
    }
  }

  /** Render all UI components with route data. */
  function renderAll(data) {
    RTZDisplay.renderVesselInfo(data);
    RTZDisplay.renderRouteSummary(data);
    RTZDisplay.renderWaypointList(data.waypoints, (idx) => {
      MapModule.openWaypointPopup(idx);
    });
    RTZDisplay.renderTimeline(data);
    MapModule.renderRoute(data.waypoints, (idx) => {
      RTZDisplay.onWaypointClick(idx);
    });
  }

  /** Load app/MCSSE status. */
  async function loadStatus() {
    try {
      const resp = await fetch(`${API_BASE}/api/status`);
      if (!resp.ok) return;
      const status = await resp.json();
      RTZDisplay.updateConnectionStatus(status.dataSource, status.hasRouteData);
      RTZDisplay.renderMCSSEStatus(status.mcsse);
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
      renderAll(data);
      RTZDisplay.updateConnectionStatus('file', true);

      statusEl.textContent = `Loaded: ${file.name}`;
      statusEl.className = 'upload-status success';
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
      statusEl.className = 'upload-status error';
    }

    // Reset file input so the same file can be re-uploaded
    e.target.value = '';
  }

  /** Push route data to MCSSE. */
  async function pushToMCSSE() {
    try {
      const resp = await fetch(`${API_BASE}/api/mcsse/push`, { method: 'POST' });
      const result = await resp.json();
      // Refresh status display
      await loadStatus();
      console.log('MCSSE push result:', result);
    } catch (err) {
      console.error('MCSSE push failed:', err);
    }
  }

  return { init, pushToMCSSE };
})();

// Boot on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
