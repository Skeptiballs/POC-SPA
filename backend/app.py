"""MASS Route Display — Backend API.

FastAPI application serving parsed RTZ route data and MCSSE bridge status.
Serves the frontend as static files.
"""

import logging
import os

from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

import config
from furuno_adapter import create_route_source
from mcsse_bridge import MCSSEBridge
from rtz_parser import parse_rtz

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="MASS Route Display",
    description="Maritime Autonomous Surface Ship route visualization prototype",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize data source
route_source = create_route_source(
    mode=config.DATA_SOURCE,
    file_path=config.DEFAULT_RTZ_FILE,
    api_url=config.FURUNO_API_URL,
    api_key=config.FURUNO_API_KEY,
)

# Initialize MCSSE bridge
mcsse = MCSSEBridge(
    api_url=config.MCSSE_API_URL,
    api_key=config.MCSSE_API_KEY,
    dry_run=config.MCSSE_DRY_RUN,
)

# Cache for the last-loaded route data (offline resilience)
_cached_route = None


def _get_route():
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
    global _cached_route
    if not file.filename or not file.filename.lower().endswith(".rtz"):
        raise HTTPException(status_code=400, detail="File must have .rtz extension")
    try:
        content = await file.read()
        xml_text = content.decode("utf-8")
        data = parse_rtz(xml_text)
        _cached_route = data
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
    return {
        "dataSource": config.DATA_SOURCE,
        "hasRouteData": _cached_route is not None,
        "mcsse": mcsse.get_status(),
        "furunoApiConfigured": bool(config.FURUNO_API_URL),
    }


# Serve frontend static files
FRONTEND_DIR = os.path.join(os.path.dirname(config.BASE_DIR), "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

    @app.get("/")
    def serve_index():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=config.HOST, port=config.PORT)
