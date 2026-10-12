/**
 * In-memory fake GitHub API (TEST-2). See `fake.ts`.
 *
 * Unit tests: `new GitHubClient({ token, fetch: fake.fetch })`. `fake.fetch` is the browser's view:
 * it fails requests whose headers would not pass GitHub's CORS preflight and hides every response
 * header GitHub does not expose.
 *
 * e2e (Playwright): route `https://api.github.com/**` to `fake.handle(request)`, building a
 * `Request` from `route.request()` (url, method, headers, `postData()`), then `route.fulfill` with
 * the response's status, headers and body. `handle` returns GitHub's full headers (CORS included),
 * so the browser applies CORS itself, and answers OPTIONS preflights. A `FakeNetworkError` thrown
 * by `handle` (from `failNext({ kind: 'network' })` or `offline = true`) maps to `route.abort()`.
 */
export {
  ALLOWED_REQUEST_HEADERS,
  API_ORIGIN,
  EXPOSED_HEADERS,
  FakeGitHub,
  FakeNetworkError,
  base64ToBytes,
  bytesToBase64,
  type CommitFilesOptions,
  type FakeCommitInfo,
  type FakeFailure,
  type FakeRepoOptions,
  type FakeRequestInfo,
  type FakeTokenOptions,
  type FakeUser,
  type RequestLogEntry,
} from './fake'
export { hashObject, sha1Hex, utf8 } from './git'
