import { Module } from '@nestjs/common'
import { GitCommitFilesService } from '@lambda/git-commit-files/git-commit-files.service'

@Module({
  providers: [GitCommitFilesService]
})
export class GitCommitFilesModule {}
