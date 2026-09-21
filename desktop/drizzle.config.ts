import { defineConfig } from 'drizzle-kit';

// Migrations for the local main-process cache DB. `drizzle-kit generate` writes
// SQL into ./drizzle from src/main/db/schema.ts; the main process applies them
// on open. The actual DB file lives in the Electron userData dir at runtime.
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/db/schema.ts',
  out: './drizzle',
});
