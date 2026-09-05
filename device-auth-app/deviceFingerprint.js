import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

const UUID_KEY = 'DEVICE_UUID_KEY';

/**
 * Generate a cryptographically secure random UUID (256 bits).
 * Uses Crypto.getRandomBytesAsync(), NOT Math.random() — Math.random()
 * is predictable (V8's xorshift128+), which matters once this code is
 * public: security must not depend on the algorithm being secret.
 */
async function generateSecureUUID() {
  const randomBytes = await Crypto.getRandomBytesAsync(32);
  return Array.from(randomBytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Get or generate a secure UUID for iOS, stored in Keychain.
 * Persists across app reinstalls (Keychain survives reinstalls on iOS).
 * Android does not need this — Android ID is used directly.
 */
async function getOrCreateUUID() {
  try {
    let uuid = await SecureStore.getItemAsync(UUID_KEY);
    if (uuid) return uuid;
    uuid = await generateSecureUUID();
    await SecureStore.setItemAsync(UUID_KEY, uuid);
    return uuid;
  } catch (error) {
    console.error('Error with UUID:', error);
    return await generateSecureUUID();
  }
}

export async function getDeviceIdentifiers() {
  try {
    const platform = Platform.OS;
    let deviceId;
    if (platform === 'ios') {
      deviceId = await getOrCreateUUID();
    } else {
      deviceId = await Application.getAndroidId();
    }
    const model = Device.modelName || Device.modelId || 'Unknown';
    const brand = Device.brand || 'Unknown';
    return {
      androidId: deviceId || 'unknown-device',
      model: model,
      brand: brand,
      platform: platform
    };
  } catch (error) {
    console.error('Error getting device identifiers:', error);
    throw error;
  }
}

/**
 * Create the client-side device hash (SHA-512).
 * This is one leg of the dual-hash design — the server applies a second,
 * HMAC-keyed hash on top of this before storing (see functions/crypto.js).
 */
export async function createDeviceHash() {
  try {
    const identifiers = await getDeviceIdentifiers();
    const combined = identifiers.androidId + identifiers.model + identifiers.brand;
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA512,
      combined
    );
    return {
      hash: hash,
      platform: identifiers.platform
    };
  } catch (error) {
    console.error('Error creating device hash:', error);
    throw error;
  }
}
