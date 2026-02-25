"""RTZ (Route Exchange Format) XML parser.

Parses RTZ v1.1 and v1.2 XML files into a clean JSON-serializable dict.
Handles both namespaced and un-namespaced elements gracefully.
Ignores <extensions> blocks as per spec.
"""

import math
import xml.etree.ElementTree as ET
from typing import Any


# Supported RTZ namespaces
RTZ_NAMESPACES = {
    "1.1": "http://www.cirm.org/RTZ/1/1",
    "1.2": "http://www.cirm.org/RTZ/1/2",
}


def _detect_namespace(root: ET.Element) -> str:
    """Detect the RTZ namespace from the root element's tag or version attribute."""
    version = root.get("version", "1.1")
    ns = RTZ_NAMESPACES.get(version, RTZ_NAMESPACES["1.1"])

    # Also check if the tag itself contains a namespace
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0].lstrip("{")

    return ns


def _find(parent: ET.Element, tag: str, ns: str) -> ET.Element | None:
    """Find a child element, trying namespaced then un-namespaced."""
    el = parent.find(f"{{{ns}}}{tag}")
    if el is None:
        el = parent.find(tag)
    return el


def _findall(parent: ET.Element, tag: str, ns: str) -> list[ET.Element]:
    """Find all child elements, trying namespaced then un-namespaced."""
    els = parent.findall(f"{{{ns}}}{tag}")
    if not els:
        els = parent.findall(tag)
    return els


def _haversine_nm(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two coordinates in nautical miles using Haversine formula."""
    R_NM = 3440.065  # Earth radius in nautical miles
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(dlon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R_NM * c


def _parse_leg(leg_el: ET.Element | None) -> dict[str, Any] | None:
    """Parse a <leg> element into a dict."""
    if leg_el is None:
        return None
    return {
        "speedMax": float(leg_el.get("speedMax", 0)),
        "portsideXTD": float(leg_el.get("portsideXTD", 0)),
        "starboardXTD": float(leg_el.get("starboardXTD", 0)),
        "geometryType": leg_el.get("geometryType", "Loxodrome"),
    }


def parse_rtz(xml_content: str) -> dict[str, Any]:
    """Parse RTZ XML string into a structured dict.

    Args:
        xml_content: Raw RTZ XML as a string.

    Returns:
        Dict with keys: routeInfo, waypoints, schedules, totalDistanceNm, rtzVersion
    """
    root = ET.fromstring(xml_content)
    ns = _detect_namespace(root)
    rtz_version = root.get("version", "1.1")

    # --- routeInfo ---
    route_info_el = _find(root, "routeInfo", ns)
    route_info = {}
    if route_info_el is not None:
        route_info = {
            "routeName": route_info_el.get("routeName", ""),
            "routeAuthor": route_info_el.get("routeAuthor", ""),
            "routeStatus": route_info_el.get("routeStatus", ""),
            "vesselName": route_info_el.get("vesselName", ""),
            "vesselMMSI": route_info_el.get("vesselMMSI", ""),
            "vesselIMO": route_info_el.get("vesselIMO", ""),
            "vesselVoyage": route_info_el.get("vesselVoyage", ""),
            "validityPeriodStart": route_info_el.get("validityPeriodStart", ""),
            "validityPeriodStop": route_info_el.get("validityPeriodStop", ""),
        }

    # --- waypoints ---
    waypoints_el = _find(root, "waypoints", ns)
    waypoints = []
    default_leg = None

    if waypoints_el is not None:
        # Parse defaultWaypoint
        default_wp_el = _find(waypoints_el, "defaultWaypoint", ns)
        if default_wp_el is not None:
            default_leg_el = _find(default_wp_el, "leg", ns)
            default_leg = _parse_leg(default_leg_el)

        # Parse each waypoint
        for wp_el in _findall(waypoints_el, "waypoint", ns):
            pos_el = _find(wp_el, "position", ns)
            if pos_el is None:
                continue

            lat = float(pos_el.get("lat", 0))
            lon = float(pos_el.get("lon", 0))

            leg_el = _find(wp_el, "leg", ns)
            leg = _parse_leg(leg_el) or default_leg

            waypoints.append({
                "id": int(wp_el.get("id", 0)),
                "revision": int(wp_el.get("revision", 0)),
                "name": wp_el.get("name", f"WP_{wp_el.get('id', '?')}"),
                "lat": lat,
                "lon": lon,
                "leg": leg,
            })

    # --- schedules ---
    schedules_el = _find(root, "schedules", ns)
    schedules = []

    if schedules_el is not None:
        for sched_el in _findall(schedules_el, "schedule", ns):
            schedule = {
                "id": sched_el.get("id", ""),
                "name": sched_el.get("name", ""),
                "elements": [],
            }
            calc_el = _find(sched_el, "calculated", ns)
            if calc_el is not None:
                for se_el in _findall(calc_el, "scheduleElement", ns):
                    schedule["elements"].append({
                        "waypointId": int(se_el.get("waypointId", 0)),
                        "eta": se_el.get("eta", ""),
                    })
            schedules.append(schedule)

    # --- Build ETA lookup for waypoints ---
    eta_lookup = {}
    for sched in schedules:
        for elem in sched["elements"]:
            eta_lookup[elem["waypointId"]] = elem["eta"]

    for wp in waypoints:
        wp["eta"] = eta_lookup.get(wp["id"], None)

    # --- Calculate total distance ---
    total_distance_nm = 0.0
    for i in range(1, len(waypoints)):
        total_distance_nm += _haversine_nm(
            waypoints[i - 1]["lat"],
            waypoints[i - 1]["lon"],
            waypoints[i]["lat"],
            waypoints[i]["lon"],
        )

    # --- Calculate leg distances ---
    for i in range(1, len(waypoints)):
        waypoints[i]["legDistanceNm"] = round(
            _haversine_nm(
                waypoints[i - 1]["lat"],
                waypoints[i - 1]["lon"],
                waypoints[i]["lat"],
                waypoints[i]["lon"],
            ),
            1,
        )
    if waypoints:
        waypoints[0]["legDistanceNm"] = 0.0

    return {
        "rtzVersion": rtz_version,
        "routeInfo": route_info,
        "waypoints": waypoints,
        "schedules": schedules,
        "totalDistanceNm": round(total_distance_nm, 1),
        "waypointCount": len(waypoints),
    }
