import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from "@aws-sdk/client-eventbridge";

export interface EventBridgeServiceOptions {
    awsStage: string;
    awsEndpoint: string;
    awsRegion: string;
}

export class EventBridgeService {
    constructor(
        private readonly eventBridgeClient: EventBridgeClient,
    ) { }
    
    async putEvents(events: PutEventsRequestEntry[]): Promise<void> {
        await this.eventBridgeClient.send(new PutEventsCommand({
            Entries: events,
        }));
    }
}

export function createEventBridgeService(options: EventBridgeServiceOptions): EventBridgeService {
    const eventBridgeClient = options.awsStage === 'local' ? new EventBridgeClient({
        region: options.awsRegion,
        endpoint: options.awsEndpoint,
    }) : new EventBridgeClient();
    return new EventBridgeService(eventBridgeClient);
}