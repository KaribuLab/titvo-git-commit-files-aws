import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

export interface SecretManagerServiceOptions {
    awsStage: string;
    awsEndpoint: string;
    awsRegion: string;
}

export class SecretManagerService {
    constructor(
        private readonly secretManagerClient: SecretsManagerClient,
    ) {}
    
    async getSecretValue(secretName: string): Promise<string | undefined> {
        const result = await this.secretManagerClient.send(new GetSecretValueCommand({
            SecretId: secretName,
        }));
        return result.SecretString;
    }
}

export function createSecretManagerService(options: SecretManagerServiceOptions): SecretManagerService {
    const secretManagerClient = options.awsStage === 'local' ? new SecretsManagerClient({
        endpoint: options.awsEndpoint,
        region: options.awsRegion,
    }) : new SecretsManagerClient();
    return new SecretManagerService(secretManagerClient);
}