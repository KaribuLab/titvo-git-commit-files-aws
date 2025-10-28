import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, GetCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';

export interface DynamoDBServiceOptions {
    awsStage: string;
    awsEndpoint: string;
    awsRegion: string;
}

export class DynamoDBService {
    constructor(
        private readonly dynamoDBDocumentClient: DynamoDBDocumentClient,
    ) {}
    async putItem(tableName: string, item: Record<string, any>): Promise<void> {
        await this.dynamoDBDocumentClient.send(new PutCommand({
            TableName: tableName,
            Item: item,
        }));
    }
    async getItem(tableName: string, key: Record<string, any>): Promise<Record<string, any> | undefined> {
        const result = await this.dynamoDBDocumentClient.send(new GetCommand({
            TableName: tableName,
            Key: key,
        }));
        return result.Item;
    }
    async scan(tableName: string, filterExpression: string, expressionAttributeValues: Record<string, any>): Promise<Record<string, any>[]> {
        const result = await this.dynamoDBDocumentClient.send(new ScanCommand({
            TableName: tableName,
            FilterExpression: filterExpression,
            ExpressionAttributeValues: expressionAttributeValues,
        }));
        return result.Items ?? [];
    }
}

export function createDynamoDBService(options: DynamoDBServiceOptions): DynamoDBService {
    const dynamoDBClient = options.awsStage === 'local' ? new DynamoDBClient({
            region: options.awsRegion,
            endpoint: options.awsEndpoint,
        }) : new DynamoDBClient();
    const dynamoDBDocumentClient = DynamoDBDocumentClient.from(dynamoDBClient);
    return new DynamoDBService(dynamoDBDocumentClient);
}