/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { Logger } from '@kbn/core/server';
import type { JsonValue } from '@kbn/utility-types';
import type { SerializedError, StackFrame } from '@kbn/workflows';
import { StepIoCache } from './step_io_cache';
import type { WorkflowExecutionState } from './workflow_execution_state';
import type { OutputSizeStats } from '../lib/telemetry/events/workflows_execution/types';
import type { StepExecutionRepository } from '../repositories/step_execution_repository';
import { safeOutputSize } from '../step/errors';

export type { StepIoType } from './step_io_cache';

const retainOnly = <T>(entries: Map<string, T>, keep: ReadonlySet<string>): void => {
  for (const key of Array.from(entries.keys())) {
    if (!keep.has(key)) entries.delete(key);
  }
};

export interface StepIoServiceInit {
  stepRepository: StepExecutionRepository;
  state: WorkflowExecutionState;
  /** Maximum total byte size for the output LRU cache. `Infinity` disables eviction entirely. */
  maxBytes?: number;
  logger?: Logger;
}

/**
 * Read-only IO surface used by node implementations and the context manager.
 */
export interface StepIoReader {
  read(stepExecutionId: string, type: 'input' | 'output'): JsonValue | null | undefined;
  getStepError(stepExecutionId: string): SerializedError | undefined;
  getLatestStepIO(
    stepId: string,
    stackFrames?: readonly StackFrame[]
  ):
    | {
        input: JsonValue | undefined;
        output: JsonValue | null | undefined;
        error: SerializedError | undefined;
      }
    | undefined;
}

/**
 * Reader + write surface used by the per-step runtime.
 */
export interface StepIoWriter extends StepIoReader {
  write(
    stepExecutionId: string,
    type: 'input' | 'output',
    value: JsonValue | null,
    sizeBytes?: number
  ): void;
}

/**
 * Lifecycle surface used by the workflow execution loop and runtime manager only.
 */
export interface StepIoLifecycle {
  rehydrate(ids: ReadonlyArray<string>, inputIds?: ReadonlyArray<string>): Promise<void>;
  getOutputSizeStats(): OutputSizeStats;
}

/**
 * Owns the read cache for step outputs and routes IO reads/writes between
 * the LRU cache and `WorkflowExecutionState`.
 *
 * Responsibilities:
 *   - Output LRU cache (`StepIoCache` → `lru-cache`)
 *   - `write(id, type, value)` — routes outputs to both cache and state, inputs to state only
 *   - `read(id, type)` — LRU hit or state fallback
 *   - `rehydrate(ids)` — fetches cache-missing IDs from ES before context build
 *   - `getOutputSizeStats` — telemetry
 *
 * Flush, load, eviction, and pin machinery have all been removed. Flush is
 * `WorkflowExecutionState`'s responsibility. Load is `WorkflowExecutionState.load()`.
 * Eviction is handled by the LRU on insert.
 */
export class StepIoService implements StepIoWriter, StepIoLifecycle {
  private readonly stepRepository: StepExecutionRepository;
  private readonly state: WorkflowExecutionState;
  private readonly cache: StepIoCache;
  /**
   * Outputs of the latest `rehydrate` request that the LRU could not retain, either
   * because it rejected or evicted them. Pruned to the latest requested IDs on each call.
   */
  private readonly overflow = new Map<string, JsonValue | null>();
  /**
   * Inputs of finished steps, which state drops after flush. Fetched on demand and pruned
   * to the latest requested input IDs. `null` marks "no stored input".
   */
  private readonly inputOverflow = new Map<string, JsonValue | null>();
  /** Requests of `rehydrate` calls that have not finished yet. */
  private readonly inFlight = new Set<{
    ids: ReadonlySet<string>;
    inputIds: ReadonlySet<string>;
  }>();
  /** Execution-wide sizes of outputs written with a measured byte count, for telemetry. */
  private readonly measuredSizes = new Map<string, number>();
  private measuredTotalBytes = 0;

  constructor({ stepRepository, state, maxBytes = Infinity, logger }: StepIoServiceInit) {
    this.stepRepository = stepRepository;
    this.state = state;
    this.cache = new StepIoCache(maxBytes, logger);
  }

  // ----- IO reads -----------------------------------------------------------

  /**
   * Reads a step's input or output. For outputs: LRU hit first, then state
   * fallback. For inputs: state only (inputs are not cached in the LRU).
   *
   * Callers must ensure `rehydrate` has run before reading outputs — the
   * pre-warm guarantee makes the state fallback a safety net rather than a
   * normal code path.
   */
  public read(stepExecutionId: string, type: 'input' | 'output'): JsonValue | null | undefined {
    const cached = this.cache.get(stepExecutionId, type);
    if (cached !== undefined) return cached;
    if (type === 'output' && this.overflow.has(stepExecutionId)) {
      return this.overflow.get(stepExecutionId);
    }
    const live = this.state.getStepIo(stepExecutionId, type);
    if (live === undefined && type === 'input') {
      return this.inputOverflow.get(stepExecutionId);
    }
    return live;
  }

  public getStepError(stepExecutionId: string): SerializedError | undefined {
    return this.state.getStepExecution(stepExecutionId)?.error;
  }

  public getLatestStepIO(
    stepId: string,
    stackFrames?: readonly StackFrame[]
  ):
    | {
        input: JsonValue | undefined;
        output: JsonValue | null | undefined;
        error: SerializedError | undefined;
      }
    | undefined {
    const latest = this.state.getLatestStepExecution(stepId, stackFrames);
    if (!latest) return undefined;
    return {
      input: this.read(latest.id, 'input') ?? undefined,
      output: this.read(latest.id, 'output'),
      error: latest.error,
    };
  }

  // ----- IO writes ----------------------------------------------------------

  /**
   * Writes a step's input or output.
   *
   * - Both types are written to `WorkflowExecutionState` for persistence.
   * - Only `output` is written to the LRU cache. Inputs are served from state
   *   directly; extending to cache inputs requires removing the type guard here.
   */
  public write(
    stepExecutionId: string,
    type: 'input' | 'output',
    value: JsonValue | null,
    sizeBytes?: number
  ): void {
    this.state.setStepIo(stepExecutionId, { [type]: value });
    if (type === 'output') {
      const measuredBytes =
        sizeBytes !== undefined && Number.isFinite(sizeBytes) && sizeBytes >= 0
          ? sizeBytes
          : undefined;
      this.overflow.delete(stepExecutionId);
      this.cache.set(stepExecutionId, 'output', value, measuredBytes);
      if (measuredBytes !== undefined) {
        this.measuredTotalBytes += measuredBytes - (this.measuredSizes.get(stepExecutionId) ?? 0);
        this.measuredSizes.set(stepExecutionId, measuredBytes);
      }
    }
  }

  // ----- Telemetry ----------------------------------------------------------

  public getOutputSizeStats(): OutputSizeStats {
    return {
      totalBytes: this.measuredTotalBytes,
      stepCount: this.measuredSizes.size,
    };
  }

  // ----- Lifecycle ----------------------------------------------------------

  /**
   * Ensures the given step execution IDs are resident in the LRU cache,
   * fetching any cache misses from Elasticsearch. A no-op when all IDs are
   * already cached. IDs whose output is still held in state (written but not
   * yet flushed) are skipped, since Elasticsearch does not have them yet.
   *
   * Callers (WorkflowContextManager.ensureContextReady) are responsible for
   * resolving which IDs are needed before calling this method. Inputs of finished
   * steps are dropped from state, so they are only fetched for `inputIds`.
   */
  public async rehydrate(
    ids: ReadonlyArray<string>,
    inputIds: ReadonlyArray<string> = []
  ): Promise<void> {
    // Overflow copies live only as long as the requests in flight, so they stay bounded
    // by what the concurrent context builds need.
    const request = { ids: new Set(ids), inputIds: new Set(inputIds) };
    this.inFlight.add(request);
    try {
      this.pruneOverflow();
      await this.rehydrateOutputs(ids, inputIds);
    } finally {
      this.inFlight.delete(request);
    }
  }

  /** Drops overflow entries that no in-flight `rehydrate` call asked for. */
  private pruneOverflow(): void {
    const keepOutputs = new Set<string>();
    const keepInputs = new Set<string>();
    for (const { ids, inputIds } of this.inFlight) {
      ids.forEach((id) => keepOutputs.add(id));
      inputIds.forEach((id) => keepInputs.add(id));
    }
    retainOnly(this.overflow, keepOutputs);
    retainOnly(this.inputOverflow, keepInputs);
  }

  private async rehydrateOutputs(
    ids: ReadonlyArray<string>,
    inputIds: ReadonlyArray<string>
  ): Promise<void> {
    await this.rehydrateInputs(inputIds);
    const missing = ids.filter(
      (id) =>
        !this.cache.has(id, 'output') &&
        !this.overflow.has(id) &&
        this.state.getStepIo(id, 'output') === undefined
    );
    if (missing.length === 0) return;

    const docs = await this.stepRepository.getStepExecutionsByIds(missing, ['id', 'output']);
    const fetched: Array<{ id: string; output: JsonValue | null }> = [];
    for (const doc of docs) {
      // An output may have been written while the fetch was in flight.
      if (this.state.getStepIo(doc.id, 'output') === undefined) {
        const output = doc.output ?? null;
        const size = safeOutputSize(output) ?? undefined;
        this.cache.set(doc.id, 'output', output, size);
        // Outputs written before a resume are not in the counters yet.
        if (size !== undefined && !this.measuredSizes.has(doc.id)) {
          this.measuredSizes.set(doc.id, size);
          this.measuredTotalBytes += size;
        }
        fetched.push({ id: doc.id, output });
      }
    }
    // The LRU may reject oversized outputs. Keep those in the shared overflow copy so
    // callers can still read the full requested set.
    for (const { id, output } of fetched) {
      if (!this.cache.has(id, 'output')) this.overflow.set(id, output);
    }
    // Inserts above may also have evicted requested outputs that were already resident.
    const missingIds = new Set(missing);
    const evicted = ids.filter(
      (id) =>
        !missingIds.has(id) &&
        !this.cache.has(id, 'output') &&
        !this.overflow.has(id) &&
        this.state.getStepIo(id, 'output') === undefined
    );
    if (evicted.length === 0) return;
    const evictedDocs = await this.stepRepository.getStepExecutionsByIds(evicted, ['id', 'output']);
    for (const doc of evictedDocs) {
      if (this.state.getStepIo(doc.id, 'output') === undefined) {
        this.overflow.set(doc.id, doc.output ?? null);
      }
    }
  }

  /** Fetches inputs that state dropped after flush (finished steps) into `inputOverflow`. */
  private async rehydrateInputs(ids: ReadonlyArray<string>): Promise<void> {
    const missing = ids.filter(
      (id) =>
        this.state.getStepExecution(id) !== undefined &&
        this.state.getStepIo(id, 'input') === undefined &&
        !this.inputOverflow.has(id) &&
        this.state.isInputEvicted(id)
    );
    if (missing.length === 0) return;

    const docs = await this.stepRepository.getStepExecutionsByIds(missing, ['id', 'input']);
    const found = new Map(docs.map((doc) => [doc.id, doc.input ?? null]));
    for (const id of missing) {
      if (this.state.getStepIo(id, 'input') === undefined) {
        this.inputOverflow.set(id, found.get(id) ?? null);
      }
    }
  }
}
