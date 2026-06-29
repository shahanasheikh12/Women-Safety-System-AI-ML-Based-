# ==============================================================================
# SafeCircle — LSTM Accelerometer Anomaly Detection Model Training
# ==============================================================================
# This script defines a Keras LSTM model architecture to detect fall/struggle
# anomalies on 50Hz accelerometer sequences, quantizes and converts the model
# into a mobile-ready TFLite file, saving it directly to mobile assets.
#
# Run this script using: python train_lstm_model.py
# ==============================================================================

"""
================================================================================
           GOOGLE COLAB TRAINING INSTRUCTIONS FOR LSTM ACCELEROMETER
================================================================================
For high accuracy fall/struggle detection, train on GPU-accelerated Colab:

1. Open Google Colab (https://colab.research.google.com/) and enable T4 GPU.

2. Datasets to download (freely available for research):
   - WISDM Activity Recognition Dataset:
     URL: https://www.cis.fordham.edu/wisdm/dataset.php
     Contains daily activities (walking, jogging, stairs, sitting, standing).
   - SisFall Fall Detection Dataset:
     URL: http://sisfall.org/
     Contains various falls (slip, trip, fainting) and ADLs (activities of daily living).

3. Setup Dependencies:
   !pip install tensorflow numpy pandas scikit-learn

4. Preprocessing:
   - Resample both datasets to 50Hz.
   - Slice continuous accelerometer readings into sliding windows of 50 samples
     (1 second at 50Hz) with 50% overlap (25 samples).
   - Each window is an array of shape (50, 3) (x, y, z axes).
   - Label ADL sequences as 0 (normal) and Fall/Struggle sequences as 1 (anomaly).
   - Split into X_train, y_train, X_val, y_val.

5. Model Architecture:
   import tensorflow as tf

   model = tf.keras.Sequential([
       tf.keras.layers.LSTM(64, input_shape=(50, 3), return_sequences=True),
       tf.keras.layers.Dropout(0.3),
       tf.keras.layers.LSTM(32),
       tf.keras.layers.Dense(16, activation='relu'),
       tf.keras.layers.Dense(1, activation='sigmoid') # output: Anomaly score [0, 1]
   ])

   model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])

6. Train model:
   model.fit(X_train, y_train, epochs=30, batch_size=32, validation_data=(X_val, y_val))

7. Quantize and convert to TFLite:
   converter = tf.lite.TFLiteConverter.from_keras_model(model)
   converter.optimizations = [tf.lite.Optimize.DEFAULT] # quantizes weights to 8-bit ints
   tflite_model = converter.convert()

   with open('anomaly_lstm.tflite', 'wb') as f:
       f.write(tflite_model)
================================================================================
"""

import os
import numpy as np
import tensorflow as tf

def main():
    print("[lstm_train] Generating dummy dataset for initial compilation...")
    # Generate mock data representing 50Hz (50 samples x 3 axes) for compilation
    # 500 samples of normal (0) and fall anomalies (1)
    num_samples = 500
    window_size = 50
    num_features = 3 # x, y, z

    X_normal = np.random.normal(loc=0.0, scale=0.2, size=(num_samples // 2, window_size, num_features))
    # Falls have high initial acceleration spike followed by zero gravity/impact anomalies
    X_fall = np.random.normal(loc=1.5, scale=1.0, size=(num_samples // 2, window_size, num_features))

    X = np.concatenate([X_normal, X_fall], axis=0).astype(np.float32)
    y = np.concatenate([np.zeros(num_samples // 2), np.ones(num_samples // 2)], axis=0).astype(np.float32)

    # Shuffle dataset
    indices = np.random.permutation(num_samples)
    X, y = X[indices], y[indices]

    print("[lstm_train] Building LSTM model architecture...")
    model = tf.keras.Sequential([
        tf.keras.layers.LSTM(64, input_shape=(window_size, num_features), return_sequences=True),
        tf.keras.layers.Dropout(0.3),
        tf.keras.layers.LSTM(32),
        tf.keras.layers.Dense(16, activation='relu'),
        tf.keras.layers.Dense(1, activation='sigmoid')
    ])

    model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
    
    print("[lstm_train] Fitting model on mock dataset...")
    model.fit(X, y, epochs=2, batch_size=32, verbose=1)

    # Convert to TFLite
    print("[lstm_train] Converting model to quantized TFLite...")
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    
    # Enable TF Select ops just in case for LSTM compatibilities
    converter.target_spec.supported_ops = [
        tf.lite.OpsSet.TFLITE_BUILTINS, # enable TensorFlow Lite ops
        tf.lite.OpsSet.SELECT_TF_OPS     # enable TensorFlow ops
    ]
    
    tflite_model = converter.convert()

    # Save to mobile assets directory
    assets_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "mobile", "assets", "models"))
    os.makedirs(assets_dir, exist_ok=True)
    tflite_path = os.path.join(assets_dir, "anomaly_lstm.tflite")

    with open(tflite_path, 'wb') as f:
        f.write(tflite_model)

    print(f"[lstm_train] quantized LSTM model saved successfully to: {tflite_path}")
    print(f"[lstm_train] Size: {len(tflite_model) / 1024:.2f} KB")

if __name__ == "__main__":
    main()
