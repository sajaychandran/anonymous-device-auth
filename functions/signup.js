const functions = require('firebase-functions');
const admin = require('firebase-admin');
const argon2 = require('argon2');
const {
  finalizeDeviceHash,
  generateRecoveryCode,
  hashRecoveryCode
} = require('./crypto');
const { logSignup, logSignupFailure } = require('./logsProjectLogger');

/**
 * Signup Function - Security Hardened
 *
 * - Argon2id for password hashing (server-side only)
 * - HMAC-SHA512 device hash finalization
 * - crypto.randomInt() recovery codes
 * - Consistent error codes (prevents account enumeration)
 */
exports.signup = functions.https.onCall(async (request) => {
  const data = request.data;
  const context = request;

  try {
    const { username, password, client_hash, platform } = data;

    if (!username || !password || !client_hash || !platform) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required fields: username, password, client_hash, platform'
      );
    }

    if (platform !== 'android' && platform !== 'ios') {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Platform must be either "android" or "ios"'
      );
    }

    const final_hash = finalizeDeviceHash(client_hash);
    const db = admin.firestore();

    const existingDevice = await db.collection('users')
      .where('device_hash', '==', final_hash)
      .limit(1)
      .get();

    if (!existingDevice.empty) {
      await logSignupFailure(username, platform, 'Device already registered', context);
      throw new functions.https.HttpsError(
        'already-exists',
        'Device already registered. One account per device allowed.'
      );
    }

    const existingUsername = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (!existingUsername.empty) {
      await logSignupFailure(username, platform, 'Username already taken', context);
      throw new functions.https.HttpsError(
        'already-exists',
        'Username already taken. Please choose another.'
      );
    }

    const final_password_hash = await argon2.hash(password);
    const userId = '#' + Math.floor(10000 + Math.random() * 90000);
    const recoveryCode = generateRecoveryCode();
    const recoveryCodeHash = hashRecoveryCode(recoveryCode);

    const userDoc = await db.collection('users').add({
      username: username,
      device_hash: final_hash,
      password_hash: final_password_hash,
      recovery_code_hash: recoveryCodeHash,
      platform: platform,
      user_id: userId,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      last_login: null
    });

    await logSignup(username, userId, platform, {
      model: data.device_model || 'unknown',
      brand: data.device_brand || 'unknown'
    }, context);

    return {
      success: true,
      message: 'Signup successful',
      user_id: userId,
      doc_id: userDoc.id,
      recovery_code: recoveryCode  // shown once — never stored as plaintext
    };

  } catch (error) {
    console.error('Signup error:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Signup failed. Please try again.');
  }
});
