/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { StepExecutionRuntime } from '../workflow_context_manager/step_execution_runtime';
import type { StepExecutionRuntimeFactory } from '../workflow_context_manager/step_execution_runtime_factory';

/**
 * Walks the scope stack of a step execution runtime and returns the
 * step execution runtimes for each enclosing scope (e.g. foreach, if, retry).
 * Useful for propagating status changes (timeout, cancellation) to all
 * ancestor container steps.
 */
export const getEnclosingScopeRuntimes = (
  currentStepExecutionRuntime: StepExecutionRuntime,
  stepExecutionRuntimeFactory: StepExecutionRuntimeFactory
): StepExecutionRuntime[] => {
  let stack = currentStepExecutionRuntime.scopeStack;
  const result: StepExecutionRuntime[] = [];

  while (!stack.isEmpty()) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const currentScope = stack.getCurrentScope()!;
    stack = stack.exitScope();
    const scopeStepExecutionRuntime = stepExecutionRuntimeFactory.createStepExecutionRuntime({
      nodeId: currentScope.nodeId,
      stackFrames: stack.stackFrames,
    });
    result.push(scopeStepExecutionRuntime);
  }

  return result;
};
