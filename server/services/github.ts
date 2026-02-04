import { Octokit } from '@octokit/rest'

let connectionSettings: any;

async function getAccessToken() {
  // Use environment variable for GitHub OAuth token
  const accessToken = process.env.GITHUB_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('GitHub access token not configured. Set GITHUB_ACCESS_TOKEN environment variable.');
  }
  
  return accessToken;
}

export async function getUncachableGitHubClient() {
  const accessToken = await getAccessToken();
  return new Octokit({ auth: accessToken });
}

export async function createGitHubRepo(repoName: string, isPrivate: boolean = true) {
  const octokit = await getUncachableGitHubClient();
  
  const { data } = await octokit.repos.createForAuthenticatedUser({
    name: repoName,
    private: isPrivate,
    auto_init: false,
  });
  
  return data;
}

export async function getAuthenticatedUser() {
  const octokit = await getUncachableGitHubClient();
  const { data } = await octokit.users.getAuthenticated();
  return data;
}
