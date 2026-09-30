/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  EuiButtonIcon,
  EuiFlexGroup,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiToolTip,
  useEuiTheme,
} from '@elastic/eui';
import { css } from '@emotion/react';
import React from 'react';
import { i18n } from '@kbn/i18n';
import { WorkflowExecutionList } from './workflow_execution_list_stateful';
import { WORKFLOW_EXECUTION_FLYOUT_HISTORY_KEY } from '../../workflow_execution_detail/ui/workflow_execution_flyout_session';

export interface WorkflowExecutionListFlyoutProps {
  workflowId: string;
  onClose: () => void;
}

export const WorkflowExecutionListFlyout = ({
  workflowId,
  onClose,
}: WorkflowExecutionListFlyoutProps) => {
  const { euiTheme } = useEuiTheme();

  return (
    <EuiFlyout
      aria-label={i18n.translate('workflows.executionListFlyout.ariaLabel', {
        defaultMessage: 'Workflow execution history',
      })}
      onClose={onClose}
      session="start"
      historyKey={WORKFLOW_EXECUTION_FLYOUT_HISTORY_KEY}
      type="push"
      size={480}
      paddingSize="none"
      hideCloseButton
      data-test-subj="workflowExecutionListFlyout"
    >
      <EuiFlyoutHeader css={{ padding: 0 }}>
        <EuiFlexGroup
          justifyContent="flexEnd"
          alignItems="center"
          gutterSize="none"
          responsive={false}
          css={{
            // AppHeader compact: 8px padding + 32px size="s" control = 48px.
            boxSizing: 'border-box',
            minHeight: 48,
            paddingBlock: euiTheme.size.s,
            paddingInline: euiTheme.size.s,
            borderBottom: euiTheme.border.thin,
          }}
        >
          <EuiToolTip
            content={i18n.translate('workflows.executionListFlyout.close', {
              defaultMessage: 'Close',
            })}
            disableScreenReaderOutput
          >
            <EuiButtonIcon
              iconType="cross"
              aria-label={i18n.translate('workflows.executionListFlyout.close', {
                defaultMessage: 'Close',
              })}
              color="text"
              size="s"
              iconSize="m"
              onClick={onClose}
            />
          </EuiToolTip>
        </EuiFlexGroup>
      </EuiFlyoutHeader>

      <EuiFlyoutBody
        css={css`
          .euiFlyoutBody__overflowContent {
            padding: 0;
          }
        `}
      >
        <WorkflowExecutionList workflowId={workflowId} />
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
