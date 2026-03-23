// @generated from wit/agent.wit -- do not edit

/// <reference path="./strands-agent-types.d.ts" />
declare module 'strands:agent/tool-provider' {
  export function callTool(args: CallToolArgs): string;
  export function callTools(args: CallToolsArgs): Array<Result<string, string>>;
  export type CallToolArgs = import('strands:agent/types').CallToolArgs;
  export type CallToolsArgs = import('strands:agent/types').CallToolsArgs;
  export type Result<T, E> = { tag: 'ok', val: T } | { tag: 'err', val: E };
}
