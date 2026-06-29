import os
import math
from typing import Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel
from shapely.geometry import Point, shape
from models.threat_zone import ThreatZoneModel
import database

router = APIRouter()
model = ThreatZoneModel()

class IncidentReport(BaseModel):
    lat: float
    lng: float

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculates the haversine distance between two points in kilometers.
    """
    R = 6371.0  # Earth's radius in kilometers
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) ** 2)
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

@router.post("/retrain")
def retrain_heatmap(x_cron_secret: Optional[str] = Header(None)):
    """
    Triggers the full DBSCAN clustering pipeline to update threat zones.
    Typically triggered nightly via pg_cron.
    """
    expected_secret = os.getenv("CRON_SECRET", "super-secret-cron-key")
    # If a secret is configured, enforce it
    if expected_secret and x_cron_secret != expected_secret:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: invalid or missing X-Cron-Secret header"
        )

    try:
        results = model.run_full_pipeline()
        return {"status": "success", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {str(e)}")

@router.get("/zones")
def get_zones(
    lat: float = Query(..., description="Latitude of location"),
    lng: float = Query(..., description="Longitude of location"),
    radius_km: float = Query(5.0, description="Radius to filter zones in kilometers")
):
    """
    Fetches threat zones within a specified radius of a location and returns them
    as a GeoJSON FeatureCollection.
    """
    client = database.get_supabase()
    try:
        # Fetch all zones
        response = client.table("threat_zones").select("*").execute()
        zones = response.data or []

        features = []
        for zone in zones:
            z_lat = zone.get("center_lat")
            z_lng = zone.get("center_lng")
            
            if z_lat is None or z_lng is None:
                continue

            dist = haversine_distance(lat, lng, z_lat, z_lng)
            if dist <= radius_km:
                features.append({
                    "type": "Feature",
                    "geometry": zone.get("geojson"),
                    "properties": {
                        "id": zone.get("id"),
                        "cluster_id": zone.get("cluster_id"),
                        "risk_level": zone.get("risk_level"),
                        "incident_count": zone.get("incident_count"),
                        "center_lat": z_lat,
                        "center_lng": z_lng,
                        "last_updated": zone.get("last_updated")
                    }
                })

        return {"type": "FeatureCollection", "features": features}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch threat zones: {str(e)}")

@router.get("/area-score")
def get_area_score(
    lat: float = Query(..., description="Latitude of query point"),
    lng: float = Query(..., description="Longitude of query point")
):
    """
    Calculates safety score (0-100) for a coordinate point based on nearby threat zones.
    """
    client = database.get_supabase()
    try:
        response = client.table("threat_zones").select("*").execute()
        zones = response.data or []

        critical_count = 0
        high_count = 0
        medium_count = 0
        low_count = 0
        nearest_dist_m = float("inf")

        for zone in zones:
            z_lat = zone.get("center_lat")
            z_lng = zone.get("center_lng")
            if z_lat is None or z_lng is None:
                continue

            dist_m = haversine_distance(lat, lng, z_lat, z_lng) * 1000.0
            if dist_m < nearest_dist_m:
                nearest_dist_m = dist_m

            # Calculate risk deductions within 500m
            if dist_m <= 500.0:
                risk = zone.get("risk_level", "low")
                if risk == "critical":
                    critical_count += 1
                elif risk == "high":
                    high_count += 1
                elif risk == "medium":
                    medium_count += 1
                elif risk == "low":
                    low_count += 1

        # Calculate score deduction
        deduction = (critical_count * 40) + (high_count * 25) + (medium_count * 10) + (low_count * 5)
        score = max(0, min(100, 100 - deduction))

        # Overall risk level
        if critical_count > 0:
            area_risk = "critical"
        elif high_count > 0:
            area_risk = "high"
        elif medium_count > 0:
            area_risk = "medium"
        elif low_count > 0:
            area_risk = "low"
        else:
            area_risk = "safe"

        return {
            "score": score,
            "risk_level": area_risk,
            "nearest_zone_distance_m": round(nearest_dist_m) if nearest_dist_m != float("inf") else None
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to calculate area score: {str(e)}")

@router.post("/report-incident")
def report_incident(report: IncidentReport):
    """
    Submits a resolved incident and updates the risk level of any intersecting
    clusters in real-time.
    """
    client = database.get_supabase()
    lat, lng = report.lat, report.lng
    now = datetime.now(timezone.utc)
    
    try:
        # 1. Insert new event
        client.table("sos_events").insert({
            "lat": lat,
            "lng": lng,
            "started_at": now.isoformat(),
            "status": "resolved",
            "notes": "Reported incident (real-time heatmap update)"
        }).execute()

        # 2. Check intersection with existing threat zone polygons
        response = client.table("threat_zones").select("*").execute()
        zones = response.data or []

        point = Point(lng, lat)  # Shapely expects (x, y) / (lng, lat) order
        intersected_zones_updated = 0

        # Load last 90 days of events to recalculate exact stats for intersecting clusters
        events_90d = database.fetch_sos_events(days=90)
        seven_days_ago = now - timedelta(days=7)

        for zone in zones:
            geojson = zone.get("geojson")
            if not geojson:
                continue

            try:
                poly_shape = shape(geojson)
                if poly_shape.contains(point):
                    # Point is inside this cluster! Recalculate size and recent count
                    cluster_events_count = 0
                    recent_events_count = 0

                    for e in events_90d:
                        e_lat = e.get("lat")
                        e_lng = e.get("lng")
                        if e_lat is not None and e_lng is not None:
                            e_point = Point(e_lng, e_lat)
                            if poly_shape.contains(e_point):
                                cluster_events_count += 1
                                started_at_str = e.get("started_at")
                                if started_at_str:
                                    started_at = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
                                    if started_at >= seven_days_ago:
                                        recent_events_count += 1

                    # Recalculate risk level
                    new_risk = model.calculate_risk_level(cluster_events_count, recent_events_count)

                    # Update in DB
                    client.table("threat_zones") \
                        .update({
                            "incident_count": cluster_events_count,
                            "risk_level": new_risk,
                            "last_updated": now.isoformat()
                        }) \
                        .eq("id", zone["id"]) \
                        .execute()
                    
                    intersected_zones_updated += 1
            except Exception as geom_err:
                print(f"[heatmap] Error checking geometry intersection: {geom_err}")

        return {
            "status": "success",
            "incident_recorded": True,
            "realtime_clusters_updated": intersected_zones_updated
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to report incident: {str(e)}")
