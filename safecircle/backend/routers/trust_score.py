import os
from typing import Optional
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from models.volunteer_scorer import VolunteerTrustScorer
import database

router = APIRouter()
scorer = VolunteerTrustScorer()

class TrustEventUpdate(BaseModel):
    volunteer_id: str
    event_type: str  # 'assist_completed' | 'rated' | 'false_report'
    rating: Optional[int] = None

@router.post("/retrain")
def retrain_trust_model(x_cron_secret: Optional[str] = Header(None)):
    """
    Triggers the weekly trust score training and update pipeline.
    Triggered by pg_cron on Sundays.
    """
    expected_secret = os.getenv("CRON_SECRET", "super-secret-cron-key")
    if expected_secret and x_cron_secret != expected_secret:
        raise HTTPException(
            status_code=401,
            detail="Unauthorized: invalid or missing X-Cron-Secret header"
        )

    try:
        results = scorer.run_full_pipeline()
        return {"status": "success", "results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline execution failed: {str(e)}")

@router.get("/score/{volunteer_id}")
def get_score(volunteer_id: str):
    """
    Returns the volunteer's current trust score and their ranking percentile.
    Does not run model retraining on the fly.
    """
    client = database.get_supabase()
    try:
        # Fetch target user
        user_resp = client.table("users") \
            .select("id, name, verification_tier, trust_score") \
            .eq("id", volunteer_id) \
            .eq("is_volunteer", True) \
            .execute()
        
        users = user_resp.data or []
        if not users:
            raise HTTPException(status_code=404, detail="Volunteer not found")

        target_user = users[0]

        # Fetch all volunteer scores to compute rank percentile
        all_vols_resp = client.table("users") \
            .select("id, trust_score") \
            .eq("is_volunteer", True) \
            .execute()
        all_vols = all_vols_resp.data or []

        scores = [v.get("trust_score", 50.0) or 50.0 for v in all_vols]
        scores.sort()

        target_score = target_user.get("trust_score", 50.0) or 50.0
        count_below = sum(1 for s in scores if s <= target_score)
        
        rank_percentile = (count_below / len(scores)) * 100.0 if scores else 100.0

        return {
            "volunteer_id": volunteer_id,
            "trust_score": target_score,
            "tier": target_user.get("verification_tier", 0),
            "rank_percentile": round(rank_percentile, 1)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch trust score: {str(e)}")

@router.post("/update-event")
def update_trust_event(event: TrustEventUpdate):
    """
    Updates a volunteer's stats and performs a lightweight recalculation of
    their individual trust score in real-time.
    """
    client = database.get_supabase()
    vol_id = event.volunteer_id
    e_type = event.event_type

    try:
        # 1. Fetch current stats
        stats_resp = client.table("volunteer_stats") \
            .select("*") \
            .eq("volunteer_id", vol_id) \
            .execute()
        
        stats_data = stats_resp.data or []

        if not stats_data:
            # Create default values
            stats = {
                "volunteer_id": vol_id,
                "total_notified": 0,
                "total_accepted": 0,
                "total_completed": 0,
                "total_declined": 0,
                "total_false_reports": 0,
                "avg_rating": 5.0,
                "avg_response_time_seconds": 300
            }
        else:
            stats = stats_data[0]

        # 2. Modify metrics depending on event
        if e_type == "assist_completed":
            stats["total_completed"] += 1
            stats["total_accepted"] += 1
            stats["total_notified"] += 1  # count notification too
        elif e_type == "rated":
            # Recalculate average rating directly from responses
            resp = client.table("volunteer_responses") \
                .select("victim_rating") \
                .eq("volunteer_id", vol_id) \
                .eq("status", "completed") \
                .execute()
            ratings_data = resp.data or []
            ratings = [r["victim_rating"] for r in ratings_data if r.get("victim_rating") is not None]
            
            if event.rating is not None:
                ratings.append(event.rating)
            
            stats["avg_rating"] = sum(ratings) / len(ratings) if ratings else 5.0
        elif e_type == "false_report":
            stats["total_false_reports"] += 1
            # Auto decrease acceptance rate counts to show impact
            stats["total_notified"] += 1
        else:
            raise HTTPException(status_code=400, detail="Invalid event_type")

        # 3. Save updated stats to volunteer_stats
        client.table("volunteer_stats").upsert(stats).execute()

        # 4. Trigger lightweight score prediction
        new_score = scorer.predict_single_score(vol_id)

        return {
            "status": "success",
            "volunteer_id": vol_id,
            "event_processed": e_type,
            "new_trust_score": round(new_score, 1)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process trust event: {str(e)}")
