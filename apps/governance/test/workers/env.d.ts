declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
    TEST_ACCESS_PRIVATE_JWK: string;
  }
}

// The same test-only bindings on the global Env the Worker code uses.
interface Env {
  TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  TEST_ACCESS_PRIVATE_JWK: string;
}
