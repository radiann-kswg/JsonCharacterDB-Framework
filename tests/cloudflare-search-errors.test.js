import { describe, it, expect } from 'vitest';
import worker from '../pkg/cloudflare/worker.js';

function makeEnv() {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              first: async () => ({ is_hidden: 0 }),
              all: async () => ({ results: [] }),
            };
          },
        };
      },
    },
    BUCKET: {
      head: async () => null,
      get: async () => null,
    },
  };
}

describe('Cloudflare Workers search query validation', () => {
  it('returns 400 for wildcard-only search queries', async () => {
    const res = await worker.fetch(
      new Request('https://example.invalid/api/v1/Works_NumberTales/search?q=*'),
      makeEnv(),
      {}
    );

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid search query');
    expect(json.status).toBe(400);
  });
});
