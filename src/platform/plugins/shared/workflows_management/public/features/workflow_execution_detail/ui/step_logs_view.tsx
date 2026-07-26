/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { EuiLoadingSpinner, EuiText, useEuiTheme } from '@elastic/eui';
import React, { useEffect, useState } from 'react';
import { i18n } from '@kbn/i18n';
import { ExecutionStatus } from '@kbn/workflows';
import type { WorkflowStepExecutionDto } from '@kbn/workflows/types/latest';
import type { StepLogEntry, StepLogsApi, StepLogsConfig } from '@kbn/workflows-extensions/public';

interface StepLogsViewProps {
  stepExecution: WorkflowStepExecutionDto;
  config: StepLogsConfig;
  logsApi: StepLogsApi;
}

export const StepLogsView: React.FC<StepLogsViewProps> = ({ stepExecution, config, logsApi }) => {
  const { euiTheme } = useEuiTheme();
  const [entries, setEntries] = useState<StepLogEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    const resolve: Promise<StepLogEntry[]> = config.getLogs
      ? Promise.resolve(config.getLogs({ stepExecution, logsApi }))
      : logsApi
          .fetchLogs()
          .then((raw) =>
            raw.map((e) => ({ message: e.message, timestamp: e.timestamp, level: e.level }))
          );

    resolve.then((result) => {
      if (!cancelled) setEntries(result);
    });

    return () => {
      cancelled = true;
    };
  }, [stepExecution, config, logsApi]);

  if (entries === null) {
    return <EuiLoadingSpinner size="m" />;
  }

  if (entries.length === 0) {
    const message =
      stepExecution.status === ExecutionStatus.RUNNING
        ? i18n.translate('workflowsManagement.stepLogsView.runningPlaceholder', {
            defaultMessage: 'Logs available when step completes.',
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
