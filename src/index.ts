// SPDX-License-Identifier: MPL-2.0
// SPDX-FileCopyrightText: Copyright (c) 2024, Emir Aganovic

import WebSocket from "ws";
import { v4 as uuidv4 } from 'uuid';

/**
 * Request message format
 */
export interface AgentRequest {
  ID: string;
  DID: string;
  OP: string;
  Data?: Record<string, any>;
}

/**
 * Response message format
 */
export interface AgentResponse {
  ID: string;
  DID: string;
  Code: number;
  Reason: string;
  Data?: Record<string, any>;
}

type AgentRPCClientOptions = {
  url: string;
  endpoint: string;
};

type MessageHandler = (text: string) => void;
type RequestCallback = (req: AgentRequest) => void;
type ResponseCallback = (response: AgentResponse) => void;
type TransactionRequestHandler = (req: AgentRequest, callback: ResponseCallback) => void

export class AgentRPCClient {
  private ws?: WebSocket;
  private onMessage?: MessageHandler;
  private onInviteCb: RequestCallback;
  private onByeCb: RequestCallback;
  private pendingTransactions: Map<string, ResponseCallback> = new Map();
  private dialogs: Map<string, DialogSession> = new Map();

  constructor(private opts: AgentRPCClientOptions) {
    this.onInviteCb = (request: AgentRequest) => {  
      console.log("DialogInvite received, but no onInvite handler attached")
      this.sendResponse(request.ID, 599, "No handler attached");
    };

    this.onByeCb = (request: AgentRequest) => {  
      console.debug("DialogBye received, responding OK");
      this.sendResponse(request.ID, 200, "OK");
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

      ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });

      ws.on("error", reject);
    });
  }
  /**
   * Connects and listens until WS connection is dropped
   */
  connectAndListen(): Promise<void> {
    const ws = new WebSocket(this.opts.url);
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.opts.url}?endpoint=${this.opts.endpoint}`);
      this.ws = ws;

      // ws.on("open", () => {
      // });

      ws.on("message", (data) => {
        this.handleMessage(data.toString());
      });
      ws.on("error", reject);
      ws.on('close', reject);
    });
  }

  disconnect(): void {
    if (!this.ws) {
      return;
    }
    if (this.ws.readyState === WebSocket.CLOSED ) {
      return;
    }
    this.ws.close();
  }

  // onInvite registers DialogInvite callback
  onInvite(cb: RequestCallback): void {
      this.onInviteCb = cb;
  }

  // onBye registers DialogBye callback. Use only if needed
  // Default behavior: it responded with 200, while any active request will be terminated with non 200
  onBye(cb: RequestCallback): void {
      this.onInviteCb = cb;
  }

  // --------------------
  // Internal protocol
  // --------------------

  private send(msg: object) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("not connected");
    }

    this.ws.send(JSON.stringify(msg));
  }

  private sendMessage(msg: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to agent server');
    }

    this.ws.send(msg);
  }

  /**
   * Send response to server
   */
  private sendResponse(requestId: string, code: number, reason: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to agent server');
    }

    const response: AgentResponse = {
      ID: requestId,
      DID: '', // Not needed for invite response
      Code: code,
      Reason: reason,
    };

    // try {
    this.ws.send(JSON.stringify(response));
    // } catch (error) {
    //   this.emit('error', error);
    // }
  }

  private handleMessage(raw: string) {
    console.log("Handling message", raw);
    const message = JSON.parse(raw);

    // Hande Request or Response
     if (!message.Code || message.Code === 0) {
      const request = message as AgentRequest;
      if (request.OP == "DialogInvite") {
        this.onInviteCb(request);
        return;
      }

      if (request.OP == "DialogBye") {
        // TODO. Dialog actions will be terminated anyway
        this.sendResponse(request.ID, 200, "OK");
      }
      return;
    }


    const response = message as AgentResponse;
    const callback = this.pendingTransactions.get(response.ID);
    console.log("Handling response", "id", response.ID, "callback", callback);
    if (callback) {
      callback(response);
    }

    if (response.Code >= 200 ) {
      this.pendingTransactions.delete(response.ID);
    }
  }


  private transactionRequest(req: AgentRequest, callback: ResponseCallback): void {
    console.log("Doing transaction request", req);
    if (req.ID == "") {
      // req.ID = uuidv4();
      throw new Error("Request ID is missing");
    }

    // For every request we expect to have some provisional or final response
    const provisionalTimeout = 10000;
    const timeoutHandle = setTimeout(() => {
        this.pendingTransactions.delete(req.ID);
        throw new Error(`Request timeout after ${provisionalTimeout}ms for operation: ${req.OP}`);
    }, provisionalTimeout);

    this.pendingTransactions.set(req.ID, (response: AgentResponse) => {
      clearTimeout(timeoutHandle);
      callback(response);
    });
    this.sendMessage(JSON.stringify(req));
  }
    /**
   * Accept a pending DialogInvite and get a DialogSession
   */
  public async acceptDialog(request: AgentRequest): Promise<DialogSession> {
    // Send 200 OK response to DialogInvite
    const dialogId = request.DID;
    this.sendResponse(request.ID, 200, 'OK');

    // Create dialog session
    const session = new DialogSession(dialogId, (req: AgentRequest, cb: ResponseCallback) => {
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
      ID: requestId,
      DID: this.dialogId,
      OP: op,
      Data: data,
    };

    return new Promise((resolve, reject) => {
      try {
        this.transactionRequest(request, (response: AgentResponse) => {
          if (response.Code < 200) {
            if (onProvisional) {
              onProvisional(response);
            }
            return;
          }
          resolve(response);
        })
      } catch(error) {
        reject(error);
      }
    })
  }

}