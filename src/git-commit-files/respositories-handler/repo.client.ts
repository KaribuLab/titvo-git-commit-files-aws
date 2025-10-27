export interface FileInfo {
  path: string
  filename: string
}

export interface RepoClient {
  initFromRepoUrl(repoUrl: string): void
  getCommitFiles(commitId: string): Promise<FileInfo[]>
  downloadFile(path: string, commitId: string): Promise<Buffer>
}
