import { Agent, BedrockModel } from '@strands-agents/sdk';
import { OpenAIModel } from '@strands-agents/sdk/openai';
import { AnthropicModel } from '@strands-agents/sdk/anthropic';
import { updateCanvasTool } from './tools';
import { marked } from 'marked';

const messagesDiv = document.getElementById('messages')!;
const inputForm = document.getElementById('input-area') as HTMLFormElement;
const userInput = document.getElementById('user-input') as HTMLInputElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const settingsModal = document.getElementById('settings-modal')!;
const providerSelect = document.getElementById('provider-select') as HTMLSelectElement;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
const cancelSettingsBtn = document.getElementById('cancel-settings-btn') as HTMLButtonElement;

// Cache settings input elements
const openaiKeyInput = document.getElementById('openai-key') as HTMLInputElement;
const openaiUrlInput = document.getElementById('openai-url') as HTMLInputElement;
const anthropicKeyInput = document.getElementById('anthropic-key') as HTMLInputElement;
const bedrockRegionInput = document.getElementById('bedrock-region') as HTMLInputElement;
const bedrockAccessKeyInput = document.getElementById('bedrock-access-key') as HTMLInputElement;
const bedrockSecretKeyInput = document.getElementById('bedrock-secret-key') as HTMLInputElement;
const openaiFields = document.querySelector('.openai-fields') as HTMLElement;
const anthropicFields = document.querySelector('.anthropic-fields') as HTMLElement;
const bedrockFields = document.querySelector('.bedrock-fields') as HTMLElement;

function showToast(message: string): void {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = 'position:fixed;top:2rem;left:50%;transform:translateX(-50%);background:#1d1d1f;color:white;padding:1rem 2rem;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:2000;';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function toggleProviderFields(provider: string): void {
    openaiFields.style.display = provider === 'openai' ? 'block' : 'none';
    anthropicFields.style.display = provider === 'anthropic' ? 'block' : 'none';
    bedrockFields.classList.toggle('show', provider === 'bedrock');
}

function addMessage(role: 'user' | 'agent' | 'tool', text: string): HTMLDivElement {
    const div = document.createElement('div');
    div.className = `message ${role}`;
    div.textContent = text;
    messagesDiv.appendChild(div);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    return div;
}

function getCredential(key: string, providerName: string): string {
    const value = localStorage.getItem(key);
    if (!value) {
        throw new Error(`${providerName} credentials not configured. Click Settings to configure.`);
    }
    return value;
}

function getModel(): BedrockModel | AnthropicModel | OpenAIModel {
    const provider = localStorage.getItem('agent_provider') || 'openai';

    if (provider === 'bedrock') {
        return new BedrockModel({
            region: getCredential('bedrock_region', 'AWS'),
            clientConfig: {
                credentials: {
                    accessKeyId: getCredential('bedrock_access_key', 'AWS'),
                    secretAccessKey: getCredential('bedrock_secret_key', 'AWS')
                }
            }
        });
    }

    if (provider === 'anthropic') {
        return new AnthropicModel({
            apiKey: getCredential('anthropic_api_key', 'Anthropic'),
            clientConfig: {
                dangerouslyAllowBrowser: true
            }
        });
    }

    const openaiKey = getCredential('openai_api_key', 'OpenAI');
    const openaiUrl = localStorage.getItem('openai_base_url');

    return new OpenAIModel({
        apiKey: openaiKey,
        modelId: 'minimax/minimax-m2.5',
        clientConfig: {
            dangerouslyAllowBrowser: true,
            ...(openaiUrl ? { baseURL: openaiUrl } : {})
        }
    });
}


async function main(): Promise<void> {
    let agent: Agent;

    function initializeAgent(): void {
        try {
            const model = getModel();
            agent = new Agent({
                model,
                systemPrompt: `You are a creative and helpful browser assistant. 
You can modify the html and style of the sandboxed canvas iframe on the page using the update_canvas tool.
The canvas is isolated in an iframe for security. Only visual updates via html and style changes are permitted.
Always use the tool when the user asks for visual changes.
Be concise in your text responses.`,
                tools: [updateCanvasTool],
            });
            console.log('Agent initialized');
        } catch (error) {
            addMessage('agent', '⚠️ ' + (error as Error).message);
            throw error;
        }
    }

    try {
        initializeAgent();
    } catch (e) {
        console.warn('Initial agent setup pending configuration');
    }

    // Settings UI handlers
    settingsBtn.addEventListener('click', () => {
        const provider = localStorage.getItem('agent_provider') || 'openai';
        providerSelect.value = provider;

        openaiKeyInput.value = localStorage.getItem('openai_api_key') || '';
        openaiUrlInput.value = localStorage.getItem('openai_base_url') || '';
        anthropicKeyInput.value = localStorage.getItem('anthropic_api_key') || '';
        bedrockRegionInput.value = localStorage.getItem('bedrock_region') || 'us-west-2';
        bedrockAccessKeyInput.value = localStorage.getItem('bedrock_access_key') || '';
        bedrockSecretKeyInput.value = localStorage.getItem('bedrock_secret_key') || '';

        toggleProviderFields(provider);
        settingsModal.classList.add('show');
    });

    cancelSettingsBtn.addEventListener('click', () => {
        settingsModal.classList.remove('show');
    });

    saveSettingsBtn.addEventListener('click', () => {
        const provider = providerSelect.value;
        localStorage.setItem('agent_provider', provider);

        if (provider === 'openai') {
            const key = openaiKeyInput.value;
            const url = openaiUrlInput.value;
            if (key) localStorage.setItem('openai_api_key', key);

            // Allow storing an empty string to clear the base URL setting
            localStorage.setItem('openai_base_url', url);
        } else if (provider === 'anthropic') {
            const key = anthropicKeyInput.value;
            if (key) localStorage.setItem('anthropic_api_key', key);
        } else {
            const region = bedrockRegionInput.value;
            const accessKey = bedrockAccessKeyInput.value;
            const secretKey = bedrockSecretKeyInput.value;
            if (region) localStorage.setItem('bedrock_region', region);
            if (accessKey) localStorage.setItem('bedrock_access_key', accessKey);
            if (secretKey) localStorage.setItem('bedrock_secret_key', secretKey);
        }

        settingsModal.classList.remove('show');

        try {
            initializeAgent();
            messagesDiv.innerHTML = '<div class="message agent">Hello! I can modify the canvas on the left. 👈<br />Try asking me "change background to blue" or "make it a circle".</div>';
            showToast('Settings saved!');
        } catch {
            showToast('Failed to initialize agent. Check your credentials.');
        }
    });

    providerSelect.addEventListener('change', (e) => {
        toggleProviderFields((e.target as HTMLSelectElement).value);
    });

    // Clear chat button
    clearBtn.addEventListener('click', () => {
        messagesDiv.innerHTML = '<div class="message agent">Hello! I can modify the canvas on the left. 👈<br />Try asking me "change background to blue" or "make it a circle".</div>';
        if (agent) {
            agent.messages.length = 0;
        }
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

        if (!agent) {
            addMessage('agent', 'Error: Agent not initialized. Please configure settings first.');
            userInput.disabled = false;
            sendBtn.disabled = false;
            return;
        }

        try {
            let fullText = '';
            let messageDiv: HTMLDivElement | null = null;

            for await (const event of agent.stream(text)) {
                if (event.type === 'modelContentBlockStartEvent') {
                    if (event.start?.type === 'toolUseStart') {
                        const toolMsg = document.createElement('div');
                        toolMsg.className = 'message tool';
                        toolMsg.style.fontSize = '0.8em';
                        toolMsg.style.color = '#666';
                        toolMsg.textContent = `🛠️ Using tool: ${event.start.name}...`;
                        messagesDiv.appendChild(toolMsg);
                        messagesDiv.scrollTop = messagesDiv.scrollHeight;
                    } else {
                        fullText = '';
                        messageDiv = addMessage('agent', '');
                    }
                } else if (event.type === 'modelContentBlockDeltaEvent' && event.delta.type === 'textDelta') {
                    if (!messageDiv) messageDiv = addMessage('agent', '');
                    fullText += event.delta.text;
                    try {
                        messageDiv.innerHTML = marked.parse(fullText) as string;
                    } catch {
                        messageDiv.textContent = fullText;
                    }
                    messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
}

main();
