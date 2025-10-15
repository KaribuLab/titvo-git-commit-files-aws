import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config';
import { GitCommitFilesInputDto, GitCommitFilesOutputDto } from '@lambda/git-commit-files/git-commit-files.dto'

@Injectable()
export class GitCommitFilesService {
  private readonly logger = new Logger(GitCommitFilesService.name)
  constructor (
    private readonly configService: ConfigService,
  ) {}
  async process (input: GitCommitFilesInputDto): Promise<GitCommitFilesOutputDto> {
    const dummy = this.configService.get<string>('dummy')
    this.logger.log(`dummy: ${dummy}`)
    return {
      name: `${dummy} ${input.name}`
    }
  }
}
