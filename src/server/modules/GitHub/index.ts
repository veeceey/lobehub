export interface GitHubRepoInfo {
  branch: string;
  owner: string;
  repo: string;
}

export interface GitHubRawFileInfo extends GitHubRepoInfo {
  filePath: string;
}

export class GitHub {
  private readonly userAgent: string;

  constructor(options?: { userAgent?: string }) {
    this.userAgent = options?.userAgent || 'LobeHub';
  }

  /**
   * Parse GitHub URL to extract owner, repo, and branch
   * Supports multiple formats:
   * - https://github.com/owner/repo
   * - https://github.com/owner/repo/tree/branch
   * - https://github.com/owner/repo/tree/branch/path/to/dir
   * - github.com/owner/repo
   * - owner/repo (shorthand)
   * - https://github.com/owner/repo.git
   */
  parseRepoUrl(url: string, defaultBranch = 'main'): GitHubRepoInfo {
    // Handle shorthand format: owner/repo
    if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
      const [owner, repo] = url.split('/');
      return { branch: defaultBranch, owner, repo };
    }

    // Handle full URL formats
    const match = url.match(
      /(?:https?:\/\/)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/tree\/([^/]+))?(?:\/.*)?$/,
    );

    if (!match) {
      throw new GitHubParseError(`Invalid GitHub URL format: ${url}`);
    }

    const [, owner, repo, branch] = match;
    return {
      branch: branch || defaultBranch,
      owner,
      repo: repo.replace(/\.git$/, ''),
    };
  }

  /**
   * Build the ZIP download URL for a GitHub repository
   */
  buildRepoZipUrl(info: GitHubRepoInfo): string {
    return `https://github.com/${info.owner}/${info.repo}/archive/refs/heads/${info.branch}.zip`;
  }

  /**
   * Build the raw file URL for a GitHub repository
   */
  buildRawFileUrl(info: GitHubRawFileInfo): string {
    return `https://raw.githubusercontent.com/${info.owner}/${info.repo}/${info.branch}/${info.filePath}`;
  }

  /**
   * Download repository as ZIP buffer
   */
  async downloadRepoZip(info: GitHubRepoInfo): Promise<Buffer> {
    const zipUrl = this.buildRepoZipUrl(info);

    const response = await fetch(zipUrl, {
      headers: {
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `Repository not found: ${info.owner}/${info.repo}@${info.branch}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download repository: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Download a single raw file from GitHub
   */
  async downloadRawFile(info: GitHubRawFileInfo): Promise<string> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: {
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    return response.text();
  }

  /**
   * Download a single raw file as buffer from GitHub
   */
  async downloadRawFileBuffer(info: GitHubRawFileInfo): Promise<Buffer> {
    const rawUrl = this.buildRawFileUrl(info);

    const response = await fetch(rawUrl, {
      headers: {
        'User-Agent': this.userAgent,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new GitHubNotFoundError(
          `File not found: ${info.owner}/${info.repo}@${info.branch}/${info.filePath}`,
        );
      }
      throw new GitHubDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHubParseError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubParseError';
  }
}

export class GitHubNotFoundError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubNotFoundError';
  }
}

export class GitHubDownloadError extends GitHubError {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubDownloadError';
  }
}

export const github = new GitHub();
