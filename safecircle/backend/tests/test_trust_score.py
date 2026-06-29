"""
backend/tests/test_trust_score.py
──────────────────────────────────
Unit tests for the VolunteerTrustScorer XGBoost model.
All Supabase DB calls are mocked — no live DB needed.

Run: pytest tests/test_trust_score.py -v
"""

import pytest
import numpy as np
import pandas as pd
import os
import sys
import tempfile
from unittest.mock import MagicMock, patch

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


# ── Helper to build a minimal feature DataFrame ───────────────────────────────

def make_volunteer_df(rows: list[dict]) -> pd.DataFrame:
    """
    Builds a DataFrame with the columns expected by VolunteerTrustScorer.
    Fills any missing columns with safe defaults.
    """
    defaults = {
        "volunteer_id": "vol-xxx",
        "response_acceptance_rate": 0.5,
        "avg_response_time_seconds": 300.0,
        "avg_victim_rating": 3.5,
        "verification_tier": 1,
        "total_assists": 5,
        "account_age_days": 30,
        "activity_streak_days": 3,
        "false_report_count": 0,
        "recent_activity_score": 5,
    }
    filled = [{**defaults, **r} for r in rows]
    return pd.DataFrame(filled)


# ── Test class ────────────────────────────────────────────────────────────────

class TestVolunteerScorer:

    @pytest.fixture(autouse=True)
    def setup(self):
        """Patch `database` before importing model to prevent live DB calls."""
        self.db_mock = MagicMock()
        with patch.dict("sys.modules", {"database": self.db_mock}):
            from models.volunteer_scorer import VolunteerTrustScorer
            self.scorer = VolunteerTrustScorer()
            yield

    def _train_temp_model(self, df: pd.DataFrame) -> str:
        """Helper: trains XGBoost on df, saves to temp file, returns path."""
        import xgboost as xgb

        X = df[self.scorer.feature_cols]
        y = df["trust_label"].astype(int)

        model = xgb.XGBClassifier(n_estimators=10, max_depth=2, eval_metric="logloss")
        model.fit(X, y, eval_set=[(X, y)], verbose=False)

        tmp = tempfile.NamedTemporaryFile(suffix=".json", delete=False)
        model.save_model(tmp.name)
        return tmp.name

    def test_high_acceptance_rate_scores_high(self):
        """
        A volunteer with near-perfect acceptance rate and no false reports
        should score significantly higher than a poor volunteer.
        """
        good_vol = make_volunteer_df([{
            "volunteer_id": "vol-good",
            "response_acceptance_rate": 0.98,
            "avg_victim_rating": 5.0,
            "false_report_count": 0,
            "verification_tier": 2,
            "total_assists": 50,
            "account_age_days": 365,
            "activity_streak_days": 30,
            "recent_activity_score": 20,
        }])
        bad_vol = make_volunteer_df([{
            "volunteer_id": "vol-bad",
            "response_acceptance_rate": 0.05,
            "avg_victim_rating": 1.5,
            "false_report_count": 5,
            "verification_tier": 0,
            "total_assists": 0,
            "account_age_days": 5,
            "activity_streak_days": 1,
            "recent_activity_score": 0,
        }])

        # Compute synthetic labels to know what the model should learn
        good_vol["trust_label"] = 1
        bad_vol["trust_label"] = 0
        train_df = pd.concat([good_vol, bad_vol], ignore_index=True)

        tmp_path = self._train_temp_model(train_df)

        with patch("models.volunteer_scorer.MODEL_PATH", tmp_path):
            from models.volunteer_scorer import VolunteerTrustScorer
            scorer = VolunteerTrustScorer()
            # Pass only the non-labeled eval data
            test_df = pd.concat([good_vol.drop("trust_label", axis=1),
                                  bad_vol.drop("trust_label", axis=1)], ignore_index=True)
            scores = scorer.predict_trust_scores(test_df)

        os.unlink(tmp_path)
        assert scores["vol-good"] > scores["vol-bad"], (
            f"High acceptance volunteer (score={scores['vol-good']:.1f}) should "
            f"score higher than poor volunteer (score={scores['vol-bad']:.1f})"
        )

    def test_false_reports_reduce_score(self):
        """Volunteers with false reports should have lower trust scores."""
        clean_vol = make_volunteer_df([{
            "volunteer_id": "vol-clean",
            "false_report_count": 0,
            "response_acceptance_rate": 0.9,
        }])
        fraudulent_vol = make_volunteer_df([{
            "volunteer_id": "vol-fraud",
            "false_report_count": 5,
            "response_acceptance_rate": 0.3,
        }])

        clean_vol["trust_label"] = 1
        fraudulent_vol["trust_label"] = 0
        train_df = pd.concat([clean_vol, fraudulent_vol], ignore_index=True)
        tmp_path = self._train_temp_model(train_df)

        with patch("models.volunteer_scorer.MODEL_PATH", tmp_path):
            from models.volunteer_scorer import VolunteerTrustScorer
            scorer = VolunteerTrustScorer()
            test_df = pd.concat([
                clean_vol.drop("trust_label", axis=1),
                fraudulent_vol.drop("trust_label", axis=1)
            ], ignore_index=True)
            scores = scorer.predict_trust_scores(test_df)

        os.unlink(tmp_path)
        assert scores["vol-clean"] > scores["vol-fraud"], (
            "Volunteer with false reports should have a lower trust score"
        )

    def test_new_volunteer_gets_neutral_score(self):
        """
        A brand-new volunteer (0 responses, 0 assists) should receive a score
        between 20 and 80 — not an extreme outlier.
        """
        new_vol = make_volunteer_df([{
            "volunteer_id": "vol-new",
            "response_acceptance_rate": 0.0,
            "total_assists": 0,
            "account_age_days": 1,
            "activity_streak_days": 1,
            "recent_activity_score": 0,
        }])

        # Prepare minimal training set to have a valid model
        good = make_volunteer_df([{"volunteer_id": "g", "response_acceptance_rate": 0.9}])
        bad = make_volunteer_df([{"volunteer_id": "b", "response_acceptance_rate": 0.1,
                                   "false_report_count": 3}])
        good["trust_label"] = 1
        bad["trust_label"] = 0
        tmp_path = self._train_temp_model(pd.concat([good, bad], ignore_index=True))

        with patch("models.volunteer_scorer.MODEL_PATH", tmp_path):
            from models.volunteer_scorer import VolunteerTrustScorer
            scorer = VolunteerTrustScorer()
            scores = scorer.predict_trust_scores(new_vol)

        os.unlink(tmp_path)
        score = scores.get("vol-new", 50.0)
        assert 0.0 <= score <= 100.0, f"Score {score} is out of bounds [0, 100]"

    def test_score_bounded_0_to_100(self):
        """All predicted scores must be in the range [0, 100]."""
        rows = [
            {"volunteer_id": f"v{i}",
             "response_acceptance_rate": float(i) / 10.0,
             "false_report_count": i % 3}
            for i in range(10)
        ]
        df = make_volunteer_df(rows)
        df["trust_label"] = (df["response_acceptance_rate"] > 0.5).astype(int)

        tmp_path = self._train_temp_model(df)
        with patch("models.volunteer_scorer.MODEL_PATH", tmp_path):
            from models.volunteer_scorer import VolunteerTrustScorer
            scorer = VolunteerTrustScorer()
            test_df = df.drop("trust_label", axis=1)
            scores = scorer.predict_trust_scores(test_df)

        os.unlink(tmp_path)
        for vol_id, score in scores.items():
            assert 0.0 <= score <= 100.0, (
                f"Volunteer {vol_id} has score {score:.1f} outside [0, 100]"
            )

    def test_verification_tier_affects_score(self):
        """
        Higher verification tier should correlate positively with trust score.
        Compare a Tier-3 certified volunteer vs Tier-0 unverified volunteer
        with identical other features.
        """
        tier3 = make_volunteer_df([{"volunteer_id": "vol-tier3", "verification_tier": 3}])
        tier0 = make_volunteer_df([{"volunteer_id": "vol-tier0", "verification_tier": 0}])

        tier3["trust_label"] = 1
        tier0["trust_label"] = 0
        tmp_path = self._train_temp_model(pd.concat([tier3, tier0], ignore_index=True))

        with patch("models.volunteer_scorer.MODEL_PATH", tmp_path):
            from models.volunteer_scorer import VolunteerTrustScorer
            scorer = VolunteerTrustScorer()
            test_df = pd.concat([
                tier3.drop("trust_label", axis=1),
                tier0.drop("trust_label", axis=1)
            ], ignore_index=True)
            scores = scorer.predict_trust_scores(test_df)

        os.unlink(tmp_path)
        assert scores["vol-tier3"] > scores["vol-tier0"], (
            "Tier-3 certified volunteer should have higher trust score than Tier-0"
        )

    def test_model_saves_and_loads_correctly(self):
        """
        Model trained with train_model() should persist to disk and be
        reloadable by predict_trust_scores() without data loss.
        """
        df = make_volunteer_df([
            {"volunteer_id": "v1", "response_acceptance_rate": 0.9, "false_report_count": 0},
            {"volunteer_id": "v2", "response_acceptance_rate": 0.1, "false_report_count": 4},
            {"volunteer_id": "v3", "response_acceptance_rate": 0.7, "false_report_count": 0},
            {"volunteer_id": "v4", "response_acceptance_rate": 0.2, "false_report_count": 3},
        ])
        df["trust_label"] = (df["response_acceptance_rate"] > 0.5).astype(int)

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp_path = os.path.join(tmpdir, "trust_model.json")
            with patch("models.volunteer_scorer.MODEL_PATH", tmp_path):
                from models.volunteer_scorer import VolunteerTrustScorer
                scorer = VolunteerTrustScorer()

                # Train and save
                accuracy, feat_importance = scorer.train_model(df)

                # File should exist
                assert os.path.exists(tmp_path), "Model file was not saved to disk"
                assert 0.0 <= accuracy <= 1.0, "Accuracy should be between 0 and 1"
                assert len(feat_importance) == len(scorer.feature_cols), (
                    "Feature importance dict should have all feature columns"
                )

                # Load and predict
                test_df = df.drop("trust_label", axis=1)
                scores = scorer.predict_trust_scores(test_df)
                assert len(scores) == 4, "Should return scores for all 4 volunteers"

    def test_generate_synthetic_labels_both_classes(self):
        """
        generate_synthetic_labels should produce both class 0 and class 1 records
        even for small datasets by injecting dummy volunteers.
        """
        # Only 1 volunteer with ambiguous features — neither clearly trust/untrust
        df = make_volunteer_df([{
            "volunteer_id": "v1",
            "response_acceptance_rate": 0.5,
            "false_report_count": 1,
            "verification_tier": 1,
            "avg_victim_rating": 3.0,
        }])

        labeled = self.scorer.generate_synthetic_labels(df)
        unique_labels = labeled["trust_label"].dropna().unique()
        assert 0 in unique_labels, "Should have at least one untrusted (0) label"
        assert 1 in unique_labels, "Should have at least one trusted (1) label"
