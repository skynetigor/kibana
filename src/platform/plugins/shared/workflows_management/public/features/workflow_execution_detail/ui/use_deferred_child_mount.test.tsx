/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { render } from '@testing-library/react';
import React from 'react';
import { useDeferredChildMount } from './use_deferred_child_mount';

const frames: boolean[] = [];

const Probe = ({ isOpen }: { isOpen: boolean }) => {
  frames.push(useDeferredChildMount(isOpen));
  return null;
};

describe('useDeferredChildMount', () => {
  beforeEach(() => {
    frames.length = 0;
  });

  it('waits one frame when the child is already open on mount', () => {
    render(<Probe isOpen />);

    expect(frames[0]).toBe(false);
    expect(frames.at(-1)).toBe(true);
  });

  it('mounts immediately when the child opens after mount', () => {
    const view = render(<Probe isOpen={false} />);
    frames.length = 0;

    view.rerender(<Probe isOpen />);

    expect(frames[0]).toBe(true);
  });
});
