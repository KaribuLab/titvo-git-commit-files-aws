import { Module } from '@nestjs/common'
import { BitbucketClientService } from './bitbucket/bitbucket-client.service'
import { GitHubClientService } from './github/github-client.service'
import { SshGitRepoClient } from './ssh/ssh-git-repo-client.service'
import { RepoFactoryService } from './repo-factory.service'
import { ConfigModule } from '@nestjs/config'
import { ParameterModule } from '@lambda/parameter/parameter.module'

@Module({
  imports: [ConfigModule, ParameterModule.forRoot()],
  providers: [
    BitbucketClientService,
    GitHubClientService,
    SshGitRepoClient,
    RepoFactoryService,
  ],
  exports: [RepoFactoryService],
})
export class RepositoriesHandlerModule {}
