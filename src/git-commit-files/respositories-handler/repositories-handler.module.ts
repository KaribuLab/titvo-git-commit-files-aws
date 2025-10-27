import { Module } from '@nestjs/common'
import { BitbucketClientService } from './bitbucket-client.service'
import { GitHubClientService } from './github-client.service'
import { RepoFactoryService } from './repo-factory.service'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [ConfigModule],
  providers: [BitbucketClientService, GitHubClientService, RepoFactoryService],
  exports: [RepoFactoryService]
})
export class RepositoriesHandlerModule {}
