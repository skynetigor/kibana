/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { ExecutionStatus } from '@kbn/workflows';
import type { WorkflowYaml } from '@kbn/workflows';
import { mergeDefinitionStepsIntoTree } from './merge_definition_steps_into_tree';
import type { StepExecutionTreeItem } from '../ui/build_step_executions_tree';

const def = (steps: Array<{ name: string; type: string }>): WorkflowYaml =>
  ({ name: 'wf', steps } as WorkflowYaml);

const node = (
  partial: Partial<StepExecutionTreeItem> & Pick<StepExecutionTreeItem, 'stepId' | 'stepType'>
): StepExecutionTreeItem => ({
  executionIndex: 0,
  stepExecutionId: `${partial.stepId}-id`,
  status: ExecutionStatus.COMPLETED,
  children: [],
  ...partial,
});

describe('mergeDefinitionStepsIntoTree', () => {
  it('inserts ghosted Not run leaves for definition steps with no execution record', () => {
    const tree = [
      node({ stepId: 'Overview', stepType: '__overview', stepExecutionId: '__overview' }),
      node({
        stepId: 'start',
        stepType: 'console',
        status: ExecutionStatus.COMPLETED,
      }),
      node({
        stepId: 'triage_overview',
        stepType: 'ai.prompt',
        status: ExecutionStatus.FAILED,
        children: [
          node({
            stepId: 'triage_overview',
            stepType: 'ai.prompt',
            isRetryAttempt: true,
            attemptNumber: 1,
            status: ExecutionStatus.FAILED,
          }),
        ],
      }),
    ];

    const result = mergeDefinitionStepsIntoTree(
      tree,
      def([
        { name: 'start', type: 'console' },
        { name: 'mid', type: 'console' },
        { name: 'triage_overview', type: 'ai.prompt' },
        { name: 'process_alerts', type: 'foreach' },
        { name: 'final_summary', type: 'console' },
        { name: 'done', type: 'console' },
      ])
    );

    expect(result.map((n) => n.stepId)).toEqual([
      'Overview',
      'start',
      'mid',
      'triage_overview',
      'process_alerts',
      'final_summary',
      'done',
    ]);
    expect(result[2]).toMatchObject({
      stepId: 'mid',
      status: ExecutionStatus.SKIPPED,
      stepExecutionId: null,
      children: [],
    });
    expect(result.find((n) => n.stepId === 'process_alerts')).toMatchObject({
      stepType: 'foreach',
      status: ExecutionStatus.SKIPPED,
      children: [],
    });
    expect(result.find((n) => n.stepId === 'triage_overview')?.children).toHaveLength(1);
  });

  it('preserves executed steps after a failure (on-failure: continue)', () => {
    const tree = [
      node({ stepId: 'a', stepType: 'console', status: ExecutionStatus.FAILED }),
      node({ stepId: 'b', stepType: 'console', status: ExecutionStatus.COMPLETED }),
    ];
    const result = mergeDefinitionStepsIntoTree(
      tree,
      def([
        { name: 'a', type: 'console' },
        { name: 'b', type: 'console' },
        { name: 'c', type: 'console' },
      ])
    );
    expect(result[0].status).toBe(ExecutionStatus.FAILED);
    expect(result[1].status).toBe(ExecutionStatus.COMPLETED);
    expect(result[2]).toMatchObject({
      stepId: 'c',
      status: ExecutionStatus.SKIPPED,
      children: [],
    });
  });

  it('returns the tree unchanged when every definition step ran (success guard)', () => {
    const tree = [
      node({ stepId: 'a', stepType: 'console' }),
      node({ stepId: 'b', stepType: 'console' }),
    ];
    const result = mergeDefinitionStepsIntoTree(
      tree,
      def([
        { name: 'a', type: 'console' },
        { name: 'b', type: 'console' },
      ])
    );
    expect(result.every((n) => n.status === ExecutionStatus.COMPLETED)).toBe(true);
    expect(result.every((n) => n.stepExecutionId != null)).toBe(true);
  });

  it('returns the tree unchanged when definition is missing', () => {
    const tree = [node({ stepId: 'a', stepType: 'console' })];
    expect(mergeDefinitionStepsIntoTree(tree, null)).toBe(tree);
  });

  it('reorders foreach iteration body steps to YAML order and ghosts unrun siblings', () => {
    const tree = [
      node({
        stepId: 'process_alerts',
        stepType: 'foreach',
        children: [
          node({
            stepId: '0',
            stepType: 'foreach-iteration',
            children: [
              node({ stepId: 'notify', stepType: 'console' }),
              node({ stepId: 'enrich', stepType: 'console' }),
            ],
          }),
        ],
      }),
    ];

    const result = mergeDefinitionStepsIntoTree(tree, {
      name: 'wf',
      steps: [
        {
          name: 'process_alerts',
          type: 'foreach',
          foreach: '{{ alerts }}',
          steps: [
            { name: 'enrich', type: 'console' },
            { name: 'triage', type: 'console' },
            { name: 'notify', type: 'console' },
          ],
        },
      ],
    } as WorkflowYaml);

    const iteration = result[0].children[0];
    expect(iteration.children.map((n) => n.stepId)).toEqual(['enrich', 'triage', 'notify']);
    expect(iteration.children[1]).toMatchObject({
      stepId: 'triage',
      status: ExecutionStatus.SKIPPED,
      stepExecutionId: null,
      children: [],
    });
    expect(iteration.children[0].status).toBe(ExecutionStatus.COMPLETED);
    expect(iteration.children[2].status).toBe(ExecutionStatus.COMPLETED);
  });

  it('reorders if-branch body steps to YAML order and ghosts unrun siblings', () => {
    const tree = [
      node({
        stepId: 'gate',
        stepType: 'if',
        children: [
          node({
            stepId: 'true',
            stepType: 'if-branch',
            children: [
              node({ stepId: 'then_b', stepType: 'console' }),
              node({ stepId: 'then_a', stepType: 'console' }),
            ],
          }),
        ],
      }),
    ];

    const result = mergeDefinitionStepsIntoTree(tree, {
      name: 'wf',
      steps: [
        {
          name: 'gate',
          type: 'if',
          condition: 'true',
          steps: [
            { name: 'then_a', type: 'console' },
            { name: 'then_mid', type: 'console' },
            { name: 'then_b', type: 'console' },
          ],
        },
      ],
    } as WorkflowYaml);

    const branch = result[0].children[0];
    expect(branch.children.map((n) => n.stepId)).toEqual(['then_a', 'then_mid', 'then_b']);
    expect(branch.children[1]).toMatchObject({
      stepId: 'then_mid',
      status: ExecutionStatus.SKIPPED,
      stepExecutionId: null,
    });
  });

  it('leaves retry-attempt children unchanged', () => {
    const retryChild = node({
      stepId: 'triage_overview',
      stepType: 'ai.prompt',
      isRetryAttempt: true,
      attemptNumber: 1,
      status: ExecutionStatus.FAILED,
    });
    const tree = [
      node({
        stepId: 'triage_overview',
        stepType: 'ai.prompt',
        status: ExecutionStatus.FAILED,
        children: [retryChild],
      }),
    ];

    const result = mergeDefinitionStepsIntoTree(tree, {
      name: 'wf',
      steps: [{ name: 'triage_overview', type: 'ai.prompt' }],
    } as WorkflowYaml);

    expect(result[0].children).toEqual([retryChild]);
  });

  it('keeps an unexecuted top-level foreach as a ghost leaf', () => {
    const tree = [node({ stepId: 'start', stepType: 'console' })];
    const result = mergeDefinitionStepsIntoTree(tree, {
      name: 'wf',
      steps: [
        { name: 'start', type: 'console' },
        {
          name: 'process_alerts',
          type: 'foreach',
          foreach: '{{ alerts }}',
          steps: [{ name: 'enrich', type: 'console' }],
        },
      ],
    } as WorkflowYaml);

    expect(result.find((n) => n.stepId === 'process_alerts')).toMatchObject({
      stepType: 'foreach',
      status: ExecutionStatus.SKIPPED,
      children: [],
    });
  });
});
