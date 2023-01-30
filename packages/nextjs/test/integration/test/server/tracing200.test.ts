import { NextTestEnv } from './utils/helpers';

describe('Tracing 200', () => {
  it('should capture a transaction', async () => {
    const env = await NextTestEnv.init();
    const url = `${env.url}/api/users`;

    const envelope = await env.getEnvelopeRequest({
      url,
      envelopeType: 'transaction',
    });

    expect(envelope[2]).toMatchObject({
      contexts: {
        trace: {
          op: 'http.server',
          status: 'ok',
          tags: { 'http.status_code': '200' },
        },
      },
      transaction: 'GET /api/users',
      transaction_info: {
        source: 'route',
        changes: [],
        propagations: 0,
      },
      type: 'transaction',
      request: {
        url,
      },
    });
  });
});