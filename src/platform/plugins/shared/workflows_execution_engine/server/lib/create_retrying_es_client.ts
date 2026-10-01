/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import { retryTransientEsErrors } from './retry_transient_es_errors';

const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  value !== null &&
  (typeof value === 'object' || typeof value === 'function') &&
  typeof (value as { then?: unknown }).then === 'function';

const wrapTarget = (target: object, logger: Logger, cache: WeakMap<object, unknown>): object => {
  const cached = cache.get(target);
  if (cached) return cached as object;

  const proxy = new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver);

      if (typeof value === 'function') {
        return (...args: unknown[]) => {
          const invoke = () => (value as (...a: unknown[]) => unknown).apply(t, args);
          const firstResult = invoke();
          // Synchronous members (e.g. `child()`) must keep returning their real value.
          if (!isThenable(firstResult)) {
            return firstResult;
          }
          // Reuse the in-flight first attempt so the call is not issued twice.
          let pendingFirst: PromiseLike<unknown> | undefined = firstResult;
          return retryTransientEsErrors(
            async () => {
              if (pendingFirst) {
                const first = pendingFirst;
                pendingFirst = undefined;
                return first;
              }
              return invoke();
            },
            { logger }
          );
        };
      }

      if (value !== null && typeof value === 'object') {
        return wrapTarget(value as object, logger, cache);
      }

      return value;
    },
  });

  cache.set(target, proxy);
  return proxy;
};

export const createRetryingEsClient = (
  esClient: ElasticsearchClient,
  logger: Logger
): ElasticsearchClient => wrapTarget(esClient, logger, new WeakMap()) as ElasticsearchClient;
