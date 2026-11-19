// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NamiSwan222. See LICENSE-MIT.

// Browse Together, page side: runs in each page's process while a Together
// session is on (pref jessnix.together.active) and reports what the person
// does on the page (pointer, scrolling, Alt+click pings, video play/pause/seek)
// to JessnixTogether.mjs in the browser window, which shares it with the room.
// The browser window starts it in each page ("start"), and it listens from
// then until the page goes away. It also applies the room's scrolling and
// video changes to the page. It never
// changes the page's own content: other people's pointers are drawn by the
// browser window, over the page.

const POINTER_INTERVAL_MS = 50;
const SCROLL_INTERVAL_MS = 100;
// Changes this page makes on the room's behalf fire the same events as the
// person's own; those are not sent back for this long.
const ECHO_GUARD_MS = 600;

// What the page side listens to once started. Media events don't bubble, so
// everything is caught on the way down (capture).
const LISTEN = [
  ["mousemove", true],
  ["mouseout", true],
  ["scroll", false],
  ["click", true],
  ["play", true],
  ["pause", true],
  ["seeked", true],
  ["ratechange", true],
];

export class JessnixTogetherChild extends JSWindowActorChild {
  #lastPointer = 0;
  #pointerTimer = null;
  #pendingPointer = null;
  #lastScroll = 0;
  #scrollTimer = null;
  #applyingScrollUntil = 0;
  #applyingMediaUntil = 0;
  #listeningTo = null;

  #start() {
    const win = this.contentWindow;
    if (!win || this.#listeningTo === win) {
      return;
    }
    this.#listeningTo = win;
    for (const [type, capture] of LISTEN) {
      win.addEventListener(type, this, { capture });
    }
  }

  didDestroy() {
    const win = this.#listeningTo;
    this.#listeningTo = null;
    if (!win) {
      return;
    }
    for (const [type, capture] of LISTEN) {
      try {
        win.removeEventListener(type, this, { capture });
      } catch {}
    }
  }

  handleEvent(event) {
    const win = this.contentWindow;
    if (!win || !event.isTrusted) {
      return;
    }
    switch (event.type) {
      case "mousemove": {
        this.#pendingPointer = {
          kind: "cursor",
          x: event.clientX / Math.max(1, win.innerWidth),
          y: event.clientY / Math.max(1, win.innerHeight),
        };
        this.#sendPointer();
        break;
      }
      case "mouseout":
        if (!event.relatedTarget) {
          this.sendAsyncMessage("page", { kind: "cursor-hide" });
        }
        break;
      case "scroll":
        this.#onScroll();
        break;
      case "click":
        // Alt+click: a ping at that spot, for everyone on this page.
        if (event.altKey && event.button === 0) {
          event.preventDefault();
          event.stopPropagation();
          this.sendAsyncMessage("page", {
            kind: "ping",
            x: event.clientX / Math.max(1, win.innerWidth),
            y: event.clientY / Math.max(1, win.innerHeight),
          });
        }
        break;
      case "play":
      case "pause":
      case "seeked":
      case "ratechange": {
        const media = event.target;
        if (!media || !["VIDEO", "AUDIO"].includes(media.tagName)) {
          return;
        }
        if (Date.now() < this.#applyingMediaUntil || media !== this.#mainMedia()) {
          return;
        }
        this.sendAsyncMessage("page", {
          kind: "media",
          action: event.type,
          time: media.currentTime,
          paused: media.paused,
          rate: media.playbackRate,
        });
        break;
      }
    }
  }

  // At most one pointer position per interval, and always the last one.
  #sendPointer() {
    const wait = POINTER_INTERVAL_MS - (Date.now() - this.#lastPointer);
    if (wait > 0) {
      if (!this.#pointerTimer) {
        this.#pointerTimer = this.contentWindow.setTimeout(() => {
          this.#pointerTimer = null;
          this.#sendPointer();
        }, wait);
      }
      return;
    }
    if (this.#pendingPointer) {
      this.#lastPointer = Date.now();
      this.sendAsyncMessage("page", this.#pendingPointer);
      this.#pendingPointer = null;
    }
  }

  #onScroll() {
    if (Date.now() < this.#applyingScrollUntil) {
      return;
    }
    const now = Date.now();
    const wait = SCROLL_INTERVAL_MS - (now - this.#lastScroll);
    if (wait > 0) {
      // One more after the scrolling stops, so the last position is sent.
      if (!this.#scrollTimer) {
        this.#scrollTimer = this.contentWindow.setTimeout(() => {
          this.#scrollTimer = null;
          this.#onScroll();
        }, wait);
      }
      return;
    }
    this.#lastScroll = now;
    const win = this.contentWindow;
    this.sendAsyncMessage("page", {
      kind: "scroll",
      fx: win.scrollX / Math.max(1, win.scrollMaxX),
      fy: win.scrollY / Math.max(1, win.scrollMaxY),
    });
  }

  // The page's main video: the biggest one, else the first audio.
  #mainMedia() {
    const doc = this.document;
    if (!doc) {
      return null;
    }
    let best = null;
    let bestArea = 0;
    for (const video of doc.querySelectorAll("video")) {
      const rect = video.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area > bestArea) {
        best = video;
        bestArea = area;
      }
    }
    return best || doc.querySelector("audio");
  }

  receiveMessage(message) {
    const win = this.contentWindow;
    if (!win) {
      return;
    }
    const data = message.data || {};
    switch (message.name) {
      case "start":
        this.#start();
        break;
      case "apply-scroll":
        this.#applyingScrollUntil = Date.now() + ECHO_GUARD_MS;
        win.scrollTo({
          left: (data.fx || 0) * win.scrollMaxX,
          top: (data.fy || 0) * win.scrollMaxY,
          behavior: "instant",
        });
        break;
      case "apply-media": {
        const media = this.#mainMedia();
        if (!media) {
          return;
        }
        this.#applyingMediaUntil = Date.now() + ECHO_GUARD_MS;
        if (typeof data.time === "number" && Math.abs(media.currentTime - data.time) > 0.6) {
          media.currentTime = data.time;
        }
        if (data.rate && media.playbackRate !== data.rate) {
          media.playbackRate = data.rate;
        }
        if (data.paused && !media.paused) {
          media.pause();
        } else if (!data.paused && media.paused) {
          media.play().catch(() => {});
        }
        break;
      }
    }
  }
}
