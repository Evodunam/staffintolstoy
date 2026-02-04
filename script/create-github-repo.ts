import { Octokit } from '@octokit/rest';

let connectionSettings: any;

async function getAccessToken() {
  // Use environment variable for GitHub OAuth token
  const accessToken = process.env.GITHUB_ACCESS_TOKEN;
  
  if (!accessToken) {
    throw new Error('GitHub access token not configured. Set GITHUB_ACCESS_TOKEN environment variable.');
  }
  
  return accessToken;
}

async function main() {
  try {
    const accessToken = await getAccessToken();
    const octokit = new Octokit({ auth: accessToken });
    
    const { data: user } = await octokit.users.getAuthenticated();
    console.log('Authenticated as:', user.login);
    
    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name: 'tolstoy-staffing',
      private: true,
      auto_init: false,
    });
    
    console.log('Repository created:', repo.html_url);
    console.log('Clone URL:', repo.clone_url);
    console.log('Username:', user.login);
  } catch (error: any) {
    if (error.status === 422) {
      console.log('Repository may already exist. Fetching existing repo info...');
      const accessToken = await getAccessToken();
      const octokit = new Octokit({ auth: accessToken });
      const { data: user } = await octokit.users.getAuthenticated();
      console.log('Username:', user.login);
      console.log('Use this remote: https://github.com/' + user.login + '/tolstoy-staffing.git');
    } else {
      console.error('Error:', error.message || error);
    }
  }
}

main();
