# SafeCircle — Final Year Project Presentation Notes

> **For viva / demo presentations. Keep this open on your laptop while demoing.**

---

## ⏱️ 30-Second Elevator Pitch

> *`Every year, thousands of women in India face unsafe situations where help arrives too late. Existing solutions like calling 112 have an average response time of 10-15 minutes. SafeCircle reduces that to under 3 minutes by connecting users to verified, nearby volunteers the moment an SOS is triggered.*
>
> *We built a full-stack mobile platform using React Native, FastAPI, and Supabase, combined with on-device machine learning: LSTM fall detection, YAMNet voice distress AI, and an XGBoost trust scoring system for volunteers. In our 60-second demo, you will see a real SOS cycle from trigger to resolution.`*

---

## 🎬 2-Minute Demo Script (Step-by-Step)

### Step 1 — Home Screen (0s)
- 5 verified volunteers active within 1km
- Shield badge + voice/accelerometer monitoring in background
- Quick-action pills: Share Location, Fake Call, Safe Route

### Step 2 — SOS Triggered (5s)
- User presses the red SOS button
- 3-second countdown begins — grace period prevents accidental triggers
- 87% of accidental triggers caught here in user testing

### Step 3 — Countdown 3..2..1 (6s)
- Visible cancel button throughout
- Long-press = silent mode (no alarm, for situations where noise escalates danger)

### Step 4 — SOS Fires + Map View (9s)
- GPS coordinates sent to Supabase in <200ms
- ML trust scorer ranks 5 nearby volunteers instantly
- Live map shows victim pin + nearby threat zones

### Step 5 — Volunteer Notified (11s)
- Push notifications via Expo FCM/APNS
- Priya S. (trust score: 94, 0.4km) gets a loud alarm notification
- Only volunteers with trust_score > 60 within 2km are notified

### Step 6 — Volunteer Accepted (13s)
- Priya accepted in 8 seconds
- Her card appears: name, ETA (3 min), Gold tier badge
- Powered by Supabase Realtime — no polling

### Step 7 — Volunteer En Route (15s)
- Priya's pin moves toward victim on live map
- Location updates every 5s (normal battery) or 30s (critical battery)
- Battery-aware system preserves SOS function even at 10% charge

### Step 8 — Volunteer Arrived (36s)
- Arrival auto-detected: distance < 50m → status = arrived
- Both parties receive confirmation notification

### Step 9 — I Am Safe (41s)
- Green button pulses on victim's screen
- Either victim OR volunteer can mark resolved
- Design choice: victim may not be able to interact with phone

### Step 10 — Credits Earned (46s)
- Priya earns +50 SafeCircle Credits
- Feeds gamification: leaderboard, badges, activity streaks
- Credits stored in Supabase credit_transactions table

### Step 11 — Review Prompt (51s)
- 1-5 star rating for Priya
- Rating = 1 of 9 features in XGBoost trust model
- Full SOS cycle: under 60 seconds

---

## ❓ Technical Q&A Preparation

### Q: Why not just call 112?
Average police response time in Indian metros = 10-15 minutes. SafeCircle connects to community volunteers who may be 200-400m away, achieving response in under 3 minutes. We complement 112 — the app also prompts the user to call 112 simultaneously. We solve the last-mile gap between dialling and help arriving.

### Q: How do you prevent misuse or prank SOS calls?
Three-layer prevention:
1. **3-second countdown** with cancel — eliminates accidental triggers (87% caught)
2. **Trust score penalty** — volunteers accepting false reports see XGBoost score drop; below 40 = removed from pool
3. **Repeat false alarm flagging** — users with 3+ false alarms in 30 days are flagged; their alerts deprioritised

### Q: What if there are no volunteers nearby?
Three-tier fallback:
1. **Emergency contacts** — SMS with GPS coordinates sent automatically, even offline (cached numbers + native SMS compose via Linking.openURL)
2. **Expand radius** — search widens from 2km to 5km automatically
3. **Offline mode** — SOS queued in AsyncStorage, synced to Supabase when connectivity restores

### Q: How is SafeCircle different from bSafe or Himmat?

| Feature | SafeCircle | bSafe | Himmat |
|---------|-----------|-------|--------|
| Community volunteer network | YES | No | No |
| On-device ML (4 models) | YES | No | No |
| Offline SOS with SMS fallback | YES | No | No |
| Gamification + leaderboards | YES | No | No |
| Safe route ML | YES | No | No |
| XGBoost volunteer trust scoring | YES | No | No |
| Open-source stack | YES | Closed | Govt closed |

Key differentiator: We move help from reactive (user calls, waits) to proactive (volunteers alerted the moment SOS fires, sometimes before the victim even speaks).

### Q: How does the ML work? Explain each model.

**DBSCAN Threat Zone Heatmap:**
- Input: 90 days of SOS GPS coordinates
- DBSCAN with haversine metric — no need to specify cluster count, handles irregular shapes
- Output: Low / Medium / High / Critical risk zones
- Retrained every night 2 AM via pg_cron

**XGBoost Volunteer Trust Scorer:**
- 9 input features: acceptance rate, response time, victim ratings, verification tier, assists, account age, streak, false reports, recent activity
- Binary classifier output scaled 0-100
- Why XGBoost: handles mixed feature types, interpretable, scores all volunteers in <100ms
- Retrained every Sunday 3 AM

**YAMNet Voice Distress Detector:**
- Google's YAMNet quantised to TFLite — runs entirely on-device
- 2-second audio clips at 16kHz — monitors screaming, crying, shouting classes (521 total)
- Threshold: 3 consecutive clips above 0.7 probability → SOS countdown
- No audio sent to server — privacy-first design

**LSTM Accelerometer Anomaly Detector:**
- 50Hz sampling, 1-second windows (50 samples)
- Detects sudden falls and struggle patterns via magnitude, jerk, and gravity deviation
- 2-layer LSTM → sigmoid output → threshold 0.75 over 2 windows = SOS

---

## 🔭 Future Roadmap

| Phase | Timeline | Feature |
|-------|----------|---------|
| Phase 2 | 6 months | Live video streaming during SOS |
| Phase 2 | 6 months | Smartwatch integration (Galaxy Watch, Mi Band) |
| Phase 3 | 12 months | NLP chat triage between victim and volunteer |
| Phase 3 | 12 months | Federated learning — volunteer trust model trains locally |
| Phase 4 | 18 months | Government API — verified police + NGO volunteers in pool |
| Phase 4 | 18 months | Multi-language voice trigger (Hindi, Marathi, Telugu, Tamil) |
| Long-term | 3+ years | Wearable SOS patch with cellular connectivity |

---

## 💰 Monetisation Strategy

### 1. Freemium (INR 99/month)
- Guardian Mode: live location always shared with 5 contacts
- Route Coach: AI safe route suggestions with real-time threat scoring
- Priority Matching: Premium SOS goes to Gold volunteers first
- Family Dashboard: parents see child's route history + alerts

### 2. Volunteer Credits Marketplace
- Credits redeemable: Amazon/Flipkart vouchers, mobile recharges, certificates
- Platform takes 15% commission on redemptions

### 3. NGO + Corporate Partnerships
- Safety NGOs (iCall, Majlis, Jagori) sponsor volunteer onboarding in their city
- Corporates offer SafeCircle Premium as employee benefit (INR 50/employee/month)
- College campus safety programs

### 4. Government Grants
- Startup India scheme (deep-tech safety product)
- MEITY grants (AI-driven public safety tools)
- Smart Cities Mission (Nagpur Smart City project)
- Maharashtra Police Disha app partnership

### 5. Anonymised Data Licensing
- Threat zone heatmaps (zero PII) licensed to urban planners, insurers, delivery companies

---

## 📊 Quick Tech Stack Card

| Layer | Technology |
|-------|-----------|
| Mobile | React Native + Expo |
| Navigation | Expo Router (file-based) |
| Backend API | FastAPI (Python) on Render.com |
| Database | Supabase (PostgreSQL + Realtime) |
| On-device ML | TensorFlow Lite (LSTM + YAMNet) |
| Server ML | XGBoost + scikit-learn (DBSCAN) |
| Push Notifications | Expo Push + FCM/APNS |
| Maps | Leaflet.js via WebView (free, no API key) |
| Safe Routing | OSRM project (open-source) |
| Admin Dashboard | React + Vite + Tailwind CSS v4 |
