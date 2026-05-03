import { z } from 'zod';

/**
 * Evidence Pack Schema
 * Reference: AH1-20 §20.7
 */

export const EvidencePackSchema = z.object({
  evidence_pack_id: z.string().regex(/^ep_[a-z0-9]+$/),
  query_text: z.string().min(1).max(4000),
  intent_type: z.enum([
    'object-status',
    'evidence',
    'relation',
    'similar-case',
    'dev-context',
    'memory-hint'
  ]),
  scope_summary: z.object({
    user_id: z.string().regex(/^u_[a-z0-9][a-z0-9_-]{0,62}$/),
    allowed_scopes: z.array(z.string())
  }),
  retrieval_steps: z.array(z.object({
    type: z.enum(['structured', 'fulltext', 'vector', 'graph', 'rerank']),
    ref: z.string(),
    candidates_count: z.number().int().optional(),
    duration_ms: z.number().int().optional()
  })),
  items: z.array(z.object({
    item_type: z.enum([
      'document_chunk',
      'memory',
      'fact',
      'entity',
      'relation',
      'artifact_excerpt'
    ]),
    item_ref: z.string(),
    score: z.number().min(0).max(1),
    evidence_ref: z.string(),
    source_scope: z.string()
  })),
  clip_summary: z.string().max(2000),
  evidence_pack_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/)
});

export type EvidencePack = z.infer<typeof EvidencePackSchema>;
