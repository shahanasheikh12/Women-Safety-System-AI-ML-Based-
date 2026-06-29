import { Audio } from 'expo-av';
import { Platform, Alert } from 'react-native';

// Native-only: TFLite model — not loaded on web
const YAMNET_ASSET = Platform.OS !== 'web'
  ? require('../assets/models/yamnet.tflite')
  : null;

const loadTensorflowModel: any = Platform.OS !== 'web'
  ? require('react-native-fast-tflite').loadTensorflowModel
  : async () => null;

const { readAsStringAsync, EncodingType } = Platform.OS !== 'web'
  ? require('expo-file-system/legacy')
  : { readAsStringAsync: async () => '', EncodingType: { Base64: 'base64' } };

type TensorflowModel = any;


// Helper to decode Base64 to Uint8Array
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(base64: string): Uint8Array {
  const bufferLength = Math.floor(base64.length * 0.75);
  const len = base64.length;
  let p = 0;
  let encoded1, encoded2, encoded3, encoded4;

  let pad = 0;
  if (base64[base64.length - 1] === '=') {
    pad++;
    if (base64[base64.length - 2] === '=') {
      pad++;
    }
  }

  const arrayBuffer = new ArrayBuffer(bufferLength - pad);
  const bytes = new Uint8Array(arrayBuffer);

  for (let i = 0; i < len; i += 4) {
    encoded1 = CHARS.indexOf(base64[i]);
    encoded2 = CHARS.indexOf(base64[i + 1]);
    encoded3 = CHARS.indexOf(base64[i + 2]);
    encoded4 = CHARS.indexOf(base64[i + 3]);

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bytes.length) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }
    if (p < bytes.length) {
      bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
    }
  }

  return bytes;
}

/**
 * Loads a WAV file, parses its 16-bit PCM samples, and normalizes them to Float32 [-1.0, 1.0].
 * YAMNet expects mono 16kHz audio input (1 second = 16,000 samples).
 */
async function loadWavPcm(uri: string): Promise<Float32Array> {
  const base64 = await readAsStringAsync(uri, { encoding: EncodingType.Base64 });
  const bytes = base64ToBytes(base64);

  // WAV header is 44 bytes
  const dataOffset = 44;
  const dataLen = bytes.length - dataOffset;
  const numSamples = Math.floor(dataLen / 2); // 16-bit PCM = 2 bytes per sample
  const floatData = new Float32Array(numSamples);

  const dataView = new DataView(bytes.buffer, dataOffset);
  for (let i = 0; i < numSamples; i++) {
    if (i * 2 + 1 < dataLen) {
      const intSample = dataView.getInt16(i * 2, true); // little endian
      floatData[i] = intSample / 32768.0;
    }
  }

  // Slice or pad to exactly 16,000 samples (1 second of 16kHz audio)
  const targetSamples = 16000;
  if (floatData.length === targetSamples) {
    return floatData;
  }
  const padded = new Float32Array(targetSamples);
  padded.set(floatData.subarray(0, Math.min(floatData.length, targetSamples)));
  return padded;
}

const RECORDING_OPTIONS = {
  android: {
    extension: '.wav',
    outputFormat: 3, // MPEG_4
    audioEncoder: 3, // AAC
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
  },
  ios: {
    extension: '.wav',
    audioQuality: 0x7f, // LOW
    sampleRate: 16000,
    numberOfChannels: 1,
    bitRate: 128000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {},
};

export class VoiceDistressDetector {
  private static instance: VoiceDistressDetector | null = null;

  public isRunning: boolean = false;
  public detectionThreshold: number = 0.85;
  
  private consecutiveDetections: number = 0;
  private requiredConsecutive: number = 3;
  private model: TensorflowModel | null = null;
  private currentRecording: Audio.Recording | null = null;
  private callback: (() => void) | null = null;

  private constructor() {}

  public static getInstance(): VoiceDistressDetector {
    if (!VoiceDistressDetector.instance) {
      VoiceDistressDetector.instance = new VoiceDistressDetector();
    }
    return VoiceDistressDetector.instance;
  }

  public setCallback(callback: () => void) {
    this.callback = callback;
  }

  public setThreshold(value: number) {
    this.detectionThreshold = value;
    console.log(`[VoiceDistress] Detection threshold set to ${value}`);
  }

  /**
   * Loads the TFLite model and requests recording permissions to start listening.
   */
  public async start() {
    if (this.isRunning || Platform.OS === 'web') return;

    try {
      console.log('[VoiceDistress] Requesting microphone permission...');
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        throw new Error('Microphone permission is required for voice distress detection');
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      console.log('[VoiceDistress] Loading YAMNet TFLite model...');
      this.model = await loadTensorflowModel(YAMNET_ASSET, []);
      console.log('[VoiceDistress] Model loaded successfully');

      this.isRunning = true;
      this.consecutiveDetections = 0;
      this.recordLoop();
    } catch (error: any) {
      console.error('[VoiceDistress] Start failed:', error);
      Alert.alert('AI Listening Error', error.message || 'Failed to start Voice Distress Detection.');
      this.isRunning = false;
    }
  }

  /**
   * Continuous loop recording 1-second audio chunks and passing them to inference.
   */
  private async recordLoop() {
    while (this.isRunning) {
      try {
        const recording = new Audio.Recording();
        this.currentRecording = recording;
        
        await recording.prepareToRecordAsync(RECORDING_OPTIONS);
        await recording.startAsync();
        
        // Wait for 1 second chunk
        await new Promise((resolve) => setTimeout(resolve, 1000));
        
        if (!this.isRunning) {
          await recording.stopAndUnloadAsync();
          break;
        }

        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        
        if (uri) {
          // Process chunk concurrently to avoid blocking the recording interval
          this.processAudioChunk(uri).catch((err) =>
            console.error('[VoiceDistress] Error processing chunk:', err)
          );
        }
      } catch (err) {
        console.error('[VoiceDistress] Loop recording error:', err);
        // Short pause before retrying loop to avoid spamming
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Converts recorded file to Float32 WAV array and runs TFLite inference.
   */
  private async processAudioChunk(audioUri: string) {
    if (!this.model || !this.isRunning) return;

    try {
      const audioData = await loadWavPcm(audioUri);
      
      // Run inference
      // model.run expects an ArrayBuffer[] (from floatData.buffer)
      const outputBuffers = await this.model.run([audioData.buffer as ArrayBuffer]);
      
      if (!outputBuffers || outputBuffers.length === 0) {
        return;
      }

      // Convert output buffer back to float scores
      const scores = new Float32Array(outputBuffers[0]);

      // YAMNet class index definitions:
      // index 14: Screaming
      // index 15: Crying, sobbing
      const screamScore = scores[14] || 0;
      const cryingScore = scores[15] || 0;
      const distressScore = Math.max(screamScore, cryingScore);

      console.log(`[VoiceDistress] Score: ${distressScore.toFixed(3)} (Scream: ${screamScore.toFixed(3)} | Crying: ${cryingScore.toFixed(3)})`);

      if (distressScore >= this.detectionThreshold) {
        this.consecutiveDetections++;
        console.warn(`[VoiceDistress] Consecutive detection count: ${this.consecutiveDetections}/${this.requiredConsecutive}`);
        
        if (this.consecutiveDetections >= this.requiredConsecutive) {
          this.triggerDistressAlert();
        }
      } else {
        this.consecutiveDetections = 0;
      }
    } catch (e) {
      console.error('[VoiceDistress] Inference run error:', e);
    }
  }

  private triggerDistressAlert() {
    console.warn('[VoiceDistress] EMERGENCY THRESHOLD BREACHED! Triggering alert.');
    this.consecutiveDetections = 0;
    if (this.callback) {
      this.callback();
    }
  }

  /**
   * Stops recording loops and unloads Tensorflow model.
   */
  public async stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log('[VoiceDistress] Stopping Voice Distress Detector...');

    try {
      if (this.currentRecording) {
        await this.currentRecording.stopAndUnloadAsync().catch(() => {});
        this.currentRecording = null;
      }
      this.model = null;
      console.log('[VoiceDistress] Stopped successfully.');
    } catch (error) {
      console.error('[VoiceDistress] Error stopping:', error);
    }
  }
}
