import {
  buildEvidenceHash,
  buildInsightText,
  buildMissionDraft,
  buildMissionType,
  clampNumber,
  dedupeEvidenceRefs,
  inferInsightType,
  parseJsonRecord,
  proactiveRuleInputSchema,
  scoreInsight,
  safeArray,
  safeRecord,
  type RuleSnapshot,
  type SignalSnapshot,
} from './domain';

describe('proactive domain helpers', () => {
  const baseRule: RuleSnapshot = {
    id: 'rule-1',
    org_id: '00000000-0000-0000-0000-000000000001',
    created_by: '550e8400-e29b-41d4-a716-446655440000',
    rule_name: '主动运营巡检',
    description: 'demo',
    status: 'active',
    schedule_expression: '0 8 * * *',
    trigger_source: 'hybrid',
    target_scope: 'org',
    approval_mode: 'review_first',
    scan_window_hours: 72,
    priority: 90,
    evidence_policy: {},
    routing_policy: {},
    metadata: {},
    created_at: '2026-05-23T00:00:00Z',
    updated_at: '2026-05-23T00:00:00Z',
  };

  const emptySignals: SignalSnapshot = {
    documents: [],
    facts: [],
    memories: [],
    skills: [],
    tasks: [],
    assignments: [],
    retrieval_items: [],
    memory_summary: [],
  };

  it('parses rule input with defaults', () => {
    const result = proactiveRuleInputSchema.parse({
      created_by: '550e8400-e29b-41d4-a716-446655440000',
      rule_name: 'MEDDIC follow-up',
      schedule_expression: '0 8 * * *',
    });

    expect(result.status).toBe('active');
    expect(result.approval_mode).toBe('review_first');
    expect(result.priority).toBe(50);
  });

  it('infers insight types from text', () => {
    expect(inferInsightType('check clawhub version change')).toBe('skill_upgrade');
    expect(inferInsightType('customer follow up champion')).toBe('customer_followup');
    expect(inferInsightType('fact gap missing evidence')).toBe('fact_gap');
    expect(inferInsightType('process blocked pending review')).toBe('process_issue');
    expect(inferInsightType('quiet scan summary')).toBe('other');
  });

  it('builds evidence hashes deterministically', () => {
    const refs = [{ source_type: 'document', ref_id: 'a', title: 'A', summary: 'hello' }];
    expect(buildEvidenceHash(refs)).toBe(buildEvidenceHash(refs));
  });

  it('builds missions from insight and rule context', () => {
    const rule = { ...baseRule, rule_name: 'MEDDIC 销售复盘', routing_policy: { default_mission_type: 'user_task' } };
    const insights = buildInsightText(rule, {
      ...emptySignals,
      documents: [{ id: 'doc-1', title: 'MEDDIC销售六步法', content_text: 'Champion and pipeline' }],
      skills: [{ id: 'skill-1', skill_name: 'Customer Research', description: 'research' }],
      assignments: [{ id: 'as-1', status: 'pending', title: 'Task' }],
    });
    expect(insights.length).toBeGreaterThan(0);

    const mission = buildMissionDraft(rule, insights[0], 'user', '550e8400-e29b-41d4-a716-446655440001');
    expect(mission.mission_title).toContain('MEDDIC');
    expect(mission.mission_type).toBe('user_task');

    const adminMission = buildMissionDraft(
      { ...baseRule, priority: 999 },
      { ...insights[0], insight_type: 'process_issue' },
      'admin',
      '550e8400-e29b-41d4-a716-446655440002'
    );
    expect(adminMission.mission_title).toContain('管理员复核');
    expect(adminMission.mission_type).toBe('admin_review');
    expect(adminMission.priority).toBe(100);
  });

  it('parses json records safely', () => {
    expect(parseJsonRecord('not-json')).toEqual({});
    expect(parseJsonRecord('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonRecord({ a: 1 })).toEqual({ a: 1 });
    expect(parseJsonRecord('[1,2,3]')).toEqual({});
    expect(parseJsonRecord(42)).toEqual({});
  });

  it('maps mission types without crossing existing org_task constraints', () => {
    expect(buildMissionType('skill_upgrade', {})).toBe('skill_upgrade');
    expect(buildMissionType('fact_gap', {})).toBe('fact_collection');
    expect(buildMissionType('process_issue', {})).toBe('admin_review');
    expect(buildMissionType('customer_followup', {})).toBe('user_task');
    expect(buildMissionType('unknown', {})).toBe('other');
    expect(buildMissionType('skill_upgrade', { default_mission_type: 'user_task' })).toBe('user_task');
  });

  it('deduplicates evidence and caps confidence safely', () => {
    const refs = [
      { source_type: 'document', ref_id: 'doc-1', title: 'A', summary: 'one' },
      { source_type: 'document', ref_id: 'doc-1', title: 'A copy', summary: 'two' },
      { source_type: 'skill', ref_id: 'skill-1', title: 'B', summary: 'three' },
    ];
    expect(dedupeEvidenceRefs(refs)).toHaveLength(2);
    expect(scoreInsight(20, 0.9)).toBe(0.98);
  });

  it('normalizes primitive helpers across invalid inputs', () => {
    expect(clampNumber('bad', 1, 10, 5)).toBe(5);
    expect(clampNumber(99.7, 1, 10, 5)).toBe(10);
    expect(clampNumber(-2, 1, 10, 5)).toBe(1);
    expect(safeRecord({ ok: true })).toEqual({ ok: true });
    expect(safeRecord(null)).toEqual({});
    expect(safeRecord(['nope'])).toEqual({});
    expect(safeArray([{ a: 1 }, null, ['x'], 'text', { b: 2 }])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('creates ClawHub skill upgrade insights from curated skill metadata', () => {
    const insights = buildInsightText(baseRule, {
      ...emptySignals,
      skills: [
        {
          id: 'skill-1',
          skill_name: 'customer-research',
          description: '客户调研',
          source_uri: 'https://clawhub.ai/andyrenxu7255/customer-research',
          metadata: { installed_from: 'clawhub.ai', clawhub_slug: 'customer-research' },
        },
        {
          id: 'skill-2',
          skill_name: 'meddic',
          description: 'MEDDIC',
          metadata: '{"source":"clawhub.ai"}',
        },
      ],
    });

    const upgrade = insights.find((item) => item.insight_type === 'skill_upgrade');
    expect(upgrade?.insight_title).toContain('ClawHub');
    expect(upgrade?.evidence_refs).toHaveLength(2);
    expect(upgrade?.metadata.installed_skill_count).toBe(2);
  });

  it('keeps fallback titles, summaries, and source URIs stable in evidence packs', () => {
    const insights = buildInsightText(
      { ...baseRule, rule_name: 'MEDDIC 销售复盘' },
      {
        ...emptySignals,
        documents: [{ id: 'doc-1', content_text: 'MEDDIC pipeline' }],
        skills: [{ id: 'skill-1', metadata: { clawhub_slug: 'fallback-skill' } }],
        assignments: [{ id: 'assignment-1', task_id: 'task-1', status: 'assigned', description: '需要跟进' }],
      }
    );

    const meddic = insights.find((item) => item.insight_type === 'customer_followup');
    const skill = insights.find((item) => item.insight_type === 'skill_upgrade');
    const process = insights.find((item) => item.insight_type === 'process_issue');
    expect(meddic?.evidence_refs[0]).toMatchObject({ title: 'document', summary: 'MEDDIC pipeline' });
    expect(skill?.evidence_refs[0]).toMatchObject({ title: 'skill', summary: '' });
    expect(process?.evidence_refs[0]).toMatchObject({ title: 'task-1', summary: '需要跟进' });
  });

  it('creates fact-gap and default scan insights when signals are sparse', () => {
    const factGap = buildInsightText(baseRule, {
      ...emptySignals,
      documents: [{ id: 'doc-1', title: '普通资料', source_uri: 'local-demo://doc' }],
      facts: [{ id: 'fact-1' }, { id: 'fact-2' }],
    });
    expect(factGap.some((item) => item.insight_type === 'fact_gap')).toBe(true);

    const defaultOnly = buildInsightText(baseRule, {
      ...emptySignals,
      facts: Array.from({ length: 5 }, (_, index) => ({ id: `fact-${index}` })),
    });
    expect(defaultOnly).toHaveLength(1);
    expect(defaultOnly[0].metadata.source).toBe('scan_summary');
  });

  it('creates process insights from rule text even without pending evidence refs', () => {
    const insights = buildInsightText(
      { ...baseRule, rule_name: '流程阻塞巡检', description: '检查 blocked 状态' },
      {
        ...emptySignals,
        facts: Array.from({ length: 5 }, (_, index) => ({ id: `fact-${index}` })),
      }
    );
    expect(insights[0]).toMatchObject({
      insight_type: 'process_issue',
      metadata: { pending_assignment_count: 0 },
    });
  });
});
