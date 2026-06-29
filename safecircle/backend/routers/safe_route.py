import os
from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from models.route_scorer import RouteSafety
import database

router = APIRouter()
scorer = RouteSafety()

class RouteSuggestionRequest(BaseModel):
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float
    hour_of_day: int

@router.post("/suggest")
def suggest_routes(request: RouteSuggestionRequest):
    """
    Suggests up to 3 alternative routes from origin to destination,
    ranked and scored by safety.
    """
    origin_lat, origin_lng = request.origin_lat, request.origin_lng
    dest_lat, dest_lng = request.dest_lat, request.dest_lng
    hour = request.hour_of_day

    # 1. Fetch routes from OSRM
    routes = scorer.get_routes_from_osrm(origin_lat, origin_lng, dest_lat, dest_lng)
    if not routes:
        raise HTTPException(
            status_code=500,
            detail="Failed to fetch routes from OSRM. Ensure origin and destination coordinates are valid."
        )

    # 2. Score and adjust each route
    routes_with_scores = []
    for idx, r in enumerate(routes):
        geometry = r.get("geometry", {})
        duration = r.get("duration", 0.0) # in seconds
        distance = r.get("distance", 0.0) # in meters

        # Calculate safety
        safety_score, warning_zones = scorer.calculate_route_safety_score(geometry)

        # Apply time adjustment
        adjusted_score = scorer.time_of_day_adjustment(safety_score, hour)

        routes_with_scores.append({
            "original_index": idx,
            "safety_score": round(adjusted_score, 1),
            "duration_minutes": round(duration / 60.0, 1),
            "distance_meters": round(distance),
            "geometry": geometry,
            "warning_zones": warning_zones,
            "label": f"Route {idx + 1}"  # default fallback label
        })

    # 3. Rank routes
    ranked_routes = scorer.rank_routes(routes_with_scores)

    return {"routes": ranked_routes}

@router.get("/area-safe")
def check_area_safe(
    lat: float = Query(..., description="Latitude of query point"),
    lng: float = Query(..., description="Longitude of query point"),
    radius: float = Query(0.5, description="Radius to filter in kilometers")
):
    """
    Checks if a target area is safe (contains no critical or high risk zones) before routing.
    """
    client = database.get_supabase()
    try:
        response = client.table("threat_zones").select("*").execute()
        zones = response.data or []

        unsafe_zones = []
        for zone in zones:
            z_lat = zone.get("center_lat")
            z_lng = zone.get("center_lng")
            if z_lat is None or z_lng is None:
                continue

            dist = scorer.haversine_distance(lat, lng, z_lat, z_lng)
            if dist <= radius:
                risk = zone.get("risk_level", "low")
                if risk in ("critical", "high"):
                    unsafe_zones.append({
                        "lat": z_lat,
                        "lng": z_lng,
                        "risk_level": risk
                    })

        if unsafe_zones:
            return {
                "safe": False,
                "reason": f"Detected {len(unsafe_zones)} high-risk threat zones in destination area.",
                "unsafe_zones": unsafe_zones
            }

        return {
            "safe": True,
            "reason": "Destination area is verified safe."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check area safety: {str(e)}")
