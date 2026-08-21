/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export {
  registerParallelRunnerTaskDefinition,
  scheduleParallelRunnerTask,
  PARALLEL_RUNNER_TASK_ID,
} from './parallel_runner_task';
export type { TaskRunnerFactory } from './parallel_runner_task';
