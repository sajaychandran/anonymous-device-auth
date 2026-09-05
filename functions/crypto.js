const crypto = require('crypto');

/**
 * Crypto Module - Security Hardened
 *
 * - FAIL LOUD: no silent fallback for missing secrets
 * - HMAC-SHA512 for device hash (correct keyed-hash primitive)
 * - crypto.randomInt() for recovery codes (cryptographically secure)
 * - crypto.timingSafeEqual() for hash comparisons (prevents timing attacks)
 */

const DEVICE_SECRET = process.env.DEVICE_SECRET;
if (!DEVICE_SECRET) {
  throw new Error(
    '[SECURITY] DEVICE_SECRET environment variable is required but was not found. ' +
    'Set this in your .env file before starting the server.'
  );
}

function finalizeDeviceHash(clientHash) {
  return crypto
    .createHmac('sha512', DEVICE_SECRET)
    .update(clientHash)
    .digest('hex');
}

function generateRecoveryCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += chars.charAt(crypto.randomInt(chars.length));
  }
  return code;
}

function hashRecoveryCode(code) {
  return crypto
    .createHash('sha512')
    .update(code.toUpperCase().trim())
    .digest('hex');
}

function timingSafeCompare(hashA, hashB) {
  try {
    const bufA = Buffer.from(hashA, 'hex');
    const bufB = Buffer.from(hashB, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

module.exports = {
  finalizeDeviceHash,
  generateRecoveryCode,
  hashRecoveryCode,
  timingSafeCompare
};
