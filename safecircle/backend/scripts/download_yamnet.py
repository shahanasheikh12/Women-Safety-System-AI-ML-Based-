# ==============================================================================
# SafeCircle — YAMNet Download & TFLite Converter Script
# ==============================================================================
# This script downloads the pre-trained YAMNet model from TensorFlow Hub
# and converts it into a quantized TFLite model for mobile deployment.
# It places the final 'yamnet.tflite' model directly into the assets folder.
#
# Run this script using: python download_yamnet.py
# ==============================================================================

"""
================================================================================
          GOOGLE COLAB FINE-TUNING INSTRUCTIONS FOR VOICE DISTRESS
================================================================================
If you want to achieve higher accuracy detecting screaming/crying distress events
compared to the generic YAMNet classes, follow these steps to fine-tune the model:

1. Open Google Colab (https://colab.research.google.com/) and enable a free GPU
   accelerator (Runtime -> Change runtime type -> T4 GPU).

2. Set up dependencies:
   !pip install tensorflow-gpu tensorflow-hub numpy pandas soundfile

3. Download Google AudioSet subsets (distress sounds):
   - Screaming: Class ID '/m/03qc9zr'
   - Crying/Sobbing: Class ID '/m/07qn4z3'
   - Shouting: Class ID '/m/07p6fkf'
   - Download the corresponding .wav audio files and split them into
     train/val directories (e.g. 80% train, 20% validation).

4. Load YAMNet features & Add transfer learning head in Keras:
   import tensorflow as tf
   import tensorflow_hub as hub

   # Use YAMNet as a feature extractor (trainable=False)
   yamnet_layer = hub.KerasLayer('https://tfhub.dev/google/yamnet/1', trainable=False)

   # Build classification head:
   # Input size: 1024 (YAMNet embeddings dimension)
   model = tf.keras.Sequential([
       tf.keras.layers.Input(shape=(1024,)),
       tf.keras.layers.Dense(64, activation='relu'),
       tf.keras.layers.Dropout(0.2),
       tf.keras.layers.Dense(1, activation='sigmoid') # Binary output: distress vs non-distress
   ])

   model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])

5. Preprocess Audio:
   - Resample wav files to 16kHz mono.
   - Run wav files through YAMNet to extract 1024-dimension embeddings:
     _, embeddings, _ = yamnet_layer(audio_samples)
   - Save these embeddings as X_train, and binary indicators as y_train.

6. Train for 20 epochs on GPU:
   model.fit(X_train, y_train, epochs=20, validation_data=(X_val, y_val))

7. Convert Keras model to TFLite:
   converter = tf.lite.TFLiteConverter.from_keras_model(model)
   converter.optimizations = [tf.lite.Optimize.DEFAULT] # apply quantization
   tflite_model = converter.convert()

   with open('distress_model.tflite', 'wb') as f:
       f.write(tflite_model)

8. Replace the default 'yamnet.tflite' model in SafeCircle mobile assets folder
   with your custom 'distress_model.tflite' and adjust indices in voiceDistress.ts.
================================================================================
"""

import os
import tensorflow as tf
import tensorflow_hub as hub

def main():
    print("[yamnet_setup] Preparing YAMNet download...")
    
    # 1. Directory Setup
    assets_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "mobile", "assets", "models"))
    os.makedirs(assets_dir, exist_ok=True)
    tflite_dest_path = os.path.join(assets_dir, "yamnet.tflite")

    # 2. Download YAMNet from TF Hub
    print("[yamnet_setup] Loading YAMNet model from TF Hub...")
    # This downloads the pre-trained YAMNet model to local cache
    yamnet_hub_url = "https://tfhub.dev/google/yamnet/1"
    
    # We will download and convert to saved model format
    temp_saved_model_dir = os.path.join(os.path.dirname(__file__), "yamnet_saved_model")
    os.makedirs(temp_saved_model_dir, exist_ok=True)
    
    try:
        # Load from Hub and save locally
        yamnet_model = hub.load(yamnet_hub_url)
        tf.saved_model.save(yamnet_model, temp_saved_model_dir)
        print(f"[yamnet_setup] Model downloaded and saved to: {temp_saved_model_dir}")

        # 3. Convert to TFLite for mobile deployment
        print("[yamnet_setup] Converting SavedModel to TFLite...")
        converter = tf.lite.TFLiteConverter.from_saved_model(temp_saved_model_dir)
        
        # Apply standard optimization/quantization to reduce file size to ~3MB (from 15MB)
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        
        tflite_model = converter.convert()

        # 4. Save to assets folder
        with open(tflite_dest_path, "wb") as f:
            f.write(tflite_model)

        print(f"[yamnet_setup] Success! Quantized TFLite model saved to: {tflite_dest_path}")
        print(f"[yamnet_setup] Model Size: {len(tflite_model) / 1024 / 1024:.2f} MB")
        
    except Exception as e:
        print(f"[yamnet_setup] Conversion failed: {e}")
        print("[yamnet_setup] Note: Since YAMNet is loaded directly from TF Hub, ensure you have an active internet connection.")
        
    finally:
        # Cleanup temporary saved model directory
        import shutil
        if os.path.exists(temp_saved_model_dir):
            shutil.rmtree(temp_saved_model_dir)

if __name__ == "__main__":
    main()
