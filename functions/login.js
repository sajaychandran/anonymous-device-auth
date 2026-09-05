const functions = require('firebase-functions');
const admin = require('firebase-admin');
const argon2 = require('argon2');
const { logLogin, logLoginFailure } = require('./logsProjectLogger');

/**
 * Login Function - Security Hardened
 *
 * - Argon2 verification (constant-work regardless of input)
 * - Consistent error codes for "user not found" AND "wrong password"
 *   (prevents account enumeration via error code differences)
 * - Device hash is NOT checked here — only at signup. Login works from
 *   any device; only account creation is device-bound.
 */
exports.login = functions.https.onCall(async (request) => {
  const data = request.data;
  const context = request;

  try {
    const { username, password } = data;

    if (!username || !password) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required fields: username, password'
      );
    }

    const db = admin.firestore();
    const userSnapshot = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      await logLoginFailure(username, 'User not found', context);
      throw new functions.https.HttpsError('unauthenticated', 'Invalid username or password');
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    const isValid = await argon2.verify(userData.password_hash, password);

    if (!isValid) {
      await logLoginFailure(username, 'Invalid password', context);
      throw new functions.https.HttpsError('unauthenticated', 'Invalid username or password');
    }

    await userDoc.ref.update({
      last_login: admin.firestore.FieldValue.serverTimestamp()
    });

    await logLogin(username, userData.user_id, userData.platform, context);

    return {
      success: true,
      message: 'Login successful',
      user_id: userData.user_id,
      username: userData.username,
      platform: userData.platform
    };

  } catch (error) {
    console.error('Login error:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Login failed. Please try again.');
  }
});
