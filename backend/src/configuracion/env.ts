import 'dotenv/config';
import { parseEnv } from './parse-env.js';

export const env = parseEnv(process.env);

