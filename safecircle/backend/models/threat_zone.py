import numpy as np
from sklearn.cluster import DBSCAN
from shapely.geometry import MultiPoint, mapping
from datetime import datetime, timezone, timedelta
import database

class ThreatZoneModel:
    def __init__(self):
        pass

    def load_data_from_supabase(self, days: int = 90) -> list:
        """
        Fetches last N days of SOS events from Supabase.
        Returns a list of dicts with keys: id, lat, lng, started_at, status.
        """
        return database.fetch_sos_events(days=days)

    def run_dbscan(self, coordinates: np.ndarray, eps_km: float = 0.3, min_samples: int = 3) -> np.ndarray:
        """
        Runs DBSCAN clustering on lat/lng coordinates (in degrees).
        Returns label array where -1 represents noise points.
        """
        if len(coordinates) < min_samples:
            return np.array([-1] * len(coordinates))

        # Convert km to radians for haversine metric: eps = eps_km / Earth_radius
        # Earth Radius in km is approximately 6371.0
        eps = eps_km / 6371.0
        
        # DBSCAN expects coordinates in [latitude_rad, longitude_rad] order for haversine
        rad_coords = np.radians(coordinates)
        
        db = DBSCAN(eps=eps, min_samples=min_samples, algorithm='ball_tree', metric='haversine')
        labels = db.fit_predict(rad_coords)
        
        return labels

    def cluster_to_geojson(self, cluster_coords: list) -> dict:
        """
        Generates a buffered GeoJSON polygon geometry dictionary from cluster points.
        """
        if not cluster_coords:
            return {}

        # Use Shapely MultiPoint to construct convex hull
        multi_point = MultiPoint(cluster_coords)
        poly = multi_point.convex_hull

        # Add 100m buffer using Shapely .buffer(0.001) (approximately 100 meters)
        poly_buffered = poly.buffer(0.001)

        # Convert Shapely shape to GeoJSON geometry dictionary
        return mapping(poly_buffered)

    def calculate_risk_level(self, cluster_size: int, recent_count: int) -> str:
        """
        Calculates risk level based on size of cluster and count of recent incidents.
        - critical: size >= 10 AND recent_count >= 3
        - high: size >= 5 OR recent_count >= 2
        - medium: size >= 3
        - low: else
        """
        if cluster_size >= 10 and recent_count >= 3:
            return "critical"
        elif cluster_size >= 5 or recent_count >= 2:
            return "high"
        elif cluster_size >= 3:
            return "medium"
        else:
            return "low"

    def run_full_pipeline(self) -> dict:
        """
        Executes load -> cluster -> format -> save pipeline.
        Returns pipeline summary.
        """
        print("[ThreatZoneModel] Executing full pipeline...")
        # 1. Load 90 days of SOS events
        events = self.load_data_from_supabase(days=90)
        
        # Filter out events without valid GPS coords
        valid_events = []
        for e in events:
            if e.get("lat") is not None and e.get("lng") is not None:
                valid_events.append(e)

        if len(valid_events) < 3:
            print("[ThreatZoneModel] Not enough incidents to cluster (need at least 3)")
            database.update_threat_zones([])
            return {"zones_created": 0, "total_incidents_clustered": 0}

        # 2. Extract coordinates
        coords = np.array([[e["lat"], e["lng"]] for e in valid_events])

        # 3. Run DBSCAN
        labels = self.run_dbscan(coords, eps_km=0.3, min_samples=3)

        # 4. Group events into clusters
        clusters = {}
        for idx, label in enumerate(labels):
            if label != -1:
                label_id = int(label)
                if label_id not in clusters:
                    clusters[label_id] = []
                clusters[label_id].append(valid_events[idx])

        # 5. Process clusters into threat zones
        zones_list = []
        now = datetime.now(timezone.utc)
        seven_days_ago = now - timedelta(days=7)

        for cluster_id, cluster_events in clusters.items():
            cluster_coords = [[e["lat"], e["lng"]] for e in cluster_events]

            # Count recent incidents (created in last 7 days)
            recent_count = 0
            for e in cluster_events:
                started_at_str = e.get("started_at")
                if started_at_str:
                    try:
                        # Handle both 'Z' and offset-based iso strings
                        started_at = datetime.fromisoformat(started_at_str.replace("Z", "+00:00"))
                        if started_at >= seven_days_ago:
                            recent_count += 1
                    except Exception as parse_err:
                        print(f"[ThreatZoneModel] Timestamp parsing error: {parse_err}")

            # Risk level
            risk = self.calculate_risk_level(len(cluster_events), recent_count)

            # Center point
            center_lat = sum(e["lat"] for e in cluster_events) / len(cluster_events)
            center_lng = sum(e["lng"] for e in cluster_events) / len(cluster_events)

            # Polygon geojson
            geojson = self.cluster_to_geojson(cluster_coords)

            zones_list.append({
                "cluster_id": cluster_id,
                "geojson": geojson,
                "risk_level": risk,
                "incident_count": len(cluster_events),
                "center_lat": float(center_lat),
                "center_lng": float(center_lng),
                "last_updated": now.isoformat()
            })

        # 6. Push to DB
        success = database.update_threat_zones(zones_list)
        if not success:
            print("[ThreatZoneModel] Failed to save threat zones to database")
            return {"error": "Failed to save threat zones"}

        total_clustered = sum(len(c) for c in clusters.values())
        return {
            "zones_created": len(zones_list),
            "total_incidents_clustered": total_clustered
        }
