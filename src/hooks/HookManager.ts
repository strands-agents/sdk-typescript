export type HookCallback = (event: any) => Promise<void>;

export class HookManager {
    /**
     * Core Hooks system for agent lifecycle events.
     * Provides parity with the Python SDK hooks implementation.
     */
    private hooks: Map<string, HookCallback[]> = new Map();

    register(event: string, callback: HookCallback) {
        if (!self.hooks.has(event)) {
            self.hooks.set(event, []);
        }
        self.hooks.get(event)?.push(callback);
    }

    async emit(event: string, data: any) {
        const callbacks = self.hooks.get(event) || [];
        for (const callback of callbacks) {
            await callback(data);
        }
    }
}
