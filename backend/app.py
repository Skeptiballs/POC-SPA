"""MASS Route Display — Backend API.

FastAPI application serving parsed RTZ route data, maritime hotspot analysis,
advisory generation, and MCSSE bridge status.  Serves the frontend as static files.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
from furuno_adapter import create_route_source
from hotspot_analyzer import (
    MockHotspotSource,
    analyze_route,
    compute_risk_summary,
    generate_advisories,
)
from mcsse_bridge import MCSSEBridge
from rtz_parser import parse_rtz

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="MASS Route Intelligence",
    description="Maritime Autonomous Surface Ship route visualization and intelligence prototype",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize data sources
route_source = create_route_source(
    mode=config.DATA_SOURCE,
    file_path=config.DEFAULT_RTZ_FILE,
    api_url=config.FURUNO_API_URL,
    api_key=config.FURUNO_API_KEY,
)

mcsse = MCSSEBridge(
    api_url=config.MCSSE_API_URL,
    api_key=config.MCSSE_API_KEY,
    dry_run=config.MCSSE_DRY_RUN,
)

hotspot_source = MockHotspotSource()

# In-memory state
_cached_route: Optional[dict] = None
_cached_analysis: Optional[dict] = None
_transmission_log: list = []


# ---------------------------------------------------------------------------
# Route helpers
# ---------------------------------------------------------------------------

def _get_route() -> Optional[dict]:
    """Get route data with fallback to cache."""
    global _cached_route
    data = route_source.get_route_data()
    if data is not None:
        _cached_route = data
        return data
    if _cached_route is not None:
        logger.warning("Data source unavailable — serving cached route data")
        return _cached_route
    return None


def _run_analysis(route_data: dict) -> dict:
    """Run hotspot analysis and advisory generation, cache the result."""
    global _cached_analysis
    hotspots = hotspot_source.get_hotspots()
    enriched = analyze_route(route_data["waypoints"], hotspots)
    advisories = generate_advisories(
        enriched, route_data.get("routeInfo", {}), hotspots
    )
    risk_summary = compute_risk_summary(enriched)
    _cached_analysis = {
        "enrichedWaypoints": enriched,
        "advisories": advisories,
        "riskSummary": risk_summary,
    }
    return _cached_analysis


# ---------------------------------------------------------------------------
# Phase 1 endpoints
# ---------------------------------------------------------------------------

@app.get("/api/route")
def get_route():
    """Return the current route data as JSON."""
    data = _get_route()
    if data is None:
        raise HTTPException(status_code=503, detail="No route data available")
    return data


@app.post("/api/route/upload")
async def upload_rtz(file: UploadFile):
    """Upload a custom RTZ file and parse it."""
    global _cached_route, _cached_analysis
    if not file.filename or not file.filename.lower().endswith(".rtz"):
        raise HTTPException(status_code=400, detail="File must have .rtz extension")
    try:
        content = await file.read()
        xml_text = content.decode("utf-8")
        data = parse_rtz(xml_text)
        _cached_route = data
        _cached_analysis = None  # Invalidate analysis cache
        logger.info("Uploaded and parsed RTZ file: %s", file.filename)
        return data
    except Exception as e:
        logger.exception("Failed to parse uploaded RTZ file")
        raise HTTPException(status_code=400, detail=f"Failed to parse RTZ: {e}")


@app.post("/api/mcsse/push")
def push_to_mcsse():
    """Push current route data to MCSSE (or dry-run log it)."""
    data = _get_route()
    if data is None:
        raise HTTPException(status_code=503, detail="No route data to push")
    result = mcsse.push(data)
    return result


@app.get("/api/mcsse/status")
def mcsse_status():
    """Return current MCSSE bridge status."""
    return mcsse.get_status()


@app.get("/api/status")
def app_status():
    """Return overall application status."""
    meta = hotspot_source.get_metadata()
    return {
        "dataSource": config.DATA_SOURCE,
        "hasRouteData": _cached_route is not None,
        "mcsse": mcsse.get_status(),
        "furunoApiConfigured": bool(config.FURUNO_API_URL),
        "hotspotDataSource": meta.get("data_source"),
        "hotspotLastUpdated": meta.get("last_updated"),
    }


# ---------------------------------------------------------------------------
# Phase 2 endpoints — Maritime Intelligence Layer
# ---------------------------------------------------------------------------

@app.get("/api/hotspots")
def get_hotspots(bbox: Optional[str] = None):
    """Return hotspot zones as a GeoJSON FeatureCollection.

    Optional query param ``bbox`` filters results: ``lat1,lon1,lat2,lon2``.
    """
    bounding_box = None
    if bbox:
        try:
            parts = [float(x) for x in bbox.split(",")]
            if len(parts) == 4:
                bounding_box = parts
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid bbox format")

    hotspots = hotspot_source.get_hotspots(bounding_box)
    meta = hotspot_source.get_metadata()

    features = [
        {
            "type": "Feature",
            "id": hs["id"],
            "properties": {
                "id": hs["id"],
                "name": hs["name"],
                "type": hs["type"],
                "severity": hs["severity"],
                "metadata": hs.get("metadata", {}),
            },
            "geometry": hs["geometry"],
        }
        for hs in hotspots
    ]

    return {
        "type": "FeatureCollection",
        "features": features,
        "metadata": meta,
    }


@app.post("/api/analyze-route")
def analyze_route_endpoint():
    """Analyze current route against hotspot data.

    Returns enriched waypoints with per-leg risk assessments, generated
    advisories sorted by severity, and an overall route risk summary.
    """
    data = _get_route()
    if data is None:
        raise HTTPException(status_code=503, detail="No route data available")
    return _run_analysis(data)


@app.get("/api/advisories")
def get_advisories():
    """Return generated advisories for the current route."""
    if _cached_analysis is None:
        data = _get_route()
        if data is None:
            raise HTTPException(status_code=503, detail="No route data available")
        _run_analysis(data)
    return {"advisories": _cached_analysis.get("advisories", [])}


@app.post("/api/advisories/{advisory_id}/transmit")
def transmit_advisory(advisory_id: str):
    """Queue an advisory for transmission to the vessel (prototype placeholder).

    Packages the advisory into the outbound SHORE_TO_MASS_ADVISORY format and
    adds it to the transmission log.  Actual delivery awaits Furuno Cloud
    two-way integration.
    """
    if _cached_analysis is None:
        raise HTTPException(status_code=400, detail="No analysis available — call /api/analyze-route first")

    advisories = _cached_analysis.get("advisories", [])
    advisory = next((a for a in advisories if a["id"] == advisory_id), None)
    if not advisory:
        raise HTTPException(status_code=404, detail="Advisory not found")

    data = _get_route()
    route_info = data.get("routeInfo", {}) if data else {}

    msg_index = len(_transmission_log) + 1
    msg_id = f"MSG-2026-04-27-{msg_index:03d}"
    now_iso = datetime.now(timezone.utc).isoformat()

    outbound = {
        "messageType": "SHORE_TO_MASS_ADVISORY",
        "messageId": msg_id,
        "timestamp": now_iso,
        "sender": {
            "system": "Tidalis MASS Route Intelligence",
            "station": "Singapore VTMS — NGVTMS Prototype",
            "operator": "Automated",
        },
        "recipient": {
            "vesselName": route_info.get("vesselName", ""),
            "mmsi": route_info.get("vesselMMSI", ""),
            "imo": route_info.get("vesselIMO", ""),
        },
        "advisories": [
            {
                "type": advisory.get("type"),
                "severity": advisory.get("severity"),
                "affectedWaypoints": advisory.get("relatedWaypoints", []),
                "message": advisory.get("message", ""),
                "recommendedAction": (
                    advisory.get("structuredData", {}).get("recommendedAction", "")
                ),
            }
        ],
        "routeReference": {
            "routeName": route_info.get("routeName", ""),
            "voyageId": route_info.get("vesselVoyage", ""),
        },
    }

    log_entry = {
        "messageId": msg_id,
        "timestamp": now_iso,
        "advisoryId": advisory_id,
        "advisoryTitle": advisory.get("title", ""),
        "advisoryType": advisory.get("type", ""),
        "severity": advisory.get("severity", ""),
        "status": "pending",
        "statusNote": "Awaiting Furuno Cloud two-way integration",
        "outboundMessage": outbound,
    }
    _transmission_log.append(log_entry)

    logger.info(
        "Advisory %s queued for transmission as %s", advisory_id, msg_id
    )
    return {
        "status": "queued",
        "messageId": msg_id,
        "note": log_entry["statusNote"],
    }


@app.get("/api/transmission-log")
def get_transmission_log():
    """Return the outbound advisory transmission log."""
    return {"log": _transmission_log}


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------

FRONTEND_DIR = os.path.join(os.path.dirname(config.BASE_DIR), "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
