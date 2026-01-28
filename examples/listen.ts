import { join } from "path";
import { FlowClient, Request } from "../src/index";
import { writeFileSync, WriteFileOptions } from "fs"

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

      // Before any media action you need to answer dialog first
      const answerResponse = await session.request('answer');
      console.log(`Answer: did=${session.dialogId} response=${answerResponse.reason}`);
      if (answerResponse.code !== 200) {
        throw new Error("Answering failed: " + answerResponse.reason);
      }

      // Listen and receive binary.
      // Final response is generated after pushing whole binary.
      let wavBuf: Buffer = new Buffer("");
      const listenResponse = await session.requestBinary('listen', (_, data: Buffer) => {
        wavBuf = data;
      }, {
        duration_sec: 10,
        audio_format: "wav", // Defaults is PCM 16 bit which is better for streaming. We prefer wav
      });
      if (listenResponse.code !== 200) {
        throw new Error("Record failed: " + listenResponse.reason);
      }
      console.log(`Listen finished`);

      // Store now recording
      if (wavBuf.byteLength == 0) {
        throw new Error("Recording is empty")
      }
      console.log("Writing recording to", join(__dirname, "record.wav"));
      writeFileSync(join(__dirname, "record.wav"), wavBuf, { flag: 'w' });

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
