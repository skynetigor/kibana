/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { createSign } from 'crypto';

export interface GcpServiceAccount {
  client_email: string;
  private_key: string;
}

export interface GcpOperation {
  status: 'PENDING' | 'RUNNING' | 'DONE';
  selfLink: string;
  error?: { errors: Array<{ code: string; message: string }> };
}

export interface MetadataItem {
  key: string;
  value: string;
}

export function base64UrlEncode(str: string | Buffer): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function getGcpAccessToken(sa: GcpServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
  const claimSet = JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  });

  const signatureInput = `${base64UrlEncode(header)}.${base64UrlEncode(claimSet)}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signatureInput);
  const signature = signer.sign(sa.private_key);
  const jwt = `${signatureInput}.${base64UrlEncode(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const tokenData = (await response.json()) as { access_token: string };
  if (!response.ok) throw new Error(`GCP auth failed: ${JSON.stringify(tokenData)}`);
  return tokenData.access_token;
}

export async function pollGcpOperation(op: GcpOperation, accessToken: string): Promise<void> {
  let current = op;
  while (current.status !== 'DONE') {
    await new Promise((res) => setTimeout(res, 2000));
    const opRes = await fetch(current.selfLink, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    current = (await opRes.json()) as GcpOperation;
    if (current.error) throw new Error(`GCP operation failed: ${JSON.stringify(current.error)}`);
  }
}
