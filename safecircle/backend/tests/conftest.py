"""
backend/tests/conftest.py
─────────────────────────
Shared pytest fixtures for SafeCircle backend tests.

Provides:
  - mock_supabase: a MagicMock that simulates the Supabase client
  - mock_sos_data: sample SOS event records for heatmap tests
  - mock_volunteer_data: sample volunteer records for trust score tests
"""

import pytest
from unittest.mock import MagicMock, AsyncMock
import pandas as pd
import numpy as np


# ── Supabase mock ─────────────────────────────────────────────────────────────

@pytest.fixture
def mock_supabase():
    """
    Returns a MagicMock simulating the Supabase client interface.
    Call .configure() to set the return value for .execute().
    """
    client = MagicMock()

    # Default: from().select().execute() returns empty list
    table_mock = MagicMock()
    execute_mock = MagicMock(return_value=MagicMock(data=[], error=None))

    table_mock.select.return_value = table_mock
    table_mock.eq.return_value = table_mock
    table_mock.gte.return_value = table_mock
    table_mock.lte.return_value = table_mock
    table_mock.neq.return_value = table_mock
    table_mock.limit.return_value = table_mock
    table_mock.order.return_value = table_mock
    table_mock.execute = execute_mock
    table_mock.upsert = MagicMock(return_value=table_mock)
    table_mock.insert = MagicMock(return_value=table_mock)
    table_mock.update = MagicMock(return_value=table_mock)

    client.from_.return_value = table_mock
    client.table.return_value = table_mock
    client.rpc.return_value = table_mock

    return client


# ── SOS incident mock data ────────────────────────────────────────────────────

@pytest.fixture
def mock_sos_data():
    """
    Returns a list of realistic SOS event dicts representing Bengaluru incidents.
    Contains enough density to form two DBSCAN clusters.
    """
    return [
        # Cluster A — Koramangala area (~15 points)
        {"id": f"sos-{i}", "lat": 12.9279 + np.random.uniform(-0.003, 0.003),
         "lng": 77.6271 + np.random.uniform(-0.003, 0.003),
         "started_at": "2024-01-15T22:30:00Z", "trigger_method": "button"}
        for i in range(15)
    ] + [
        # Cluster B — Indiranagar area (~10 points)
        {"id": f"sos-{i+15}", "lat": 12.9784 + np.random.uniform(-0.003, 0.003),
         "lng": 77.6408 + np.random.uniform(-0.003, 0.003),
         "started_at": "2024-01-16T02:00:00Z", "trigger_method": "voice"}
        for i in range(10)
    ] + [
        # Noise — isolated points far from clusters
        {"id": "sos-noise-1", "lat": 12.8500, "lng": 77.4800,
         "started_at": "2024-01-15T14:00:00Z", "trigger_method": "shake"},
        {"id": "sos-noise-2", "lat": 13.0200, "lng": 77.5900,
         "started_at": "2024-01-15T09:00:00Z", "trigger_method": "button"},
    ]


# ── Volunteer mock data ───────────────────────────────────────────────────────

@pytest.fixture
def mock_volunteer_data():
    """
    Returns a list of volunteer profile dicts with behavioural metrics.
    """
    return [
        {
            "id": "vol-001",
            "total_responses": 50,
            "accepted_responses": 48,
            "false_report_count": 0,
            "avg_response_time_seconds": 120,
            "verification_tier": 2,
            "days_active": 180,
        },
        {
            "id": "vol-002",
            "total_responses": 20,
            "accepted_responses": 10,
            "false_report_count": 5,
            "avg_response_time_seconds": 600,
            "verification_tier": 0,
            "days_active": 30,
        },
        {
            "id": "vol-003",
            "total_responses": 0,
            "accepted_responses": 0,
            "false_report_count": 0,
            "avg_response_time_seconds": None,
            "verification_tier": 1,
            "days_active": 1,
        },
        {
            "id": "vol-004",
            "total_responses": 100,
            "accepted_responses": 95,
            "false_report_count": 1,
            "avg_response_time_seconds": 90,
            "verification_tier": 3,
            "days_active": 365,
        },
    ]
