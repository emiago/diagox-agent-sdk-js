// SPDX-License-Identifier: MPL-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024, Emir Aganovic

import WebSocket from "ws";
import { v4 as uuidv4 } from 'uuid';
import debug from 'debug';


// Use DEBUG=diagox-agent-sdk to have logging
const _log = debug('diagox-agent-sdk');
const log = (...data: any[]) => {
  const timestamp = new Date().toISOString();
  _log(timestamp, ...data);
}

/**
 * Request message format
 */
export interface AgentRequest {
  id: string;
  did: string;
  op: string;
  data?: Record<string, any>;
}

/**
 * Response message format
 */
export interface AgentResponse {
  id: string;
  did: string;
  code: number;
  reason: string;
  data?: Record<string, any>;
}

type AgentRPCClientOptions = {
  url: string;
  endpoint: string;
};

type MessageHandler = (text: string) => void;
type RequestCallback = (req: AgentRequest) => void;
type ResponseCallback = (response: AgentResponse) => void;
type BinaryCallback = (dataType: number, data: Buffer) => void
type TransactionRequestHandler = (req: AgentRequest, callback: ResponseCallback, callbackBin?: BinaryCallback) => void

export class AgentRPCClient {
  private ws?: WebSocket;
  private onMessage?: MessageHandler;
  private onInviteCb: RequestCallback;
  private onByeCb: RequestCallback;
  private pendingTransactions: Map<string, ResponseCallback> = new Map();
  private pendingBinaryData: Map<string, BinaryCallback> = new Map();
  private dialogs: Map<string, DialogSession> = new Map();

  constructor(private opts: AgentRPCClientOptions) {
    this.onInviteCb = (request: AgentRequest) => {
      log("Invite received, but no onInvite handler attached")
      this.sendResponse(request.id, 599, "No handler attached");
    };

    this.onByeCb = (request: AgentRequest) => {
      log("Bye received, responding OK");
      this.sendResponse(request.id, 200, "OK");
    };
  }

  /**
   * Connects over websocket. Exits once connection is open
  */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opts.url);
      this.ws = ws;

      ws.on("open", () => {
        resolve();
      });

      ws.on("message", this.handleMessage.bind(this));


      ws.on("error", reject);
    });
  }
  /**
   * Connects and listens until WS connection is dropped
   */
  connectAndListen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.opts.url}?endpoint=${this.opts.endpoint}`);
      this.ws = ws;

      // ws.on("open", () => {
      // });

      ws.on("message", this.handleMessage.bind(this));
      ws.on("error", reject);
      ws.on('close', reject);
    });
  }

  disconnect(): void {
    if (!this.ws) {
      return;
    }
    if (this.ws.readyState === WebSocket.CLOSED) {
      return;
    }
    this.ws.close();
  }

  // onInvite registers invite callback
  onInvite(cb: RequestCallback): void {
    this.onInviteCb = cb;
  }

  // onBye registers bye callback. Use only if needed
  // Default behavior: it responded with 200, while any active request will be terminated with non 200
  onBye(cb: RequestCallback): void {
    this.onByeCb = cb;
  }

  // --------------------
  // Internal protocol
  // --------------------

  private send(msg: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("not connected");
    }

    log("Send message", msg);
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send response to server
   */
  private sendResponse(requestId: string, code: number, reason: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to agent server');
    }

    const response: AgentResponse = {
      id: requestId,
      did: '', // Not needed for invite response
      code: code,
      reason: reason,
    };

    this.send(response);
  }

  private handleMessage(data: WebSocket.RawData, isBinary: boolean) {
    if (isBinary) {
      const binData = data as Buffer;
      this.handleMessageBinary(binData);
      return;
    }
    this.handleMessageJSON(data.toString());
  }

  private handleMessageJSON(raw: string) {
    const message = JSON.parse(raw);
    log("New message", message);

    // Hande Request or Response
    if (!message.code || message.code === 0) {
      const request = message as AgentRequest;
      if (request.op == "invite") {
        this.onInviteCb(request);
        return;
      }

      if (request.op == "bye") {
        this.onByeCb(request);
        return;
      }
      return;
    }

    const response = message as AgentResponse;
    const callback = this.pendingTransactions.get(response.id);
    if (callback) {
      callback(response);
    }
  }

  private handleMessageBinary(binData: Buffer) {
    const dataType = binData.readInt8(0);
    const idlen = binData.readInt32BE(1);
    const requestID = binData.toString('utf8', 5, 5 + idlen);
    log("New binary data", "req.id", requestID, "idlen", idlen);
    const bufData = binData.subarray(5 + idlen, binData.length)
    const callback = this.pendingBinaryData.get(requestID);
    if (callback) {
      callback(dataType, bufData);
    }
    return;
  }


  private transactionRequest(req: AgentRequest, callback: ResponseCallback): void {
    if (req.id == "") {
      throw new Error("Request ID is missing");
    }

    // For every request we expect to have some provisional or final response
    const provisionalTimeout = 10000;
    const timeoutHandle = setTimeout(() => {
      this.pendingTransactions.delete(req.id);
      throw new Error(`Request timeout after ${provisionalTimeout}ms for operation: ${req.op}`);
    }, provisionalTimeout);

    this.pendingTransactions.set(req.id, (response: AgentResponse) => {
      clearTimeout(timeoutHandle);
      callback(response);
    });

    this.send(req);
  }

  // Experimental: transaction with Binary Data 
  private transactionRequestBinary(req: AgentRequest, callback: ResponseCallback, callbackBin: BinaryCallback): void {
    if (req.id == "") {
      throw new Error("Request ID is missing");
    }

    // For every request we expect to have some provisional or final response
    const provisionalTimeout = 10000;
    const timeoutHandle = setTimeout(() => {
      this.pendingTransactions.delete(req.id);
      this.pendingBinaryData.delete(req.id);
      throw new Error(`Request timeout after ${provisionalTimeout}ms for operation: ${req.op}`);
    }, provisionalTimeout);

    this.pendingTransactions.set(req.id, (response: AgentResponse) => {
      clearTimeout(timeoutHandle);
      callback(response);
      if (response.code >= 200) {
        this.pendingTransactions.delete(response.id);
      }
    });

    this.pendingBinaryData.set(req.id, (t: number, data: Buffer) => {
      callbackBin(t, data);
      this.pendingBinaryData.delete(req.id);
    });

    this.send(req);
  }

  /**
 * Accept a pending invite and get a DialogSession
 */
  public async acceptDialog(request: AgentRequest): Promise<DialogSession> {
    // Send 200 OK response to invite
    this.sendResponse(request.id, 200, 'OK');

    // Create dialog session
    const dialogId = request.did;
    const session = new DialogSession(dialogId, (req: AgentRequest, cb: ResponseCallback, binCb?: BinaryCallback) => {
      if (binCb) {
        this.transactionRequestBinary(req, cb, binCb);
        return;
      }
      this.transactionRequest(req, cb);
    });

    this.dialogs.set(dialogId, session);
    return session;
  }
}


/**
 * Dialog session - represents a single active dialog
 */
export class DialogSession {
  public readonly dialogId: string;
  // private sendMessage: (msg: string) => void;
  private transactionRequest: TransactionRequestHandler;

  // constructor(dialogId: string, sendMessage: (msg: string) => void, transaction: (req: AgentRequest, callback: ResponseCallback) => void) {
  constructor(dialogId: string, transactionRequest: TransactionRequestHandler) {
    this.dialogId = dialogId;
    // this.sendMessage = sendMessage;
    this.transactionRequest = transactionRequest;
  }

  public async request(
    op: string,
    data?: Record<string, any>,
    onProvisional?: ResponseCallback,
  ): Promise<AgentResponse> {
    const requestId = uuidv4();
    const request: AgentRequest = {
      id: requestId,
      did: this.dialogId,
      op: op,
      data: data,
    };

    return new Promise((resolve, reject) => {
      try {
        this.transactionRequest(request, (response: AgentResponse) => {
          if (response.code < 200) {
            if (onProvisional) {
              onProvisional(response);
            }
            return;
          }
          resolve(response);
        })
      } catch (error) {
        reject(error);
      }
    })
  }


  // NOTE: Binary data handling may not be supported.
  public async requestBinary(
    op: string,
    onBinaryData: BinaryCallback,
    data?: Record<string, any>,
    onProvisional?: ResponseCallback,
  ): Promise<AgentResponse> {
    const requestId = uuidv4();
    const request: AgentRequest = {
      id: requestId,
      did: this.dialogId,
      op: op,
      data: data,
    };

    return new Promise((resolve, reject) => {
      try {
        this.transactionRequest(request, (response: AgentResponse) => {
          if (response.code < 200) {
            if (onProvisional) {
              onProvisional(response);
            }
            return;
          }
          resolve(response);
        }, onBinaryData)
      } catch (error) {
        reject(error);
      }
    })
  }
}