const { initializeApp } = require('firebase/app');
const { getFirestore, collection, addDoc, serverTimestamp } = require('firebase/firestore');

/**
 * Separate Logs Project Logger
 *
 * SECURITY MODEL — read this before changing anything here:
 *
 * This intentionally uses the regular Firebase CLIENT SDK, NOT the Admin SDK.
 * The client SDK RESPECTS Firestore security rules; the Admin SDK bypasses them.
 *
 * Rules on the logs project: write-only, structured validation, NO read, NO delete.
 * That means even if this entire Cloud Functions codebase and its main-project
 * credentials are fully compromised, an attacker still cannot read or delete a
 * single log entry — because the logs live in a completely separate Firebase
 * project with its own credentials, and the write path is bound by rules that
 * this compromised code has no way to bypass.
 *
 * Do NOT "simplify" this by switching to Admin SDK for the logs project.
 * Admin SDK bypasses Firestore rules entirely — that would defeat the entire
 * point of isolating the logs in the first place.
 *
 * SETUP: Replace the placeholder config below with your OWN separate Firebase
 * project's web config (Project Settings > General > Your apps > Web app).
 * This config is not a secret — it's meant to be public, same as any Firebase
 * web app config — but it MUST point to a dedicated logs-only project with the
 * security rules from firestore-logs-project.rules applied.
 */

const logsFirebaseConfig = {
  apiKey: "YOUR_LOGS_PROJECT_API_KEY",
  authDomain: "your-logs-project.firebaseapp.com",
  projectId: "your-logs-project",
  storageBucket: "your-logs-project.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const logsApp = initializeApp(logsFirebaseConfig, 'logs-app');
const logsDb = getFirestore(logsApp);

function getClientIP(context) {
  if (context.rawRequest) {
    const forwardedFor = context.rawRequest.headers['x-forwarded-for'];
    if (forwardedFor) return forwardedFor.split(',')[0].trim();
    const realIP = context.rawRequest.headers['x-real-ip'];
    if (realIP) return realIP;
  }
  return context.rawRequest?.ip || 'unknown';
}

function getUserAgent(context) {
  if (context.rawRequest) {
    return context.rawRequest.headers['user-agent'] || 'unknown';
  }
  return 'unknown';
}

async function writeLog(eventType, data, context) {
  try {
    const username = data.username || 'system';
    const logEntry = {
      event_type: eventType,
      username: username,
      user_id: data.user_id || null,
      platform: data.platform || null,
      ip_address: getClientIP(context),
      user_agent: getUserAgent(context),
      success: data.success || false,
      error_message: data.error_message || null,
      device_info: data.device_info || null,
      timestamp: serverTimestamp(),
      metadata: data.metadata || {}
    };
    const logsRef = collection(logsDb, 'logs', username, 'access_logs');
    await addDoc(logsRef, logEntry);
    console.log(`[SECURE_LOG] ${eventType} - ${username} - Written to logs project`);
  } catch (error) {
    // Surfaced for monitoring — never silently swallowed.
    console.error(`[LOG_ERROR] Failed to write ${eventType}:`, error.message);
  }
}

module.exports = {
  logSignup: async (username, userId, platform, deviceInfo, context) => {
    await writeLog('signup_success', { username, user_id: userId, platform, device_info: deviceInfo, success: true }, context);
  },
  logSignupFailure: async (username, platform, reason, context) => {
    await writeLog('signup_failed', { username, platform, success: false, error_message: reason }, context);
  },
  logBlockedSignup: async (username, platform, reason, context) => {
    await writeLog('signup_blocked', { username, platform, success: false, error_message: reason }, context);
  },
  logLogin: async (username, userId, platform, context) => {
    await writeLog('login_success', { username, user_id: userId, platform, success: true }, context);
  },
  logLoginFailure: async (username, reason, context) => {
    await writeLog('login_failed', { username, success: false, error_message: reason }, context);
  },
  logRecoveryAttempt: async (username, success, reason, context) => {
    const eventType = success ? 'password_recovery_success' : 'password_recovery_failed';
    await writeLog(eventType, { username, success, error_message: reason || null }, context);
  }
};
