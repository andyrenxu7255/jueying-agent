import { WorkflowPlanner } from './planner';

describe('WorkflowPlanner', () => {
  const planner = new WorkflowPlanner();

  const baseInput = {
    user_id: 'test_user',
    user_goal: 'Test goal',
    policy_snapshot_hash: 'sha256:abc123',
    task_type_hint: 'knowledge' as const,
    risk_level: 'medium' as const,
  };

  describe('buildPlanFromMarkdownSteps', () => {
    it('sets on_success to succeeded for the last stage (2-stage plan)', () => {
      const input = {
        ...baseInput,
        markdown_steps: [
          { seq: 1, name: '分析问题', description: '分析问题' },
          { seq: 2, name: '输出结果', description: '输出结果' },
        ],
      };

      const plan = (planner as any).buildPlanFromMarkdownSteps(input);

      expect(plan.stage_chain).toHaveLength(2);
      expect(plan.stage_chain[0].on_success).toBe('next_stage');
      expect(plan.stage_chain[1].on_success).toBe('succeeded');
    });

    it('sets on_success correctly for a 3-stage plan', () => {
      const input = {
        ...baseInput,
        markdown_steps: [
          { seq: 1, name: '澄清', description: 'Clarify' },
          { seq: 2, name: '检索', description: 'Search' },
          { seq: 3, name: '报告', description: 'Report' },
        ],
      };

      const plan = (planner as any).buildPlanFromMarkdownSteps(input);

      expect(plan.stage_chain).toHaveLength(3);
      expect(plan.stage_chain[0].on_success).toBe('next_stage');
      expect(plan.stage_chain[1].on_success).toBe('next_stage');
      expect(plan.stage_chain[2].on_success).toBe('succeeded');
    });

    it('handles empty markdown_steps fallback (2-stage plan)', () => {
      const input = {
        ...baseInput,
        markdown_steps: [],
      };

      const plan = (planner as any).buildPlanFromMarkdownSteps(input);

      expect(plan.stage_chain).toHaveLength(2);
      expect(plan.stage_chain[0].on_success).toBe('next_stage');
      expect(plan.stage_chain[1].on_success).toBe('succeeded');
    });
  });

  describe('getDefaultStageChain', () => {
    it('knowledge default has 3 stages with correct on_success', () => {
      const stages = (planner as any).getDefaultStageChain('knowledge', 'test goal');

      expect(stages).toHaveLength(3);
      expect(stages[0].on_success).toBe('next_stage');
      expect(stages[1].on_success).toBe('next_stage');
      expect(stages[2].on_success).toBe('succeeded');
    });

    it('development default has 6 stages with correct on_success', () => {
      const stages = (planner as any).getDefaultStageChain('development', 'test goal');

      expect(stages).toHaveLength(6);
      for (let i = 0; i < 5; i++) {
        expect(stages[i].on_success).toBe('next_stage');
      }
      expect(stages[5].on_success).toBe('succeeded');
    });

    it('analysis default has 5 stages with correct on_success', () => {
      const stages = (planner as any).getDefaultStageChain('analysis', 'test goal');

      expect(stages).toHaveLength(5);
      for (let i = 0; i < 4; i++) {
        expect(stages[i].on_success).toBe('next_stage');
      }
      expect(stages[4].on_success).toBe('succeeded');
    });

    it('sales default has 5 stages with correct on_success', () => {
      const stages = (planner as any).getDefaultStageChain('sales', 'test goal');

      expect(stages).toHaveLength(5);
      for (let i = 0; i < 4; i++) {
        expect(stages[i].on_success).toBe('next_stage');
      }
      expect(stages[4].on_success).toBe('succeeded');
    });
  });

  describe('stageType inference', () => {
    const infer = (name: string) => (planner as any).inferStageTypeFromStepName(name);

    it('recognizes clarification stages', () => {
      expect(infer('明确需求')).toBe('IntentClarification');
      expect(infer('澄清目标')).toBe('IntentClarification');
      expect(infer('Intent Clarification')).toBe('IntentClarification');
    });

    it('recognizes retrieval stages', () => {
      expect(infer('检索相关文档')).toBe('EvidenceRetrieval');
      expect(infer('查找资料')).toBe('EvidenceRetrieval');
      expect(infer('Search Evidence')).toBe('EvidenceRetrieval');
    });

    it('recognizes implementation stages', () => {
      expect(infer('实现功能')).toBe('Implementation');
      expect(infer('开发模块')).toBe('Implementation');
      expect(infer('Implement fix')).toBe('Implementation');
    });

    it('recognizes reporting stages', () => {
      expect(infer('输出报告')).toBe('ResultReporting');
      expect(infer('结果汇总')).toBe('ResultReporting');
      expect(infer('Report Result')).toBe('ResultReporting');
    });

    it('defaults to DecisionMaking for unknown', () => {
      expect(infer('something unknown')).toBe('DecisionMaking');
    });
  });

  describe('executor assignment', () => {
    const inferExec = (stageType: string) => (planner as any).inferExecutorFromStageType(stageType);

    it('assigns retrieval-aware-executor to retrieval stages', () => {
      expect(inferExec('EvidenceRetrieval')).toBe('retrieval-aware-executor');
      expect(inferExec('MemoryRetrieval')).toBe('retrieval-aware-executor');
    });

    it('assigns code-executor to implementation and repair', () => {
      expect(inferExec('Implementation')).toBe('code-executor');
      expect(inferExec('Repair')).toBe('code-executor');
    });

    it('assigns verification-executor to verification', () => {
      expect(inferExec('Verification')).toBe('verification-executor');
    });

    it('assigns generic-executor as default', () => {
      expect(inferExec('IntentClarification')).toBe('generic-executor');
      expect(inferExec('ResultReporting')).toBe('generic-executor');
    });
  });
});
