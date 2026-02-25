"""Configuration for MASS Route Display backend."""

import os

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAMPLE_DATA_DIR = os.path.join(BASE_DIR, "sample_data")
DEFAULT_RTZ_FILE = os.path.join(SAMPLE_DATA_DIR, "elder_leader.rtz")

# Furuno Cloud API (Phase 2 — placeholders)
FURUNO_API_URL = os.environ.get("FURUNO_API_URL", "")
FURUNO_API_KEY = os.environ.get("FURUNO_API_KEY", "")
FURUNO_POLL_INTERVAL_SECONDS = int(os.environ.get("FURUNO_POLL_INTERVAL", "60"))

# MCSSE Bridge (Phase 3 — placeholders)
MCSSE_API_URL = os.environ.get("MCSSE_API_URL", "")
MCSSE_API_KEY = os.environ.get("MCSSE_API_KEY", "")
MCSSE_DRY_RUN = os.environ.get("MCSSE_DRY_RUN", "true").lower() == "true"

# Data source mode: "file" or "furuno"
DATA_SOURCE = os.environ.get("DATA_SOURCE", "file")

# Server
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
