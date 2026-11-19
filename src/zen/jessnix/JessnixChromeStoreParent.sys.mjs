// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Chrome Web Store pages, browser side: passes the store page's button
// (JessnixChromeStoreChild.sys.mjs) to the window's JessnixChromeStore.mjs.
// Which extension is taken from the page's address here, never from the page.

import { webStoreId } from "chrome://browser/content/zen-components/JessnixChromeExtensions.sys.mjs";

export class JessnixChromeStoreParent extends JSWindowActorParent {
  receiveMessage(message) {
    // The tab's address (it follows the store's in-page navigation).
    const id = webStoreId(this.browsingContext.top?.embedderElement?.currentURI?.spec);
    // topChromeWindow: browser.ownerGlobal isn't reachable from an actor's module.
    const win = this.browsingContext.topChromeWindow;
    const store = win?.gJessnixChromeStore;
    if (!store) {
      return;
    }
    switch (message.name) {
      case "ready":
        store.pageButtonReady(this.browsingContext.top?.embedderElement);
        break;
      case "query":
        if (id) {
          store.sendState(this, id);
        }
        break;
      case "add":
        if (id) {
          store.add(id, this);
        }
        break;
      case "remove":
        if (id) {
          store.remove(id, this);
        }
        break;
    }
  }
}
