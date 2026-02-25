/**
 * RTZ Display module — Vessel info panel, risk summary, advisory list,
 * waypoint list, and sidebar interactions.
 */

const RTZDisplay = (() => {

  let currentWaypoints = [];
  let txLogVisible = false;

  // Advisory expand/collapse state (advisoryId → expanded bool)
  const expandedAdvisories = {};

  // Callback wired by App for advisory-to-map interaction
  let onAdvisoryFocus = null;
  let onTransmitAdvisory = null;

  /** Set the callback invoked when an advisory is clicked. */
  function setOnAdvisoryFocus(cb) {
    onAdvisoryFocus = cb;
  }

  /** Set the callback invoked when "Transmit" is clicked. */
  function setOnTransmitAdvisory(cb) {
    onTransmitAdvisory = cb;
  }

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

  /** Render route risk summary (Phase 2). */
  function renderRiskSummary(riskSummary, enrichedWaypoints) {
    const card = document.getElementById('risk-card');
    const el = document.getElementById('risk-summary');
    const overallBadge = document.getElementById('overall-risk-badge');

    if (!riskSummary) {
      card.style.display = 'none';
      return;
    }

    const level = riskSummary.overallRisk || 'low';
    const levelLabel = level.toUpperCase();

    // Update card-header badge
    overallBadge.className = `risk-badge risk-${level}`;
    overallBadge.textContent = levelLabel;

    const riskyLegs = (riskSummary.riskyLegs || []).filter(l =>
      l.riskLevel === 'high' || l.riskLevel === 'medium'
    );

    // Stats row
    let html = `
      <div class="risk-stats">
        <div class="risk-stat">
          <div class="risk-stat-value">${riskSummary.hotspotCount || 0}</div>
          <div class="risk-stat-label">Hotspot Zones</div>
        </div>
        <div class="risk-stat">
          <div class="risk-stat-value">${riskyLegs.length}</div>
          <div class="risk-stat-label">Flagged Legs</div>
        </div>
        <div class="risk-stat">
          <div class="risk-stat-value" style="color:var(--color-risk-${level})">${levelLabel}</div>
          <div class="risk-stat-label">Overall Risk</div>
        </div>
      </div>
    `;

    // Risky leg list (amber/red only)
    if (riskyLegs.length > 0) {
      html += `<ul class="risk-leg-list">`;
      riskyLegs.forEach(leg => {
        const levelLabel = leg.riskLevel.charAt(0).toUpperCase() + leg.riskLevel.slice(1);
        const shortDesc = leg.summary
          ? leg.summary.split('.')[0].replace(/^[^:]+:\s*/, '').substring(0, 50)
          : '';
        html += `
          <li class="risk-leg-item" onclick="RTZDisplay._onRiskLegClick(${leg.legIndex})">
            <span class="risk-dot risk-${leg.riskLevel}"></span>
            <span class="risk-leg-route">WP${leg.fromWaypointId} → WP${leg.toWaypointId}</span>
            <span class="risk-leg-level risk-${leg.riskLevel}">${levelLabel}</span>
            <span class="risk-leg-desc">${shortDesc}</span>
          </li>
        `;
      });
      html += `</ul>`;
    } else {
      html += `<div style="font-size:12px;color:var(--color-text-muted);padding:8px 0">No high-risk legs identified along route.</div>`;
    }

    // Hotspot toggle row
    const toggleLabel = document.getElementById('toggle-hotspots');
    html += `
      <div class="hotspot-toggle-row">
        <span>${riskSummary.hotspotCount || 0} hotspot zone${riskSummary.hotspotCount !== 1 ? 's' : ''} along route</span>
        <button class="hotspot-toggle-btn" onclick="document.getElementById('toggle-hotspots').click()">
          Toggle on Map
        </button>
      </div>
    `;

    el.innerHTML = html;
    card.style.display = '';
  }

  /** Handle click on a risky leg entry in the risk summary. */
  function _onRiskLegClick(legIndex) {
    MapModule.highlightLeg(legIndex, true);
  }

  /** Render advisory list (Phase 2). */
  function renderAdvisories(advisories) {
    const card = document.getElementById('advisory-card');
    const el = document.getElementById('advisory-list');
    const countBadge = document.getElementById('advisory-count-badge');

    if (!advisories || advisories.length === 0) {
      card.style.display = 'none';
      return;
    }

    countBadge.textContent = advisories.length;
    card.style.display = '';

    el.innerHTML = advisories.map(adv => buildAdvisoryItem(adv)).join('');
  }

  /** Build HTML for a single advisory item (collapsed by default). */
  function buildAdvisoryItem(adv) {
    const isExpanded = !!expandedAdvisories[adv.id];
    const sev = adv.severity || 'low';
    const wpsText = adv.relatedWaypoints && adv.relatedWaypoints.length >= 2
      ? `WP${adv.relatedWaypoints[0]} → WP${adv.relatedWaypoints[1]}`
      : '';

    const structData = adv.structuredData || {};
    const density = structData.trafficDensity;
    const inPeak = structData.inPeakWindow;
    const peakWindow = structData.peakWindow;
    const recommendedAction = structData.recommendedAction || '';

    const alreadySent = _isAlreadyQueued(adv.id);

    const detailHtml = `
      <div class="advisory-detail">
        <div class="advisory-message">${adv.message || ''}</div>
        ${density ? `<div class="advisory-message" style="margin-bottom:0"><strong>Traffic density:</strong> ${density.value} ${density.unit}${inPeak ? ` <span style="color:var(--color-risk-high);font-weight:600">— peak period active (${peakWindow})</span>` : ''}</div>` : ''}
        <div class="advisory-rec">
          <div class="advisory-rec-label">Recommendation</div>
          ${recommendedAction}
        </div>
        <div class="advisory-tx-box">
          ${alreadySent
            ? `<div class="advisory-tx-sent"><span class="material-icons" style="font-size:14px">check_circle</span> Queued for transmission</div>`
            : `
              <div class="advisory-tx-status">
                <span class="material-icons" style="font-size:14px">cell_tower</span>
                Transmission Status: READY TO SEND
              </div>
              <div class="advisory-tx-method">Method: Furuno Cloud Return Path</div>
              <div class="advisory-tx-actions">
                <button class="transmit-btn" onclick="RTZDisplay._onTransmitClick(event,'${adv.id}')">
                  <span class="material-icons" style="font-size:13px">send</span>
                  Transmit Advisory
                  <span class="demo-tag">DEMO</span>
                </button>
                <button class="edit-before-send-btn" onclick="RTZDisplay._onEditClick(event,'${adv.id}')">Edit</button>
              </div>`
          }
        </div>
      </div>
    `;

    return `
      <div class="advisory-item sev-${sev}${isExpanded ? ' expanded' : ''}"
           id="advisory-item-${adv.id}"
           onclick="RTZDisplay._onAdvisoryClick('${adv.id}')">
        <div class="advisory-header">
          <span class="advisory-sev-badge sev-${sev}">${sev.toUpperCase()}</span>
          <div style="flex:1;min-width:0">
            <div class="advisory-title">${adv.title || ''}</div>
            ${wpsText ? `<div class="advisory-wps">${wpsText}</div>` : ''}
          </div>
          <span class="material-icons advisory-expand-icon">expand_more</span>
        </div>
        ${detailHtml}
      </div>
    `;
  }

  /** Track which advisory IDs have been queued for transmission. */
  const _queuedAdvisories = new Set();

  function _isAlreadyQueued(id) {
    return _queuedAdvisories.has(id);
  }

  /** Toggle expand/collapse of an advisory item. */
  function _onAdvisoryClick(advisoryId) {
    expandedAdvisories[advisoryId] = !expandedAdvisories[advisoryId];

    const item = document.getElementById(`advisory-item-${advisoryId}`);
    if (!item) return;

    if (expandedAdvisories[advisoryId]) {
      item.classList.add('expanded');
    } else {
      item.classList.remove('expanded');
    }

    // Notify map to focus the leg
    if (expandedAdvisories[advisoryId] && onAdvisoryFocus) {
      // Find advisory data from DOM (advisory id is enough for App to look up)
      onAdvisoryFocus(advisoryId);
    }
  }

  /** Handle "Transmit" button click. */
  function _onTransmitClick(event, advisoryId) {
    event.stopPropagation();
    if (onTransmitAdvisory) onTransmitAdvisory(advisoryId);
  }

  /** Handle "Edit" button click. */
  function _onEditClick(event, advisoryId) {
    event.stopPropagation();
    alert('Advisory editing will be available in a future release. Transmit directly or cancel.');
  }

  /** Mark an advisory as queued in the UI (called after successful transmit API call). */
  function markAdvisoryQueued(advisoryId) {
    _queuedAdvisories.add(advisoryId);
    // Re-render just that item's TX box
    const item = document.getElementById(`advisory-item-${advisoryId}`);
    if (item) {
      const txBox = item.querySelector('.advisory-tx-box');
      if (txBox) {
        txBox.innerHTML = `<div class="advisory-tx-sent"><span class="material-icons" style="font-size:14px">check_circle</span> Queued for transmission</div>`;
      }
    }
  }

  /**
   * Scroll to and expand the advisory that relates to a given hotspot ID.
   * Called when the user clicks a hotspot polygon on the map.
   */
  function focusAdvisoryByHotspot(hotspotId) {
    // Find the advisory item whose data-hotspot includes this id
    const items = document.querySelectorAll('.advisory-item');
    items.forEach(item => {
      const id = item.id.replace('advisory-item-', '');
      if (!id) return;
      // Use the title text as a rough proxy; we expand any advisory referencing this hotspot
      // The cleanest approach is to search in the DOM text for the hotspot name / id
      if (item.textContent.includes(hotspotId)) {
        item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (!expandedAdvisories[id]) {
          _onAdvisoryClick(id);
        }
      }
    });
  }

  /** Render transmission log. */
  function renderTransmissionLog(log) {
    const card = document.getElementById('txlog-card');
    const el = document.getElementById('transmission-log');

    if (!log || log.length === 0) {
      return; // Keep hidden until there's something to show
    }

    card.style.display = '';

    el.innerHTML = log.map(entry => {
      const ts = entry.timestamp ? formatShortETA(entry.timestamp) : '—';
      const statusEmoji = {
        pending: '⏳',
        transmitting: '📡',
        delivered: '✅',
        failed: '❌',
      }[entry.status] || '⏳';

      return `
        <div class="txlog-entry">
          <span class="txlog-time">${ts}</span>
          <span class="txlog-id">${entry.messageId}</span>
          <span class="txlog-title">${entry.advisoryTitle || ''}</span>
          <span class="txlog-status ${entry.status}">${statusEmoji} ${entry.status || 'pending'}</span>
        </div>
      `;
    }).join('');

    // Show the log body if visible
    if (txLogVisible) {
      el.style.display = '';
    }
  }

  /** Toggle visibility of the transmission log body. */
  function toggleTransmissionLog() {
    txLogVisible = !txLogVisible;
    const el = document.getElementById('transmission-log');
    const icon = document.getElementById('txlog-toggle-icon');
    if (el) el.style.display = txLogVisible ? '' : 'none';
    if (icon) icon.textContent = txLogVisible ? 'expand_less' : 'expand_more';
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

      const risk = (wp.leg || {}).riskAssessment;
      const riskDot = risk
        ? `<span class="risk-dot risk-${risk.level}" style="margin-left:4px;flex-shrink:0" title="${risk.level} risk"></span>`
        : '';

      return `
        <div class="wp-item" data-index="${idx}" onclick="RTZDisplay.onWaypointClick(${idx})">
          <div class="wp-number">${wp.id}</div>
          <div class="wp-details">
            <div class="wp-name">${wp.name}</div>
            <div class="wp-meta">${metaParts}</div>
          </div>
          ${eta}
          ${riskDot}
        </div>
      `;
    }).join('');
  }

  /** Handle waypoint click from sidebar list. */
  function onWaypointClick(index) {
    document.querySelectorAll('.wp-item').forEach(el => el.classList.remove('active'));
    const item = document.querySelector(`.wp-item[data-index="${index}"]`);
    if (item) item.classList.add('active');
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

  /** Update the footer bar with data source / last updated info. */
  function updateFooter(statusData) {
    if (!statusData) return;
    const dsEl = document.getElementById('footer-datasource');
    const upEl = document.getElementById('footer-updated');
    const stEl = document.getElementById('footer-status');

    if (dsEl && statusData.hotspotDataSource) {
      dsEl.textContent = `Data: ${statusData.hotspotDataSource}`;
    }
    if (upEl && statusData.hotspotLastUpdated) {
      const d = new Date(statusData.hotspotLastUpdated);
      upEl.textContent = `Last updated: ${d.toLocaleDateString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
    }
    if (stEl) {
      stEl.textContent = statusData.hasRouteData ? 'Route loaded' : 'No route data';
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

  return {
    renderVesselInfo,
    renderRouteSummary,
    renderRiskSummary,
    renderAdvisories,
    markAdvisoryQueued,
    focusAdvisoryByHotspot,
    renderTransmissionLog,
    toggleTransmissionLog,
    renderWaypointList,
    renderMCSSEStatus,
    updateConnectionStatus,
    updateFooter,
    setOnAdvisoryFocus,
    setOnTransmitAdvisory,
    onWaypointClick,
    // Exposed for inline onclick handlers
    _onAdvisoryClick,
    _onTransmitClick,
    _onEditClick,
    _onRiskLegClick,
  };
})();
