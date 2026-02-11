import { logger } from './logger';

/**
 * Generic circuit breaker implementation
 * States: CLOSED, OPEN, HALF_OPEN
 */

export enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerConfig {
  maxRetries?: number;
  consecutiveFailuresThreshold?: number;
  resetTimeoutMs?: number;
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private successCount = 0;
  private nextAttemptTime = 0;

  private readonly maxRetries: number;
  private readonly consecutiveFailuresThreshold: number;
  private readonly resetTimeoutMs: number;

  constructor(
    private readonly name: string,
    config: CircuitBreakerConfig = {}
  ) {
    this.maxRetries = config.maxRetries ?? 2;
    this.consecutiveFailuresThreshold = config.consecutiveFailuresThreshold ?? 3;
    this.resetTimeoutMs = config.resetTimeoutMs ?? 60000;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check if circuit is open
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        logger.warn(`Circuit breaker ${this.name} is OPEN, rejecting call`, {
          action: 'circuit_breaker_reject',
          circuit_name: this.name,
          next_attempt_in_ms: this.nextAttemptTime - Date.now(),
        });
        throw new Error(`Circuit breaker ${this.name} is OPEN`);
      }

      // Transition to half-open for test call
      this.transitionTo(CircuitState.HALF_OPEN);
    }

    let lastError: Error | undefined;

    // Retry loop
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await fn();
        this.onSuccess();
        return result;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.debug(`Circuit breaker ${this.name} attempt ${attempt + 1} failed`, {
          action: 'circuit_breaker_attempt_failed',
          circuit_name: this.name,
          attempt: attempt + 1,
          max_retries: this.maxRetries,
          error: lastError.message,
        });

        // Don't retry on last attempt
        if (attempt === this.maxRetries) {
          this.onFailure();
          break;
        }

        // Exponential backoff
        await this.sleep(Math.pow(2, attempt) * 100);
      }
    }

    throw lastError;
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      logger.info(`Circuit breaker ${this.name} test call succeeded, closing circuit`, {
        action: 'circuit_breaker_close',
        circuit_name: this.name,
      });
      this.transitionTo(CircuitState.CLOSED);
      this.failureCount = 0;
    } else if (this.state === CircuitState.CLOSED) {
      // Reset failure count on success
      this.failureCount = 0;
    }
    this.successCount++;
  }

  private onFailure(): void {
    this.failureCount++;

    if (this.state === CircuitState.HALF_OPEN) {
      logger.warn(`Circuit breaker ${this.name} test call failed, opening circuit`, {
        action: 'circuit_breaker_open',
        circuit_name: this.name,
      });
      this.transitionTo(CircuitState.OPEN);
    } else if (
      this.state === CircuitState.CLOSED &&
      this.failureCount >= this.consecutiveFailuresThreshold
    ) {
      logger.error(
        `Circuit breaker ${this.name} threshold reached, opening circuit`,
        {
          action: 'circuit_breaker_open',
          circuit_name: this.name,
          failure_count: this.failureCount,
          threshold: this.consecutiveFailuresThreshold,
        }
      );
      this.transitionTo(CircuitState.OPEN);
    }
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state;
    this.state = newState;

    if (newState === CircuitState.OPEN) {
      this.nextAttemptTime = Date.now() + this.resetTimeoutMs;
    }

    logger.info(`Circuit breaker ${this.name} state transition`, {
      action: 'circuit_breaker_state_change',
      circuit_name: this.name,
      old_state: oldState,
      new_state: newState,
      failure_count: this.failureCount,
      success_count: this.successCount,
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Getters for monitoring
  getState(): CircuitState {
    return this.state;
  }

  getStats() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      nextAttemptTime: this.nextAttemptTime,
    };
  }
}
