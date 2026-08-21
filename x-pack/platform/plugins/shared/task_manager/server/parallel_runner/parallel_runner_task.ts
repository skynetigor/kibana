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
const SCHEDULE_INTERVAL = '1s';

/** Total number of parallel-runner partitions always kept scheduled. */
const TOTAL_PARTITIONS = 4;

/**
 * How long each parallel-runner cycle actively polls for new tasks.
 * After this budget the runner stops claiming, drains in-flight tasks, and exits.
 * TM re-schedules the next cycle immediately via runAt: new Date().
 */
const RUN_BUDGET_MS = 5_000;

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
      // 30s: generous drain headroom after the 5s run budget.
      // TM aborts via signal if exceeded, which cancels sub-runners.
      timeout: '30s',
      createTaskRunner: ({ taskInstance, signal }) => ({
        async run() {
          const runnerFactory = getRunnerFactory();
          if (!runnerFactory) {
            throw new Error('[parallel-runner] task runner factory not ready');
          }
          const taskStore = getTaskStore();
          if (!taskStore) {
            throw new Error('[parallel-runner] task store not ready');
          }
          const partitionIndex: number =
            (taskInstance.params as { partitionIndex?: number })?.partitionIndex ?? 0;

          await runParallelLoop({
            logger,
            taskTypeDictionary,
            runnerFactory,
            taskStore,
            signal,
            partitionIndex,
          });

          // Re-schedule immediately — the 5s budget already paces the cycle.
          // The schedule interval serves only as crash-recovery fallback.
          return { state: {}, runAt: new Date() };
        },
        async cancel() {},
      }),
    },
  });
}

export async function scheduleParallelRunnerTask(logger: Logger, taskScheduling: TaskScheduling) {
  for (let i = 0; i < TOTAL_PARTITIONS; i++) {
    const id = `${PARALLEL_RUNNER_TASK_ID}-${i}`;
    try {
      await taskScheduling.ensureScheduled({
        id,
        taskType: PARALLEL_RUNNER_TASK_TYPE,
        schedule: { interval: SCHEDULE_INTERVAL },
        state: {},
        params: { partitionIndex: i },
      });
    } catch (e) {
      logger.error(`Error scheduling ${id}: ${e.message}`);
    }
  }
}

async function runParallelLoop({
  logger,
  taskTypeDictionary,
  runnerFactory,
  taskStore,
  signal,
  partitionIndex,
}: {
  logger: Logger;
  taskTypeDictionary: TaskTypeDictionary;
  runnerFactory: TaskRunnerFactory;
  taskStore: TaskStore;
  signal: AbortSignal;
  partitionIndex: number;
}) {
  // Only process types assigned to this partition.
  // A type with parallelRunnerPartitions=P is handled by partitions 0..(P-1).
  const parallelTypes = taskTypeDictionary
    .getAllDefinitions()
    .filter(
      (def) =>
        (def.internalParallelism ?? 1) > 1 && partitionIndex < (def.parallelRunnerPartitions ?? 1)
    );

  if (parallelTypes.length === 0) {
    logger.debug(
      `[parallel-runner-${partitionIndex}] no task types assigned to this partition, idling`
    );
    return;
  }

  const maxSlots = parallelTypes.reduce((sum, d) => sum + d.internalParallelism!, 0);
  const deadline = Date.now() + RUN_BUDGET_MS;

  logger.debug(
    `[parallel-runner-${partitionIndex}] cycle start — ${maxSlots} slots, types: ${parallelTypes
      .map((d) => d.type)
      .join(', ')}`
  );

  // ── Slot tracking ──────────────────────────────────────────────────────────
  // inFlight: number of tasks currently running.
  // When a task finishes it decrements inFlight and calls the pending resolver (if any)
  // so the main loop wakes up and either starts a new task or detects drain completion.

  let inFlight = 0;
  let resolveSlot: (() => void) | null = null;

  const waitForSlot = (): Promise<void> =>
    new Promise((resolve) => {
      resolveSlot = resolve;
    });

  const signalSlot = () => {
    inFlight--;
    const r = resolveSlot;
    resolveSlot = null;
    r?.();
  };

  // ── Fire a single task without blocking the main loop ─────────────────────

  function fireTask(instance: ConcreteTaskInstance): void {
    inFlight++;
    const runner = runnerFactory(instance);

    const cancelOnAbort = () => {
      runner
        .cancel?.()
        .catch((err: Error) =>
          logger.error(`[parallel-runner-${partitionIndex}] cancel error: ${err.message}`)
        );
    };
    signal.addEventListener('abort', cancelOnAbort, { once: true });

    (async () => {
      try {
        await runner.markTaskAsRunning();
        await runner.run();
      } catch (err) {
        logger.error(
          `[parallel-runner-${partitionIndex}] unhandled task error: ${(err as Error).message}`
        );
      } finally {
        signal.removeEventListener('abort', cancelOnAbort);
        signalSlot();
      }
    })();
  }

  // ── Main loop ──────────────────────────────────────────────────────────────

  while (!signal.aborted) {
    const timeRemaining = deadline - Date.now();

    // Budget exhausted — stop claiming, drain in-flight tasks, and exit.
    if (timeRemaining <= 0) {
      if (inFlight > 0) {
        logger.debug(
          `[parallel-runner-${partitionIndex}] budget elapsed, draining ${inFlight} in-flight tasks`
        );
        while (inFlight > 0) await waitForSlot();
      }
      logger.debug(`[parallel-runner-${partitionIndex}] cycle complete`);
      return;
    }

    // All slots busy — wait for one to free before fetching more.
    if (inFlight >= maxSlots) {
      await waitForSlot();
      continue;
    }

    // Fetch only as many tasks as there are free slots.
    // Each type with parallelRunnerPartitions > 1 uses runnerPartition (assigned at schedule time)
    // so each partition owns a disjoint subset — no cross-partition claim races.
    const slotsAvailable = maxSlots - inFlight;
    const typeFilters = parallelTypes.map((def) => {
      const p = def.parallelRunnerPartitions ?? 1;
      const typeFilter = { term: { 'task.taskType': def.type } };
      if (p <= 1) return typeFilter;
      return {
        bool: {
          filter: [typeFilter, { term: { 'task.runnerPartition': partitionIndex } }],
        },
      };
    });
    const { docs } = await taskStore.fetch({
      query: {
        bool: {
          filter: [
            { bool: { should: typeFilters, minimum_should_match: 1 } },
            { term: { 'task.status': 'idle' } },
            { range: { 'task.runAt': { lte: 'now' } } },
          ],
        },
      },
      size: slotsAvailable,
      seq_no_primary_term: true,
    });

    if (!docs.length) {
      if (inFlight === 0) {
        // Truly idle — sleep briefly, respecting both the deadline and abort signal.
        await sleep(Math.min(1_000, timeRemaining), signal);
      } else {
        // Tasks still running but queue is empty for now — wait for a slot to free,
        // then re-check (new tasks may have become runAt-eligible by then).
        await waitForSlot();
      }
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
      logger.debug(
        `[parallel-runner-${partitionIndex}] +${claimed.length} tasks (${
          inFlight + claimed.length
        }/${maxSlots} slots): ${summary}`
      );

      for (const task of claimed) {
        fireTask(task);
      }
    }
  }

  // Abort signal fired — drain before returning.
  if (inFlight > 0) {
    logger.debug(
      `[parallel-runner-${partitionIndex}] aborted, draining ${inFlight} in-flight tasks`
    );
    while (inFlight > 0) await waitForSlot();
  }
}
