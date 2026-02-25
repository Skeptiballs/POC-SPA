"""MCSSE Data Bridge.

Transforms parsed RTZ route data and pushes to MCSSE REST API.
Phase 3 implementation — currently operates in dry-run mode only.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


class MCSSEBridge:
    """Handles transformation and delivery of route data to MCSSE."""

    def __init__(self, api_url: str, api_key: str, dry_run: bool = True):
        self.api_url = api_url
        self.api_key = api_key
        self.dry_run = dry_run
        self.last_push_status: str | None = None
        self.last_push_time: str | None = None

    def transform(self, route_data: dict[str, Any]) -> dict[str, Any]:
        """Transform parsed RTZ JSON into MCSSE payload format.

        This is a placeholder. The actual format depends on MCSSE API docs
        from the Swedish team. Current output is a reasonable GeoJSON-like
        structure that can be adapted once the real spec is known.
        """
        info = route_data.get("routeInfo", {})
        waypoints = route_data.get("waypoints", [])

        coordinates = [[wp["lon"], wp["lat"]] for wp in waypoints]
        properties_per_wp = []
        for wp in waypoints:
            props = {
                "id": wp["id"],
                "name": wp["name"],
                "eta": wp.get("eta"),
            }
            if wp.get("leg"):
                props["speedMax"] = wp["leg"]["speedMax"]
            properties_per_wp.append(props)

        return {
            "type": "Feature",
            "properties": {
                "vesselName": info.get("vesselName", ""),
                "vesselMMSI": info.get("vesselMMSI", ""),
                "vesselIMO": info.get("vesselIMO", ""),
                "routeName": info.get("routeName", ""),
                "voyageId": info.get("vesselVoyage", ""),
                "routeStatus": info.get("routeStatus", ""),
                "totalDistanceNm": route_data.get("totalDistanceNm", 0),
                "waypointCount": route_data.get("waypointCount", 0),
                "waypoints": properties_per_wp,
            },
            "geometry": {
                "type": "LineString",
                "coordinates": coordinates,
            },
        }

    def push(self, route_data: dict[str, Any]) -> dict[str, Any]:
        """Push route data to MCSSE.

        Returns a status dict with push result info.
        """
        payload = self.transform(route_data)
        timestamp = datetime.now(timezone.utc).isoformat()

        if self.dry_run:
            logger.info(
                "[DRY RUN] Would POST to %s with payload: %s",
                self.api_url or "(no URL configured)",
                json.dumps(payload, indent=2)[:500],
            )
            self.last_push_status = "dry_run"
            self.last_push_time = timestamp
            return {
                "status": "dry_run",
                "timestamp": timestamp,
                "message": "Dry run — payload logged but not sent",
                "payload_preview": json.dumps(payload)[:200],
            }

        # Phase 3: Implement actual HTTP POST to MCSSE here
        # Expected flow:
        #   1. Set headers (Content-Type, Authorization with api_key)
        #   2. POST payload to api_url
        #   3. Handle response / errors
        #   4. Update last_push_status / last_push_time
        logger.warning("MCSSE live push not yet implemented")
        self.last_push_status = "not_implemented"
        self.last_push_time = timestamp
        return {
            "status": "not_implemented",
            "timestamp": timestamp,
            "message": "Live MCSSE push not yet implemented (Phase 3)",
        }

    def get_status(self) -> dict[str, Any]:
        """Return the current bridge status."""
        return {
            "configured": bool(self.api_url),
            "dryRun": self.dry_run,
            "lastPushStatus": self.last_push_status,
            "lastPushTime": self.last_push_time,
        }
