/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import type { ConcreteTaskInstance, PartialConcreteTaskInstance } from '../task';
import { TaskStatus } from '../task';
import type { TaskTypeDictionary } from '../task_type_dictionary';
import type { TaskStore } from '../task_store';
import { isOk } from '../lib/result_type';
import { getRetryAt } from '../lib/get_retry_at';

export interface ClaimBatchResult {
  claimed: ConcreteTaskInstance[];
  conflicts: number;
  errors: number;
}

/**
 * Atomically claims a set of candidate task instances by bulk-updating their status to
 * `running`. Uses OCC (version-based optimistic concurrency): 409 conflicts are counted
 * but not thrown. Returns the full task documents for successfully claimed instances.
 *
 * Extracted from `strategy_mget.ts` so it can be shared between the main claim loop and
 * the `taskManager:parallel-runner` system task.
 */
export const claimTaskBatch = async (
  taskStore: TaskStore,
  candidates: ConcreteTaskInstance[],
  definitions: TaskTypeDictionary,
  logger: Logger
): Promise<ClaimBatchResult> => {
  const now = new Date();
  const updates: PartialConcreteTaskInstance[] = [];
  const malformed: string[] = [];

  for (const task of candidates) {
    try {
      updates.push({
        id: task.id,
        version: task.version,
        scheduledAt:
          task.retryAt != null && new Date(task.retryAt).getTime() < now.getTime()
            ? task.retryAt
            : task.runAt,
        status: TaskStatus.Running,
        startedAt: now,
        attempts: task.attempts + 1,
        retryAt: getRetryAt(task, definitions.get(task.taskType)) ?? null,
        ownerId: taskStore.taskManagerId,
      });
    } catch (err) {
      logger.error(
        `Error building claim update for task ${task.id}:${task.taskType}: ${err.message}`
      );
      malformed.push(task.id);
    }
  }

  const updatedById: Record<string, PartialConcreteTaskInstance> = {};
  let conflicts = 0;
  let errors = malformed.length;

  const updateResults = await taskStore.bulkPartialUpdate(updates);
  for (const result of updateResults) {
    if (isOk(result)) {
      updatedById[result.value.id] = result.value;
    } else if (result.error.status === 409) {
      conflicts++;
    } else {
      logger.error(
        `Error claiming task ${result.error.id}:${result.error.type}: ${JSON.stringify(
          result.error.error
        )}`
      );
      errors++;
    }
  }

  const claimed: ConcreteTaskInstance[] = [];
  const getResults = await taskStore.bulkGet(Object.keys(updatedById));
  for (const result of getResults) {
    if (isOk(result)) {
      if (result.value.version !== updatedById[result.value.id].version) {
        logger.warn(
          `Task ${result.value.id} was modified during the claiming phase, skipping until the next claiming cycle.`
        );
        conflicts++;
      } else {
        claimed.push(result.value);
      }
    } else {
      logger.error(
        `Error fetching claimed task ${result.error.id}:${result.error.type}: ${result.error.error.message}`
      );
      errors++;
    }
  }

  return { claimed, conflicts, errors };
};
