/**
 * HTTP request tool for making HTTP/HTTPS requests.
 *
 * This is a vended tool, separate from the core SDK.
 * It can be optionally included in projects that need HTTP request functionality.
 *
 * @example
 * ```typescript
 * import { httpRequest } from '@strands-agents/sdk/vended_tools/http-request'
 *
 * const result = await httpRequest.stream({
 *   toolUse: {
 *     name: 'httpRequest',
 *     toolUseId: 'req-1',
 *     input: {
 *       method: 'GET',
 *       url: 'https://api.github.com/user',
 *       auth: {
 *         type: 'token',
 *         envVar: 'GITHUB_TOKEN'
 *       }
 *     }
 *   },
 *   invocationState: {}
 * })
 * ```
 */

export { httpRequest } from './http-request.js'
export type {
  HttpMethod,
  HttpAuthConfig,
  HttpBearerAuthConfig,
  HttpTokenAuthConfig,
  HttpBasicAuthConfig,
  HttpCustomAuthConfig,
  HttpApiKeyAuthConfig,
  HttpRequestInput,
  HttpResponse,
} from './types.js'
