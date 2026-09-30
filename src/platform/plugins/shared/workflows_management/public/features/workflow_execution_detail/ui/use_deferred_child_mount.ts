/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { useEffect, useRef, useState } from 'react';

/**
 * When a managed child flyout is already open on the first render (a direct link),
 * wait one frame so its parent can register with EUI first. A child opened later
 * mounts immediately.
 */
export const useDeferredChildMount = (isOpen: boolean): boolean => {
  const openedOnMountRef = useRef(isOpen);
  const [parentReady, setParentReady] = useState(() => !openedOnMountRef.current);

  useEffect(() => {
    if (openedOnMountRef.current) {
      setParentReady(true);
    }
  }, []);

  return isOpen && parentReady;
};
