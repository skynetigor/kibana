/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import React, { useEffect } from 'react';
import { EuiFormRow, EuiTextArea } from '@elastic/eui';
import { i18n } from '@kbn/i18n';
import type { ActionParamsProps } from '@kbn/triggers-actions-ui-plugin/public';

interface CloudVmActionParams {
  subAction: 'ssh';
  subActionParams: {
    bashScript: string;
  };
}

const CloudVmParamsFields: React.FunctionComponent<ActionParamsProps<CloudVmActionParams>> = ({
  actionParams,
  editAction,
  index,
  errors,
}) => {
  const { subAction, subActionParams } = actionParams;
  const bashScript = subActionParams?.bashScript ?? '';

  useEffect(() => {
    if (subAction !== 'ssh') {
      editAction('subAction', 'ssh', index);
    }
  }, [editAction, index, subAction]);

  const bashScriptErrors = errors.bashScript as string[] | undefined;

  return (
    <EuiFormRow
      fullWidth
      label={i18n.translate('workflowsExtensions.cloudVmConnector.params.bashScript.label', {
        defaultMessage: 'Bash script',
      })}
      error={bashScriptErrors}
      isInvalid={Array.isArray(bashScriptErrors) && bashScriptErrors.length > 0}
    >
      <EuiTextArea
        fullWidth
        rows={10}
        value={bashScript}
        onChange={(e) => editAction('subActionParams', { bashScript: e.target.value }, index)}
        data-test-subj="cloudVmBashScript"
      />
    </EuiFormRow>
  );
};

// eslint-disable-next-line import/no-default-export
export { CloudVmParamsFields as default };
