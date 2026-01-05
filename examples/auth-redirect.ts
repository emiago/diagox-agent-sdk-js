import { AgentRPCClient, AgentRequest } from "../src/index";

const originalLog = console.log;
console.log = (...data: any[]) => {
  const timestamp = new Date().toISOString();
  originalLog(timestamp, ...data);
}

async function main() {
  const client = new AgentRPCClient({ url: 'ws://localhost:6000', endpoint: 'myagent' });

  client.onInvite(async (request: AgentRequest) => {
    console.log(`Received invite for dialog: ${request.did}`);
    try {
      // Accept the dialog
      const session = await client.acceptDialog(request);
      const inviteData = request.data as { callID: string, from: string, to: string }
      console.log(`Dialog accepted: did=${session.dialogId} from=${inviteData.from} to=${inviteData.to}`);

      // Before any media action you need to answer dialog first
      const answerResponse = await session.request('answer');
      console.log(`Answer: did=${session.dialogId} response=${answerResponse.reason}`);
      if (answerResponse.code !== 200) {
        throw new Error("Answering failed: " + answerResponse.reason);
      }

      // Read DTMF
      const readDtmfResponse = await session.request('read_dtmf', {
        duration_sec: 10,
        termination: '#',
      });
      if (readDtmfResponse.code !== 200) {
        throw new Error("Read DTMF failed: " + readDtmfResponse.reason);
      }
      const readDtmfData = readDtmfResponse.data as { dtmf: string }
      console.log(`DTMF Read: did=${session.dialogId} response:${readDtmfResponse.reason} dtmf=${readDtmfData.dtmf}`);

      // Authenticate user and redirect to voicebot
      if (readDtmfData.dtmf == "1234" || readDtmfData.dtmf == "1234#") {
        console.log("User authenticated, redirecting to VoiceBot")

        const redirectResponse = await session.request(`redirect`, { endpoint: "voicebot" })
        if (redirectResponse.code !== 200) {
          throw new Error("Redirecting failed: " + redirectResponse.reason);
        }
        return
      }

      console.log("User was not authenticated, hanguping..")
      const hangupResponse = await session.request('hangup');
      if (hangupResponse.code !== 200) {
        throw new Error("Hangup failed: " + hangupResponse.reason);
      }
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
