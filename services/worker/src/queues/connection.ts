import IORedis from 'ioredis';

let _connection: IORedis | null = null;

export function getQueueConnection(): IORedis {
  if (!_connection) {
    _connection = new IORedis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      maxRetriesPerRequest: null,
    });
  }
  return _connection;
}
