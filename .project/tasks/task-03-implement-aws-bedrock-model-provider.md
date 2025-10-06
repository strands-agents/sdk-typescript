# Title: Impement AWS Bedrock Model Provider

## Description:
Create the AWS Bedrock model provider implementation using the AWS SDK v3. Implement the ModelProvider interface with proper configuration management, streaming support, and comprehensive error handling for all Bedrock model types.

## Work Required:
- Add AWS Bedrock SDK as a dependency to package.json
  - https://www.npmjs.com/package/@aws-sdk/client-bedrock-runtime
- Implement BedrockModel class implementing the ModelProvider interface implemented in task-01 (update_config, get_config, stream methods)
- Create BedrockConfig interface including all config options needed for the bedrock converse_stream API (guardrails, caching, model parameters, etc.)
  - Python example of this: https://github.com/strands-agents/sdk-python/blob/eef11cc890266b48a22dcc3e555880926d52ec88/src/strands/models/bedrock.py#L66-L112
- Implement constructor with client configuration
- Add the `user_agent_extra` header with the value `strands-agents-ts-sdk` to request to bedrock so that we can track they were provided by strands
  - Python example: https://github.com/strands-agents/sdk-python/blob/eef11cc890266b48a22dcc3e555880926d52ec88/src/strands/models/bedrock.py#L146-L158
- Implement stream method supporting all Bedrock model types with proper request/response mapping
  - You will use the `ConverseStreamCommand` from the aws bedrock sdk: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/bedrock-runtime/command/ConverseStreamCommand/
  - The format of the response of this command is an AsyncIterable of this type: https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/Package/-aws-sdk-client-bedrock-runtime/TypeAlias/ConverseStreamOutput/
- Add handling for context window overflow errors, and throttling errors, creating new error types for each in the sdk that will be handled in a later task.
- Create integration tests that test against real AWS Bedrock service
- Add unit tests with mocked AWS SDK client

## Exit Criteria:
A fully functional BedrockModel that implements the ModelProvider interface, converts the aws bedrock client repsonse stream to the expected shape outlined in task-02, has ContextWindowOverflow error handling, and includes+passes both unit and integration tests against real AWS Bedrock service.

## Dependencies:
- task-02-create-base-model-provider-interface
