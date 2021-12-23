"use strict";
import appInsights = require("applicationinsights");
import * as vscode from "vscode";

export class AppInsightsClient {
    private _client;
    private _enableAppInsights;

    constructor() {
        const config = vscode.workspace.getConfiguration("vs-code-runner");
        this._enableAppInsights = config.get<boolean>("enableAppInsights");
    }

    public sendEvent(eventName: string, properties?: { [key: string]: string; }): void {
        if (this._enableAppInsights) {
            this._client.trackEvent(eventName === "" ? "bat" : eventName, properties);
        }
    }
}