import os
import pandas as pd
import numpy as np
import xgboost as xgb
from datetime import datetime, timezone
from typing import Tuple, Dict
import database

MODEL_PATH = os.path.join(os.path.dirname(__file__), "trust_model.json")

class VolunteerTrustScorer:
    def __init__(self):
        self.feature_cols = [
            "response_acceptance_rate",
            "avg_response_time_seconds",
            "avg_victim_rating",
            "verification_tier",
            "total_assists",
            "account_age_days",
            "activity_streak_days",
            "false_report_count",
            "recent_activity_score"
        ]

    def fetch_volunteer_features(self) -> pd.DataFrame:
        """
        Fetches volunteer profile and response data, computes ML features,
        and returns a pandas DataFrame.
        """
        client = database.get_supabase()

        # 1. Fetch tables
        volunteers = client.table("users").select("id, created_at, verification_tier, trust_score").eq("is_volunteer", True).execute().data or []
        responses = client.table("volunteer_responses").select("volunteer_id, status, victim_rating, response_time_seconds, created_at").execute().data or []
        credit_tx = client.table("credit_transactions").select("user_id, created_at").execute().data or []

        if not volunteers:
            return pd.DataFrame(columns=["volunteer_id"] + self.feature_cols)

        # Convert to DataFrames
        df_vol = pd.DataFrame(volunteers)
        df_resp = pd.DataFrame(responses)
        df_tx = pd.DataFrame(credit_tx)

        now = datetime.now(timezone.utc)
        features_list = []

        for _, vol in df_vol.iterrows():
            vol_id = vol["id"]
            created_at_str = vol.get("created_at")
            
            # Account age
            if created_at_str:
                created_at = datetime.fromisoformat(created_at_str.replace("Z", "+00:00"))
                account_age = max(1, (now - created_at).days)
            else:
                account_age = 30

            # Filter responses
            v_resp = df_resp[df_resp["volunteer_id"] == vol_id] if not df_resp.empty else pd.DataFrame()
            total_notified = len(v_resp)

            if total_notified > 0:
                # Accepted states
                accepted = v_resp[v_resp["status"].isin(["accepted", "en_route", "arrived", "completed"])]
                total_accepted = len(accepted)
                acceptance_rate = total_accepted / total_notified

                # Completed assists
                completed = v_resp[v_resp["status"] == "completed"]
                total_assists = len(completed)

                # Avg response time
                resp_times = completed["response_time_seconds"].dropna()
                avg_resp_time = resp_times.mean() if not resp_times.empty else 300.0

                # Avg rating
                ratings = completed["victim_rating"].dropna()
                avg_rating = ratings.mean() if not ratings.empty else 5.0

                # False reports (e.g. status is 'false_alarm')
                false_reports = len(v_resp[v_resp["status"] == "false_alarm"])

                # Recent activity (last 7 days assists * 2 + last 30 days assists)
                seven_days_ago = now - timedelta(days=7)
                thirty_days_ago = now - timedelta(days=30)
                
                assists_7d = 0
                assists_30d = 0

                for _, r in completed.iterrows():
                    r_date_str = r.get("created_at")
                    if r_date_str:
                        r_date = datetime.fromisoformat(r_date_str.replace("Z", "+00:00"))
                        if r_date >= seven_days_ago:
                            assists_7d += 1
                        if r_date >= thirty_days_ago:
                            assists_30d += 1
                
                recent_activity = (assists_7d * 2) + assists_30d
            else:
                acceptance_rate = 1.0  # default for new
                total_assists = 0
                avg_resp_time = 300.0
                avg_rating = 5.0
                false_reports = 0
                recent_activity = 0

            # Calculate activity streak
            dates_activity = set()
            if not v_resp.empty:
                for _, r in v_resp.iterrows():
                    r_date_str = r.get("created_at")
                    if r_date_str:
                        dates_activity.add(datetime.fromisoformat(r_date_str.replace("Z", "+00:00")).date())

            v_tx = df_tx[df_tx["user_id"] == vol_id] if not df_tx.empty else pd.DataFrame()
            if not v_tx.empty:
                for _, t in v_tx.iterrows():
                    t_date_str = t.get("created_at")
                    if t_date_str:
                        dates_activity.add(datetime.fromisoformat(t_date_str.replace("Z", "+00:00")).date())

            activity_streak = self._calculate_streak(list(dates_activity))

            features_list.append({
                "volunteer_id": vol_id,
                "response_acceptance_rate": float(acceptance_rate),
                "avg_response_time_seconds": float(avg_resp_time),
                "avg_victim_rating": float(avg_rating),
                "verification_tier": int(vol.get("verification_tier") or 0),
                "total_assists": int(total_assists),
                "account_age_days": int(account_age),
                "activity_streak_days": int(activity_streak),
                "false_report_count": int(false_reports),
                "recent_activity_score": int(recent_activity)
            })

        return pd.DataFrame(features_list)

    def _calculate_streak(self, dates: list) -> int:
        """
        Calculates the longest streak of consecutive days.
        """
        if not dates:
            return 1
        sorted_dates = sorted(dates)
        longest_streak = 1
        current_streak = 1

        for i in range(1, len(sorted_dates)):
            diff = (sorted_dates[i] - sorted_dates[i-1]).days
            if diff == 1:
                current_streak += 1
            elif diff > 1:
                longest_streak = max(longest_streak, current_streak)
                current_streak = 1
        
        return max(longest_streak, current_streak)

    def generate_synthetic_labels(self, df: pd.DataFrame) -> pd.DataFrame:
        """
        Labels trustworthy (1) and untrustworthy (0) volunteers based on heuristic criteria
        for model bootstrapping.
        """
        df["trust_label"] = np.nan

        # Trustworthy label (1)
        trust_mask = (
            (df["verification_tier"] >= 1) &
            (df["response_acceptance_rate"] >= 0.6) &
            (df["avg_victim_rating"] >= 4.0) &
            (df["false_report_count"] == 0)
        )
        df.loc[trust_mask, "trust_label"] = 1

        # Untrustworthy label (0)
        untrust_mask = (
            (df["response_acceptance_rate"] < 0.2) |
            (df["false_report_count"] >= 2)
        )
        df.loc[untrust_mask, "trust_label"] = 0

        # Bootstrapping helper: If we have no/few samples of a class, inject a dummy volunteer to prevent training failure
        has_ones = (df["trust_label"] == 1).any()
        has_zeros = (df["trust_label"] == 0).any()

        dummy_records = []
        if not has_ones:
            dummy_records.append({
                "volunteer_id": "dummy-trustworthy-id",
                "response_acceptance_rate": 0.9,
                "avg_response_time_seconds": 120.0,
                "avg_victim_rating": 5.0,
                "verification_tier": 2,
                "total_assists": 15,
                "account_age_days": 60,
                "activity_streak_days": 8,
                "false_report_count": 0,
                "recent_activity_score": 10,
                "trust_label": 1
            })
        if not has_zeros:
            dummy_records.append({
                "volunteer_id": "dummy-untrustworthy-id",
                "response_acceptance_rate": 0.05,
                "avg_response_time_seconds": 600.0,
                "avg_victim_rating": 2.0,
                "verification_tier": 0,
                "total_assists": 0,
                "account_age_days": 5,
                "activity_streak_days": 1,
                "false_report_count": 3,
                "recent_activity_score": 0,
                "trust_label": 0
            })

        if dummy_records:
            df_dummies = pd.DataFrame(dummy_records)
            df = pd.concat([df, df_dummies], ignore_index=True)

        return df

    def train_model(self, df: pd.DataFrame) -> Tuple[float, dict]:
        """
        Trains the XGBoost Classifier model on labeled training data.
        Saves model weights to disk.
        """
        # Filter labeled data
        train_df = df[df["trust_label"].notna()]
        X = train_df[self.feature_cols]
        y = train_df["trust_label"].astype(int)

        # Split data or use entire set if extremely small
        if len(X) >= 10:
            from sklearn.model_selection import train_test_split
            X_train, X_val, y_train, y_val = train_test_split(X, y, test_size=0.2, random_state=42)
            eval_set = [(X_val, y_val)]
        else:
            X_train, y_train = X, y
            eval_set = [(X, y)]

        # Initialize XGBoost model
        model = xgb.XGBClassifier(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.1,
            early_stopping_rounds=10,
            eval_metric="logloss"
        )

        model.fit(
            X_train,
            y_train,
            eval_set=eval_set,
            verbose=False
        )

        # Save model
        model.save_model(MODEL_PATH)
        print(f"[VolunteerTrustScorer] Model saved to {MODEL_PATH}")

        # Compute accuracy
        preds = model.predict(X_train)
        accuracy = float(np.mean(preds == y_train))

        # Feature importance
        importances = model.feature_importances_
        feature_importance_dict = {
            col: float(importances[idx])
            for idx, col in enumerate(self.feature_cols)
        }

        return accuracy, feature_importance_dict

    def predict_trust_scores(self, df: pd.DataFrame) -> Dict[str, float]:
        """
        Loads the trained XGBoost model and returns scaled safety score dictionary.
        """
        if not os.path.exists(MODEL_PATH):
            raise FileNotFoundError("Model file does not exist. Please train the model first.")

        model = xgb.XGBClassifier()
        model.load_model(MODEL_PATH)

        # Exclude dummy records if present
        clean_df = df[~df["volunteer_id"].astype(str).str.startswith("dummy")]
        if clean_df.empty:
            return {}

        X = clean_df[self.feature_cols]
        # Predict probability of being trustworthy (class 1)
        probs = model.predict_proba(X)[:, 1]

        # Scale to 0.0 - 100.0
        scores_dict = {}
        for idx, row in clean_df.iterrows():
            scores_dict[row["volunteer_id"]] = float(probs[clean_df.index.get_loc(idx)] * 100.0)

        return scores_dict

    def run_full_pipeline(self) -> dict:
        """
        Runs the full ETL, Training, Prediction and DB update pipeline.
        Skips training if model trained in past 7 days.
        """
        print("[VolunteerTrustScorer] Launching full pipeline...")
        df = self.fetch_volunteer_features()
        if df.empty:
            return {"volunteers_scored": 0, "model_trained": False, "avg_score": 0.0}

        model_trained = False
        accuracy = 1.0
        feat_importance = {}

        # Check if model training is needed (older than 7 days or missing)
        need_training = True
        if os.path.exists(MODEL_PATH):
            mtime = os.path.getmtime(MODEL_PATH)
            trained_time = datetime.fromtimestamp(mtime, timezone.utc)
            if (datetime.now(timezone.utc) - trained_time).days < 7:
                need_training = False
                print("[VolunteerTrustScorer] Model was trained recently. Skipping training step.")

        if need_training:
            df_labeled = self.generate_synthetic_labels(df)
            accuracy, feat_importance = self.train_model(df_labeled)
            model_trained = True

        # Predict scores
        scores = self.predict_trust_scores(df)

        # Update scores in Supabase
        if scores:
            database.update_trust_scores(scores)
            avg_score = sum(scores.values()) / len(scores)
        else:
            avg_score = 0.0

        return {
            "volunteers_scored": len(scores),
            "model_trained": model_trained,
            "accuracy": accuracy,
            "feature_importance": feat_importance,
            "avg_score": avg_score
        }

    def predict_single_score(self, volunteer_id: str) -> float:
        """
        Runs a lightweight prediction for a single volunteer.
        Trains model if it does not exist.
        """
        df = self.fetch_volunteer_features()
        v_df = df[df["volunteer_id"] == volunteer_id]
        if v_df.empty:
            return 50.0

        if not os.path.exists(MODEL_PATH):
            self.run_full_pipeline()

        model = xgb.XGBClassifier()
        model.load_model(MODEL_PATH)

        X = v_df[self.feature_cols]
        prob = model.predict_proba(X)[0, 1]
        score = float(prob * 100.0)

        # Update in database immediately
        database.update_trust_scores({volunteer_id: score})
        return score

from datetime import timedelta
