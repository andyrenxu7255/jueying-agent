import type { Enforcer } from 'casbin';
import { newEnforcer, newModel } from 'casbin';
import { createHash, randomBytes } from 'crypto';
import { auditWriter } from '@agent-harness/audit';
import { createLogger } from '@agent-harness/shared';

const logger = createLogger('policy-manager');

export interface PolicySnapshotInput {
  user_id: string;
  org_id?: string;
  role: 'user' | 'admin';
  acting_subject?: string;
}

export interface PolicySnapshot {
  id: string;
  user_id: string;
  org_id?: string;
  role: string;
  acting_subject: string;
  allowed_scopes: string[];
  resource_rules: Record<string, string[]>;
  constraints: {
    max_graph_hops: number;
    allow_cross_user_read: boolean;
    allow_public_publish: boolean;
  };
  snapshot_hash: string;
  created_at: string;
}

export interface PolicyRule {
  role: string;
  resource: string;
  action: string;
  org_id?: string;
}

const casbinModel = newModel(`
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act
`);

const DEFAULT_POLICIES: PolicyRule[] = [
  { role: 'guest', resource: 'skill', action: 'read' },
  { role: 'guest', resource: 'knowledge', action: 'read' },
  { role: 'admin', resource: 'workflow_instance', action: 'read' },
  { role: 'admin', resource: 'workflow_instance', action: 'write' },
  { role: 'admin', resource: 'workflow_instance', action: 'execute' },
  { role: 'admin', resource: 'workflow_instance', action: 'delete' },
  { role: 'admin', resource: 'skill', action: 'publish' },
  { role: 'admin', resource: 'user', action: 'cross_read' },
  { role: 'admin', resource: 'organization', action: 'manage' },
  { role: 'admin', resource: 'knowledge', action: 'import' },
  { role: 'admin', resource: 'knowledge', action: 'delete' },
  { role: 'user', resource: 'workflow_instance:own', action: 'read' },
  { role: 'user', resource: 'workflow_instance:own', action: 'write' },
  { role: 'user', resource: 'workflow_instance:own', action: 'execute' },
  { role: 'user', resource: 'skill', action: 'read' },
  { role: 'user', resource: 'skill', action: 'create' },
  { role: 'user', resource: 'knowledge', action: 'read' },
  { role: 'user', resource: 'knowledge', action: 'import' },
];

const DEFAULT_GROUPING_POLICIES: [string, string][] = [
  ['user', 'guest'],
  ['admin', 'user'],
];

let _sharedPgPool: import('pg').Pool | null = null;
let _sharedPgPoolRefs = 0;

async function getSharedPgPool(): Promise<import('pg').Pool | null> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return null;

  if (_sharedPgPool) {
    _sharedPgPoolRefs++;
    return _sharedPgPool;
  }

  try {
    const { Pool } = await import('pg');
    _sharedPgPool = new Pool({
      connectionString: databaseUrl,
      max: 4,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    _sharedPgPoolRefs = 1;
    return _sharedPgPool;
  } catch {
    return null;
  }
}

function releaseSharedPgPool(): void {
  _sharedPgPoolRefs = Math.max(0, _sharedPgPoolRefs - 1);
}

async function shutdownSharedPgPool(): Promise<void> {
  if (_sharedPgPool && _sharedPgPoolRefs <= 0) {
    const pool = _sharedPgPool;
    _sharedPgPool = null;
    await pool.end();
  }
}

export class PolicyManager {
  private enforcer: Enforcer | null = null;
  private orgPolicies = new Map<string, PolicyRule[]>();
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.enforcer = await newEnforcer(casbinModel);
    await this.loadPolicies();
    await this.loadOrgPoliciesFromDb();
    await this.persistDefaultPoliciesToDb();
    this.initialized = true;

    logger.info('policy.initialized', 'Policy manager initialized', {
      default_policies: DEFAULT_POLICIES.length,
      org_policies: this.orgPolicies.size
    });
  }

  private async loadPolicies(): Promise<void> {
    if (!this.enforcer) return;

    for (const policy of DEFAULT_POLICIES) {
      await this.enforcer.addPolicy(policy.role, policy.resource, policy.action);
    }

    for (const [child, parent] of DEFAULT_GROUPING_POLICIES) {
      await this.enforcer.addGroupingPolicy(child, parent);
    }
  }

  private async loadOrgPoliciesFromDb(): Promise<void> {
    const pool = await getSharedPgPool();
    if (!pool) return;

    try {
      const result = await pool.query(
        `SELECT org_id, role, resource, action FROM org_policy WHERE status = 'active' ORDER BY org_id, role`
      );

      for (const row of result.rows) {
        const orgId = row.org_id;
        if (!this.orgPolicies.has(orgId)) {
          this.orgPolicies.set(orgId, []);
        }
        this.orgPolicies.get(orgId)!.push({
          role: row.role,
          resource: row.resource,
          action: row.action,
          org_id: orgId
        });
      }

      logger.info('policy.org.loaded', 'Loaded org-specific policies from DB', {
        org_count: this.orgPolicies.size,
        total_policies: result.rows.length
      });
    } catch (error) {
      logger.warn('policy.org.load_failed', 'Failed to load org policies from DB', {
        error: String(error)
      });
    } finally {
      releaseSharedPgPool();
    }
  }

  private async persistDefaultPoliciesToDb(): Promise<void> {
    const pool = await getSharedPgPool();
    if (!pool) return;

    try {
      const systemOrgId = '00000000-0000-0000-0000-000000000000';

      const existingResult = await pool.query(
        `SELECT COUNT(*) as cnt FROM org_policy WHERE org_id = $1 AND status = 'active'`,
        [systemOrgId]
      );
      const existingCount = Number(existingResult.rows[0]?.cnt || 0);

      if (existingCount >= DEFAULT_POLICIES.length) {
        logger.info('policy.default.already_persisted', 'Default policies already exist in database', {
          existing_count: existingCount
        });
        return;
      }

      let inserted = 0;
      for (const policy of DEFAULT_POLICIES) {
        try {
          await pool.query(
            `INSERT INTO org_policy (org_id, role, resource, action, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'active', now(), now())
             ON CONFLICT (org_id, role, resource, action) DO NOTHING`,
            [systemOrgId, policy.role, policy.resource, policy.action]
          );
          inserted++;
        } catch (insertError) {
          logger.warn('policy.default.insert_failed', 'Failed to insert default policy', {
            role: policy.role, resource: policy.resource, action: policy.action, error: String(insertError)
          });
        }
      }

      for (const [child, parent] of DEFAULT_GROUPING_POLICIES) {
        try {
          await pool.query(
            `INSERT INTO org_policy (org_id, role, resource, action, status, created_at, updated_at)
             VALUES ($1, $2, $3, $4, 'active', now(), now())
             ON CONFLICT (org_id, role, resource, action) DO NOTHING`,
            [systemOrgId, child, 'role_grouping', `inherits:${parent}`]
          );
        } catch { /* ignore */ }
      }

      logger.info('policy.default.persisted', 'Default policies persisted to database', {
        inserted_count: inserted,
        total_count: DEFAULT_POLICIES.length
      });
    } catch (error) {
      logger.warn('policy.default.persist_failed', 'Failed to persist default policies to database', {
        error: String(error)
      });
    } finally {
      releaseSharedPgPool();
    }
  }

  async checkPermission(
    userId: string,
    role: string,
    resource: string,
    action: string,
    orgId?: string
  ): Promise<boolean> {
    if (!this.enforcer) {
      await this.initialize();
    }

    if (!this.enforcer) {
      void auditWriter.write({
        user_id: userId,
        org_id: orgId,
        action: 'policy.denied',
        resource_type: resource,
        resource_ref: `${resource}:${action}`,
        resource_scope: 'system',
        result: 'failure',
        detail_json: { role, resource, action, reason: 'policy_enforcer_unavailable' }
      });
      return false;
    }

    const allowed = await this.enforcer.enforce(role, resource, action);

    if (allowed && orgId) {
      const orgPolicies = this.orgPolicies.get(orgId);
      if (orgPolicies) {
        const orgDeny = orgPolicies.find(
          p => p.role === role && p.resource === resource && p.action === `!${action}`
        );
        if (orgDeny) {
          void auditWriter.write({
            user_id: userId,
            org_id: orgId,
            action: 'policy.org.denied',
            resource_type: resource,
            resource_ref: `${resource}:${action}`,
            resource_scope: `org:${orgId}`,
            result: 'failure',
            detail_json: { role, resource, action, reason: 'org_policy_deny' }
          });
          return false;
        }
      }
    }

    if (!allowed) {
      void auditWriter.write({
        user_id: userId,
        org_id: orgId,
        action: 'policy.denied',
        resource_type: resource,
        resource_ref: `${resource}:${action}`,
        resource_scope: `private:${userId}`,
        result: 'failure',
        detail_json: { role, resource, action, reason: 'permission_denied' }
      });
    } else {
      const auditAllowedEnv = process.env.POLICY_AUDIT_ALLOWED || 'admin';
      if (auditAllowedEnv !== 'off') {
        if (auditAllowedEnv === 'all' || role === 'admin') {
          void auditWriter.write({
            user_id: userId,
            org_id: orgId,
            action: 'policy.allowed',
            resource_type: resource,
            resource_ref: `${resource}:${action}`,
            resource_scope: orgId ? `org:${orgId}` : `private:${userId}`,
            result: 'success',
            detail_json: { role, resource, action }
          });
        }
      }
    }

    return allowed;
  }

  generateSnapshot(input: PolicySnapshotInput): PolicySnapshot {
    const { user_id, org_id, role, acting_subject = 'system:workflow' } = input;

    const allowedScopes: string[] = [
      `private:${user_id}`,
      'public:workflow',
      'public:skill'
    ];

    if (role === 'admin') {
      allowedScopes.push('admin:*');
    }

    if (org_id) {
      allowedScopes.push(`org:${org_id}`);
    }

    const resourceRules: Record<string, string[]> = {
      workflow_instance: role === 'admin' ? ['read', 'write', 'update', 'execute', 'archive'] : ['read', 'write', 'execute'],
      skill: role === 'admin' ? ['read', 'write', 'publish'] : ['read'],
      fact: role === 'admin' ? ['read', 'write'] : ['read'],
      knowledge: role === 'admin' ? ['read', 'write', 'import', 'delete'] : ['read', 'import']
    };

    const constraints = {
      max_graph_hops: 2,
      allow_cross_user_read: role === 'admin',
      allow_public_publish: role === 'admin'
    };

    const snapshot: PolicySnapshot = {
      id: `ps_${Date.now()}_${randomBytes(8).toString('hex')}`,
      user_id,
      org_id,
      role,
      acting_subject,
      allowed_scopes: allowedScopes,
      resource_rules: resourceRules,
      constraints,
      snapshot_hash: '',
      created_at: new Date().toISOString()
    };

    snapshot.snapshot_hash = this.calculateSnapshotHash(snapshot);

    void auditWriter.write({
      user_id: snapshot.user_id,
      org_id: snapshot.org_id,
      action: 'policy.snapshot.create',
      resource_type: 'policy_snapshot',
      resource_ref: snapshot.snapshot_hash,
      resource_scope: `private:${snapshot.user_id}`,
      result: 'success',
      detail_json: {
        role: snapshot.role,
        org_id: snapshot.org_id,
        acting_subject: snapshot.acting_subject,
        allowed_scopes_count: snapshot.allowed_scopes.length
      }
    });

    return snapshot;
  }

  async addOrgPolicy(orgId: string, role: string, resource: string, action: string): Promise<boolean> {
    if (!this.orgPolicies.has(orgId)) {
      this.orgPolicies.set(orgId, []);
    }

    const existing = this.orgPolicies.get(orgId)!.find(
      p => p.role === role && p.resource === resource && p.action === action
    );
    if (existing) return false;

    const policy: PolicyRule = { role, resource, action, org_id: orgId };
    this.orgPolicies.get(orgId)!.push(policy);

    await this.persistOrgPolicyToDb(orgId, role, resource, action);

    logger.info('policy.org.added', 'Added org policy', { org_id: orgId, role, resource, action });
    return true;
  }

  async removeOrgPolicy(orgId: string, role: string, resource: string, action: string): Promise<boolean> {
    const policies = this.orgPolicies.get(orgId);
    if (!policies) return false;

    const idx = policies.findIndex(
      p => p.role === role && p.resource === resource && p.action === action
    );
    if (idx === -1) return false;

    policies.splice(idx, 1);
    if (policies.length === 0) {
      this.orgPolicies.delete(orgId);
    }

    await this.deleteOrgPolicyFromDb(orgId, role, resource, action);

    logger.info('policy.org.removed', 'Removed org policy', { org_id: orgId, role, resource, action });
    return true;
  }

  getOrgPolicies(orgId: string): PolicyRule[] {
    return this.orgPolicies.get(orgId) || [];
  }

  getAllOrgIds(): string[] {
    return Array.from(this.orgPolicies.keys());
  }

  private async persistOrgPolicyToDb(orgId: string, role: string, resource: string, action: string): Promise<void> {
    const pool = await getSharedPgPool();
    if (!pool) return;

    try {
      await pool.query(
        `INSERT INTO org_policy (org_id, role, resource, action, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', now(), now())
         ON CONFLICT (org_id, role, resource, action)
         DO UPDATE SET status = 'active', updated_at = now()`,
        [orgId, role, resource, action]
      );
    } catch (error) {
      logger.warn('policy.org.insert_failed', 'Failed to persist org policy', {
        org_id: orgId, role, resource, action, error: String(error)
      });
    } finally {
      releaseSharedPgPool();
    }
  }

  private async deleteOrgPolicyFromDb(orgId: string, role: string, resource: string, action: string): Promise<void> {
    const pool = await getSharedPgPool();
    if (!pool) return;

    try {
      await pool.query(
        `UPDATE org_policy SET status = 'deleted', updated_at = now()
         WHERE org_id = $1 AND role = $2 AND resource = $3 AND action = $4`,
        [orgId, role, resource, action]
      );
    } catch (error) {
      logger.warn('policy.org.delete_failed', 'Failed to soft-delete org policy', {
        org_id: orgId, role, resource, action, error: String(error)
      });
    } finally {
      releaseSharedPgPool();
    }
  }

  private calculateSnapshotHash(snapshot: Omit<PolicySnapshot, 'snapshot_hash'>): string {
    const data = JSON.stringify({
      user_id: snapshot.user_id,
      org_id: snapshot.org_id,
      role: snapshot.role,
      acting_subject: snapshot.acting_subject,
      allowed_scopes: snapshot.allowed_scopes.sort(),
      resource_rules: snapshot.resource_rules,
      constraints: snapshot.constraints
    });

    return `sha256:${createHash('sha256').update(data).digest('hex')}`;
  }

  validateSnapshotHash(snapshot: PolicySnapshot): boolean {
    const { snapshot_hash, ...data } = snapshot;
    const expectedHash = this.calculateSnapshotHash(data);
    return snapshot_hash === expectedHash;
  }

  async shutdown(): Promise<void> {
    await shutdownSharedPgPool();
  }
}

export const policyManager = new PolicyManager();
