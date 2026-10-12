/**
 * In-memory fake GitHub API (TEST-2). See `fake.ts`.
 *
 * Unit tests:  new GitHubClient({ token, fetch: fake.fetch })        (browser view, CORS applied)
 * e2e tests:   page.route('https://api.github.com/**', (route) => fake.handle(toRequest(route)) …)
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
