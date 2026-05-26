DO $$
DECLARE
  v_username text := 'u_feishu_cf6147dc';
  v_user_id uuid;
  v_org_id uuid := '00000000-0000-0000-0000-000000000001';
BEGIN
  SELECT md5('user:' || v_username)::uuid INTO v_user_id;

  INSERT INTO "user" (id, org_id, username, display_name, role, status, metadata)
  VALUES (v_user_id, v_org_id, v_username, '飞书用户', 'user', 'active', '{"source":"feishu_auto","channel":"feishu"}'::jsonb)
  ON CONFLICT (org_id, username) DO UPDATE SET status = 'active', metadata = '{"source":"feishu_auto","channel":"feishu","upgraded":true}'::jsonb;

  UPDATE channel_identity
  SET binding_status = 'bound', user_id = v_user_id
  WHERE channel_type = 'feishu'
    AND external_identity = 'ou_cf6147dcb7c1b28ca629c8532629631e'
    AND binding_status = 'pending';
END $$;

SELECT ci.external_identity, ci.binding_status, u.username, u.display_name
FROM channel_identity ci
LEFT JOIN "user" u ON u.id = ci.user_id
WHERE ci.external_identity = 'ou_cf6147dcb7c1b28ca629c8532629631e';
