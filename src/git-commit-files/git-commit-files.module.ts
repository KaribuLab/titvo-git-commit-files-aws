import { Module } from '@nestjs/common'
import { GitCommitFilesService } from './git-commit-files.service'
import { RepositoriesHandlerModule } from './respositories-handler/repositories-handler.module'
import { S3ParallelETLService } from './buckets/s3-parallel-uploader.service'
import { AwsModule } from '@lambda/aws/aws.module'
import { ParameterModule } from '@lambda/parameter/parameter.module'

@Module({
  imports: [
    RepositoriesHandlerModule,
    AwsModule.forRoot(),
    ParameterModule.forRoot(),
  ],
  providers: [S3ParallelETLService, GitCommitFilesService]
})
export class GitCommitFilesModule {}
