/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { EuiLoadingSpinner, EuiText, useEuiTheme } from '@elastic/eui';
import React, { useEffect, useRef, useState } from 'react';
import { i18n } from '@kbn/i18n';
import { ExecutionStatus } from '@kbn/workflows';
import type { WorkflowStepExecutionDto } from '@kbn/workflows/types/latest';
import type { StepLogEntry, StepLogsApi, StepLogsConfig } from '@kbn/workflows-extensions/public';

const POLL_INTERVAL_MS = 2000;

interface StepLogsViewProps {
  stepExecution: WorkflowStepExecutionDto;
  config: StepLogsConfig;
  logsApi: StepLogsApi;
}

export const StepLogsView: React.FC<StepLogsViewProps> = ({ stepExecution, config, logsApi }) => {
  const { euiTheme } = useEuiTheme();
  const [entries, setEntries] = useState<StepLogEntry[] | null>(null);

  // Refs keep the latest prop values accessible inside the effect without
  // requiring them as deps — prevents restarting the poll interval on every
  // parent re-render while stepExecution.id and isRunning stay the same.
  const stepExecutionRef = useRef(stepExecution);
  stepExecutionRef.current = stepExecution;
  const configRef = useRef(config);
  configRef.current = config;
  const logsApiRef = useRef(logsApi);
  logsApiRef.current = logsApi;

  const isRunning = stepExecution.status === ExecutionStatus.RUNNING;

  useEffect(() => {
    let cancelled = false;

    const doFetch = async () => {
      if (cancelled) return;
      const cfg = configRef.current;
      const api = logsApiRef.current;
      const exec = stepExecutionRef.current;
      const result = cfg.getLogs
        ? await Promise.resolve(cfg.getLogs({ stepExecution: exec, logsApi: api }))
        : await api
            .fetchLogs()
            .then((raw) =>
              raw.map((e) => ({ message: e.message, timestamp: e.timestamp, level: e.level }))
            );
      if (!cancelled) setEntries(result);
    };

    doFetch();

    if (isRunning) {
      const interval = setInterval(doFetch, POLL_INTERVAL_MS);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    return () => {
      cancelled = true;
    };
    // stepExecution.id resets the effect (and any active interval) when the
    // selected step changes. isRunning toggles polling on/off.
  }, [isRunning, stepExecution.id]);

  if (entries === null) {
    return <EuiLoadingSpinner size="m" />;
  }

  if (entries.length === 0) {
    const message = isRunning
      ? i18n.translate('workflowsManagement.stepLogsView.runningPlaceholder', {
          defaultMessage: 'Waiting for logs…',
        })
      : i18n.translate('workflowsManagement.stepLogsView.emptyPlaceholder', {
          defaultMessage: 'No logs.',
        });
    return (
      <EuiText color="subdued" size="s">
        <p>{message}</p>
      </EuiText>
    );
  }

  const levelColor = (level: StepLogEntry['level']): string => {
    switch (level) {
      case 'warn':
        return euiTheme.colors.textWarning;
      case 'error':
        return euiTheme.colors.textDanger;
      case 'debug':
        return euiTheme.colors.textSubdued;
      default:
        return 'inherit';
    }
  };

  return (
    <pre
      css={{
        height: '100%',
        overflowY: 'auto',
        margin: 0,
        padding: euiTheme.size.s,
        fontFamily: euiTheme.font.familyCode,
        fontSize: euiTheme.size.m,
        lineHeight: `${euiTheme.base * 1.5}px`,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {entries.map((e, i) => (
        <div key={i} css={{ color: levelColor(e.level) }}>
          {e.message}
        </div>
      ))}
    </pre>
  );
};
