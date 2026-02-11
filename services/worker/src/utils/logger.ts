import winston from 'winston';

/**
 * Structured JSON logger using Winston
 * Fields: timestamp, level, tenant_id, action, message
 */

export interface LogContext {
  tenant_id?: string;
  action?: string;
  [key: string]: unknown;
}

export const createLogger = (tenantId?: string) => {
  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    defaultMeta: tenantId ? { tenant_id: tenantId } : {},
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.printf(({ timestamp, level, message, tenant_id, action, ...meta }) => {
            let log = `${timestamp} [${level}]`;
            if (tenant_id) log += ` [tenant:${tenant_id}]`;
            if (action) log += ` [${action}]`;
            log += `: ${message}`;

            const metaKeys = Object.keys(meta);
            if (metaKeys.length > 0) {
              log += ` ${JSON.stringify(meta)}`;
            }

            return log;
          })
        ),
      }),
    ],
  });

  // Add file transport in production
  if (process.env.NODE_ENV === 'production') {
    logger.add(
      new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 10485760, // 10MB
        maxFiles: 5,
      })
    );
    logger.add(
      new winston.transports.File({
        filename: 'logs/combined.log',
        maxsize: 10485760,
        maxFiles: 10,
      })
    );
  }

  return {
    info: (message: string, context?: LogContext) => {
      logger.info(message, context);
    },
    error: (message: string, context?: LogContext) => {
      logger.error(message, context);
    },
    warn: (message: string, context?: LogContext) => {
      logger.warn(message, context);
    },
    debug: (message: string, context?: LogContext) => {
      logger.debug(message, context);
    },
  };
};

// Export default logger for non-tenant specific logs
export const logger = createLogger();
