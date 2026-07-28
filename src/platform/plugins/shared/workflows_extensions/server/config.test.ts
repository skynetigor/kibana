/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { config, resolveExperimentalStepsConfig } from './config';

describe('workflows_extensions config', () => {
  describe('resolveExperimentalStepsConfig', () => {
    it('returns empty config when set to true', () => {
      expect(resolveExperimentalStepsConfig(true)).toEqual({});
    });

    it('returns empty config when set to false', () => {
      expect(resolveExperimentalStepsConfig(false)).toEqual({});
    });

    it('returns empty config when an object is provided', () => {
      expect(resolveExperimentalStepsConfig({})).toEqual({});
    });
  });

  describe('schema', () => {
    it('accepts a boolean value', () => {
      expect(config.schema.validate({ experimentalSteps: true })).toEqual({
        experimentalSteps: true,
      });
    });

    it('accepts an empty object value', () => {
      expect(config.schema.validate({ experimentalSteps: {} })).toEqual({
        experimentalSteps: {},
      });
    });

    it('defaults experimentalSteps to false when omitted', () => {
      expect(config.schema.validate({})).toEqual({
        experimentalSteps: false,
      });
    });
  });
});
