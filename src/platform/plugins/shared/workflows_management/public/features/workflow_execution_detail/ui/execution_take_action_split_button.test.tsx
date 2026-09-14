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
import { useWorkflowsApi, useWorkflowsCapabilities } from '@kbn/workflows-ui';
import { createMockWorkflowsCapabilities } from '@kbn/workflows-ui/mocks';
import { ExecutionTakeActionSplitButton } from './execution_take_action_split_button';
import { createStartServicesMock } from '../../../mocks';
import { getTestProvider } from '../../../shared/mocks/test_providers';
import { createMockWorkflowExecutionDto } from '../../../shared/test_utils';

const mockCancelExecution = jest.fn();

jest.mock('@kbn/workflows-ui', () => ({
  ...jest.requireActual('@kbn/workflows-ui'),
  useWorkflowsApi: jest.fn(),
  useWorkflowsCapabilities: jest.fn(),
}));

jest.mock('../../../hooks/navigation/use_navigate_to_execution', () => ({
  useNavigateToExecution: () => ({ href: '/app/workflows/wf-1?executionId=exec-1' }),
}));

const LocationSearch = () => {
  const { search } = useLocation();
  return <div data-test-subj="location-search">{search}</div>;
};

describe('ExecutionTakeActionSplitButton', () => {
  const services = createStartServicesMock();
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
    jest.mocked(useWorkflowsCapabilities).mockReturnValue(createMockWorkflowsCapabilities());
    services.notifications.toasts.addSuccess = jest.fn();
    services.notifications.toasts.addError = jest.fn();
  });

  const renderButton = (
    overrides: Parameters<typeof createMockWorkflowExecutionDto>[0] = {},
    initialEntries = ['/wf-1?tab=executions&executionId=exec-1']
  ) =>
    render(
      <>
        <ExecutionTakeActionSplitButton
          execution={createMockWorkflowExecutionDto({ ...execution, ...overrides })}
        />
        <LocationSearch />
      </>,
      { wrapper: getTestProvider({ services, initialEntries }) }
    );

  const openTakeActionMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  };

  it('opens the replay modal without closing the current execution', () => {
    const navigateToApp = jest.fn();
    services.application.navigateToApp = navigateToApp;

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));

    const search = screen.getByTestId('location-search').textContent ?? '';
    expect(search).toContain('executionId=exec-1');
    expect(search).toContain('replayExecutionId=exec-1');
    expect(navigateToApp).not.toHaveBeenCalled();
  });

  it('navigates to the workflow replay modal from another route', () => {
    const navigateToApp = jest.fn();
    services.application.navigateToApp = navigateToApp;

    renderButton({}, ['/executions?executionId=exec-1']);
    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));

    expect(navigateToApp).toHaveBeenCalledWith('workflows', {
      path: '/wf-1?tab=executions&executionId=exec-1&replayExecutionId=exec-1',
    });
  });

  it('does not open the replay modal without execute privilege', () => {
    const navigateToApp = jest.fn();
    services.application.navigateToApp = navigateToApp;
    jest.mocked(useWorkflowsCapabilities).mockReturnValue({
      ...createMockWorkflowsCapabilities(),
      canExecuteWorkflow: false,
    });

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Re-run' }));

    expect(navigateToApp).not.toHaveBeenCalled();
    expect(screen.getByTestId('location-search')).not.toHaveTextContent('replayExecutionId');
  });

  it('cancels a running execution from the take-action menu', async () => {
    renderButton({
      status: ExecutionStatus.RUNNING,
      finishedAt: undefined,
    });

    openTakeActionMenu();
    const cancelItem = screen.getByTestId('workflowExecutionFlyoutCancelExecution');
    expect(cancelItem).toBeEnabled();
    fireEvent.click(cancelItem);

    await waitFor(() => {
      expect(mockCancelExecution).toHaveBeenCalledWith('exec-1');
    });
  });

  it('disables Cancel execution when the run is terminal', () => {
    renderButton({
      status: ExecutionStatus.COMPLETED,
    });

    openTakeActionMenu();
    expect(screen.getByTestId('workflowExecutionFlyoutCancelExecution')).toBeDisabled();
  });

  it('does not cancel a terminal execution if the disabled item is activated', () => {
    renderButton({
      status: ExecutionStatus.FAILED,
    });

    openTakeActionMenu();
    fireEvent.click(screen.getByTestId('workflowExecutionFlyoutCancelExecution'));
    expect(mockCancelExecution).not.toHaveBeenCalled();
  });
});
