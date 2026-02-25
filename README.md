# MASS Route Display

Maritime Autonomous Surface Ship route visualization prototype for the MPA Singapore NGVTMS trial. Displays RTZ route data from Furuno's cloud platform on an interactive maritime map.

## Quick Start

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run the backend (serves both API and frontend)
cd backend
python app.py
```

Open http://localhost:8000 in your browser.

## Architecture

```
Furuno Cloud  ──▶  Backend (FastAPI)  ──▶  MCSSE REST API
  (RTZ XML)            │
                       ▼
                  Web UI (Leaflet)
```

- **Backend** (`backend/`): FastAPI app that parses RTZ XML, serves JSON to the frontend, and bridges to MCSSE.
- **Frontend** (`frontend/`): Single-page app with Leaflet map, vessel info panel, and waypoint interactions.

## Configuration

Set via environment variables:

| Variable | Default | Description |
|---|---|---|
| `DATA_SOURCE` | `file` | `file` or `furuno` |
| `FURUNO_API_URL` | (empty) | Furuno cloud API endpoint |
| `FURUNO_API_KEY` | (empty) | Furuno API authentication key |
| `FURUNO_POLL_INTERVAL` | `60` | Polling interval in seconds |
| `MCSSE_API_URL` | (empty) | MCSSE REST API endpoint |
| `MCSSE_API_KEY` | (empty) | MCSSE authentication key |
| `MCSSE_DRY_RUN` | `true` | Set to `false` to enable live push |
| `HOST` | `0.0.0.0` | Server bind address |
| `PORT` | `8000` | Server port |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/api/route` | Current route data (JSON) |
| POST | `/api/route/upload` | Upload a custom RTZ file |
| POST | `/api/mcsse/push` | Push route to MCSSE |
| GET | `/api/mcsse/status` | MCSSE bridge status |
| GET | `/api/status` | Overall app status |

## Development Phases

1. **Phase 1** (current): Standalone web UI with mock RTZ data
2. **Phase 2**: Furuno Cloud API integration (pending technical call)
3. **Phase 3**: MCSSE data bridge (pending Swedish team API docs)
4. **Phase 4**: Live AIS position overlay (stretch goal)
