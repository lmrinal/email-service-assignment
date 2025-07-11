// test/emailService.test.js
const { EmailService, ProviderA, ProviderB } = require('../src/emailService');

// Mocking timeouts
jest.useFakeTimers();

// Helper: Always succeeding provider
class SuccessProvider {
  constructor() { this.name = 'SuccessProvider'; }
  async send() { return true; }
}

// Helper: Always failing provider
class FailProvider {
  constructor() { this.name = 'FailProvider'; }
  async send() { throw new Error('Failure'); }
}

describe('EmailService', () => {
  test('sends email successfully', async () => {
    const service = new EmailService([new SuccessProvider()]);
    const job = { id: '1', to: 'a@test.com', subject: 'Hi', body: 'Hello' };

    const result = await service.sendEmail(job);
    expect(result).toBe('Sent');
    expect(service.getStatus('1')).toBe('Sent');
  });

  test('idempotency: does not resend the same job ID', async () => {
    const service = new EmailService([new SuccessProvider()]);
    const job = { id: '2', to: 'a@test.com', subject: 'Hi', body: 'Hello' };

    await service.sendEmail(job);
    const result = await service.sendEmail(job);
    expect(result).toBe('Already sent');
  });

  test('rate limiting blocks excessive sends', async () => {
    const service = new EmailService([new SuccessProvider()]);
    const to = 'a@test.com';

    for (let i = 0; i < 5; i++) {
      await service.sendEmail({ id: `r${i}`, to, subject: 'X', body: 'Y' });
    }

    const result = await service.sendEmail({ id: 'r5', to, subject: 'Z', body: 'W' });
    expect(result).toBe('Rate limit exceeded');
  });

  test('falls back to second provider when first fails', async () => {
    const service = new EmailService([new FailProvider(), new SuccessProvider()]);
    const job = { id: '3', to: 'fallback@test.com', subject: 'Hi', body: 'Fallback test' };

    const result = await service.sendEmail(job);
    expect(result).toBe('Sent');
  });

  test('retry logic with exponential backoff works', async () => {
    const failingOnceProvider = {
      name: 'RetryProvider',
      attempts: 0,
      async send() {
        if (this.attempts++ === 0) throw new Error('Fail once');
        return true;
      }
    };
    const service = new EmailService([failingOnceProvider]);
    const job = { id: '4', to: 'retry@test.com', subject: 'Retry', body: 'Try again' };

    const result = await service.sendEmail(job);
    expect(result).toBe('Sent');
  });

  test('circuit breaker opens after 3 failures', async () => {
    const failProvider = new FailProvider();
    const service = new EmailService([failProvider]);
    const job1 = { id: '5', to: 'cb@test.com', subject: 'CB1', body: 'x' };
    const job2 = { id: '6', to: 'cb@test.com', subject: 'CB2', body: 'y' };
    const job3 = { id: '7', to: 'cb@test.com', subject: 'CB3', body: 'z' };

    await service.sendEmail(job1);
    await service.sendEmail(job2);
    await service.sendEmail(job3);

    const job4 = { id: '8', to: 'cb@test.com', subject: 'CB4', body: 'should fail' };
    const result = await service.sendEmail(job4);
    expect(result).toBe('Failed');
  });

  test('status tracking returns correct values', async () => {
    const service = new EmailService([new SuccessProvider()]);
    const job = { id: 'status-1', to: 'status@test.com', subject: 'Track', body: 'Status check' };

    await service.sendEmail(job);
    const status = service.getStatus('status-1');
    expect(status).toBe('Sent');
  });
});
