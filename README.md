# Diagox Agent SDK

This is diagox agent API sdk for NodeJS folks.

## Setup
To install dependencies:

```bash
bun install
```

## Examples

Best to see usage is checking out [/examples](/examples/) dir.  
Run any example like:
```sh
bun run examples/playback.ts
```


```ts 
const client = new AgentRPCClient({ url: 'ws://localhost:6000', endpoint: 'myagent' });

client.onInvite(async (request: AgentRequest) => {
    try {
        // Accept the dialog
        const session = await client.acceptDialog(request);

        // Answer
        const answerResponse = await session.request('answer');

        // Play sound
        const playResponse = await session.request('play', {
            uri: 'http://mymediaserver/hello-world.wav'
        });

        // Redirect call to internal endpoint
        const redirectResponse = await session.request(`redirect`, { endpoint: "voicebot" });
    } catch (error) {
        // handle error 
    }
}

// Connect to diagox and listen 
await client.connectAndListen();
```

## Debuging 

Use `DEBUG=diagox-agent-sdk` to have logging from SDK.