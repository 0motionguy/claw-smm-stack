import crypto from 'crypto';
import { logger } from '../utils/logger';

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || '';
const APP_SECRET = process.env.META_APP_SECRET || '';

export function verifyWebhookChallenge(mode: string, token: string, challenge: string): string | null {
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    logger.info('Webhook verification successful');
    return challenge;
  }
  logger.warn('Webhook verification failed', { mode, token_match: token === VERIFY_TOKEN });
  return null;
}

export function verifySignature(payload: string, signature: string): boolean {
  if (!APP_SECRET || !signature) return false;
  const expectedSig = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(payload).digest('hex');
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}
