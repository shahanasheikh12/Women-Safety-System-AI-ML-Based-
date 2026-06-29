import math
import requests
import database

class RouteSafety:
    def __init__(self):
        pass

    def get_routes_from_osrm(self, origin_lat: float, origin_lng: float, dest_lat: float, dest_lng: float) -> list:
        """
        Fetches foot routes from OSRM demo server.
        """
        url = f"http://router.project-osrm.org/route/v1/foot/{origin_lng},{origin_lat};{dest_lng},{dest_lat}"
        params = {
            "alternatives": "true",
            "steps": "true",
            "geometries": "geojson",
            "overview": "full"
        }
        try:
            response = requests.get(url, params=params, timeout=10)
            if response.status_code == 200:
                data = response.json()
                return data.get("routes", [])
            else:
                print(f"[RouteSafety] OSRM query failed, status: {response.status_code}")
                return []
        except Exception as e:
            print(f"[RouteSafety] OSRM request error: {e}")
            return []

    def haversine_distance(self, lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """
        Calculates haversine distance in kilometers.
        """
        R = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
             math.sin(dlon / 2) ** 2)
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
        return R * c

    def calculate_route_safety_score(self, route_geometry: dict) -> tuple:
        """
        Computes safety score and returns (score, warning_zones_list).
        Each waypoint in LineString coordinates (lng, lat) is checked against
        threat zones within 100m (0.1km).
        """
        waypoints = route_geometry.get("coordinates", [])
        if not waypoints:
            return 100, []

        client = database.get_supabase()
        base_score = 100
        warning_zones = []

        try:
            # Fetch all threat zones
            response = client.table("threat_zones").select("*").execute()
            all_zones = response.data or []

            for zone in all_zones:
                z_lat = zone.get("center_lat")
                z_lng = zone.get("center_lng")
                if z_lat is None or z_lng is None:
                    continue

                # Check if this threat zone is within 100m of ANY waypoint on the route
                is_near = False
                for wp in waypoints: # wp is [lng, lat]
                    wp_lng, wp_lat = wp[0], wp[1]
                    dist = self.haversine_distance(wp_lat, wp_lng, z_lat, z_lng)
                    if dist <= 0.1: # 100 meters
                        is_near = True
                        break

                if is_near:
                    risk = zone.get("risk_level", "low")
                    if risk == 'critical':
                        base_score -= 20
                    elif risk == 'high':
                        base_score -= 12
                    elif risk == 'medium':
                        base_score -= 6
                    elif risk == 'low':
                        base_score -= 2

                    warning_zones.append({
                        "lat": z_lat,
                        "lng": z_lng,
                        "risk_level": risk,
                        "description": f"{risk.upper()} risk area near route"
                    })

            # Clamp score to [0, 100]
            clamped_score = max(0, min(100, base_score))
            return clamped_score, warning_zones
        except Exception as e:
            print(f"[RouteSafety] Error calculating safety score: {e}")
            return 100, []

    def time_of_day_adjustment(self, score: float, hour: int) -> float:
        """
        Applies time of day penalties to safety score:
        - Night (9 PM - 5 AM): score * 0.85
        - Dusk (6 PM - 9 PM): score * 0.93
        - Day (6 AM - 6 PM): score * 1.0
        """
        if hour >= 21 or hour < 5:
            return score * 0.85
        elif hour >= 18 and hour < 21:
            return score * 0.93
        else:
            return score * 1.0

    def rank_routes(self, routes_with_scores: list) -> list:
        """
        Sorts and labels routes based on safety and speed weightings.
        """
        if not routes_with_scores:
            return []

        # Find Route A: highest safety score -> "Safest Route"
        safest_route = max(routes_with_scores, key=lambda r: r["safety_score"])
        safest_route["label"] = "Safest Route"

        # Find Route B: lowest duration -> "Fastest Route"
        fastest_route = min(routes_with_scores, key=lambda r: r["duration_minutes"])
        fastest_route["label"] = "Fastest Route"

        # Find Route C: Balanced Route (safety*0.6 + speed*0.4)
        # Calculate speed score relative to the fastest route duration
        min_dur = fastest_route["duration_minutes"]
        for r in routes_with_scores:
            dur = r["duration_minutes"]
            speed_score = (min_dur / dur * 100) if dur > 0 else 100.0
            r["balanced_score"] = (r["safety_score"] * 0.6) + (speed_score * 0.4)

        balanced_route = max(routes_with_scores, key=lambda r: r["balanced_score"])
        # If the balanced route overlaps with safest or fastest, assign it to a different one if possible,
        # or just label it "Balanced Route"
        balanced_route["label"] = "Balanced Route"

        # Ensure that if one route qualifies for multiple tags, we preserve their labels correctly
        # Let's override safest and fastest as they have priority
        safest_route["label"] = "Safest Route"
        fastest_route["label"] = "Fastest Route"

        # Return sorted list (Safest first, then Balanced, then Fastest)
        sorted_routes = []
        for label in ["Safest Route", "Balanced Route", "Fastest Route"]:
            match = next((r for r in routes_with_scores if r["label"] == label), None)
            if match and match not in sorted_routes:
                sorted_routes.append(match)
        
        # Add remaining if any
        for r in routes_with_scores:
            if r not in sorted_routes:
                sorted_routes.append(r)

        return sorted_routes
