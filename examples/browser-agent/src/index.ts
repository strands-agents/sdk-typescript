import { Agent } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/openai';
import { updateCanvasTool } from './tools';

const messagesDiv = document.getElementById('messages')!;
const inputForm = document.getElementById('input-area') as HTMLFormElement;
const userInput = document.getElementById('user-input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;

// Helper to add message to UI
function addMessage(role: 'user' | 'agent', text: string) {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Helper to get API Key
async function getApiKey(): Promise<string> {
    const savedKey = localStorage.getItem('openai_api_key');
    if (savedKey) return savedKey;

    const key = prompt('Please enter your OpenAI API Key to use this demo (it will be saved in localStorage):');
    if (!key) {
        addMessage('agent', '⚠️ APIs Key is required. Please reload and enter a valid key.');
        throw new Error('No API Key provided');
    }

    localStorage.setItem('openai_api_key', key);
    return key;
}


async function main() {
    try {
        const apiKey = await getApiKey();

        // Initialize model
        // Note: In a production app, you should proxy requests to avoid exposing keys,
        // or use a provider that supports browser-safe authentication.
        const model = new OpenAIModel({
            apiKey: apiKey,
            modelId: 'gpt-4o', // or gpt-3.5-turbo
            clientConfig: {
                dangerouslyAllowBrowser: true // OpenAI SDK requires this for browser usage
            }
        });

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
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message agent';
                messagesDiv.appendChild(messageDiv);

                // We will update this div as tokens come in
                for await (const event of agent.stream(text)) {
                    if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
                        fullText += event.delta.text;
                        messageDiv.textContent = fullText;
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    }
                }

                // If the response was empty (e.g. only tool calls), we might want to say something
                if (!fullText) {
                    // Check if we can get the final response from invoke if stream is purely tool based?
                    // The stream iterator yields events. Tool use events happen, then tool results, then agent response.
                    // The textDelta accumulates the final answer.
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
