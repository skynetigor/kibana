/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

/** History list and the execution panel, when no step is open. */
export const WORKFLOW_EXECUTION_FLYOUT_HISTORY_KEY = Symbol('workflowExecutionFlyout');

/**
 * Execution and step. Separate from the list session so the list stays mounted
 * while the visible pair is the execution and the step.
 */
export const WORKFLOW_EXECUTION_STEP_SESSION_KEY = Symbol('workflowExecutionStep');
