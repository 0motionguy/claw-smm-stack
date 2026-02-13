import crypto from 'crypto';
import { Pool } from 'pg';
import axios from 'axios';
import { logger } from './logger';

/**
 * Meta token management with encryption and refresh
 * Uses AES-256-GCM for token encryption
 */

interface TokenData {
  access_token: string;
  expires_at: Date;
  refresh_token?: string;
}

interface MetaTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export class TokenManager {
  private readonly algorithm = 'aes-256-gcm';
  private readonly encryptionKey: Buffer;

  constructor(private readonly db: Pool) {
    const key = process.env.TOKEN_ENCRYPTION_KEY;
    if (!key) {
      throw new Error('TOKEN_ENCRYPTION_KEY environment variable is required');
    }

    // Ensure key is 32 bytes for AES-256
    this.encryptionKey = crypto
      .createHash('sha256')
      .update(key)
      .digest();
  }

  /**
   * Encrypt token using AES-256-GCM
   */
  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    // Return iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt token using AES-256-GCM
   */
  private decrypt(encryptedText: string): string {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted token format');
    }

    const ivHex = parts[0]!;
    const authTagHex = parts[1]!;
    const encrypted = parts[2]!;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);

    const decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8');

    return decrypted;
  }

  /**
   * Refresh Meta access token
   * @param tenantId - Tenant identifier
   * @returns New access token
   */
  async refreshToken(tenantId: string): Promise<string> {
    logger.info('Refreshing Meta access token', {
      action: 'token_refresh',
      tenant_id: tenantId,
    });

    try {
      // Get current token data
      const result = await this.db.query(
        `SELECT meta_access_token, meta_refresh_token, meta_app_id, meta_app_secret
         FROM tenants
         WHERE id = $1`,
        [tenantId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Tenant ${tenantId} not found`);
      }

      const tenant = result.rows[0];
      const appId = tenant.meta_app_id || process.env.META_APP_ID;
      const appSecret = tenant.meta_app_secret || process.env.META_APP_SECRET;

      if (!appId || !appSecret) {
        throw new Error('Meta app credentials not configured');
      }

      // Call Meta's token exchange endpoint
      // https://graph.facebook.com/v21.0/oauth/access_token
      const response = await axios.get<MetaTokenResponse>(
        'https://graph.facebook.com/v21.0/oauth/access_token',
        {
          params: {
            grant_type: 'fb_exchange_token',
            client_id: appId,
            client_secret: appSecret,
            fb_exchange_token: tenant.meta_access_token
              ? this.decrypt(tenant.meta_access_token)
              : undefined,
          },
          timeout: 10000,
        }
      );

      const newToken = response.data.access_token;
      const expiresIn = response.data.expires_in; // seconds
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      // Encrypt and store new token
      const encryptedToken = this.encrypt(newToken);

      await this.db.query(
        `UPDATE tenants
         SET meta_access_token = $1,
             meta_token_expires_at = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [encryptedToken, expiresAt, tenantId]
      );

      logger.info('Meta access token refreshed successfully', {
        action: 'token_refresh_success',
        tenant_id: tenantId,
        expires_at: expiresAt.toISOString(),
      });

      return newToken;
    } catch (error) {
      logger.error('Failed to refresh Meta access token', {
        action: 'token_refresh_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Get valid access token for tenant
   * Automatically refreshes if expiring within 10 days
   * @param tenantId - Tenant identifier
   * @returns Decrypted access token
   */
  async getToken(tenantId: string): Promise<string> {
    try {
      const result = await this.db.query(
        `SELECT meta_access_token, meta_token_expires_at
         FROM tenants
         WHERE id = $1`,
        [tenantId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Tenant ${tenantId} not found`);
      }

      const tenant = result.rows[0];

      if (!tenant.meta_access_token) {
        throw new Error(`No Meta access token configured for tenant ${tenantId}`);
      }

      const expiresAt = new Date(tenant.meta_token_expires_at);
      const now = new Date();
      const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      // Refresh if expiring within 10 days or already expired
      if (daysUntilExpiry < 10) {
        logger.info('Token expiring soon, refreshing', {
          action: 'token_auto_refresh',
          tenant_id: tenantId,
          days_until_expiry: daysUntilExpiry.toFixed(2),
        });
        return await this.refreshToken(tenantId);
      }

      // Decrypt and return existing token
      return this.decrypt(tenant.meta_access_token);
    } catch (error) {
      logger.error('Failed to get Meta access token', {
        action: 'token_get_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Store new token for tenant (used during initial OAuth flow)
   * @param tenantId - Tenant identifier
   * @param accessToken - Plain text access token
   * @param expiresIn - Token lifetime in seconds
   */
  async storeToken(
    tenantId: string,
    accessToken: string,
    expiresIn: number
  ): Promise<void> {
    try {
      const encryptedToken = this.encrypt(accessToken);
      const expiresAt = new Date(Date.now() + expiresIn * 1000);

      await this.db.query(
        `UPDATE tenants
         SET meta_access_token = $1,
             meta_token_expires_at = $2,
             updated_at = NOW()
         WHERE id = $3`,
        [encryptedToken, expiresAt, tenantId]
      );

      logger.info('Meta access token stored', {
        action: 'token_store',
        tenant_id: tenantId,
        expires_at: expiresAt.toISOString(),
      });
    } catch (error) {
      logger.error('Failed to store Meta access token', {
        action: 'token_store_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Check if token is valid and not expiring soon
   * @param tenantId - Tenant identifier
   * @returns true if token is valid and has >10 days remaining
   */
  async isTokenValid(tenantId: string): Promise<boolean> {
    try {
      const result = await this.db.query(
        `SELECT meta_token_expires_at
         FROM tenants
         WHERE id = $1`,
        [tenantId]
      );

      if (result.rows.length === 0) {
        return false;
      }

      const expiresAt = new Date(result.rows[0].meta_token_expires_at);
      const now = new Date();
      const daysUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);

      return daysUntilExpiry >= 10;
    } catch (error) {
      logger.error('Failed to check token validity', {
        action: 'token_validity_check_error',
        tenant_id: tenantId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
