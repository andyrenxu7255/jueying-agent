import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { auditWriter } from '@agent-harness/audit';

export type IdentityBindingState = 'bound' | 'pending' | 'conflicted'
export type BindingAction = 'continue' | 'binding_required' | 'admin_resolution_required'

export interface IdentityResolutionResult {
  user_id: string | null
  org_id: string | null
  identity_binding_state: IdentityBindingState
  binding_action: BindingAction
}

export class IdentityResolver {
  private dbPool: Pool | null = null;

  private generateUserId(): string {
    return randomUUID();
  }

  private async getDbPool(): Promise<Pool | null> {
    if (!this.dbPool) {
      const { Pool } = await import('pg');
      const { configManager, getDatabaseSslConfig } = await import('@agent-harness/shared');
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) return null;
      this.dbPool = new Pool({
        connectionString: databaseUrl,
        max: 5,
        ssl: getDatabaseSslConfig(configManager.get())
      });
    }
    return this.dbPool;
  }

  private async ensurePendingIdentityUser(pool: Pool): Promise<string> {
    const username = 'u_pending_identity';
    const existing = await pool.query<{ id: string }>(
      `SELECT id FROM "user" WHERE username = $1 LIMIT 1`,
      [username]
    );

    if (existing.rows[0]?.id) {
      return existing.rows[0].id;
    }

    const userId = this.generateUserId();
    const orgId = this.generateUserId();

    await pool.query(
      `INSERT INTO "user" (id, org_id, username, display_name, role, status, metadata)
       VALUES ($1, $2, $3, $4, 'user', 'active', '{"system_placeholder":true}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [userId, orgId, username, 'Pending Identity Placeholder']
    );

    return userId;
  }

  private async ensurePendingBinding(pool: Pool, channelType: string, channelIdentity: string): Promise<void> {
    const placeholderUserId = await this.ensurePendingIdentityUser(pool);
    await pool.query(
      `INSERT INTO channel_identity (user_id, channel_type, external_identity, binding_status, metadata)
       VALUES ($1, $2, $3, 'pending', '{"source":"auto_capture"}'::jsonb)
       ON CONFLICT (channel_type, external_identity) DO NOTHING`,
      [placeholderUserId, channelType, channelIdentity]
    );

    void auditWriter.write({
      user_id: 'system',
      action: 'identity.pending_created',
      resource_type: 'channel_identity',
      resource_ref: `${channelType}:${channelIdentity}`,
      resource_scope: 'system',
      result: 'success',
      detail_json: {
        channel_type: channelType,
        binding_status: 'pending'
      }
    });
  }

  async resolve(channelIdentity: string, channelType: string = 'feishu'): Promise<IdentityResolutionResult> {
    if (!channelIdentity || channelIdentity === 'unknown') {
      return {
        user_id: null,
        org_id: null,
        identity_binding_state: 'pending',
        binding_action: 'binding_required'
      }
    }

    try {
      const pool = await this.getDbPool();
      if (!pool) {
        return {
          user_id: null,
          org_id: null,
          identity_binding_state: 'pending',
          binding_action: 'binding_required'
        }
      }

      const bindingResult = await pool.query(
        `SELECT user_id, binding_status FROM channel_identity WHERE channel_type = $1 AND external_identity = $2 LIMIT 1`,
        [channelType, channelIdentity]
      );

      if (bindingResult.rows.length === 0) {
        const newUser = await this.createUserForChannel(pool, channelType, channelIdentity);
        return {
          user_id: newUser.username,
          org_id: newUser.org_id,
          identity_binding_state: 'bound',
          binding_action: 'continue'
        }
      }

      const binding = bindingResult.rows[0];

      if (binding.binding_status === 'bound') {
        const userResult = await pool.query(
          `SELECT u.id, u.username, u.status, u.org_id FROM "user" u WHERE u.id = $1 LIMIT 1`,
          [binding.user_id]
        );

        if (userResult.rows.length > 0 && userResult.rows[0].status === 'active') {
          const resolvedUserId = userResult.rows[0].username || binding.user_id;
          const resolvedOrgId = userResult.rows[0].org_id || null;
          void auditWriter.write({
            user_id: resolvedUserId,
            action: 'identity.bind',
            resource_type: 'channel_identity',
            resource_ref: `${channelType}:${channelIdentity}`,
            resource_scope: `private:${resolvedUserId}`,
            result: 'success',
            detail_json: {
              channel_type: channelType,
              binding_status: 'bound',
              resolved_user_id: resolvedUserId,
              resolved_org_id: resolvedOrgId
            }
          });
          return {
            user_id: resolvedUserId,
            org_id: resolvedOrgId,
            identity_binding_state: 'bound',
            binding_action: 'continue'
          }
        }

        return {
          user_id: null,
          org_id: null,
          identity_binding_state: 'pending',
          binding_action: 'binding_required'
        }
      }

      if (binding.binding_status === 'conflicted') {
        void auditWriter.write({
          user_id: 'system',
          action: 'identity.conflict',
          resource_type: 'channel_identity',
          resource_ref: `${channelType}:${channelIdentity}`,
          resource_scope: 'system',
          result: 'failure',
          detail_json: {
            channel_type: channelType,
            binding_status: 'conflicted',
            db_user_id: binding.user_id
          }
        });
        return {
          user_id: null,
          org_id: null,
          identity_binding_state: 'conflicted',
          binding_action: 'admin_resolution_required'
        }
      }

      if (binding.binding_status === 'pending') {
        const newUser = await this.createUserForChannel(pool, channelType, channelIdentity);
        return {
          user_id: newUser.username,
          org_id: newUser.org_id,
          identity_binding_state: 'bound',
          binding_action: 'continue'
        }
      }

      return {
        user_id: null,
        org_id: null,
        identity_binding_state: 'pending',
        binding_action: 'binding_required'
      }
    } catch (error) {
      return {
        user_id: null,
        org_id: null,
        identity_binding_state: 'pending',
        binding_action: 'binding_required'
      }
    }
  }

  private async createUserForChannel(pool: Pool, channelType: string, channelIdentity: string): Promise<{ id: string; username: string; org_id: string }> {
    const suffix = createHash('sha256').update(`${channelType}:${channelIdentity}`).digest('hex').slice(0, 8);
    const channelLabel = channelType === 'feishu' ? '飞书' : channelType === 'wecom' ? '企微' : channelType;
    const username = `u_${channelType}_${suffix}`;
    const userId = this.generateUserId();
    const orgId = this.generateUserId();
    const displayName = `${channelLabel}用户 ${suffix}`;

    await pool.query(
      `INSERT INTO "user" (id, org_id, username, display_name, role, status, metadata)
       VALUES ($1, $2, $3, $4, 'user', 'active', $5::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [userId, orgId, username, displayName, JSON.stringify({ source: `${channelType}_auto`, channel: channelType })]
    );

    await pool.query(
      `INSERT INTO channel_identity (user_id, channel_type, external_identity, binding_status, metadata)
       VALUES ($1, $2, $3, 'bound', '{"source":"auto_bind"}'::jsonb)
       ON CONFLICT (channel_type, external_identity) DO UPDATE SET binding_status = 'bound', user_id = $1`,
      [userId, channelType, channelIdentity]
    );

    void auditWriter.write({
      user_id: username,
      action: 'identity.auto_bound',
      resource_type: 'channel_identity',
      resource_ref: `${channelType}:${channelIdentity}`,
      resource_scope: 'system',
      result: 'success',
      detail_json: {
        channel_type: channelType,
        username,
        auto_created: true
      }
    });

    return { id: userId, username, org_id: orgId };
  }
}

export const identityResolver = new IdentityResolver()
