import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CircuitBreaker } from '../utils/circuit-breaker';

describe('CircuitBreaker', () => {
  let cb: CircuitBreaker;

  beforeEach(() => {
    cb = new CircuitBreaker('test', {
      consecutiveFailuresThreshold: 3,
      resetTimeoutMs: 1000,
      maxRetries: 0,
    });
  });

  it('should execute successfully in closed state', async () => {
    const result = await cb.execute(() => Promise.resolve('ok'));
    expect(result).toBe('ok');
  });

  it('should open after consecutiveFailuresThreshold failures', async () => {
    const failing = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(failing)).rejects.toThrow('fail');
    }

    // Next call should be blocked by open circuit
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toThrow('Circuit breaker test is OPEN');
  });

  it('should transition to half-open after reset timeout', async () => {
    vi.useFakeTimers();
    const failing = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(failing)).rejects.toThrow('fail');
    }

    // Advance time past reset timeout
    vi.advanceTimersByTime(1100);

    // Should allow one probe request in half-open
    const result = await cb.execute(() => Promise.resolve('recovered'));
    expect(result).toBe('recovered');

    vi.useRealTimers();
  });

  it('should close again after successful half-open probe', async () => {
    vi.useFakeTimers();
    const failing = () => Promise.reject(new Error('fail'));

    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(failing)).rejects.toThrow('fail');
    }

    vi.advanceTimersByTime(1100);

    // Successful probe closes the circuit
    await cb.execute(() => Promise.resolve('ok'));

    // Should work normally now
    const result = await cb.execute(() => Promise.resolve('normal'));
    expect(result).toBe('normal');

    vi.useRealTimers();
  });

  it('should reset failure count on success', async () => {
    const failing = () => Promise.reject(new Error('fail'));

    // 2 failures (not enough to trip)
    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();

    // Success resets
    await cb.execute(() => Promise.resolve('ok'));

    // 2 more failures should not trip
    await expect(cb.execute(failing)).rejects.toThrow();
    await expect(cb.execute(failing)).rejects.toThrow();

    // Should still be closed
    const result = await cb.execute(() => Promise.resolve('still open'));
    expect(result).toBe('still open');
  });

  it('should expose stats', () => {
    const stats = cb.getStats();
    expect(stats).toHaveProperty('state', 'CLOSED');
    expect(stats).toHaveProperty('failureCount', 0);
    expect(stats).toHaveProperty('successCount', 0);
  });
});
