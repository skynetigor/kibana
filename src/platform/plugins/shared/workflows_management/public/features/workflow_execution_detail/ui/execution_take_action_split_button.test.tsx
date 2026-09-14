/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { useLocation } from 'react-router-dom';
import { ExecutionStatus } from '@kbn/workflows';
import { useWorkflowsApi } from '@kbn/workflows-ui';
import { ExecutionTakeActionSplitButton } from './execution_take_action_split_button';
import { createStartServicesMock } from '../../../mocks';
import { getTestProvider } from '../../../shared/mocks/test_providers';
import { createMockWorkflowExecutionDto } from '../../../shared/test_utils';

const mockCancelExecution = jest.fn();
const mockUseWorkflowsCapabilities = jest.fn(() => ({
  canExecuteWorkflow: true,
  canUpdateWorkflow: true,
  canCancelWorkflowExecution: true,
}));

jest.mock('@kbn/workflows-ui', () => {
  const actual = jest.requireActual('@kbn/workflows-ui');
  return {
    ...actual,
    useWorkflowsApi: jest.fn(),
    useWorkflowsCapabilities: () => mockUseWorkflowsCapabilities(),
  };
});

jest.mock('../../../hooks/navigation/use_navigate_to_execution', () => ({
  useNavigateToExecution: () => ({ href: '/app/workflows/wf-1?executionId=exec-1' }),
}));

const LocationSearch = () => {
  const { search } = useLocation();
  return <div data-test-subj="location-search">{search}</div>;
};

describe('ExecutionTakeActionSplitButton', () => {
  const execution = createMockWorkflowExecutionDto({
    id: 'exec-1',
    workflowId: 'wf-1',
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCancelExecution.mockResolvedValue({});
    jest.mocked(useWorkflowsApi).mockReturnValue({
      cancelExecution: mockCancelExecution,
    } as ReturnType<typeof useWorkflowsApi>);
    mockUseWorkflowsCapabilities.mockReturnValue({
      canExecuteWorkflow: true,
      canUpdateWorkflow: true,
      canCancelWorkflowExecution: true,
    });
  });

  const openTakeActionMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  };

  it('opens the replay modal without closing the current execution', () => {
    const services = createStartServicesMock();
    const navigateToApp = jest.fn();
    services.application.navigateToApp = navigateToApp;

    render(
      <>
        <ExecutionTakeActionSplitButton execution={execution} />
        <LocationSearch />
      </>,
      {
        wrapper: getTestProvider({
          services,
          initialEntries: ['/wf-1?tab=executions&executionId=exec-1'],
        }),
      }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));

    const search = screen.getByTestId('location-search').textContent ?? '';
    expect(search).toContain('executionId=exec-1');
    expect(search).toContain('replayExecutionId=exec-1');
    expect(navigateToApp).not.toHaveBeenCalled();
  });

  it('navigates to the workflow replay modal from another route', () => {
    const services = createStartServicesMock();
    const navigateToApp = jest.fn();
    services.application.navigateToApp = navigateToApp;

    render(<ExecutionTakeActionSplitButton execution={execution} />, {
      wrapper: getTestProvider({
        services,
        initialEntries: ['/executions?executionId=exec-1'],
      }),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));

    expect(navigateToApp).toHaveBeenCalledWith('workflows', {
      path: '/wf-1?tab=executions&executionId=exec-1&replayExecutionId=exec-1',
    });
  });

  it('does not open the replay modal without execute privilege', () => {
    const services = createStartServicesMock();
    const navigateToApp = jest.fn();
    services.application.navigateToApp = navigateToApp;
    mockUseWorkflowsCapabilities.mockReturnValue({
      canExecuteWorkflow: false,
      canUpdateWorkflow: true,
      canCancelWorkflowExecution: true,
    });

    render(
      <>
        <ExecutionTakeActionSplitButton execution={execution} />
        <LocationSearch />
      </>,
      {
        wrapper: getTestProvider({
          services,
          initialEntries: ['/wf-1?tab=executions&executionId=exec-1'],
        }),
      }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));

    expect(navigateToApp).not.toHaveBeenCalled();
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('replayExecutionId');
  });

  it('cancels a running execution from the take-action menu', async () => {
    const services = createStartServicesMock();

    render(
      <ExecutionTakeActionSplitButton
        execution={createMockWorkflowExecutionDto({
          id: 'exec-1',
          workflowId: 'wf-1',
          status: ExecutionStatus.RUNNING,
          finishedAt: undefined,
        })}
      />,
      { wrapper: getTestProvider({ services }) }
    );

    openTakeActionMenu();
    const cancelItem = screen.getByTestId('workflowExecutionFlyoutCancelExecution');
    expect(cancelItem).toBeEnabled();
    fireEvent.click(cancelItem);

    await waitFor(() => {
      expect(mockCancelExecution).toHaveBeenCalledWith('exec-1');
    });
  });

  it('disables Cancel execution when the run is terminal', () => {
    const services = createStartServicesMock();

    render(
      <ExecutionTakeActionSplitButton
        execution={createMockWorkflowExecutionDto({
          id: 'exec-1',
          workflowId: 'wf-1',
          status: ExecutionStatus.COMPLETED,
        })}
      />,
      { wrapper: getTestProvider({ services }) }
    );

    openTakeActionMenu();
    expect(screen.getByTestId('workflowExecutionFlyoutCancelExecution')).toBeDisabled();
  });

  it('does not cancel a terminal execution if the disabled item is activated', () => {
    const services = createStartServicesMock();

    render(
      <ExecutionTakeActionSplitButton
        execution={createMockWorkflowExecutionDto({
          id: 'exec-1',
          workflowId: 'wf-1',
          status: ExecutionStatus.FAILED,
        })}
      />,
      { wrapper: getTestProvider({ services }) }
    );

    openTakeActionMenu();
    fireEvent.click(screen.getByTestId('workflowExecutionFlyoutCancelExecution'));
    expect(mockCancelExecution).not.toHaveBeenCalled();
  });
});
