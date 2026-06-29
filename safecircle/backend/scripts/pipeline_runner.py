import os
import json
import requests
from dotenv import load_dotenv

# Load environment variables if .env file exists
load_dotenv()

ML_API_URL = os.getenv('ML_API_URL', 'http://localhost:8000')
CRON_SECRET = os.getenv('CRON_SECRET', 'super-secret-cron-key')

def trigger_heatmap_retrain():
    print(f"[Pipeline] Triggering heatmap retrain on {ML_API_URL}...")
    try:
        r = requests.post(
            f"{ML_API_URL}/ml/heatmap/retrain", 
            headers={"X-Cron-Secret": CRON_SECRET},
            timeout=30
        )
        if r.status_code == 200:
            print("Heatmap retrain success:", r.json())
        else:
            print(f"Heatmap retrain failed ({r.status_code}):", r.text)
    except Exception as e:
        print("Heatmap retrain request failed:", e)

def trigger_trust_retrain():
    print(f"[Pipeline] Triggering volunteer trust scores retrain on {ML_API_URL}...")
    try:
        r = requests.post(
            f"{ML_API_URL}/ml/trust/retrain",
            headers={"X-Cron-Secret": CRON_SECRET},
            timeout=30
        )
        if r.status_code == 200:
            print("Trust score retrain success:", r.json())
        else:
            print(f"Trust score retrain failed ({r.status_code}):", r.text)
    except Exception as e:
        print("Trust score retrain request failed:", e)

def health_check():
    print(f"[Pipeline] Running health check on {ML_API_URL}...")
    try:
        r = requests.get(f"{ML_API_URL}/health", timeout=10)
        print("Health status:", r.json())
    except Exception as e:
        print("Health check failed:", e)

def run_full_pipeline():
    print("=================== SafeCircle ML Pipeline Runner ===================")
    health_check()
    trigger_heatmap_retrain()
    trigger_trust_retrain()
    print("======================== Pipeline Complete =========================")

if __name__ == "__main__":
    run_full_pipeline()
