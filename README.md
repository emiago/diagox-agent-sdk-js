# Diagox Flow API SDK

This is diagox Flow API SDK for NodeJS folks.

## Setup
To install dependencies:

```bash
bun install
```



## Getting Started

Small example what is needed to connect and run. It is expected that you have endpoint `myagent` configured.

```ts 
const client = new FlowClient({ url: 'ws://localhost:6000', endpoint: 'myagent' });

client.onInvite(async (request: Request) => {
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

## Examples

You can find more examples on [/examples](/examples/).

For examples you need diagox running 
`CONF_FILE=examples/diagox-agent.yaml diagox` 


Run any example like:
```sh
bun run examples/playback.ts
bun run examples/read_dtmf.ts
```


## Debuging 

Use `DEBUG=diagox-agent-sdk` to have logging from SDK.