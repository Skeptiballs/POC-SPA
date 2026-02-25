/**
 * RTZ Display module — Vessel info panel, waypoint list, and sidebar interactions.
 */

const RTZDisplay = (() => {

  let currentWaypoints = [];

  /** Render vessel information in the sidebar. */
  function renderVesselInfo(routeData) {
    const info = routeData.routeInfo || {};
    const el = document.getElementById('vessel-info');

    el.innerHTML = `
      <div class="info-row">
        <span class="info-label">Vessel</span>
        <span class="info-value highlight">${info.vesselName || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">MMSI</span>
        <span class="info-value">${info.vesselMMSI || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">IMO</span>
        <span class="info-value">${info.vesselIMO || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Route Author</span>
        <span class="info-value">${info.routeAuthor || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value">${info.routeStatus || '—'}</span>
      </div>
    `;
  }

  /** Render route summary in the sidebar. */
  function renderRouteSummary(routeData) {
    const info = routeData.routeInfo || {};
    const el = document.getElementById('route-info');

    // Find first and last ETAs
    const wps = routeData.waypoints || [];
    const etaFirst = wps.find(w => w.eta);
    const etaLast = [...wps].reverse().find(w => w.eta);

    el.innerHTML = `
      <div class="info-row">
        <span class="info-label">Route Name</span>
        <span class="info-value">${info.routeName || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Voyage ID</span>
        <span class="info-value">${info.vesselVoyage || '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Waypoints</span>
        <span class="info-value highlight">${routeData.waypointCount || 0}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Total Distance</span>
        <span class="info-value highlight">${routeData.totalDistanceNm || 0} NM</span>
      </div>
      <div class="info-row">
        <span class="info-label">Departure</span>
        <span class="info-value">${etaFirst ? formatETA(etaFirst.eta) : '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Arrival</span>
        <span class="info-value">${etaLast ? formatETA(etaLast.eta) : '—'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">RTZ Version</span>
        <span class="info-value">${routeData.rtzVersion || '—'}</span>
      </div>
    `;
  }

  /** Render the waypoint list in the sidebar. */
  function renderWaypointList(waypoints, onWaypointClick) {
    currentWaypoints = waypoints;
    const el = document.getElementById('waypoint-list');

    if (!waypoints || waypoints.length === 0) {
      el.innerHTML = '<div class="info-placeholder">No waypoints</div>';
      return;
    }

    el.innerHTML = waypoints.map((wp, idx) => {
      const eta = wp.eta ? `<span class="wp-eta">${formatShortETA(wp.eta)}</span>` : '';
      const speedInfo = wp.leg ? `${wp.leg.speedMax} kn` : '';
      const distInfo = wp.legDistanceNm ? `${wp.legDistanceNm} NM` : '';
      const metaParts = [speedInfo, distInfo].filter(Boolean).join(' · ');

      return `
        <div class="wp-item" data-index="${idx}" onclick="RTZDisplay.onWaypointClick(${idx})">
          <div class="wp-number">${wp.id}</div>
          <div class="wp-details">
            <div class="wp-name">${wp.name}</div>
            <div class="wp-meta">${metaParts}</div>
          </div>
          ${eta}
        </div>
      `;
    }).join('');
  }

  /** Handle waypoint click from sidebar list. */
  function onWaypointClick(index) {
    // Highlight active item in sidebar
    document.querySelectorAll('.wp-item').forEach(el => el.classList.remove('active'));
    const item = document.querySelector(`.wp-item[data-index="${index}"]`);
    if (item) {
      item.classList.add('active');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Highlight active node on timeline
    document.querySelectorAll('.tl-node').forEach(el => el.classList.remove('active'));
    const tlNode = document.querySelector(`.tl-node[data-index="${index}"]`);
    if (tlNode) tlNode.classList.add('active');

    // Open popup on map
    MapModule.openWaypointPopup(index);
  }

  /** Render MCSSE bridge status. */
  function renderMCSSEStatus(status) {
    const el = document.getElementById('mcsse-info');

    let dotClass = 'pending';
    let statusText = 'Not configured';

    if (status.dryRun) {
      dotClass = 'dry-run';
      statusText = 'Dry-run mode';
    } else if (status.configured) {
      dotClass = 'connected';
      statusText = 'Connected';
    }

    let lastPush = '';
    if (status.lastPushTime) {
      lastPush = `<div class="info-row">
        <span class="info-label">Last push</span>
        <span class="info-value">${formatETA(status.lastPushTime)}</span>
      </div>`;
    }

    el.innerHTML = `
      <div class="mcsse-status-row">
        <span class="mcsse-status-dot ${dotClass}"></span>
        <span style="font-size:12px;font-weight:500">${statusText}</span>
      </div>
      ${lastPush}
      <button class="push-btn" onclick="App.pushToMCSSE()">Push Route to MCSSE</button>
    `;
  }

  /** Update connection status badge. */
  function updateConnectionStatus(mode, hasData) {
    const badge = document.getElementById('connection-status');
    const text = document.getElementById('status-text');

    badge.className = 'status-badge';

    if (mode === 'furuno' && hasData) {
      badge.classList.add('status-connected');
      text.textContent = 'Connected to Furuno Cloud';
    } else if (mode === 'file' && hasData) {
      badge.classList.add('status-file');
      text.textContent = 'Local RTZ file loaded';
    } else if (hasData) {
      badge.classList.add('status-cached');
      text.textContent = 'Using cached data';
    } else {
      badge.classList.add('status-error');
      text.textContent = 'No data available';
    }
  }

  // Formatting helpers
  function formatETA(isoStr) {
    try {
      const d = new Date(isoStr);
      return d.toUTCString().replace('GMT', 'UTC');
    } catch {
      return isoStr || '—';
    }
  }

  function formatShortETA(isoStr) {
    try {
      const d = new Date(isoStr);
      const month = d.toLocaleString('en', { month: 'short', timeZone: 'UTC' });
      const day = d.getUTCDate();
      const hours = String(d.getUTCHours()).padStart(2, '0');
      const mins = String(d.getUTCMinutes()).padStart(2, '0');
      return `${day} ${month} ${hours}:${mins}Z`;
    } catch {
      return '';
    }
  }

  /** Render the voyage timeline at the bottom of the map. */
  function renderTimeline(routeData) {
    const container = document.getElementById('voyage-timeline');
    const track = document.getElementById('timeline-track');
    const subtitle = document.getElementById('timeline-subtitle');
    const waypoints = routeData.waypoints || [];

    if (!waypoints || waypoints.length < 2) {
      container.classList.remove('visible');
      return;
    }

    // Calculate cumulative distances for proportional spacing
    let cumDist = [0];
    for (let i = 1; i < waypoints.length; i++) {
      cumDist.push(cumDist[i - 1] + (waypoints[i].legDistanceNm || 0));
    }
    const totalDist = cumDist[cumDist.length - 1] || 1;

    // Subtitle text
    const info = routeData.routeInfo || {};
    subtitle.textContent = `${info.vesselName || ''} — ${routeData.totalDistanceNm || 0} NM — ${waypoints.length} waypoints`;

    // Clear existing nodes (keep the line)
    track.querySelectorAll('.tl-node, .timeline-line-fill').forEach(el => el.remove());

    // Add the gradient fill line
    const fillLine = document.createElement('div');
    fillLine.className = 'timeline-line-fill';
    fillLine.style.width = '0%';
    track.appendChild(fillLine);

    // Add nodes
    waypoints.forEach((wp, idx) => {
      const pct = (cumDist[idx] / totalDist) * 100;
      const isStart = idx === 0;
      const isEnd = idx === waypoints.length - 1;

      const node = document.createElement('div');
      node.className = 'tl-node';
      if (isStart) node.classList.add('tl-start');
      if (isEnd) node.classList.add('tl-end');
      node.dataset.index = idx;
      node.style.left = `${pct}%`;
      node.style.animationDelay = `${0.1 + idx * 0.04}s`;

      const dot = document.createElement('div');
      dot.className = 'tl-dot';

      const labelTop = document.createElement('span');
      labelTop.className = 'tl-label-top';
      labelTop.textContent = wp.name;

      const labelBottom = document.createElement('span');
      labelBottom.className = 'tl-label-bottom';
      labelBottom.textContent = wp.eta ? formatShortETA(wp.eta) : `${cumDist[idx].toFixed(0)} NM`;

      node.appendChild(labelTop);
      node.appendChild(dot);
      node.appendChild(labelBottom);

      node.addEventListener('click', () => {
        onWaypointClick(idx);
      });

      track.appendChild(node);
    });

    // Animate the fill line in after a beat
    requestAnimationFrame(() => {
      container.classList.add('visible');
      setTimeout(() => {
        fillLine.style.width = '100%';
      }, 200);
    });
  }

  return {
    renderVesselInfo,
    renderRouteSummary,
    renderWaypointList,
    renderTimeline,
    renderMCSSEStatus,
    updateConnectionStatus,
    onWaypointClick,
  };
})();
