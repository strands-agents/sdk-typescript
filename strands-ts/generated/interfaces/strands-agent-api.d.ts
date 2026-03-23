// @generated from wit/agent.wit -- do not edit

/// <reference path="./strands-agent-types.d.ts" />
declare module 'strands:agent/api' {
  export type AgentConfig = import('strands:agent/types').AgentConfig;
  export type StreamEvent = import('strands:agent/types').StreamEvent;
  export type StreamArgs = import('strands:agent/types').StreamArgs;
  export type RespondArgs = import('strands:agent/types').RespondArgs;
  export type SetMessagesArgs = import('strands:agent/types').SetMessagesArgs;
  
  export class Agent {
    constructor(config: AgentConfig)
    generate(args: StreamArgs): ResponseStream;
    getMessages(): string;
    setMessages(args: SetMessagesArgs): void;
    saveSession(): void;
    listSnapshots(): Array<string>;
    deleteSession(): void;
  }
  
  export class ResponseStream {
    /**
     * This type does not have a public constructor.
     */
    private constructor();
    readNext(): Array<StreamEvent> | undefined;
    respond(args: RespondArgs): void;
    cancel(): void;
  }
}
