// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Chrome Web Store pages, page side: the store's own "Add to Chrome" button
// (greyed out outside Chrome) is hidden and an active copy takes its place,
// reading "Add to Custom Browser" (or "Remove from Custom Browser" when the
// converted extension is installed). Clicking it asks the browser window
// (CustomChromeStore.mjs) to add or remove the extension; the browser works
// out which extension from the page's address, not from anything the page
// says. The "Switch to Chrome" banner and popup are hidden. The store redraws its pages
// as you move around, so this re-checks after each change.

const MARK = "data-custom-store";
const ADD_RE = /^(Add to|Remove from) Chrome$/;

export class CustomChromeStoreChild extends JSWindowActorChild {
  #observer = null;
  #pending = false;
  #url = null;
  #installed = null;
  #busy = false;

  handleEvent(event) {
    if (event.type === "DOMContentLoaded") {
      this.#start();
    }
  }

  receiveMessage(message) {
    switch (message.name) {
      case "start":
        this.#start();
        break;
      case "state":
        this.#installed = !!message.data?.installed;
        this.#busy = !!message.data?.busy;
        this.#apply();
        break;
    }
  }

  didDestroy() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  #start() {
    const doc = this.document;
    if (!doc || this.#observer) {
      return;
    }
    if (doc.readyState === "loading") {
      doc.addEventListener("DOMContentLoaded", () => this.#start(), { once: true });
      return;
    }
    const win = this.contentWindow;
    this.#observer = new win.MutationObserver(() => this.#schedule());
    this.#observer.observe(doc.documentElement, { childList: true, subtree: true });
    this.#apply();
  }

  #schedule() {
    if (this.#pending) {
      return;
    }
    this.#pending = true;
    this.contentWindow?.setTimeout(() => {
      this.#pending = false;
      this.#apply();
    }, 150);
  }

  #apply() {
    const doc = this.document;
    if (!doc?.body) {
      return;
    }
    // A different extension's page (the store navigates without reloading):
    // ask the browser whether that one is installed.
    if (this.#url !== doc.location.href) {
      this.#url = doc.location.href;
      this.#installed = null;
      this.sendAsyncMessage("query");
    }
    this.#hideBanner(doc);
    const original = [...doc.querySelectorAll(`button:not([${MARK}])`)].find(b =>
      ADD_RE.test(b.textContent.trim())
    );
    let ours = doc.querySelector(`button[${MARK}]`);
    if (!original) {
      return;
    }
    if (!ours || ours.previousElementSibling !== original) {
      ours?.remove();
      ours = original.cloneNode(true);
      // The copy must not run the store's own click handling.
      for (const el of [ours, ...ours.querySelectorAll("*")]) {
        el.removeAttribute("jsaction");
        el.removeAttribute("jscontroller");
        el.removeAttribute("jsname");
        el.removeAttribute("id");
      }
      ours.removeAttribute("aria-describedby");
      ours.setAttribute(MARK, "");
      ours.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (!this.#busy) {
          this.sendAsyncMessage(this.#installed ? "remove" : "add");
        }
      });
      original.after(ours);
      original.style.setProperty("display", "none", "important");
      this.sendAsyncMessage("ready");
    }
    const label = this.#busy
      ? "Adding…"
      : this.#installed
        ? "Remove from Custom Browser"
        : "Add to Custom Browser";
    ours.disabled = this.#busy || this.#installed === null;
    this.#setLabel(ours, label);
  }

  // The innermost element holding the button's words.
  #setLabel(button, text) {
    let target = button;
    for (const el of button.querySelectorAll("span")) {
      if (el.children.length === 0 && el.textContent.trim()) {
        target = el;
      }
    }
    if (target.textContent !== text) {
      target.textContent = text;
    }
    button.setAttribute("aria-label", text);
  }

  // "Switch to Chrome to install extensions and themes / Install Chrome", and
  // the Google bar's "Switch to Chrome?" popup (an iframe named "callout"),
  // which covers the button.
  #hideBanner(doc) {
    for (const frame of doc.querySelectorAll('iframe[name="callout"]')) {
      (frame.parentElement || frame).style.setProperty("display", "none", "important");
    }
    const button = [...doc.querySelectorAll("button[aria-label], a[aria-label]")].find(b =>
      /^Switch to Chrome/.test(b.getAttribute("aria-label"))
    );
    if (!button) {
      return;
    }
    let box = button;
    while (box.parentElement && box.parentElement !== doc.body && box.parentElement.textContent.trim().length < 200) {
      box = box.parentElement;
    }
    box.style.setProperty("display", "none", "important");
  }
}
