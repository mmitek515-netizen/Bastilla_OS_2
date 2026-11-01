import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchGitHubEvidence, isAuthorizedGitHubDashboardToken } from '../src/lib/githubEvidence.mjs';

const token = 'github-read-token-for-tests';
const dashboardToken = 'dashboard-access-token-for-tests-0123456789';
const authHeader = value => ['Be', 'arer '].join('') + value;

test('dashboard access token is checked without accepting missing or malformed credentials', () => {
  assert.equal(isAuthorizedGitHubDashboardToken(dashboardToken, authHeader(dashboardToken)), true);
  assert.equal(isAuthorizedGitHubDashboardToken(dashboardToken, dashboardToken), false);
  assert.equal(isAuthorizedGitHubDashboardToken(dashboardToken, ''), false);
  assert.equal(isAuthorizedGitHubDashboardToken('short', authHeader('short')), false);
});

test('GitHub evidence uses authenticated GET requests and separates process status from assignments', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.includes('/issues?')) {
      return { ok: true, json: async () => [
        { number: 2, title: 'Issue', state: 'open', html_url: 'https://github.com/example/repo/issues/2', updated_at: '2026-10-30T00:00:00Z', assignees: [{ login: 'Alex' }] },
        { number: 3, title: 'PR-shaped issue', pull_request: {}, state: 'open', html_url: 'https://github.com/example/repo/pull/3', updated_at: '2026-10-30T00:00:00Z' },
      ] };
    }
    if (url.includes('/pulls?')) {
      return { ok: true, json: async () => [
        { number: 4, title: 'Pull', state: 'open', merged_at: null, html_url: 'https://github.com/example/repo/pull/4', updated_at: '2026-10-31T00:00:00Z', head: { sha: 'abc123' }, assignees: [] },
      ] };
    }
    return { ok: true, json: async () => ({ workflow_runs: [
      { id: 8, name: 'CI', status: 'completed', conclusion: 'success', html_url: 'https://github.com/example/repo/actions/runs/8', head_sha: 'def456', updated_at: '2026-10-31T01:00:00Z' },
    ] }) };
  };

  const evidence = await fetchGitHubEvidence({ token, repository: 'example/repo', fetchImpl });
  assert.equal(requests.length, 3);
  for (const { options } of requests) {
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, authHeader(token));
  }
  assert.deepEqual(evidence.agents.map(agent => agent.processStatus), ['unverified', 'unverified', 'unverified', 'unverified']);
  assert.equal(evidence.issues.length, 1);
  assert.deepEqual(evidence.issues[0].assignees, ['Alex']);
  assert.equal(evidence.pulls[0].headSha, 'abc123');
  assert.equal(evidence.actions[0].conclusion, 'success');
  assert.equal(evidence.actions[0].headSha, 'def456');
  assert.equal(evidence.source, 'https://github.com/example/repo');
});

test('GitHub evidence rejects invalid configuration and does not leak credentials in errors', async () => {
  await assert.rejects(() => fetchGitHubEvidence({ token: '' }), /not configured/);
  await assert.rejects(() => fetchGitHubEvidence({ token, repository: 'https://attacker.example' }), /configuration is invalid/);
  await assert.rejects(
    () => fetchGitHubEvidence({
      token,
      repository: 'example/repo',
      fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ message: token }) }),
    }),
    error => error.message === 'GitHub API returned HTTP 401.' && !error.message.includes(token),
  );
});
