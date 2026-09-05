const functions = require('firebase-functions');
const admin = require('firebase-admin');
const argon2 = require('argon2');
const {
  generateRecoveryCode,
  hashRecoveryCode,
  timingSafeCompare
} = require('./crypto');
const { logRecoveryAttempt } = require('./logsProjectLogger');

/**
 * Password Recovery Function - Security Hardened
 *
 * - timingSafeCompare() for recovery code comparison (prevents timing attacks)
 * - crypto.randomInt() for new recovery code (not Math.random())
 * - Consistent error codes (prevents account enumeration)
 * - Recovery code is single-use — a new one is issued on every successful reset
 */
exports.recoverPassword = functions.https.onCall(async (request) => {
  const data = request.data;
  const context = request;

  try {
    const { username, recovery_code, new_password } = data;

    if (!username || !recovery_code || !new_password) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Missing required fields: username, recovery_code, new_password'
      );
    }

    const db = admin.firestore();
    const userSnapshot = await db.collection('users')
      .where('username', '==', username)
      .limit(1)
      .get();

    if (userSnapshot.empty) {
      await logRecoveryAttempt(username, false, 'User not found', context);
      throw new functions.https.HttpsError('unauthenticated', 'Invalid username or recovery code');
    }

    const userDoc = userSnapshot.docs[0];
    const userData = userDoc.data();

    const providedCodeHash = hashRecoveryCode(recovery_code);
    const isValid = timingSafeCompare(providedCodeHash, userData.recovery_code_hash);

    if (!isValid) {
      await logRecoveryAttempt(username, false, 'Invalid recovery code', context);
      throw new functions.https.HttpsError('unauthenticated', 'Invalid username or recovery code');
    }

    const final_password_hash = await argon2.hash(new_password);
    const newRecoveryCode = generateRecoveryCode();
    const newRecoveryCodeHash = hashRecoveryCode(newRecoveryCode);

    await userDoc.ref.update({
      password_hash: final_password_hash,
      recovery_code_hash: newRecoveryCodeHash,
      last_password_reset: admin.firestore.FieldValue.serverTimestamp()
    });

    await logRecoveryAttempt(username, true, null, context);

    return {
      success: true,
      message: 'Password reset successful',
      new_recovery_code: newRecoveryCode,  // shown once — never stored as plaintext
      user_id: userData.user_id
    };

  } catch (error) {
    console.error('Recovery error:', error);
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', 'Password recovery failed. Please try again.');
  }
});
