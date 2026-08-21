/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/logging';
import type { ConcreteTaskInstance } from '../task';
import type { TaskTypeDictionary } from '../task_type_dictionary';
import type { TaskRunner } from '../task_running';
import type { TaskScheduling } from '../task_scheduling';
import type { TaskStore } from '../task_store';
import { claimTaskBatch } from '../task_claimers/claim_task_batch';

export const PARALLEL_RUNNER_TASK_ID = 'taskManager:parallel-runner';
const PARALLEL_RUNNER_TASK_TYPE = PARALLEL_RUNNER_TASK_ID;
const SCHEDULE_INTERVAL = '5s';

export type TaskRunnerFactory = (instance: ConcreteTaskInstance) => TaskRunner;

const sleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

export function registerParallelRunnerTaskDefinition(
  logger: Logger,
  taskTypeDictionary: TaskTypeDictionary,
  getRunnerFactory: () => TaskRunnerFactory | undefined,
  getTaskStore: () => TaskStore | undefined
) {
  taskTypeDictionary.registerTaskDefinitions({
    [PARALLEL_RUNNER_TASK_TYPE]: {
      title: 'Task Manager: Parallel Runner',
      timeout: '365d',
      createTaskRunner: ({ signal }) => ({
        async run() {
          const runnerFactory = getRunnerFactory();
          if (!runnerFactory) {
            // start() sets this before any task can run; guard is defensive only
            throw new Error('[parallel-runner] task runner factory not ready');
          }
          const taskStore = getTaskStore();
          if (!taskStore) {
            throw new Error('[parallel-runner] task store not ready');
          }
          await runParallelLoop({ logger, taskTypeDictionary, runnerFactory, taskStore, signal });
          // Return a future runAt so TM re-schedules after crash recovery.
          // Under normal operation the loop exits only on abort.
          return { state: {}, runAt: new Date(Date.now() + 5_000) };
        },
        async cancel() {},
      }),
    },
  });
}

export async function scheduleParallelRunnerTask(logger: Logger, taskScheduling: TaskScheduling) {
  try {
    await taskScheduling.ensureScheduled({
      id: PARALLEL_RUNNER_TASK_ID,
      taskType: PARALLEL_RUNNER_TASK_TYPE,
      schedule: { interval: SCHEDULE_INTERVAL },
      state: {},
      params: {},
    });
  } catch (e) {
    logger.error(`Error scheduling ${PARALLEL_RUNNER_TASK_ID}: ${e.message}`);
  }
}

async function runParallelLoop({
  logger,
  taskTypeDictionary,
  runnerFactory,
  taskStore,
  signal,
}: {
  logger: Logger;
  taskTypeDictionary: TaskTypeDictionary;
  runnerFactory: TaskRunnerFactory;
  taskStore: TaskStore;
  signal: AbortSignal;
}) {
  const parallelTypes = taskTypeDictionary
    .getAllDefinitions()
    .filter((def) => (def.internalParallelism ?? 1) > 1);

  if (parallelTypes.length === 0) return;

  while (!signal.aborted) {
    const { docs } = await taskStore.fetch({
      query: {
        bool: {
          filter: [
            { terms: { 'task.taskType': parallelTypes.map((d) => d.type) } },
            { term: { 'task.status': 'idle' } },
            { range: { 'task.runAt': { lte: 'now' } } },
          ],
        },
      },
      size: parallelTypes.reduce((sum, d) => sum + d.internalParallelism!, 0),
    });

    if (!docs.length) {
      await sleep(5_000, signal);
      continue;
    }

    const { claimed } = await claimTaskBatch(taskStore, docs, taskTypeDictionary, logger);

    if (claimed.length) {
      const countByType = claimed.reduce<Record<string, number>>((acc, t) => {
        acc[t.taskType] = (acc[t.taskType] ?? 0) + 1;
        return acc;
      }, {});
      const summary = Object.entries(countByType)
        .map(([type, count]) => `${type}×${count}`)
        .join(', ');
      logger.debug(`[parallel-runner] running ${claimed.length} tasks in parallel: ${summary}`);

      await runBatch({ claimed, runnerFactory, signal, logger });
    }
  }
}

async function runBatch({
  claimed,
  runnerFactory,
  signal,
  logger,
}: {
  claimed: ConcreteTaskInstance[];
  runnerFactory: TaskRunnerFactory;
  signal: AbortSignal;
  logger: Logger;
}) {
  const runners = claimed.map((instance) => runnerFactory(instance));

  // markTaskAsRunning is a no-op for mget-claimed tasks (status already set to
  // 'running' during claimTaskBatch); it transitions the in-memory instance state only.
  await Promise.all(runners.map((r) => r.markTaskAsRunning()));

  // Propagate system-task abort into each sub-runner.
  signal.addEventListener(
    'abort',
    () => {
      for (const r of runners) {
        r.cancel?.().catch((err: Error) => {
          logger.error(`[parallel-runner] error cancelling sub-runner: ${err.message}`);
        });
      }
    },
    { once: true }
  );

  // Run all concurrently; each runner handles its own error, retry, and state persistence.
  await Promise.allSettled(runners.map((r) => r.run()));
  logger.debug(`[parallel-runner] batch of ${runners.length} tasks completed`);
}
