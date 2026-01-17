import { Agent, BedrockModel } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/openai';
import { updateCanvasTool } from './tools';

const messagesDiv = document.getElementById('messages')!;
const inputForm = document.getElementById('input-area') as HTMLFormElement;
const userInput = document.getElementById('user-input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;

// Helper to add message to UI
function addMessage(role: 'user' | 'agent' | 'tool', text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return div;
}

// Helper to initialize model based on user selection
async function getModel() {
    const savedProvider = localStorage.getItem('agent_provider');
    // Default to openai if not set, but allow changing via prompt if we want to be fancy.
    // For simplicity, we'll check if we have keys for one or the other, or ask.

    let provider = savedProvider;
    if (!provider) {
        provider = prompt('Choose model provider: "openai" or "bedrock"', 'openai') || 'openai';
        localStorage.setItem('agent_provider', provider);
    }

    if (provider.toLowerCase() === 'bedrock') {
        const savedRegion = localStorage.getItem('bedrock_region');
        const savedAccessKey = localStorage.getItem('bedrock_access_key');
        const savedSecretKey = localStorage.getItem('bedrock_secret_key');

        if (savedRegion && savedAccessKey && savedSecretKey) {
            return new BedrockModel({
                region: savedRegion,
                clientConfig: {
                    credentials: {
                        accessKeyId: savedAccessKey,
                        secretAccessKey: savedSecretKey
                    }
                }
            });
        }

        const region = prompt('Enter AWS Region (e.g., us-west-2):', 'us-west-2');
        const accessKey = prompt('Enter AWS Access Key ID:');
        const secretKey = prompt('Enter AWS Secret Access Key:');

        if (!region || !accessKey || !secretKey) {
            addMessage('agent', '⚠️ AWS Credentials are required for Bedrock. Please reload.');
            throw new Error('Missing AWS Credentials');
        }

        localStorage.setItem('bedrock_region', region);
        localStorage.setItem('bedrock_access_key', accessKey);
        localStorage.setItem('bedrock_secret_key', secretKey);

        return new BedrockModel({
            region,
            clientConfig: {
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey
                }
            }
        });
    } else {
        // OpenAI default
        const savedKey = localStorage.getItem('openai_api_key');
        let apiKey = savedKey;

        if (!apiKey) {
            apiKey = prompt('Please enter your OpenAI API Key (saved in localStorage):');
            if (!apiKey) {
                addMessage('agent', '⚠️ API Key is required. Please reload.');
                throw new Error('No API Key provided');
            }
            localStorage.setItem('openai_api_key', apiKey);
        }

        return new OpenAIModel({
            apiKey: apiKey!,
            modelId: 'gpt-4o',
            clientConfig: {
                dangerouslyAllowBrowser: true
            }
        });
    }
}


async function main() {
    try {
        const model = await getModel();

        const agent = new Agent({
            model,
            systemPrompt: `You are a creative and helpful browser assistant. 
You can modify the style and content of the "canvas" element on the page using the update_canvas tool.
Always use the tool when the user asks for visual changes.
Be concise in your text responses.`,
            tools: [updateCanvasTool],
        });

        // Handle user input
        inputForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = userInput.value.trim();
            if (!text) return;

            addMessage('user', text);
            userInput.value = '';
            userInput.disabled = true;
            sendBtn.disabled = true;

            try {
                // Stream the response
                let fullText = '';
                const messageDiv = addMessage('agent', '');

                // We will update this div as tokens come in
                for await (const event of agent.stream(text)) {
                    if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
                        fullText += event.delta.text;
                        messageDiv.textContent = fullText;
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    } else if (event.type === 'modelContentBlockStartEvent' && event.start.type === 'toolUseStart') {
                        // Indicate tool use
                        const toolMsg = document.createElement('div');
                        toolMsg.className = 'message tool';
                        toolMsg.style.fontSize = '0.8em';
                        toolMsg.style.color = '#666';
                        toolMsg.textContent = `🛠️ Using tool: ${event.start.name}...`;
                        // Insert before the current agent message or append?
                        // If we append, it might appear after partial text.
                        // Let's just append it to the main container for now.
                        messagesDiv.insertBefore(toolMsg, messageDiv);
                    }
                }

            } catch (err) {
                console.error(err);
                addMessage('agent', 'Error: ' + (err as Error).message);
            } finally {
                userInput.disabled = false;
                sendBtn.disabled = false;
                userInput.focus();
            }
        });

        console.log('Agent initialized');

    } catch (error) {
        console.error('Failed to initialize agent:', error);
    }
}

main();
