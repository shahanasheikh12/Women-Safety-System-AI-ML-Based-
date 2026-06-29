"""
backend/tests/test_heatmap.py
─────────────────────────────
Unit tests for the ThreatZoneModel DBSCAN clustering logic.
Tests run with mocked Supabase (no live DB needed).

Run: pytest tests/test_heatmap.py -v
"""

import pytest
import numpy as np
import sys
import os
from unittest.mock import MagicMock, patch

# Ensure backend root is on sys.path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Helpers ───────────────────────────────────────────────────────────────────

def make_cluster(center_lat: float, center_lng: float, n: int, spread: float = 0.001):
    """Generate n points tightly around a center coordinate."""
    rng = np.random.default_rng(seed=42)
    return [
        {"id": f"p{i}", "lat": center_lat + rng.uniform(-spread, spread),
         "lng": center_lng + rng.uniform(-spread, spread),
         "started_at": "2024-01-15T22:00:00Z", "trigger_method": "button"}
        for i in range(n)
    ]


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestDBSCANClustering:

    @pytest.fixture(autouse=True)
    def setup(self):
        """Patch `database` module before importing ThreatZoneModel."""
        self.db_mock = MagicMock()
        with patch.dict("sys.modules", {"database": self.db_mock}):
            from models.threat_zone import ThreatZoneModel
            self.model = ThreatZoneModel()
            yield

    def test_clusters_nearby_points(self):
        """Points within 0.3 km should be grouped into a single cluster."""
        # 10 tightly-packed points (~20m spread)
        coords = np.array([
            [12.9279 + i * 0.0001, 77.6271 + i * 0.0001] for i in range(10)
        ])
        labels = self.model.run_dbscan(coords, eps_km=0.3, min_samples=3)
        # All should be in the same cluster (label 0), none noise
        non_noise = labels[labels != -1]
        assert len(non_noise) == len(coords), "All nearby points should be clustered"
        assert len(set(non_noise)) == 1, "Should form exactly one cluster"

    def test_noise_points_excluded(self):
        """Isolated points far from each other should be labeled as noise (-1)."""
        # 3 well-separated points (each > 1km apart)
        coords = np.array([
            [12.9279, 77.6271],
            [12.9500, 77.6700],
            [12.8900, 77.5900],
        ])
        labels = self.model.run_dbscan(coords, eps_km=0.3, min_samples=3)
        assert all(l == -1 for l in labels), "All isolated points should be noise"

    def test_risk_level_critical_assignment(self):
        """Cluster with 10+ events and 3+ recent should be 'critical'."""
        risk = self.model.calculate_risk_level(cluster_size=12, recent_count=5)
        assert risk == "critical"

    def test_risk_level_high_assignment(self):
        """Cluster with 5+ events OR 2+ recent should be 'high'."""
        assert self.model.calculate_risk_level(cluster_size=6, recent_count=0) == "high"
        assert self.model.calculate_risk_level(cluster_size=2, recent_count=2) == "high"

    def test_risk_level_medium_assignment(self):
        """Cluster with 3+ events and fewer recent should be 'medium'."""
        risk = self.model.calculate_risk_level(cluster_size=4, recent_count=1)
        assert risk == "medium"

    def test_risk_level_low_assignment(self):
        """Small clusters with no recent activity should be 'low'."""
        risk = self.model.calculate_risk_level(cluster_size=2, recent_count=0)
        assert risk == "low"

    def test_geojson_output_format(self):
        """cluster_to_geojson should return a dict with 'type' and 'coordinates'."""
        cluster_points = [
            [12.9279, 77.6271],
            [12.9285, 77.6278],
            [12.9282, 77.6265],
            [12.9275, 77.6280],
        ]
        geojson = self.model.cluster_to_geojson(cluster_points)
        assert isinstance(geojson, dict), "GeoJSON should be a dict"
        assert "type" in geojson, "GeoJSON must have 'type' key"
        assert "coordinates" in geojson, "GeoJSON must have 'coordinates' key"
        assert geojson["type"] in ("Polygon", "Point", "LineString", "GeometryCollection")

    def test_empty_dataset_handled(self):
        """run_dbscan with 0 rows should return an empty array, not crash."""
        coords = np.empty((0, 2))
        labels = self.model.run_dbscan(coords, eps_km=0.3, min_samples=3)
        assert len(labels) == 0, "Empty input should return empty label array"

    def test_single_point_no_cluster(self):
        """A single point should be labeled as noise (-1)."""
        coords = np.array([[12.9279, 77.6271]])
        labels = self.model.run_dbscan(coords, eps_km=0.3, min_samples=3)
        assert labels[0] == -1, "Single isolated point should be noise"

    def test_two_separate_clusters_form(self, mock_sos_data):
        """
        Two geographically distant point groups should form two separate clusters.
        Uses the shared mock_sos_data fixture from conftest.py.
        """
        valid = [e for e in mock_sos_data if "noise" not in e["id"]]
        coords = np.array([[e["lat"], e["lng"]] for e in valid])
        labels = self.model.run_dbscan(coords, eps_km=0.5, min_samples=3)
        unique_clusters = set(labels[labels != -1])
        # Koramangala + Indiranagar should be distinct clusters
        assert len(unique_clusters) >= 2, (
            f"Expected at least 2 clusters, got {len(unique_clusters)}: {unique_clusters}"
        )

    def test_time_of_day_adjustment(self):
        """
        DBSCAN results should be stable regardless of timestamp — time weighting
        is applied post-clustering in calculate_risk_level via recent_count.
        Risk should increase when recent_count is high.
        """
        daytime_risk = self.model.calculate_risk_level(cluster_size=5, recent_count=0)
        nighttime_risk = self.model.calculate_risk_level(cluster_size=5, recent_count=4)
        # Nighttime (more recent) should have higher risk than daytime
        risk_order = {"low": 0, "medium": 1, "high": 2, "critical": 3}
        assert risk_order[nighttime_risk] >= risk_order[daytime_risk], (
            "Higher recent count should result in equal or higher risk level"
        )
