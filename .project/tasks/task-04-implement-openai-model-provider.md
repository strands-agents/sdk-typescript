# Title: Implement OpenAI Model Provider

## Description:
Create the OpenAI model provider implementation using the official OpenAI TypeScript client. Implement the ModelProvider interface with proper configuration management, streaming support, and comprehensive error handling for OpenAI models.

## Work Required:
- Add OpenAI TypeScript client as a dependency to package.json
- Implement OpenAIModel class implementing the ModelProvider interface (update_config, get_config, stream methods)
- Create OpenAIConfig interface including all config options for OpenAI chat completions API (model, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, stop, etc.)
- Implement constructor with API key and base URL support
- Implement stream method using OpenAI's streaming API with proper request/response mapping
- Add comprehensive error handling for OpenAI-specific errors with well-defined error types
- Create integration tests that test against real OpenAI API service
- Add unit tests with mocked OpenAI client

## Exit Criteria:
A fully functional OpenAIModel that implements the ModelProvider interface, supports OpenAI chat completions, has comprehensive error handling, and passes both unit and integration tests against real OpenAI API service.

## Dependencies:
- task-03-implement-aws-bedrock-model-provider
