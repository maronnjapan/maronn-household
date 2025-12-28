export type Bindings = {
  DB: D1Database;
  SYNC: DurableObjectNamespace;
  ENVIRONMENT: string;
  ALLOWED_ORIGINS?: string;
};
