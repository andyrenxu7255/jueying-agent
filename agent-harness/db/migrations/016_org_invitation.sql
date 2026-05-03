CREATE TABLE IF NOT EXISTS org_invitation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organization(id) ON DELETE CASCADE,
  invite_code text NOT NULL UNIQUE,
  invitee text,
  role text NOT NULL CHECK (role IN ('admin', 'user')) DEFAULT 'user',
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')) DEFAULT 'pending',
  invited_by_user_id uuid REFERENCES "user"(id),
  accepted_user_id uuid REFERENCES "user"(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_invitation_org_status ON org_invitation(org_id, status);
CREATE INDEX IF NOT EXISTS idx_org_invitation_expires_at ON org_invitation(expires_at);
