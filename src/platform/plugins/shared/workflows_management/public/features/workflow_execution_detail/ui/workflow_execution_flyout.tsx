/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import {
  copyToClipboard,
  EuiBadge,
  EuiButtonIcon,
  EuiCopy,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutFooter,
  EuiFlyoutHeader,
  EuiIcon,
  EuiLink,
  EuiLoadingSpinner,
  EuiTab,
  EuiTabs,
  EuiText,
  EuiTextTruncate,
  EuiTitle,
  EuiToolTip,
  useEuiTheme,
} from '@elastic/eui';
import { css } from '@emotion/react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux-v7';
import { i18n } from '@kbn/i18n';
import { isInProgressStatus } from '@kbn/workflows';
import { ExecutionTakeActionSplitButton } from './execution_take_action_split_button';
import { ResumeExecutionButton } from './resume_execution_button';
import { ResumeUnavailableCallout } from './resume_unavailable_callout';
import { StepExecutionsTruncatedCallout } from './step_executions_truncated_callout';
import { useDeferredChildMount } from './use_deferred_child_mount';
import {
  WORKFLOW_EXECUTION_FLYOUT_HISTORY_KEY,
  WORKFLOW_EXECUTION_STEP_SESSION_KEY,
} from './workflow_execution_flyout_session';
import { WorkflowExecutionStepFlyout } from './workflow_execution_step_flyout';
import { WorkflowStepExecutionTree } from './workflow_step_execution_tree';
import { areStepExecutionsUnavailable } from '../../../../common';
import { ServiceAccountName } from '../../../entities/service_accounts';
import { useWorkflowExecutionPolling } from '../../../entities/workflows/model/use_workflow_execution_polling';
import { selectStepExecutionsTotal } from '../../../entities/workflows/store/workflow_detail/selectors';
import { useNavigateToExecution } from '../../../hooks/navigation/use_navigate_to_execution';
import { useKibana } from '../../../hooks/use_kibana';
import { useWorkflowUrlState } from '../../../hooks/use_workflow_url_state';
import { formatDuration } from '../../../shared/lib/format_duration';
import { getStatusLabel } from '../../../shared/translations/status_translations';
import { JSONCodeEditorCommonMemoized } from '../../../shared/ui/execution_data_viewer/json_editor_common';
import { FormattedRelativeEnhanced } from '../../../shared/ui/formatted_relative_enhanced/formatted_relative_enhanced';
import { getExecutionStatusIcon } from '../../../shared/ui/status_badge';
import { formatExecutionTimestamp } from '../../../shared/ui/use_formatted_date';
import { getFailedStepPosition } from '../lib/get_failed_step_position';
import { getRunMode } from '../lib/get_run_mode';
import { useChildWorkflowExecutions } from '../model/use_child_workflow_executions';
import { useWaitingStepResume } from '../model/use_waiting_step_resume';

export interface WorkflowExecutionFlyoutProps {
  executionId: string;
  /** Optional; falls back to the loaded execution / definition name. */
  workflowName?: string;
  /** Optional; falls back to tags on the workflow definition when present. */
  workflowTags?: string[];
  onClose: () => void;
  /** `inherit` when the history list is the session root. `start` on the executions page. */
  session?: 'start' | 'inherit';
}

type FlyoutTabId = 'table' | 'json';

const i18nTexts = {
  result: i18n.translate('workflows.executionFlyout.result', { defaultMessage: 'Result' }),
  executionTime: i18n.translate('workflows.executionFlyout.executionTime', {
    defaultMessage: 'Execution time',
  }),
  executedBy: i18n.translate('workflows.executionFlyout.executedBy', {
    defaultMessage: 'Triggered by',
  }),
  tableTab: i18n.translate('workflows.executionFlyout.tableTab', { defaultMessage: 'Table' }),
  jsonTab: i18n.translate('workflows.executionFlyout.jsonTab', { defaultMessage: 'JSON' }),
  share: i18n.translate('workflows.executionFlyout.share', { defaultMessage: 'Share' }),
  testRun: i18n.translate('workflows.executionFlyout.runMode.testRun', {
    defaultMessage: 'Test run',
  }),
  linkCopied: i18n.translate('workflows.executionFlyout.share.linkCopied', {
    defaultMessage: 'Execution link copied',
  }),
};

const FLYOUT_CLASSNAME = 'workflowExecutionFlyout';

const STEP_TEST_NAME_MAX_LEN = 24;

const truncateStepName = (name: string): string =>
  name.length > STEP_TEST_NAME_MAX_LEN ? `${name.slice(0, STEP_TEST_NAME_MAX_LEN)}…` : name;

export const WorkflowExecutionFlyout = React.memo<WorkflowExecutionFlyoutProps>(
  ({
    executionId,
    workflowName: workflowNameProp,
    workflowTags: workflowTagsProp,
    onClose,
    session = 'start',
  }) => {
    const { euiTheme } = useEuiTheme();
    const { application, notifications, settings } = useKibana().services;
    const timeZoneSetting: string | undefined = settings.client.get('dateFormat:tz');
    const [activeTab, setActiveTab] = useState<FlyoutTabId>('table');
    const {
      selectedStepExecutionId: urlSelectedStepExecutionId,
      setSelectedStepExecution,
      shouldAutoResume,
    } = useWorkflowUrlState();
    const selectedStepExecutionId = urlSelectedStepExecutionId ?? null;
    // EUI shows the session root and one child. While a step is open on the workflow
    // page, the execution becomes that root so the visible pair is the execution and
    // the step. The list stays mounted in its own session and returns when the step closes.
    const stepSessionActive = session === 'inherit' && selectedStepExecutionId != null;
    const managedSession = stepSessionActive ? 'start' : session;
    const historyKey = stepSessionActive
      ? WORKFLOW_EXECUTION_STEP_SESSION_KEY
      : WORKFLOW_EXECUTION_FLYOUT_HISTORY_KEY;
    const [registeredSession, setRegisteredSession] = useState<'start' | 'inherit' | null>(null);
    useLayoutEffect(() => {
      setRegisteredSession(managedSession);
    }, [managedSession]);
    const setSelectedStepExecutionId = useCallback(
      (stepExecutionId: string | null) => {
        setSelectedStepExecution(stepExecutionId);
      },
      [setSelectedStepExecution]
    );
    const [autoExpandErrorForStepId, setAutoExpandErrorForStepId] = useState<string | null>(null);
    const [errorArrivalPulseStepId, setErrorArrivalPulseStepId] = useState<string | null>(null);
    const autoExpandedForExecutionIdRef = useRef<string | null>(null);

    const { workflowExecution, error } = useWorkflowExecutionPolling(executionId);
    const {
      waitingStepExecutionId,
      waitingStepStartedAt,
      resumeMessage,
      resumeSchema,
      approvalLabels,
      hasResumeError,
      retryResume,
    } = useWaitingStepResume(executionId, workflowExecution);
    const [isResumeSubmitting, setIsResumeSubmitting] = useState(false);
    const [isResumeSubmitted, setIsResumeSubmitted] = useState(false);
    const resumeSubmitState = useMemo(
      () => ({
        isSubmitting: isResumeSubmitting,
        isSubmitted: isResumeSubmitted,
        setSubmitting: setIsResumeSubmitting,
        setSubmitted: setIsResumeSubmitted,
      }),
      [isResumeSubmitting, isResumeSubmitted]
    );

    // The selected step is URL state: switching runs already drops `stepExecutionId`, and
    // clearing it here would wipe a deep-linked step on mount.
    useEffect(() => {
      setIsResumeSubmitting(false);
      setIsResumeSubmitted(false);
    }, [executionId]);

    useEffect(() => {
      setIsResumeSubmitting(false);
      setIsResumeSubmitted(false);
    }, [waitingStepExecutionId]);

    const stepExecutionsTotal = useSelector(selectStepExecutionsTotal);
    const stepExecutionsUnavailable = areStepExecutionsUnavailable({
      stepExecutionsTotal,
      loadedCount: workflowExecution?.stepExecutions.length ?? 0,
      isInProgress: workflowExecution ? isInProgressStatus(workflowExecution.status) : false,
    });
    const showStepExecutionTree =
      activeTab === 'table' || error !== null || stepExecutionsUnavailable;
    // Monaco renders only the visible lines, so a run with thousands of loaded steps stays usable.
    // Only stringify while the JSON tab is showing; the Table tab re-renders on every poll.
    const executionJson = useMemo(
      () =>
        !showStepExecutionTree && workflowExecution
          ? JSON.stringify(workflowExecution, null, 2)
          : '',
      [showStepExecutionTree, workflowExecution]
    );

    const workflowName =
      workflowNameProp ||
      workflowExecution?.workflowName ||
      workflowExecution?.workflowDefinition?.name ||
      workflowExecution?.workflowId ||
      '';
    const workflowTags = workflowTagsProp ?? workflowExecution?.workflowDefinition?.tags ?? [];

    const { href: executionHref } = useNavigateToExecution({
      workflowId: workflowExecution?.workflowId ?? '',
      executionId,
    });

    const workflowDefinition = workflowExecution?.workflowDefinition ?? null;

    const failedPosition = useMemo(
      () => getFailedStepPosition(workflowExecution, workflowDefinition),
      [workflowExecution, workflowDefinition]
    );

    const runModeInfo = useMemo(
      () => (workflowExecution ? getRunMode(workflowExecution) : null),
      [workflowExecution]
    );

    const scrollToFailedStep = useCallback((stepExecutionId: string) => {
      // Wait for Table tree paint (including tab switch + ancestor expand).
      window.setTimeout(() => {
        const node = document.querySelector(
          `[data-test-subj="workflowStepTreeNode"][data-step-execution-id="${stepExecutionId}"]`
        );
        const errorRegion = node?.querySelector('[data-test-subj="workflowFailedStepErrorPanel"]');
        (errorRegion ?? node)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 0);
    }, []);

    const focusFailedStep = useCallback(
      (stepExecutionId: string) => {
        setActiveTab('table');
        setSelectedStepExecutionId(stepExecutionId);
        setAutoExpandErrorForStepId(stepExecutionId);
        setErrorArrivalPulseStepId(stepExecutionId);
        scrollToFailedStep(stepExecutionId);
      },
      [scrollToFailedStep, setSelectedStepExecutionId]
    );

    // Clear the one-shot arrival pulse after the animation window (~1.2s).
    useEffect(() => {
      if (!errorArrivalPulseStepId) return;
      const timer = window.setTimeout(() => {
        setErrorArrivalPulseStepId(null);
      }, 1300);
      return () => window.clearTimeout(timer);
    }, [errorArrivalPulseStepId]);

    // Highlight the failed step in the tree once per execution open (not on tab switches).
    // Do not open the step-detail sub-flyout — that is only for an explicit step click.
    useEffect(() => {
      if (!workflowExecution || !failedPosition) return;
      if (autoExpandedForExecutionIdRef.current === workflowExecution.id) return;
      autoExpandedForExecutionIdRef.current = workflowExecution.id;
      setActiveTab('table');
      setAutoExpandErrorForStepId(failedPosition.step.id);
      setErrorArrivalPulseStepId(failedPosition.step.id);
      scrollToFailedStep(failedPosition.step.id);
    }, [workflowExecution, failedPosition, scrollToFailedStep]);

    const handleShare = useCallback(() => {
      if (!workflowExecution?.workflowId) return;
      const hrefWithStep =
        selectedStepExecutionId != null
          ? `${executionHref}${
              executionHref.includes('?') ? '&' : '?'
            }stepExecutionId=${encodeURIComponent(selectedStepExecutionId)}`
          : executionHref;
      const absolute =
        typeof window !== 'undefined' ? `${window.location.origin}${hrefWithStep}` : hrefWithStep;
      copyToClipboard(absolute);
      notifications.toasts.addSuccess(i18nTexts.linkCopied, { toastLifeTimeMs: 2000 });
    }, [
      executionHref,
      notifications.toasts,
      selectedStepExecutionId,
      workflowExecution?.workflowId,
    ]);

    const handleOpenFailedStepInEditor = useCallback(
      (_stepId: string) => {
        if (!workflowExecution?.workflowId) return;
        application.navigateToApp('workflows', { path: `/${workflowExecution.workflowId}` });
      },
      [application, workflowExecution?.workflowId]
    );

    const { childExecutions, isLoading: isLoadingChildExecutions } =
      useChildWorkflowExecutions(workflowExecution);

    const startedAt = useMemo(
      () => (workflowExecution?.startedAt ? new Date(workflowExecution.startedAt) : null),
      [workflowExecution?.startedAt]
    );
    const formattedDate = formatExecutionTimestamp(workflowExecution?.startedAt, 'header', {
      timeZoneSetting,
    });
    const formattedDateTooltip = formatExecutionTimestamp(workflowExecution?.startedAt, 'tooltip', {
      timeZoneSetting,
    });
    const formattedDuration = useMemo(
      () =>
        workflowExecution?.duration != null ? formatDuration(workflowExecution.duration) : null,
      [workflowExecution?.duration]
    );
    const executedByValue = workflowExecution?.executedBy?.trim() || '';
    const executedByDisplay = executedByValue || '-';

    const showRunModeBadge = runModeInfo?.runMode === 'test' || runModeInfo?.runMode === 'stepTest';
    const showTagsRow = showRunModeBadge || workflowTags.length > 0;
    const stepTestTargetName = runModeInfo?.stepTestTargetName ?? '';
    const showStepFlyout =
      useDeferredChildMount(selectedStepExecutionId != null) &&
      managedSession === 'start' &&
      registeredSession === 'start';

    return (
      <>
        <EuiFlyout
          aria-label={i18n.translate('workflows.executionFlyout.ariaLabel', {
            defaultMessage: 'Execution of {name}',
            values: { name: workflowName },
          })}
          onClose={onClose}
          session={managedSession}
          historyKey={historyKey}
          type={managedSession === 'start' ? 'push' : undefined}
          size="m"
          ownFocus={managedSession === 'inherit' ? false : undefined}
          paddingSize="none"
          className={FLYOUT_CLASSNAME}
          data-test-subj="workflowExecutionFlyout"
        >
          <EuiFlyoutHeader css={{ padding: 0 }}>
            <EuiFlexGroup
              justifyContent="flexEnd"
              alignItems="center"
              gutterSize="xs"
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
              <EuiToolTip content={i18nTexts.share} disableScreenReaderOutput>
                <EuiButtonIcon
                  iconType="share"
                  aria-label={i18nTexts.share}
                  color="text"
                  size="s"
                  iconSize="m"
                  onClick={handleShare}
                  isDisabled={!workflowExecution?.workflowId}
                  data-test-subj="workflowExecutionFlyoutShare"
                />
              </EuiToolTip>
            </EuiFlexGroup>

            <div
              css={{
                padding: '16px 16px 8px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '16px',
              }}
            >
              <div>
                <EuiTitle size="s">
                  <h2 css={{ wordBreak: 'break-word' }}>{workflowName}</h2>
                </EuiTitle>
                {formattedDate && startedAt && (
                  <EuiToolTip content={formattedDateTooltip} position="top">
                    <span tabIndex={0}>
                      <EuiText
                        size="xs"
                        color="subdued"
                        css={{ marginTop: '3px' }}
                        data-test-subj="workflowExecutionFlyoutStartedAt"
                      >
                        {formattedDate}
                        {' ('}
                        <FormattedRelativeEnhanced value={startedAt} />
                        {')'}
                      </EuiText>
                    </span>
                  </EuiToolTip>
                )}
              </div>

              {showTagsRow && (
                <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
                  {runModeInfo?.runMode === 'test' && (
                    <EuiFlexItem grow={false}>
                      <EuiBadge color="warning" iconType="flask">
                        {i18nTexts.testRun}
                      </EuiBadge>
                    </EuiFlexItem>
                  )}
                  {runModeInfo?.runMode === 'stepTest' && (
                    <EuiFlexItem grow={false}>
                      <EuiToolTip content={stepTestTargetName}>
                        <EuiBadge tabIndex={0} color="warning" iconType="flask">
                          {i18n.translate('workflows.executionFlyout.runMode.stepTest', {
                            defaultMessage: 'Step test: {name}',
                            values: { name: truncateStepName(stepTestTargetName) },
                          })}
                        </EuiBadge>
                      </EuiToolTip>
                    </EuiFlexItem>
                  )}
                  {workflowTags.map((tag) => (
                    <EuiFlexItem grow={false} key={tag}>
                      <EuiBadge color="hollow">{tag}</EuiBadge>
                    </EuiFlexItem>
                  ))}
                </EuiFlexGroup>
              )}

              {workflowExecution ? (
                <div
                  css={{
                    border: `1px solid ${euiTheme.colors.borderBaseSubdued}`,
                    borderRadius: '10px',
                    padding: '12px',
                    minWidth: 0,
                    maxWidth: '100%',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    css={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: '16px',
                      minWidth: 0,
                    }}
                  >
                    <div
                      css={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <EuiText size="s" color="subdued" css={{ fontWeight: 500, fontSize: '12px' }}>
                        {i18nTexts.result}
                      </EuiText>
                      <EuiFlexGroup
                        gutterSize="none"
                        css={{ gap: '4px', minWidth: 0 }}
                        alignItems="center"
                        responsive={false}
                      >
                        <EuiFlexItem grow={false}>
                          {getExecutionStatusIcon(euiTheme, workflowExecution.status)}
                        </EuiFlexItem>
                        <EuiFlexItem grow={false} css={{ minWidth: 0 }}>
                          {failedPosition ? (
                            <EuiLink
                              color="danger"
                              data-test-subj="workflowExecutionFlyoutResultLink"
                              onClick={() => {
                                focusFailedStep(failedPosition.step.id);
                              }}
                              css={{
                                fontWeight: 600,
                                fontSize: '12px',
                                textDecoration: 'underline',
                              }}
                            >
                              {failedPosition.index != null
                                ? i18n.translate('workflows.executionFlyout.result.failedAtStep', {
                                    defaultMessage: 'Failed at step {n}',
                                    values: {
                                      n: failedPosition.index,
                                    },
                                  })
                                : i18n.translate('workflows.executionFlyout.result.failed', {
                                    defaultMessage: 'Failed',
                                  })}
                            </EuiLink>
                          ) : (
                            <EuiText size="s" css={{ fontWeight: 600, fontSize: '12px' }}>
                              {getStatusLabel(workflowExecution.status)}
                            </EuiText>
                          )}
                        </EuiFlexItem>
                      </EuiFlexGroup>
                    </div>

                    <div
                      aria-hidden="true"
                      css={{
                        width: '1px',
                        alignSelf: 'stretch',
                        background: euiTheme.colors.borderBaseSubdued,
                        flexShrink: 0,
                      }}
                    />

                    <div
                      css={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <EuiText size="s" color="subdued" css={{ fontWeight: 500, fontSize: '12px' }}>
                        {i18nTexts.executionTime}
                      </EuiText>
                      <EuiFlexGroup
                        gutterSize="none"
                        css={{ gap: '4px', minWidth: 0 }}
                        alignItems="center"
                        responsive={false}
                      >
                        <EuiFlexItem grow={false}>
                          <EuiIcon type="clock" color="subdued" size="m" aria-hidden={true} />
                        </EuiFlexItem>
                        <EuiFlexItem grow={false} css={{ minWidth: 0 }}>
                          <EuiText size="s" css={{ fontWeight: 600, fontSize: '12px' }}>
                            {formattedDuration ?? '-'}
                          </EuiText>
                        </EuiFlexItem>
                      </EuiFlexGroup>
                    </div>

                    <div
                      aria-hidden="true"
                      css={{
                        width: '1px',
                        alignSelf: 'stretch',
                        background: euiTheme.colors.borderBaseSubdued,
                        flexShrink: 0,
                      }}
                    />

                    <div
                      css={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '2px',
                        flex: 1,
                        minWidth: 0,
                      }}
                      data-test-subj="workflowExecutionFlyoutExecutedBy"
                    >
                      <EuiText size="s" color="subdued" css={{ fontWeight: 500, fontSize: '12px' }}>
                        {i18nTexts.executedBy}
                      </EuiText>
                      <EuiFlexGroup
                        gutterSize="xs"
                        alignItems="center"
                        responsive={false}
                        wrap={false}
                        css={{ minWidth: 0, width: '100%' }}
                      >
                        <EuiFlexItem grow css={{ minWidth: 0 }}>
                          <EuiToolTip content={executedByDisplay} display="block">
                            <EuiText
                              tabIndex={0}
                              size="s"
                              css={{
                                fontWeight: 600,
                                fontSize: '12px',
                                minWidth: 0,
                              }}
                            >
                              <EuiTextTruncate text={executedByDisplay} truncation="middle" />
                            </EuiText>
                          </EuiToolTip>
                        </EuiFlexItem>
                        {executedByValue ? (
                          <EuiFlexItem grow={false}>
                            <EuiCopy textToCopy={executedByValue}>
                              {(copy) => {
                                const copyLabel = i18n.translate(
                                  'workflows.executionFlyout.executedBy.copy',
                                  { defaultMessage: 'Copy executed by' }
                                );
                                return (
                                  <EuiToolTip content={copyLabel} disableScreenReaderOutput>
                                    <EuiButtonIcon
                                      iconType="copy"
                                      size="xs"
                                      color="text"
                                      aria-label={copyLabel}
                                      onClick={copy}
                                      data-test-subj="workflowExecutionFlyoutExecutedByCopy"
                                    />
                                  </EuiToolTip>
                                );
                              }}
                            </EuiCopy>
                          </EuiFlexItem>
                        ) : null}
                      </EuiFlexGroup>
                      {workflowExecution?.effectiveIdentity?.type === 'service_account' && (
                        <EuiText size="s" data-test-subj="workflowExecutionFlyoutRunAs">
                          {i18n.translate('workflows.executionFlyout.runAs', {
                            defaultMessage: 'Run as',
                          })}
                          {': '}
                          <ServiceAccountName id={workflowExecution.effectiveIdentity.id} />
                        </EuiText>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <EuiLoadingSpinner size="m" />
              )}

              {waitingStepExecutionId && workflowExecution && (
                <ResumeExecutionButton
                  executionId={executionId}
                  workflowId={workflowExecution.workflowId}
                  stepStartedAt={waitingStepStartedAt}
                  resumeMessage={resumeMessage}
                  resumeSchema={resumeSchema}
                  approvalLabels={approvalLabels}
                  autoOpen={shouldAutoResume}
                  waitingStepExecutionId={waitingStepExecutionId}
                  submitState={resumeSubmitState}
                />
              )}
              {hasResumeError && <ResumeUnavailableCallout onRetry={retryResume} />}
            </div>
          </EuiFlyoutHeader>

          <EuiFlyoutBody
            css={css`
              .euiFlyoutBody__overflowContent {
                padding: 0;
              }
            `}
          >
            {!workflowExecution && !error ? (
              <EuiFlexGroup
                justifyContent="center"
                css={{ padding: `${euiTheme.size.xl} ${euiTheme.size.base} 0` }}
              >
                <EuiFlexItem grow={false}>
                  <EuiLoadingSpinner size="l" />
                </EuiFlexItem>
              </EuiFlexGroup>
            ) : (
              <>
                <EuiTabs css={{ paddingInline: euiTheme.size.base }}>
                  <EuiTab isSelected={activeTab === 'table'} onClick={() => setActiveTab('table')}>
                    {i18nTexts.tableTab}
                  </EuiTab>
                  <EuiTab isSelected={activeTab === 'json'} onClick={() => setActiveTab('json')}>
                    {i18nTexts.jsonTab}
                  </EuiTab>
                </EuiTabs>
                {/*
                    No Table-tab step search: findability is auto-scroll, the header
                    failure link, and iteration pins. If step search returns, spec
                    expand-on-match and match handling inside collapsed gaps/attempts
                    first — naive filter breaks the pin/gap model. (Subflyout
                    Input/Output field/value search is separate and required.)
                  */}
                <div
                  css={{
                    padding: `${euiTheme.size.s} ${euiTheme.size.base} ${euiTheme.size.base}`,
                  }}
                >
                  {/* Both tabs show the same paginated run, so the callout is outside the Table branch. */}
                  <StepExecutionsTruncatedCallout
                    executionId={executionId}
                    loadedCount={workflowExecution?.stepExecutions.length ?? 0}
                  />
                  {showStepExecutionTree && (
                    <WorkflowStepExecutionTree
                      definition={workflowDefinition}
                      execution={workflowExecution ?? null}
                      stepExecutionsTotal={stepExecutionsTotal}
                      error={error}
                      onStepExecutionClick={setSelectedStepExecutionId}
                      selectedId={selectedStepExecutionId}
                      childExecutionsMap={childExecutions}
                      isLoadingChildExecutions={isLoadingChildExecutions}
                      autoExpandErrorForStepId={autoExpandErrorForStepId}
                      errorArrivalPulseStepId={errorArrivalPulseStepId}
                      workflowName={workflowName}
                      onBeforeDiagnose={() => setSelectedStepExecutionId(null)}
                    />
                  )}
                  {!showStepExecutionTree && (
                    <div css={{ height: '70vh' }}>
                      <JSONCodeEditorCommonMemoized
                        data-test-subj="workflowExecutionJsonEditor"
                        jsonValue={executionJson}
                        onEditorDidMount={() => {}}
                        height="100%"
                        hasLineNumbers
                        enableFindAction
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </EuiFlyoutBody>

          <EuiFlyoutFooter>
            <div css={{ padding: `${euiTheme.size.m} ${euiTheme.size.base}` }}>
              <EuiFlexGroup justifyContent="flexEnd" gutterSize="none">
                <EuiFlexItem grow={false}>
                  {workflowExecution && (
                    <ExecutionTakeActionSplitButton
                      execution={workflowExecution}
                      failedStepId={failedPosition?.step.stepId}
                      onOpenFailedStepInEditor={handleOpenFailedStepInEditor}
                    />
                  )}
                </EuiFlexItem>
              </EuiFlexGroup>
            </div>
          </EuiFlyoutFooter>
        </EuiFlyout>
        {showStepFlyout ? (
          <WorkflowExecutionStepFlyout
            executionId={executionId}
            workflowExecution={workflowExecution}
            childExecutions={childExecutions}
            waitingStepExecutionId={waitingStepExecutionId}
            waitingStepStartedAt={waitingStepStartedAt}
            resumeMessage={resumeMessage}
            resumeSchema={resumeSchema}
            approvalLabels={approvalLabels}
            resumeSubmitState={resumeSubmitState}
          />
        ) : null}
      </>
    );
  }
);
WorkflowExecutionFlyout.displayName = 'WorkflowExecutionFlyout';
