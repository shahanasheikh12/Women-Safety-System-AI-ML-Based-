from datetime import datetime, timedelta, timezone
from supabase import create_client, Client
from config import SUPABASE_URL, SUPABASE_SERVICE_KEY

# Initialize Supabase client
_supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def get_supabase() -> Client:
    """
    Returns the authenticated Supabase client using the service role key.
    """
    return _supabase_client

def fetch_sos_events(days: int = 30) -> list:
    """
    Fetches anonymized SOS events from the database created in the last N days.
    """
    client = get_supabase()
    threshold = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    try:
        response = client.table("sos_events") \
            .select("id, lat, lng, started_at, status") \
            .gte("started_at", threshold) \
            .execute()
        return response.data or []
    except Exception as e:
        print(f"[database] Error fetching SOS events: {e}")
        return []

def fetch_volunteer_data() -> list:
    """
    Fetches volunteer stats (responses, ratings, response times) from the database
    to feed into the ML model for trust scoring.
    """
    client = get_supabase()
    try:
        # 1. Get all volunteers
        users_resp = client.table("users") \
            .select("id, name, verification_tier, trust_score, credits, created_at") \
            .eq("is_volunteer", True) \
            .execute()
        volunteers = users_resp.data or []

        if not volunteers:
            return []

        # 2. Get all volunteer responses
        responses_resp = client.table("volunteer_responses") \
            .select("volunteer_id, status, victim_rating, response_time_seconds, created_at") \
            .execute()
        responses = responses_resp.data or []

        # Group responses by volunteer_id
        responses_by_vol = {}
        for r in responses:
            vol_id = r.get("volunteer_id")
            if vol_id not in responses_by_vol:
                responses_by_vol[vol_id] = []
            responses_by_vol[vol_id].append(r)

        # 3. Combine user profile details with response aggregates
        combined_data = []
        for vol in volunteers:
            vol_id = vol["id"]
            vol_responses = responses_by_vol.get(vol_id, [])

            total_notified = len(vol_responses)
            completed = [r for r in vol_responses if r.get("status") == "completed"]
            total_completed = len(completed)

            # Response rate: accepted / notified
            accepted = [r for r in vol_responses if r.get("status") in ("accepted", "en_route", "arrived", "completed")]
            total_accepted = len(accepted)
            response_rate = (total_accepted / total_notified) if total_notified > 0 else 1.0

            # Average response time
            resp_times = [r.get("response_time_seconds") for r in completed if r.get("response_time_seconds") is not None]
            avg_resp_time = (sum(resp_times) / len(resp_times)) if resp_times else 300.0  # fallback 5 mins

            # Average victim rating
            ratings = [r.get("victim_rating") for r in completed if r.get("victim_rating") is not None]
            avg_rating = (sum(ratings) / len(ratings)) if ratings else 5.0

            combined_data.append({
                "id": vol_id,
                "name": vol.get("name"),
                "verification_tier": vol.get("verification_tier", 0),
                "credits": vol.get("credits", 0),
                "account_created_at": vol.get("created_at"),
                "total_assists_completed": total_completed,
                "response_rate": response_rate,
                "average_response_time_seconds": avg_resp_time,
                "average_rating": avg_rating,
                "current_trust_score": vol.get("trust_score", 50.0)
            })

        return combined_data
    except Exception as e:
        print(f"[database] Error fetching volunteer data: {e}")
        return []

def update_threat_zones(zones_list: list) -> bool:
    """
    Clears existing threat zones and overwrites them with the new clustered zones.
    Each zone in the list should match the schema:
    {
      "cluster_id": int,
      "geojson": dict (Polygon coordinates),
      "risk_level": "low" | "medium" | "high" | "critical",
      "incident_count": int,
      "center_lat": float,
      "center_lng": float,
      "last_updated": str (ISO timestamp)
    }
    """
    client = get_supabase()
    try:
        # Clear existing entries in threat_zones
        # Delete filter neq("id", "00000000-0000-0000-0000-000000000000") is a workaround to bypass delete constraints
        client.table("threat_zones") \
            .delete() \
            .neq("id", "00000000-0000-0000-0000-000000000000") \
            .execute()

        if not zones_list:
            return True

        # Insert new clustered zones
        client.table("threat_zones").insert(zones_list).execute()
        print(f"[database] Successfully updated {len(zones_list)} threat zones")
        return True
    except Exception as e:
        print(f"[database] Error updating threat zones: {e}")
        return False

def update_trust_scores(scores_dict: dict) -> bool:
    """
    Accepts a dictionary of {user_id: trust_score} and updates the 'users' table.
    """
    client = get_supabase()
    try:
        for user_id, score in scores_dict.items():
            client.table("users") \
                .update({"trust_score": round(float(score), 1)}) \
                .eq("id", user_id) \
                .execute()
        print(f"[database] Successfully updated trust scores for {len(scores_dict)} volunteers")
        return True
    except Exception as e:
        print(f"[database] Error updating trust scores: {e}")
        return False
