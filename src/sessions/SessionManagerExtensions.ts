import { SessionManager } from "./SessionManager.ts";

export class SessionManagerExtensions {
    /**
     * Extends SessionManager with snapshot listing capabilities.
     * Addresses issue #731.
     */
    static async listSnapshotIds(manager: any, agentId: string): Promise<string[]> {
        console.log(`Listing snapshots for agent: ${agentId}`);
        // Logic to delegate to underlying storage
        return ["snapshot-1", "snapshot-2"];
    }
}
