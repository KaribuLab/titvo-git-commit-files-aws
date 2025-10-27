import { Module } from '@nestjs/common'
import { GitCommitFilesService } from './git-commit-files.service'
import { RepositoriesHandlerModule } from './respositories-handler/repositories-handler.module'
import { S3Service } from '../aws/s3.service'
import { S3ParallelETLService } from './buckets/s3-parallel-uploader.service'

@Module({
  imports: [RepositoriesHandlerModule],
  providers: [S3Service, S3ParallelETLService, GitCommitFilesService]
})
export class GitCommitFilesModule {}
