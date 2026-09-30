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
  EuiBasicTable,
  EuiButtonEmpty,
  EuiButtonIcon,
  EuiCodeBlock,
  EuiContextMenuItem,
  EuiContextMenuPanel,
  EuiFieldSearch,
  EuiFlexGroup,
  EuiFlexItem,
  EuiFlyout,
  EuiFlyoutBody,
  EuiFlyoutHeader,
  EuiHorizontalRule,
  EuiLoadingSpinner,
  EuiPopover,
  EuiText,
  EuiTextTruncate,
  EuiTitle,
  EuiToken,
  EuiToolTip,
  useEuiTheme,
} from '@elastic/eui';
import type { Criteria, EuiBasicTableColumn } from '@elastic/eui';
import { css } from '@emotion/react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { i18n } from '@kbn/i18n';
import type { WorkflowExecutionDto, WorkflowStepExecutionDto } from '@kbn/workflows';
import { ExecutionStatus } from '@kbn/workflows';
import type { JsonModelSchemaType } from '@kbn/workflows/spec/schema/common/json_model_schema';
import { AiStepSection } from './ai_step_section';
import { ForeachIterationsSection } from './foreach_iterations_section';
import { NestedWorkflowExecutionLinks } from './nested_workflow_execution_links';
import type { ApprovalLabels } from './resume_execution_button';
import { ResumeExecutionButton } from './resume_execution_button';
import { StepDataValueCell } from './step_data_value_cell';
import { StepDetailAccordionSection } from './step_detail_accordion_section';
import { WORKFLOW_EXECUTION_FLYOUT_HISTORY_KEY } from './workflow_execution_flyout_session';
import {
  buildOverviewStepExecutionFromContext,
  buildTriggerStepExecutionFromContext,
  isOverviewContextField,
} from './workflow_pseudo_step_context';
import {
  useAvailableConnectors,
  useFetchConnector,
} from '../../../entities/connectors/model/use_available_connectors';
import { useWorkflowUrlState } from '../../../hooks/use_workflow_url_state';
import { appendKeyPath } from '../../../shared/lib/flatten_key_paths';
import { formatDuration } from '../../../shared/lib/format_duration';
import { StepIcon } from '../../../shared/ui/step_icons/step_icon';
import { TokenUsageBreakdown } from '../../../shared/ui/token_usage_badge/token_usage_breakdown';
import {
  buildIterationPseudoStep,
  isIterationPseudoStepId,
} from '../lib/build_iteration_pseudo_step';
import { findStepConnectorId } from '../lib/find_step_connector_id';
import { getStepFieldPathPrefix } from '../lib/get_step_field_path_prefix';
import { isTokenUsageTableField } from '../lib/is_token_usage_table_field';
import { normalizeStepAi } from '../lib/normalize_step_ai';
import { resolveSelectedStepExecution } from '../model/resolve_selected_step_execution';
import type { ChildWorkflowExecutionsMap } from '../model/use_child_workflow_executions';
import { useStepExecution } from '../model/use_step_execution';

/** Field column: content-sized between a header-comfortable min and a path-truncation max. */
const FIELD_COLUMN_MIN_PX = 100;
const FIELD_COLUMN_MAX_PX = 160;

type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'null';
interface StepDataTableRow {
  field: string;
  value: string;
  fieldType: FieldType;
}

const fieldTypeToToken: Record<FieldType, string> = {
  string: 'tokenString',
  number: 'tokenNumber',
  boolean: 'tokenBoolean',
  array: 'tokenArray',
  null: 'tokenNull',
};

const flattenToRows = (
  value: unknown,
  prefix = ''
): Array<{ field: string; value: string; fieldType: FieldType }> => {
  if (value === null || value === undefined || typeof value !== 'object' || Array.isArray(value)) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, val]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
      return flattenToRows(val, fullKey);
    }
    const fieldType: FieldType =
      val === null ? 'null' : Array.isArray(val) ? 'array' : (typeof val as FieldType);
    const display =
      val === null
        ? 'null'
        : Array.isArray(val)
        ? JSON.stringify(val)
        : typeof val === 'string'
        ? val
        : String(val);
    return [{ field: fullKey, value: display, fieldType }];
  });
};

/** Table view only — AI section owns tokenUsage presentation. JSON view stays raw. */
const filterTokenUsageFromTableRows = <T extends { field: string }>(rows: T[]): T[] =>
  rows.filter((row) => !isTokenUsageTableField(row.field));

const isTableable = (v: unknown): boolean =>
  v !== null &&
  v !== undefined &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v as object).length > 0;

const SECTION_PAGE_SIZE = 10;

const StepDataSection = ({
  label,
  data,
  fieldPathPrefix,
  isFieldPathCopyable,
}: {
  label: string;
  data: unknown;
  fieldPathPrefix?: string;
  /** Hides copy on rows whose field is not a real template path. Copy is on for all rows if omitted. */
  isFieldPathCopyable?: (field: string) => boolean;
}) => {
  const { euiTheme } = useEuiTheme();
  const [view, setView] = useState<'table' | 'code'>(() => (isTableable(data) ? 'table' : 'code'));
  const [isViewPopoverOpen, setIsViewPopoverOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [pageIndex, setPageIndex] = useState(0);

  const hasTable = isTableable(data);
  const effectiveView = hasTable ? view : 'code';

  const rows = useMemo(() => filterTokenUsageFromTableRows(flattenToRows(data)), [data]);

  const filteredRows = useMemo(() => {
    if (!searchTerm) return rows;
    const term = searchTerm.toLowerCase();
    return rows.filter(
      (row) => row.field.toLowerCase().includes(term) || row.value.toLowerCase().includes(term)
    );
  }, [rows, searchTerm]);

  useEffect(() => {
    setPageIndex(0);
  }, [searchTerm]);

  const pageCount = Math.ceil(filteredRows.length / SECTION_PAGE_SIZE);
  const paginatedRows = filteredRows.slice(
    pageIndex * SECTION_PAGE_SIZE,
    (pageIndex + 1) * SECTION_PAGE_SIZE
  );

  const emptyTableMessage =
    searchTerm.trim().length > 0
      ? i18n.translate('workflows.executionFlyout.stepDetail.noFieldsMatch', {
          defaultMessage: 'No fields match',
        })
      : i18n.translate('workflows.executionFlyout.stepDetail.noData', {
          defaultMessage: 'No data',
        });

  const tableColumns = useMemo<Array<EuiBasicTableColumn<StepDataTableRow>>>(
    () => [
      {
        field: 'field',
        name: i18n.translate('workflows.executionFlyout.stepDetail.fieldColumn', {
          defaultMessage: 'Field',
        }),
        className: 'workflowStepDataFieldCol',
        width: `${FIELD_COLUMN_MAX_PX}px`,
        render: (field: string, row) => (
          <div
            css={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              minWidth: 0,
              maxWidth: FIELD_COLUMN_MAX_PX,
              overflow: 'hidden',
            }}
          >
            <EuiToken
              iconType={fieldTypeToToken[row.fieldType]}
              size="xs"
              css={{ flexShrink: 0, width: '12px', height: '12px', margin: 0 }}
            />
            {/* The tooltip anchors are the flex items: the name's must be able to shrink, and the
                copy button's must not, or a long name pushes the button out of the capped column.
                The name's anchor is a flex container so the span inside can truncate. */}
            <EuiToolTip
              content={field}
              position="top"
              anchorProps={{ css: { display: 'flex', minWidth: 0 } }}
            >
              <span
                tabIndex={0}
                css={{
                  fontSize: '12px',
                  fontFamily: euiTheme.font.familyCode,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  // Truncate from the left so the leaf segment stays visible.
                  direction: 'rtl',
                  textAlign: 'left',
                }}
              >
                <bdi>{field}</bdi>
              </span>
            </EuiToolTip>
            {fieldPathPrefix != null && (isFieldPathCopyable?.(field) ?? true) && (
              <EuiToolTip
                content={i18n.translate('workflows.executionFlyout.stepDetail.copyFieldPath', {
                  defaultMessage: 'Copy field path',
                })}
                disableScreenReaderOutput
                anchorProps={{ css: { flexShrink: 0 } }}
              >
                <EuiButtonIcon
                  iconType="copy"
                  size="xs"
                  color="text"
                  aria-label={i18n.translate('workflows.executionFlyout.stepDetail.copyFieldPath', {
                    defaultMessage: 'Copy field path',
                  })}
                  data-test-subj="workflowExecutionStepDataCopyFieldPath"
                  onClick={() => copyToClipboard(appendKeyPath(fieldPathPrefix, field))}
                />
              </EuiToolTip>
            )}
          </div>
        ),
      },
      {
        field: 'value',
        name: i18n.translate('workflows.executionFlyout.stepDetail.valueColumn', {
          defaultMessage: 'Value',
        }),
        className: 'workflowStepDataValueCol',
        truncateText: true,
        render: (value: string) => <StepDataValueCell value={value} />,
      },
    ],
    [euiTheme.font.familyCode, fieldPathPrefix, isFieldPathCopyable]
  );

  const onTableChange = useCallback(({ page }: Criteria<StepDataTableRow>) => {
    if (page) {
      setPageIndex(page.index);
    }
  }, []);

  return (
    <StepDetailAccordionSection
      title={label}
      toggleAriaLabel={i18n.translate('workflows.executionFlyout.stepDetail.toggleNamedSection', {
        defaultMessage: '{label} section',
        values: { label },
      })}
      extraAction={
        hasTable ? (
          <EuiPopover
            aria-label={i18n.translate('workflows.executionFlyout.stepDetail.viewMenuAriaLabel', {
              defaultMessage: 'Data view',
            })}
            isOpen={isViewPopoverOpen}
            closePopover={() => setIsViewPopoverOpen(false)}
            anchorPosition="downRight"
            panelPaddingSize="none"
            button={
              <EuiButtonEmpty
                size="xs"
                iconType="chevronSingleDown"
                iconSide="right"
                onClick={() => setIsViewPopoverOpen((v) => !v)}
              >
                {effectiveView === 'table'
                  ? i18n.translate('workflows.executionFlyout.stepDetail.tableView', {
                      defaultMessage: 'Table',
                    })
                  : i18n.translate('workflows.executionFlyout.stepDetail.codeView', {
                      defaultMessage: 'JSON',
                    })}
              </EuiButtonEmpty>
            }
          >
            <EuiContextMenuPanel
              items={[
                <EuiContextMenuItem
                  key="table"
                  icon={effectiveView === 'table' ? 'check' : 'empty'}
                  onClick={() => {
                    setView('table');
                    setIsViewPopoverOpen(false);
                  }}
                >
                  {i18n.translate('workflows.executionFlyout.stepDetail.tableView', {
                    defaultMessage: 'Table',
                  })}
                </EuiContextMenuItem>,
                <EuiContextMenuItem
                  key="code"
                  icon={effectiveView === 'code' ? 'check' : 'empty'}
                  onClick={() => {
                    setView('code');
                    setIsViewPopoverOpen(false);
                  }}
                >
                  {i18n.translate('workflows.executionFlyout.stepDetail.codeView', {
                    defaultMessage: 'JSON',
                  })}
                </EuiContextMenuItem>,
              ]}
            />
          </EuiPopover>
        ) : undefined
      }
    >
      {effectiveView === 'code' ? (
        <EuiCodeBlock
          language="json"
          fontSize="s"
          paddingSize="m"
          overflowHeight={300}
          isCopyable
          css={`
            & .euiCodeBlock__controls {
              background: transparent;
              top: 4px;
              right: 4px;
              padding: 2px;
            }

            & .euiCodeBlock__controls .euiButtonIcon {
              background: transparent;
            }
          `}
        >
          {JSON.stringify(data ?? null, null, 2)}
        </EuiCodeBlock>
      ) : (
        <div css={{ minWidth: 0 }}>
          <div css={{ marginBottom: euiTheme.size.m }}>
            <EuiFieldSearch
              compressed
              fullWidth
              placeholder={i18n.translate(
                'workflows.executionFlyout.stepDetail.searchPlaceholder',
                { defaultMessage: 'Search fields and values' }
              )}
              aria-label={i18n.translate('workflows.executionFlyout.stepDetail.searchAriaLabel', {
                defaultMessage: 'Search fields and values',
              })}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              data-test-subj="workflowExecutionStepDataSearch"
            />
          </div>
          <div
            data-test-subj="workflowExecutionStepDataTable"
            css={css`
              min-width: 0;
              width: 100%;
              overflow: hidden;

              .euiTable {
                table-layout: fixed;
                width: 100%;
              }

              .workflowStepDataFieldCol {
                min-width: ${FIELD_COLUMN_MIN_PX}px;
                max-width: ${FIELD_COLUMN_MAX_PX}px;
                width: ${FIELD_COLUMN_MAX_PX}px;
              }

              .workflowStepDataValueCol {
                width: auto;
                overflow: hidden;
              }

              .workflowStepDataValueCol .euiTableCellContent {
                display: block;
                overflow: hidden;
                max-width: 100%;
              }
            `}
          >
            <EuiBasicTable<StepDataTableRow>
              tableCaption={i18n.translate('workflows.executionFlyout.stepDetail.tableCaption', {
                defaultMessage: 'Step data fields',
              })}
              items={paginatedRows}
              columns={tableColumns}
              compressed
              tableLayout="fixed"
              responsiveBreakpoint={false}
              noItemsMessage={emptyTableMessage}
              onChange={onTableChange}
              pagination={
                pageCount > 1
                  ? {
                      pageIndex,
                      pageSize: SECTION_PAGE_SIZE,
                      totalItemCount: filteredRows.length,
                      showPerPageOptions: false,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </StepDetailAccordionSection>
  );
};

export interface WorkflowExecutionStepFlyoutProps {
  executionId: string;
  workflowExecution: WorkflowExecutionDto | undefined;
  childExecutions: ChildWorkflowExecutionsMap;
  waitingStepExecutionId: string | undefined;
  waitingStepStartedAt: string | undefined;
  resumeMessage: string | undefined;
  resumeSchema: JsonModelSchemaType | undefined;
  approvalLabels: ApprovalLabels | undefined;
  resumeSubmitState: {
    isSubmitting: boolean;
    isSubmitted: boolean;
    setSubmitting: (value: boolean) => void;
    setSubmitted: (value: boolean) => void;
  };
}

/** Step input and output, as a child of the execution flyout. */
export const WorkflowExecutionStepFlyout = ({
  executionId,
  workflowExecution,
  childExecutions,
  waitingStepExecutionId,
  waitingStepStartedAt,
  resumeMessage,
  resumeSchema,
  approvalLabels,
  resumeSubmitState,
}: WorkflowExecutionStepFlyoutProps) => {
  const { euiTheme } = useEuiTheme();
  const { setSelectedStepExecution, selectedStepExecutionId: urlSelectedStepExecutionId } =
    useWorkflowUrlState();
  const selectedStepExecutionId = urlSelectedStepExecutionId ?? null;
  const onClose = useCallback(() => {
    setSelectedStepExecution(null);
  }, [setSelectedStepExecution]);

  const isPseudoStep =
    selectedStepExecutionId === '__overview' ||
    selectedStepExecutionId === 'trigger' ||
    (selectedStepExecutionId?.startsWith('if-branch:') ?? false) ||
    (selectedStepExecutionId?.startsWith('enter-case-branch:') ?? false) ||
    isIterationPseudoStepId(selectedStepExecutionId);

  const isIterationPseudoStep = isIterationPseudoStepId(selectedStepExecutionId);

  const pseudoStepExecution = useMemo<WorkflowStepExecutionDto | null>(() => {
    if (!workflowExecution) return null;
    if (selectedStepExecutionId === 'trigger') {
      return buildTriggerStepExecutionFromContext(workflowExecution);
    }
    if (selectedStepExecutionId === '__overview') {
      return buildOverviewStepExecutionFromContext(workflowExecution);
    }
    if (selectedStepExecutionId && isIterationPseudoStepId(selectedStepExecutionId)) {
      return buildIterationPseudoStep(selectedStepExecutionId, workflowExecution);
    }
    if (selectedStepExecutionId?.startsWith('if-branch:')) {
      const branchName = selectedStepExecutionId.split(':')[1];
      return {
        id: selectedStepExecutionId,
        stepId: branchName,
        stepType: 'if-branch',
        status: ExecutionStatus.COMPLETED,
        input: undefined,
        output: { result: branchName } as unknown as WorkflowStepExecutionDto['output'],
        scopeStack: [],
        workflowRunId: workflowExecution.id,
        workflowId: workflowExecution.workflowId ?? '',
        startedAt: '',
        globalExecutionIndex: -1,
        stepExecutionIndex: 0,
        topologicalIndex: -1,
      } as WorkflowStepExecutionDto;
    }
    if (selectedStepExecutionId?.startsWith('enter-case-branch:')) {
      const parts = selectedStepExecutionId.split(':');
      const caseName = parts[1];
      const caseStatus = (parts[3] as ExecutionStatus) ?? ExecutionStatus.COMPLETED;
      return {
        id: selectedStepExecutionId,
        stepId: caseName,
        stepType: 'enter-case-branch',
        status: caseStatus,
        input: undefined,
        output: undefined,
        scopeStack: [],
        workflowRunId: workflowExecution.id,
        workflowId: workflowExecution.workflowId ?? '',
        startedAt: '',
        globalExecutionIndex: -1,
        stepExecutionIndex: 0,
        topologicalIndex: -1,
      } as WorkflowStepExecutionDto;
    }
    return null;
  }, [selectedStepExecutionId, workflowExecution]);

  const executionMetadata = useMemo(() => {
    if (!workflowExecution || selectedStepExecutionId !== 'trigger') return null;
    return buildOverviewStepExecutionFromContext(workflowExecution).input;
  }, [selectedStepExecutionId, workflowExecution]);

  const {
    lightweightStep: selectedLightStep,
    resolvedExecutionId,
    childWorkflowExecution,
    parentWorkflowExecution,
  } = useMemo(
    () =>
      resolveSelectedStepExecution({
        selectedStepExecutionId: isPseudoStep ? undefined : selectedStepExecutionId,
        parentExecutionId: executionId,
        parentStepExecutions: workflowExecution?.stepExecutions,
        childExecutions,
      }),
    [
      isPseudoStep,
      selectedStepExecutionId,
      executionId,
      workflowExecution?.stepExecutions,
      childExecutions,
    ]
  );

  const { data: fullStepExecution, isLoading: isLoadingStepData } = useStepExecution(
    resolvedExecutionId,
    isPseudoStep ? undefined : selectedStepExecutionId ?? undefined,
    selectedLightStep?.status
  );

  const activeStepExecution = useMemo(() => {
    if (isPseudoStep) {
      return pseudoStepExecution;
    }
    if (selectedLightStep && fullStepExecution) {
      return {
        ...selectedLightStep,
        input: fullStepExecution.input,
        output: fullStepExecution.output,
      };
    }
    return selectedLightStep ?? fullStepExecution ?? pseudoStepExecution;
  }, [isPseudoStep, pseudoStepExecution, selectedLightStep, fullStepExecution]);
  const stepName = selectedLightStep?.stepId ?? activeStepExecution?.stepId ?? '';

  const activeStepType = selectedLightStep?.stepType ?? activeStepExecution?.stepType;
  const isForeachOrWhileStep = activeStepType === 'foreach' || activeStepType === 'while';
  const hasStepError = !isPseudoStep && activeStepExecution?.error != null;
  const stepOutputData = hasStepError ? activeStepExecution?.error : activeStepExecution?.output;
  const stepInputFieldPathPrefix = getStepFieldPathPrefix({
    stepId: selectedLightStep?.stepId ?? activeStepExecution?.stepId ?? '',
    stepType: selectedLightStep?.stepType ?? activeStepExecution?.stepType,
    mode: 'input',
    hasError: hasStepError,
  });
  const stepOutputFieldPathPrefix = getStepFieldPathPrefix({
    stepId: selectedLightStep?.stepId ?? activeStepExecution?.stepId ?? '',
    stepType: selectedLightStep?.stepType ?? activeStepExecution?.stepType,
    mode: 'output',
    hasError: hasStepError,
  });
  const metadataFieldPathPrefix = getStepFieldPathPrefix({
    stepId: 'Overview',
    stepType: '__overview',
    mode: 'input',
  });

  const definitionConnectorId = useMemo(
    () =>
      findStepConnectorId(
        workflowExecution?.workflowDefinition ?? null,
        selectedLightStep?.stepId ?? activeStepExecution?.stepId ?? ''
      ),
    [workflowExecution?.workflowDefinition, selectedLightStep?.stepId, activeStepExecution?.stepId]
  );

  const stepAi = useMemo(
    () =>
      normalizeStepAi({
        usage: activeStepExecution?.usage,
        output: activeStepExecution?.output,
        connectorId: definitionConnectorId,
      }),
    [activeStepExecution?.usage, activeStepExecution?.output, definitionConnectorId]
  );

  const { data: fetchedConnector } = useFetchConnector(stepAi?.connectorId);
  const availableConnectors = useAvailableConnectors();
  const aiConnectorName = useMemo(() => {
    const id = stepAi?.connectorId;
    if (!id) return undefined;
    if (fetchedConnector?.name) return fetchedConnector.name;
    for (const typeInfo of Object.values(availableConnectors?.connectorTypes ?? {})) {
      const match = typeInfo.instances.find((inst) => inst.id === id);
      if (match?.name) return match.name;
    }
    return id;
  }, [availableConnectors?.connectorTypes, fetchedConnector?.name, stepAi?.connectorId]);

  const stepAiWithModel = useMemo(() => {
    if (!stepAi) return undefined;
    if (stepAi.model) return stepAi;
    const config =
      fetchedConnector && 'config' in fetchedConnector ? fetchedConnector.config : undefined;
    const defaultModel =
      typeof config?.defaultModel === 'string' && config.defaultModel.length > 0
        ? config.defaultModel
        : undefined;
    return defaultModel ? { ...stepAi, model: defaultModel } : stepAi;
  }, [fetchedConnector, stepAi]);

  if (!selectedStepExecutionId) {
    return null;
  }

  return (
    <EuiFlyout
      aria-label={i18n.translate('workflows.executionFlyout.stepAriaLabel', {
        defaultMessage: 'Step {name}',
        values: { name: stepName },
      })}
      onClose={onClose}
      session="inherit"
      historyKey={WORKFLOW_EXECUTION_FLYOUT_HISTORY_KEY}
      // The execution panel is size "m". EUI rejects a child that is also "m".
      size="s"
      ownFocus={false}
      paddingSize="none"
      closeButtonProps={{ 'data-test-subj': 'workflowExecutionFlyoutStepClose' }}
      data-test-subj="workflowExecutionStepFlyout"
    >
      <EuiFlyoutHeader css={{ padding: 0 }}>
        <div
          css={{
            display: 'flex',
            alignItems: 'center',
            gap: euiTheme.size.s,
            flexShrink: 0,
            boxSizing: 'border-box',
            minHeight: 48,
            paddingBlock: euiTheme.size.s,
            paddingInline: euiTheme.size.s,
            borderBottom: euiTheme.border.thin,
          }}
        >
          {(selectedLightStep?.stepType ?? activeStepExecution?.stepType) && (
            <StepIcon
              stepType={selectedLightStep?.stepType ?? activeStepExecution?.stepType ?? ''}
              executionStatus={selectedLightStep?.status ?? activeStepExecution?.status}
              size="m"
              css={{ flexShrink: 0 }}
            />
          )}
          <EuiTitle
            size="xs"
            css={{
              flex: 1,
              minWidth: 0,
              marginBottom: 0,
            }}
          >
            <h2
              css={{
                minWidth: 0,
                margin: 0,
                color: euiTheme.colors.title,
              }}
            >
              <EuiTextTruncate text={stepName} />
            </h2>
          </EuiTitle>
        </div>
      </EuiFlyoutHeader>
      <EuiFlyoutBody
        css={css`
          .euiFlyoutBody__overflowContent {
            padding: 0;
          }
        `}
      >
        <div
          css={{
            overflowY: 'auto',
            overflowX: 'hidden',
            paddingInline: euiTheme.size.base,
            paddingBottom: euiTheme.size.base,
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            minWidth: 0,
          }}
        >
          {!isPseudoStep && (childWorkflowExecution || parentWorkflowExecution) && (
            <div
              css={{
                paddingTop: euiTheme.size.m,
                paddingBottom: euiTheme.size.m,
              }}
            >
              <NestedWorkflowExecutionLinks
                stepExecution={activeStepExecution ?? selectedLightStep}
                childWorkflowExecution={childWorkflowExecution}
                parentWorkflowExecution={parentWorkflowExecution}
              />
            </div>
          )}
          {isLoadingStepData && !isPseudoStep ? (
            <EuiFlexGroup justifyContent="center">
              <EuiFlexItem grow={false}>
                <EuiLoadingSpinner size="l" />
              </EuiFlexItem>
            </EuiFlexGroup>
          ) : activeStepExecution?.stepType === 'enter-case-branch' ? (
            <StepDataSection
              key={`status-${selectedStepExecutionId}`}
              label={i18n.translate('workflows.executionFlyout.caseBranch.statusLabel', {
                defaultMessage: 'Status',
              })}
              data={{
                result:
                  activeStepExecution.status === ExecutionStatus.COMPLETED
                    ? i18n.translate('workflows.executionFlyout.caseBranch.taken', {
                        defaultMessage: 'Branch executed',
                      })
                    : i18n.translate('workflows.executionFlyout.caseBranch.skipped', {
                        defaultMessage: 'Branch not taken',
                      }),
              }}
            />
          ) : isIterationPseudoStep ? (
            <>
              {activeStepExecution?.executionTimeMs != null &&
                activeStepExecution.executionTimeMs > 0 && (
                  <div css={{ flexShrink: 0 }}>
                    <div
                      css={{
                        paddingTop: euiTheme.size.m,
                        paddingBottom: euiTheme.size.m,
                      }}
                    >
                      <EuiText
                        size="s"
                        color="subdued"
                        data-test-subj="iterationPseudoStepDuration"
                      >
                        {i18n.translate('workflows.executionFlyout.iteration.duration', {
                          defaultMessage: 'Duration: {duration}',
                          values: {
                            duration: formatDuration(activeStepExecution.executionTimeMs),
                          },
                        })}
                      </EuiText>
                    </div>
                    <EuiHorizontalRule margin="none" />
                  </div>
                )}
              {activeStepExecution?.usage && activeStepExecution.usage.totalTokens > 0 && (
                <TokenUsageBreakdown
                  usage={activeStepExecution.usage}
                  data-test-subj="iterationPseudoStepTokenUsage"
                />
              )}
              <StepDataSection
                key={`input-${selectedStepExecutionId}`}
                label={i18n.translate('workflows.executionFlyout.stepDetail.input', {
                  defaultMessage: 'Input',
                })}
                data={activeStepExecution?.input}
                fieldPathPrefix={stepInputFieldPathPrefix}
              />
            </>
          ) : (
            <>
              {executionMetadata && (
                <StepDataSection
                  key={`metadata-${selectedStepExecutionId}`}
                  label={i18n.translate('workflows.executionFlyout.stepDetail.metadata', {
                    defaultMessage: 'Metadata',
                  })}
                  data={executionMetadata}
                  fieldPathPrefix={metadataFieldPathPrefix}
                  isFieldPathCopyable={isOverviewContextField}
                />
              )}
              {!isPseudoStep && stepAiWithModel && (
                <AiStepSection ai={stepAiWithModel} connectorName={aiConnectorName} />
              )}
              {!isPseudoStep &&
                selectedStepExecutionId === waitingStepExecutionId &&
                waitingStepExecutionId && (
                  <div
                    css={{
                      paddingTop: euiTheme.size.m,
                      paddingBottom: euiTheme.size.m,
                    }}
                  >
                    <ResumeExecutionButton
                      executionId={executionId}
                      workflowId={workflowExecution?.workflowId}
                      stepStartedAt={
                        selectedLightStep?.startedAt ??
                        activeStepExecution?.startedAt ??
                        waitingStepStartedAt
                      }
                      resumeMessage={resumeMessage}
                      resumeSchema={resumeSchema}
                      approvalLabels={approvalLabels}
                      waitingStepExecutionId={selectedStepExecutionId}
                      submitState={resumeSubmitState}
                    />
                  </div>
                )}
              <StepDataSection
                key={`input-${selectedStepExecutionId}`}
                label={i18n.translate('workflows.executionFlyout.stepDetail.input', {
                  defaultMessage: 'Input',
                })}
                data={activeStepExecution?.input}
                fieldPathPrefix={stepInputFieldPathPrefix}
              />
              {!isPseudoStep &&
                isForeachOrWhileStep &&
                activeStepExecution &&
                workflowExecution?.stepExecutions && (
                  <ForeachIterationsSection
                    foreachStep={activeStepExecution}
                    allStepExecutions={workflowExecution.stepExecutions}
                    selectedId={selectedStepExecutionId}
                    onSelectStep={setSelectedStepExecution}
                    executionStatus={workflowExecution.status}
                  />
                )}
              {!isPseudoStep &&
                (hasStepError ? (
                  <StepDataSection
                    key={`error-${selectedStepExecutionId}`}
                    label={i18n.translate('workflows.executionFlyout.stepDetail.error', {
                      defaultMessage: 'Error',
                    })}
                    data={activeStepExecution?.error}
                  />
                ) : stepOutputData != null ? (
                  <StepDataSection
                    key={`output-${selectedStepExecutionId}`}
                    label={i18n.translate('workflows.executionFlyout.stepDetail.output', {
                      defaultMessage: 'Output',
                    })}
                    data={stepOutputData}
                    fieldPathPrefix={stepOutputFieldPathPrefix}
                  />
                ) : null)}
            </>
          )}
        </div>
      </EuiFlyoutBody>
    </EuiFlyout>
  );
};
