import * as crypto from 'crypto';

export interface AbacatePayConfig {
  apiKey: string;
  apiUrl: string;
  webhookSecret: string;
}

export interface AbacatePayCustomer {
  name: string;
  email: string;
  cellphone: string;
  taxId: string;
}

export interface CreatePixChargeInput {
  amount: number;
  expiresIn: number;
  description?: string;
  externalId?: string;
  customer: AbacatePayCustomer;
  metadata?: Record<string, unknown>;
}

export type AbacatePayChargeStatus =
  | 'PENDING'
  | 'PAID'
  | 'EXPIRED'
  | 'REFUNDED'
  | 'CANCELLED'
  | 'FAILED';

export interface AbacatePayChargeResponse {
  id: string;
  amount: number;
  status: AbacatePayChargeStatus;
  brCode: string;
  brCodeBase64: string;
  expiresAt: string;
}

interface AbacatePayApiEnvelope<T> {
  data: T | null;
  error: string | null;
}

export class AbacatePayApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AbacatePayApiError';
  }
}

export class AbacatePayClient {
  constructor(private readonly config: AbacatePayConfig) {}

  async createPixCharge(input: CreatePixChargeInput): Promise<AbacatePayChargeResponse> {
    const url = `${this.config.apiUrl}/transparents/create`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    return this.parse<AbacatePayChargeResponse>(res);
  }

  async checkPixStatus(id: string): Promise<AbacatePayChargeResponse> {
    const url = `${this.config.apiUrl}/transparents/check?id=${encodeURIComponent(id)}`;
    const res = await fetch(url, { method: 'GET', headers: this.headers() });
    return this.parse<AbacatePayChargeResponse>(res);
  }

  verifyWebhookSignature(rawBody: Buffer, signature: string | undefined | null): boolean {
    if (!signature) return false;

    const expected = crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(rawBody)
      .digest('base64');

    const a = Buffer.from(signature, 'base64');
    const b = Buffer.from(expected, 'base64');
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text();
    let body: AbacatePayApiEnvelope<T> | null = null;
    try {
      body = text ? (JSON.parse(text) as AbacatePayApiEnvelope<T>) : null;
    } catch {
      body = null;
    }

    if (!res.ok || !body || body.error || !body.data) {
      const errMessage = body?.error ?? text ?? `HTTP ${res.status}`;
      throw new AbacatePayApiError(res.status, 'abacatepay_api_error', `AbacatePay: ${errMessage}`);
    }

    return body.data;
  }
}
