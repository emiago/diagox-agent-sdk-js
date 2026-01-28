import { FlowClient, Request } from "../src/index";

const originalLog = console.log;
console.log = (...data: any[]) => {
  const timestamp = new Date().toISOString();
  originalLog(timestamp, ...data);
}

async function main() {
  const client = new FlowClient({ url: 'ws://localhost:6000', endpoint: 'myagent' });

  client.onInvite(async (request: Request) => {
    console.log(`Received invite for dialog: ${request.did}`);
    try {
      // Accept the dialog
      const session = await client.acceptDialog(request);
      const inviteData = request.data as { callID: string, from: string, to: string }
      console.log(`Dialog accepted: did=${session.dialogId} from=${inviteData.from} to=${inviteData.to}`);

      // Now you can use this session to send requests
      const ringResponse = await session.request('ring');
      console.log(`Ringing: did=${session.dialogId} response=${ringResponse.reason}`);
      if (ringResponse.code !== 200) {
        throw new Error("Ringing failed");
      }

      const answerResponse = await session.request('answer');
      console.log(`Answer: did=${session.dialogId} response=${answerResponse.reason}`);
      if (answerResponse.code !== 200) {
        throw new Error("Answering failed");
      }

      // This will block until playback is terminated
      const playResponse = await session.request('play', {
        uri: 'https://mauvecloud.net/sounds/pcm1608m.wav'
      }, (response) => {
        console.log(`Playback info: (${response.code}) ${response.reason}`);
      });
      console.log(`Play finished: did=${session.dialogId} response=${playResponse.reason}`);
      if (playResponse.code !== 200) {
        throw new Error("Playback failed");
      }

      const hangupResponse = await session.request('hangup');
      console.log(`Hanguped: did=${session.dialogId} response=${hangupResponse.reason}`);
    } catch (error) {
      console.error(`Error handling dialog ${request.did}:`, error);
    }
  });

  try {
    // Connect and start listening for invites
    console.log('Waiting for incoming dialogs...');
    await client.connectAndListen();
  } catch (error) {
    console.error('Failed:', error);
  }
}

await main();
