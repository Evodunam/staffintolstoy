# Call Inspiration: Peer Calls Reference

This document summarizes the [Peer Calls](https://github.com/peer-calls/peer-calls) reference codebase used as inspiration for the job chat video call feature. The reference lives at:

- **Local path:** `D:\Apps\tolstoy-staffing-main\peer-calls-master`
- **Upstream:** https://github.com/peer-calls/peer-calls (Apache-2.0)

Peer Calls is a WebRTC peer-to-peer (or SFU) group video call app written in Go (server) and React/TypeScript (client).

---

## Reference Structure (High Level)

| Area | Path | Notes |
|------|------|--------|
| **Client entry** | `src/client/index.tsx` | React app; config from `window` (injected by server) |
| **Call lifecycle** | `src/client/actions/CallActions.ts` | `dial()`, `hangUp()`, `init()` (socket connect/disconnect) |
| **Media (getUserMedia, devices)** | `src/client/actions/MediaActions.ts` | `enumerateDevices`, `getMediaStream`, `getMediaTrack`, `toggleDevice`, `setDeviceId` |
| **Streams (local/remote)** | `src/client/actions/StreamActions.ts` | Add/remove local and peer streams |
| **Toolbar (in-call UI)** | `src/client/components/Toolbar.tsx` | Hang up, share desktop, video/audio dropdowns, fullscreen, copy URL |
| **Device dropdown** | `src/client/components/DeviceDropdown.tsx` | Mic/camera toggle + device list; video quality (Lo/Md/Sd/Hd) |
| **Pre-call media form** | `src/client/components/Media.tsx` | Local preview (`VideoSrc`), nickname, device selects, “Join Call” |
| **In-call video grid** | `src/client/components/Videos.tsx` | Grid of `Video` components (maximized + minimized toolbar) |
| **Single video** | `src/client/components/Video.tsx` | `VideoSrc`, nickname, VUMeter, menu (maximize, minimize, fit, stats) |
| **Video element** | `src/client/components/VideoSrc.tsx` | `<video>` with `srcObject`, `autoPlay`, `playsInline`, `muted` |
| **Media state** | `src/client/reducers/media.ts` | `dialState`, `devices`, `video`/`audio` constraints, `socketConnected` |
| **Streams state** | `src/client/reducers/streams.ts` | Local and peer streams keyed by type/peer |
| **Server room** | `server/room.go` | Room manager (enter/exit), adapter per room |
| **Server templates** | `server/templates/call.html` | Page that loads client bundle with config |

---

## Concepts We Reuse (Tolstoy Calling Dialog)

1. **End call = single red control**  
   Peer Calls uses a red “Hang Up” button (`.hangup .icon` → `#dd2c00`). We use a red “End” button with phone icon in the header.

2. **Toolbar layout**  
   In-call controls in a horizontal bar: share desktop, video dropdown, **hang up**, audio dropdown, fullscreen. We use: mic toggle, camera toggle, device popover (mic/camera list), and End in the header.

3. **Device handling**  
   - `enumerateDevices()` (optionally after a `getUserMedia` so labels are filled).  
   - Separate “enabled” vs “deviceId”: toggle device on/off vs choose which device.  
   - “No Audio” / “No Video” and “Default” + list of devices (see `DeviceDropdown`, `MediaActions`).

4. **Local preview**  
   Pre-call: `VideoSrc` with `stream.stream`, `muted`, `mirrored`. We show local video when camera is on, avatar when off.

5. **Media constraints**  
   Audio/video each have `enabled` and `constraints` (e.g. `deviceId`, or size for video). Getting a new track uses `getUserMedia({ audio: constraint, video: false })` or the reverse for video.

6. **Hang up cleanup**  
   On hang up: emit socket event, remove socket listeners, clear `onbeforeunload`, stop local streams (`removeLocalStream`), and set dial state to hung up.

---

## Constants (Reference)

- `DialState`: `'hung-up' | 'dialling' | 'in-call'`
- `DEVICE_DISABLED_ID = 'disabled'`, `DEVICE_DEFAULT_ID = ''`
- Socket events: `users`, `hangUp`, `signal`, `pubTrack`, `subTrack`, etc.

---

## Styling (SASS) Highlights

- **Toolbar** (`_toolbar.sass`): absolute, flex row, rounded icon buttons; hang up uses `#dd2c00`; hover blue `#407cf7`; tooltips below; dropdown list with “No Audio/Video”, “Default”, then device list.
- **Video** (`_video.sass`): grid (flex or aspect-ratio), `.video-container` with nickname and VUMeter in footer; `object-fit: cover`; mirrored class for `rotateY(180deg)`.

---

## How We Differ

- **No embedded Peer Calls app:** We open the Peer Calls room URL in a new tab (`VITE_PEERCALLS_URL`); our Calling dialog is a “waiting room” with local preview and controls, not the full WebRTC app.
- **Single call per job:** We enforce one active call per job (backend 409 + frontend `hasActiveCall`).
- **No Redux:** Our call UI is local React state (and a bit of API) rather than Redux actions/reducers.
- **End in header:** We use a single red “End” in the dialog header instead of a footer “End call” + “Join call”.

---

## Quick File Reference

| Purpose | File in peer-calls-master |
|--------|----------------------------|
| Dial / hang up | `src/client/actions/CallActions.ts` |
| getUserMedia, enumerate, toggle device | `src/client/actions/MediaActions.ts` |
| Toolbar (hang up, video/audio, share) | `src/client/components/Toolbar.tsx` |
| Device list + quality | `src/client/components/DeviceDropdown.tsx` |
| Join form + local preview | `src/client/components/Media.tsx` |
| Video grid + single Video | `src/client/components/Videos.tsx`, `Video.tsx` |
| `<video>` wrapper | `src/client/components/VideoSrc.tsx` |
| Media reducer (dial state, devices) | `src/client/reducers/media.ts` |
| Toolbar / video styles | `src/sass/_toolbar.sass`, `_video.sass` |

Use this doc and the `peer-calls-master` folder together when extending the in-app calling experience (e.g. embedding Peer Calls, adding VUMeter, or aligning device/quality UX).
