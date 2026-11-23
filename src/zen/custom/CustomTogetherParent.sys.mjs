// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Browse Together, browser side of the page actor: hands what a page reports
// (CustomTogetherChild.sys.mjs) to the Together session of the window that
// shows the page (CustomTogether.mjs).

export class CustomTogetherParent extends JSWindowActorParent {
  receiveMessage(message) {
    if (message.name !== "page") {
      return;
    }
    const browser = this.browsingContext.top?.embedderElement;
    // topChromeWindow, not browser.ownerGlobal: the latter isn't reachable
    // from an actor's module.
    const win = this.browsingContext.topChromeWindow;
    if (browser && win) {
      win.gCustomTogether?.onPageMessage(browser, message.data);
    }
  }
}
