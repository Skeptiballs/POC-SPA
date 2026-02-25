"""Maritime hotspot analysis and advisory generation.

Provides route risk assessment by intersecting route legs against known
maritime traffic hotspot zones, and generates structured advisory messages.

Data source abstraction allows mock data to be swapped for MSG AIS analytics
without changing application logic.
"""

import json
import os
from datetime import datetime, timezone
from typing import Optional

from shapely.geometry import LineString, shape

# ---------------------------------------------------------------------------
# Severity ranking and type mappings
# ---------------------------------------------------------------------------

SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1}

_TYPE_TO_ADVISORY = {
    "high_traffic_density": "traffic_density_warning",
    "crossing_traffic": "crossing_traffic_alert",
    "congestion": "congestion_advisory",
    "fishing_activity": "fishing_activity_notice",
}

_ADVISORY_TITLE_PREFIX = {
    "traffic_density_warning": "Traffic Density Warning",
    "crossing_traffic_alert": "Crossing Traffic Alert",
    "congestion_advisory": "Congestion Advisory",
    "fishing_activity_notice": "Fishing Activity Notice",
    "speed_recommendation": "Speed Recommendation",
    "arrival_window_advisory": "Arrival Window Advisory",
}

_ADVISORY_DEFAULT_SEVERITY = {
    "traffic_density_warning": "high",
    "crossing_traffic_alert": "high",
    "congestion_advisory": "medium",
    "fishing_activity_notice": "low",
    "speed_recommendation": "medium",
    "arrival_window_advisory": "medium",
}

_RECOMMENDED_ACTIONS = {
    "traffic_density_warning": (
        "Enhanced radar/AIS monitoring. Maintain maximum lookout. "
        "Consider speed adjustment to arrive outside peak window."
    ),
    "crossing_traffic_alert": (
        "Maintain heightened watch for crossing traffic. Reduce speed as required. "
        "Be prepared for evasive manoeuvring."
    ),
    "congestion_advisory": (
        "Reduce speed when approaching the area. Monitor VHF channel 16. "
        "Co-ordinate with VTS if required."
    ),
    "fishing_activity_notice": (
        "Maintain visual watch. Do not rely solely on AIS. "
        "Fishing vessels may not respond to VHF or radar."
    ),
}


# ---------------------------------------------------------------------------
# Data source abstraction
# ---------------------------------------------------------------------------

class HotspotDataSource:
    """Base interface for hotspot data."""

    def get_hotspots(self, bounding_box=None) -> list:
        raise NotImplementedError

    def get_metadata(self) -> dict:
        return {}


class MockHotspotSource(HotspotDataSource):
    """Loads hotspot data from a local JSON file.

    The JSON file structure matches the MSG AIS analytics format so swapping
    in the real data source requires only replacing this class.
    """

    def __init__(self, filepath: Optional[str] = None):
        if filepath is None:
            filepath = os.path.join(
                os.path.dirname(__file__), "data", "mock_hotspots.json"
            )
        self.filepath = filepath

    def get_hotspots(self, bounding_box=None) -> list:
        with open(self.filepath, encoding="utf-8") as f:
            data = json.load(f)
        hotspots = data.get("hotspots", [])
        if bounding_box:
            min_lat, min_lon, max_lat, max_lon = bounding_box
            filtered = []
            for hs in hotspots:
                try:
                    coords = hs["geometry"]["coordinates"][0]
                    if any(
                        min_lat <= lat <= max_lat and min_lon <= lon <= max_lon
                        for lon, lat in coords
                    ):
                        filtered.append(hs)
                except (KeyError, TypeError):
                    pass
            return filtered
        return hotspots

    def get_metadata(self) -> dict:
        with open(self.filepath, encoding="utf-8") as f:
            data = json.load(f)
        return {
            "data_source": data.get("data_source"),
            "data_period": data.get("data_period"),
            "last_updated": data.get("last_updated"),
        }


class MSGHotspotSource(HotspotDataSource):
    """Queries MSG AIS analytics API for real hotspot data (stub).

    Replace MockHotspotSource with this class once MSG API credentials
    are available — no other application code changes required.
    """

    def __init__(self, api_url: str, api_key: str):
        self.api_url = api_url
        self.api_key = api_key

    def get_hotspots(self, bounding_box=None) -> list:
        raise NotImplementedError("MSG API integration not yet configured")


# ---------------------------------------------------------------------------
# Route analysis
# ---------------------------------------------------------------------------

def _parse_peak_hour_window(window: str):
    """Parse '06:00-10:00' into (start_hour, end_hour) integer tuple."""
    try:
        start, end = window.split("-")
        return int(start.split(":")[0]), int(end.split(":")[0])
    except Exception:
        return None


def _eta_in_peak_window(eta_str: str, peak_hours_list: list):
    """Return (is_peak: bool, matching_window: str | None) for the given ETA."""
    if not eta_str or not peak_hours_list:
        return False, None
    try:
        d = datetime.fromisoformat(eta_str.replace("Z", "+00:00"))
        hour = d.hour
        for window in peak_hours_list:
            parsed = _parse_peak_hour_window(window)
            if parsed:
                start_h, end_h = parsed
                if start_h <= hour < end_h:
                    return True, window
    except Exception:
        pass
    return False, None


def analyze_route(waypoints: list, hotspots: list) -> list:
    """Analyse route legs against hotspot zones.

    For each leg (waypoint[i] → waypoint[i+1]), checks for geometric
    intersection with every hotspot polygon.  Returns a new list of waypoints
    with ``leg.riskAssessment`` populated for any leg that intersects one or
    more hotspots.

    Args:
        waypoints: Parsed waypoint list from the RTZ parser.
        hotspots:  Hotspot records from the data source.

    Returns:
        New list of waypoint dicts with riskAssessment embedded.
    """
    # Pre-build Shapely geometries once
    shapely_hotspots = []
    for hs in hotspots:
        try:
            geom = shape(hs["geometry"])
            shapely_hotspots.append((hs, geom))
        except Exception:
            continue

    enriched = []
    for i, wp in enumerate(waypoints):
        wp_copy = dict(wp)
        if wp_copy.get("leg"):
            wp_copy["leg"] = dict(wp_copy["leg"])

        if i < len(waypoints) - 1:
            wp_next = waypoints[i + 1]
            leg_line = LineString(
                [(wp["lon"], wp["lat"]), (wp_next["lon"], wp_next["lat"])]
            )

            intersecting = []
            for hs, geom in shapely_hotspots:
                try:
                    if leg_line.intersects(geom):
                        intersecting.append(hs)
                except Exception:
                    continue

            if intersecting:
                highest = max(
                    intersecting,
                    key=lambda h: SEVERITY_RANK.get(h.get("severity", "low"), 0),
                )
                risk_level = highest.get("severity", "low")

                parts = []
                for h in intersecting:
                    m = h.get("metadata", {})
                    parts.append(
                        f"{h['name']}: avg {m.get('avg_vessels_per_hour', '?')} vessels/hour."
                    )

                leg = wp_copy.get("leg") or {}
                leg["riskAssessment"] = {
                    "level": risk_level,
                    "intersectingHotspots": [h["id"] for h in intersecting],
                    "summary": " ".join(parts),
                }
                wp_copy["leg"] = leg

        enriched.append(wp_copy)

    return enriched


def generate_advisories(
    enriched_waypoints: list, route_info: dict, hotspots: list
) -> list:
    """Generate structured advisory messages from enriched route waypoints.

    Advisory generation is deterministic: the same route + hotspot data always
    produces the same set of advisories, making the output predictable for demos
    and tests.

    Args:
        enriched_waypoints: Output of ``analyze_route``.
        route_info:         Route metadata dict (vesselName, vesselMMSI, etc.).
        hotspots:           Hotspot records (used for full metadata lookup).

    Returns:
        List of advisory dicts sorted by severity (high → low) then waypoint order.
    """
    hs_by_id = {hs["id"]: hs for hs in hotspots}

    advisories = []
    adv_date = "2026-04-27"
    adv_counter = 1

    for i, wp in enumerate(enriched_waypoints[:-1]):
        leg = wp.get("leg") or {}
        risk = leg.get("riskAssessment")
        if not risk:
            continue

        wp_next = enriched_waypoints[i + 1]

        for hs_id in risk.get("intersectingHotspots", []):
            hs = hs_by_id.get(hs_id)
            if not hs:
                continue

            hs_type = hs.get("type", "high_traffic_density")
            adv_type = _TYPE_TO_ADVISORY.get(hs_type, "traffic_density_warning")
            severity = _ADVISORY_DEFAULT_SEVERITY.get(adv_type, "medium")

            meta = hs.get("metadata", {})
            peak_hours = meta.get("peak_hours_utc", [])
            eta_str = wp.get("eta", "")

            in_peak, peak_window = _eta_in_peak_window(eta_str, peak_hours)

            # Escalate severity when ETA coincides with peak hours
            if in_peak and SEVERITY_RANK.get(severity, 1) < SEVERITY_RANK.get("high", 3):
                severity = "high"

            # Format ETA for display
            eta_display = ""
            if eta_str:
                try:
                    d = datetime.fromisoformat(eta_str.replace("Z", "+00:00"))
                    eta_display = d.strftime("%d %b %Y %H:%M UTC")
                except Exception:
                    eta_display = eta_str

            type_title = _ADVISORY_TITLE_PREFIX.get(
                adv_type, adv_type.replace("_", " ").title()
            )
            title = f"{type_title} — {hs['name']}"

            avg_density = meta.get("avg_vessels_per_hour")
            dominant = meta.get("dominant_vessel_types", [])
            notes = meta.get("notes", "")

            # Build natural-language advisory message
            msg_parts = [
                f"Vessel route from WP{wp['id']} ({wp['name']}) to "
                f"WP{wp_next['id']} ({wp_next['name']}) transits {hs['name']}."
            ]
            if avg_density:
                msg_parts.append(f"Average traffic: {avg_density} vessels/hour.")
            if peak_hours:
                msg_parts.append(f"Peak period: {', '.join(peak_hours)} UTC.")
            if in_peak and eta_display:
                msg_parts.append(
                    f"Vessel ETA at WP{wp['id']}: {eta_display} — "
                    f"coincides with peak traffic window ({peak_window})."
                )
            elif eta_display:
                msg_parts.append(f"Vessel ETA at WP{wp['id']}: {eta_display}.")
            if dominant:
                msg_parts.append(f"Dominant vessel types: {', '.join(dominant)}.")
            if notes:
                msg_parts.append(notes)

            recommended_action = _RECOMMENDED_ACTIONS.get(
                adv_type, "Maintain enhanced watch and proceed with caution."
            )

            adv_id = f"ADV-{adv_date}-{adv_counter:03d}"
            adv_counter += 1

            structured = {
                "affectedLegStart": {"waypointId": wp["id"], "name": wp["name"]},
                "affectedLegEnd": {"waypointId": wp_next["id"], "name": wp_next["name"]},
                "trafficDensity": (
                    {"value": avg_density, "unit": "vessels/hour"}
                    if avg_density else None
                ),
                "vesselETA": eta_str,
                "peakWindow": ", ".join(peak_hours) if peak_hours else None,
                "inPeakWindow": in_peak,
                "recommendedAction": recommended_action,
            }

            advisories.append({
                "id": adv_id,
                "timestamp": f"{adv_date}T06:00:00Z",
                "type": adv_type,
                "severity": severity,
                "relatedWaypoints": [wp["id"], wp_next["id"]],
                "relatedHotspots": [hs_id],
                "title": title,
                "message": " ".join(msg_parts),
                "structuredData": structured,
                "transmissionStatus": "ready",
                "transmissionMethod": "Furuno Cloud (pending two-way integration)",
            })

    # Sort: severity descending, then waypoint order ascending
    severity_order = {"high": 0, "medium": 1, "low": 2}
    advisories.sort(
        key=lambda a: (
            severity_order.get(a["severity"], 3),
            a["relatedWaypoints"][0] if a["relatedWaypoints"] else 0,
        )
    )

    return advisories


def compute_risk_summary(enriched_waypoints: list) -> dict:
    """Compute overall route risk from enriched waypoints."""
    overall_risk = "low"
    hotspot_ids: set = set()
    risky_legs = []

    for i, wp in enumerate(enriched_waypoints[:-1]):
        leg = wp.get("leg") or {}
        risk = leg.get("riskAssessment")
        if not risk:
            continue
        level = risk.get("level", "low")
        if SEVERITY_RANK.get(level, 0) > SEVERITY_RANK.get(overall_risk, 0):
            overall_risk = level
        for hs_id in risk.get("intersectingHotspots", []):
            hotspot_ids.add(hs_id)
        risky_legs.append({
            "legIndex": i,
            "fromWaypointId": wp["id"],
            "fromWaypointName": wp.get("name", ""),
            "toWaypointId": enriched_waypoints[i + 1]["id"],
            "toWaypointName": enriched_waypoints[i + 1].get("name", ""),
            "riskLevel": level,
            "summary": risk.get("summary", ""),
        })

    return {
        "overallRisk": overall_risk,
        "hotspotCount": len(hotspot_ids),
        "riskyLegs": risky_legs,
    }
