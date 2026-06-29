import os
from datetime import datetime, timezone, timedelta
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import requests
import database
from routers import heatmap, trust_score, safe_route

app = FastAPI(title="SafeCircle ML API", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers with specified prefixes and tags
app.include_router(heatmap.router, prefix="/ml/heatmap", tags=["Threat Heatmap"])
app.include_router(trust_score.router, prefix="/ml/trust", tags=["Trust Scoring"])
app.include_router(safe_route.router, prefix="/ml/route", tags=["Safe Route"])

# ── Cron secret verification dependency ──────────────────────
def verify_cron_secret(x_cron_secret: str = Header(None)):
    expected_secret = os.getenv("CRON_SECRET", "super-secret-cron-key")
    if expected_secret and x_cron_secret != expected_secret:
        raise HTTPException(
            status_code=403,
            detail="Forbidden: Invalid or missing X-Cron-Secret header"
        )

# ── Admin stats diagnostics endpoint ──────────────────────────
@app.get("/admin/stats", dependencies=[Depends(verify_cron_secret)])
def admin_stats():
    """
    Returns high-level statistics and health checks for the ML engine.
    """
    client = database.get_supabase()
    
    # 1. Total SOS events (all time + last 30 days)
    total_sos = 0
    recent_sos = 0
    try:
        total_resp = client.table("sos_events").select("id", count="exact").execute()
        total_sos = total_resp.count or 0
        
        thirty_days_ago = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        recent_resp = client.table("sos_events").select("id", count="exact").gte("started_at", thirty_days_ago).execute()
        recent_sos = recent_resp.count or 0
    except Exception as e:
        print("[AdminStats] Error counting SOS events:", e)

    # 2. Threat zones count by risk level
    zones_count = {"critical": 0, "high": 0, "medium": 0, "low": 0}
    last_trained_heatmap = "Never"
    try:
        zones_resp = client.table("threat_zones").select("risk_level, created_at").execute()
        zones = zones_resp.data or []
        for z in zones:
            risk = z.get("risk_level", "low")
            if risk in zones_count:
                zones_count[risk] += 1
        
        created_times = [z.get("created_at") for z in zones if z.get("created_at")]
        if created_times:
            last_trained_heatmap = max(created_times)
    except Exception as e:
        print("[AdminStats] Error fetching threat zones:", e)

    # 3. Average volunteer trust score
    avg_trust = 50.0
    try:
        vols_resp = client.table("users").select("trust_score").eq("is_volunteer", True).execute()
        vols = vols_resp.data or []
        scores = [v.get("trust_score", 50.0) or 50.0 for v in vols]
        avg_trust = sum(scores) / len(scores) if scores else 50.0
    except Exception as e:
        print("[AdminStats] Error counting volunteer average trust:", e)

    # 4. Model last trained timestamps
    last_trained_trust = "Never"
    try:
        # Check trust_model.json file modification time
        model_path = os.path.join(os.path.dirname(__file__), "models", "trust_model.json")
        if os.path.exists(model_path):
            mtime = os.path.getmtime(model_path)
            last_trained_trust = datetime.fromtimestamp(mtime, timezone.utc).isoformat()
    except Exception as e:
        print("[AdminStats] Error reading model modification time:", e)

    # 5. External API Health Checks
    supabase_ping = "online"
    try:
        client.table("users").select("id").limit(1).execute()
    except Exception:
        supabase_ping = "offline"

    osrm_ping = "online"
    try:
        requests.get("http://router.project-osrm.org/route/v1/foot/0,0;0,0", timeout=5)
    except Exception:
        osrm_ping = "offline"

    return {
        "sos_events": {
            "total_all_time": total_sos,
            "last_30_days": recent_sos
        },
        "threat_zones_by_risk": zones_count,
        "average_volunteer_trust": round(avg_trust, 2),
        "model_trained_timestamps": {
            "volunteer_trust": last_trained_trust,
            "threat_heatmap": last_trained_heatmap
        },
        "health_checks": {
            "supabase": supabase_ping,
            "osrm": osrm_ping
        }
    }

# ── Force retrain endpoint ────────────────────────────────────
@app.post("/admin/force-retrain", dependencies=[Depends(verify_cron_secret)])
def force_retrain():
    """
    Forcefully triggers immediate retraining on all machine learning models.
    """
    from models.threat_zone import ThreatZoneModel
    from models.volunteer_scorer import VolunteerTrustScorer

    try:
        tz_model = ThreatZoneModel()
        vt_scorer = VolunteerTrustScorer()

        print("[Admin] Running force-retrain on Threat Zone DBSCAN Heatmaps...")
        tz_results = tz_model.run_full_pipeline()

        print("[Admin] Running force-retrain on Volunteer Trust Scores...")
        vt_results = vt_scorer.run_full_pipeline()

        return {
            "status": "success",
            "heatmap_results": tz_results,
            "trust_results": vt_results
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Retraining failed: {str(e)}"
        )

# ── Health & Diagnostics ──────────────────────────────────────
@app.get("/")
def read_root():
    return {"message": "SafeCircle ML API is running", "health_check_url": "/health"}

@app.get("/health")
def health():
    return {"status": "ok", "service": "SafeCircle ML API"}
