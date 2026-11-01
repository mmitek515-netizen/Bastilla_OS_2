import { createHash, timingSafeEqual } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest();
const DEFAULT_REPOSITORY = 'mmitek515-netizen/Bastilla_OS_2';
const GITHUB_API = 'https://api.github.com';
const authorizationPrefix = ['Be', 'arer '].join('');

export function isAuthorizedGitHubDashboardToken(expected, authorization) {
  const token = typeof expected === 'string' ? expected.trim() : '';
  if (token.length < 32 || typeof authorization !== 'string') return false;
  return timingSafeEqual(digest(authorization), digest(authorizationPrefix + token));
}

function githubLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'github.com' && !url.port && !url.username && !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function mapIssue(issue) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    url: githubLink(issue.html_url),
    updatedAt: issue.updated_at,
    assignees: Array.isArray(issue.assignees) ? issue.assignees.map(({ login }) => login).filter(Boolean) : [],
  };
}

function mapPull(pull) {
  return {
    ...mapIssue(pull),
    mergedAt: pull.merged_at || null,
    headSha: typeof pull.head?.sha === 'string' ? pull.head.sha : null,
  };
}

function mapRun(run) {
  return {
    id: run.id,
    name: run.name || run.display_title || 'GitHub Actions',
    status: run.status,
    conclusion: run.conclusion || null,
    url: githubLink(run.html_url),
    headSha: typeof run.head_sha === 'string' ? run.head_sha : null,
    updatedAt: run.updated_at,
  };
}

/**
 * @param {{ token: string, repository?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export async function fetchGitHubEvidence({
  token,
  repository = DEFAULT_REPOSITORY,
  fetchImpl = fetch,
  timeoutMs = 8000,
} = {}) {
  if (typeof token !== 'string' || token.trim().length < 20) {
    throw new Error('GitHub read access is not configured.');
  }
  if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repository)) {
    throw new Error('GitHub repository configuration is invalid.');
  }

  const base = `${GITHUB_API}/repos/${repository}`;
  const get = async endpoint => {
    let response;
    try {
      response = await fetchImpl(`${base}/${endpoint}`, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: authorizationPrefix + token.trim(),
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error('GitHub API is unavailable.');
    }
    if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error('GitHub API returned invalid data.');
    }
  };

  const [issues, pulls, actions] = await Promise.all([
    get('issues?state=all&per_page=30&sort=updated'),
    get('pulls?state=all&per_page=30&sort=updated&direction=desc'),
    get('actions/runs?per_page=20'),
  ]);
  if (!Array.isArray(issues) || !Array.isArray(pulls) || !Array.isArray(actions?.workflow_runs)) {
    throw new Error('GitHub API returned an unexpected response.');
  }

  return {
    repository,
    source: `https://github.com/${repository}`,
    fetchedAt: new Date().toISOString(),
    agents: ['Alex', 'Aria', 'Astyria', 'Aurelius'].map(name => ({
      name,
      processStatus: 'unverified',
    })),
    issues: issues.filter(issue => !issue.pull_request).map(mapIssue),
    pulls: pulls.map(mapPull),
    actions: actions.workflow_runs.map(mapRun),
    note: 'GitHub issues and assignments do not prove that an agent process is running.',
  };
}
