import { clockConfigFromEnv, type ClockConfig } from '../src/game/clock';

export type ServerConfig = {
  port: number;
  production: boolean;
  mongoUrl: string;
  databaseName: string;
  clock: ClockConfig;
};

export function loadServerConfig(
  env: Record<string, string | undefined>,
  argv: string[] = [],
): ServerConfig {
  const production = argv.includes('--static');
  const port = Number(env.PORT) || (production ? 3000 : 3001);

  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('PORT must be an integer between 1 and 65535');

  const mongoUrl = env.PLAKOTO_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
  let parsed: URL;

  try {
    parsed = new URL(mongoUrl);
  } catch {
    throw new Error('PLAKOTO_MONGO_URL must be a valid MongoDB URL');
  }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol))
    throw new Error('PLAKOTO_MONGO_URL must use mongodb: or mongodb+srv:');

  const databaseName = env.PLAKOTO_DB_NAME ?? 'plakoto';

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(databaseName))
    throw new Error('PLAKOTO_DB_NAME must be 1-64 letters, digits, underscores, or dashes');

  return { port, production, mongoUrl, databaseName, clock: clockConfigFromEnv(env) };
}
