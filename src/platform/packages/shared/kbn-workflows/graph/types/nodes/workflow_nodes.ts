/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { z } from '@kbn/zod/v4';
import { GraphNodeSchema } from './base';

export const EnterWorkflowNodeSchema = GraphNodeSchema.extend({
  id: z.string(),
  type: z.literal('enter-workflow'),
  exitNodeId: z.string(),
});

export type EnterWorkflowNode = z.infer<typeof EnterWorkflowNodeSchema>;

export const ExitWorkflowNodeSchema = GraphNodeSchema.extend({
  id: z.string(),
  type: z.literal('exit-workflow'),
  startNodeId: z.string(),
});

export type ExitWorkflowNode = z.infer<typeof ExitWorkflowNodeSchema>;
