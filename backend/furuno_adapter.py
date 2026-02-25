"""Furuno Cloud API adapter.

Provides a clean interface for route data retrieval.
Currently implements file-based loading; will be extended for Furuno API polling in Phase 2.
"""

import logging
import os
from abc import ABC, abstractmethod
from typing import Any

from rtz_parser import parse_rtz

logger = logging.getLogger(__name__)


class RouteDataSource(ABC):
    """Abstract interface for route data retrieval."""

    @abstractmethod
    def get_route_data(self) -> dict[str, Any] | None:
        """Fetch and return parsed route data, or None on failure."""
        ...


class FileRouteSource(RouteDataSource):
    """Load route data from a local RTZ file."""

    def __init__(self, file_path: str):
        self.file_path = file_path

    def get_route_data(self) -> dict[str, Any] | None:
        if not os.path.exists(self.file_path):
            logger.error("RTZ file not found: %s", self.file_path)
            return None
        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                xml_content = f.read()
            data = parse_rtz(xml_content)
            logger.info("Loaded route from file: %s (%d waypoints)", self.file_path, data["waypointCount"])
            return data
        except Exception:
            logger.exception("Failed to parse RTZ file: %s", self.file_path)
            return None


class FurunoCloudSource(RouteDataSource):
    """Poll route data from Furuno Cloud API (Phase 2 — stub)."""

    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url
        self.api_key = api_key

    def get_route_data(self) -> dict[str, Any] | None:
        # Phase 2: Implement actual Furuno API polling here.
        # Expected flow:
        #   1. Authenticate with api_key
        #   2. GET route data (RTZ XML) from api_url
        #   3. Parse with parse_rtz()
        #   4. Return parsed data
        logger.warning("FurunoCloudSource not yet implemented — returning None")
        return None


def create_route_source(
    mode: str,
    file_path: str = "",
    api_url: str = "",
    api_key: str = "",
) -> RouteDataSource:
    """Factory to create the appropriate route data source.

    Args:
        mode: "file" or "furuno"
        file_path: Path to local RTZ file (for file mode)
        api_url: Furuno API URL (for furuno mode)
        api_key: Furuno API key (for furuno mode)
    """
    if mode == "furuno":
        logger.info("Using Furuno Cloud data source: %s", api_url)
        return FurunoCloudSource(api_url, api_key)
    else:
        logger.info("Using file data source: %s", file_path)
        return FileRouteSource(file_path)
