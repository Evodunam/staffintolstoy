# Cursor Select Element Tool

The **Cursor** (and Replit) **select element** tool lets you click an element in the app preview to target it for editing. When the app runs on **Replit**, the tool can fail with:

- **"The data provided has been truncated as it is over the limit of 225280 characters"**
- **POST `https://sp.replit.com/v1/t` 400 (Bad Request)**

## Cause

The tool sends an `element_selected` payload that includes the full DOM node. Large subtrees (e.g. job cards, list containers) exceed the ~225 KB limit, so the request is rejected and the tool stops working.

## Workarounds

1. **Select smaller elements**  
   Use the tool on elements with small DOM subtrees, e.g.:
   - View mode selector (`data-cursor-stable-id="view-mode-select"`)
   - AI Dispatch button (`data-cursor-stable-id="ai-dispatch-btn"`)
   - Filters dropdown (`data-cursor-stable-id="filters-dropdown"`)

2. **Run the app locally**  
   Start the app with `npm run dev` and open the preview (e.g. Cursor’s built-in browser or localhost). The Replit telemetry that hits the limit is not used for local runs, so the select-element tool may work for larger elements.

3. **Use `data-cursor-stable-id` for targeting**  
   We use `data-cursor-stable-id` and `data-cursor-stable-container` on key UI elements. When the tool works, it uses these for stable targeting. Prefer selecting those elements when possible.

## Suppressed console noise

We suppress the truncation and related `sp.replit.com` 400 errors in `client/index.html` so they don’t clutter the console. The tool may still fail for large elements; suppression only hides the messages.

## Attributes in this app

- **Containers:** `data-cursor-stable-container="find-work"`, `"filters"`, `"job-list"`, `"jobs-pending"`, `"jobs-accepted"`, etc.
- **Elements:** `data-cursor-stable-id="view-mode-select"`, `"ai-dispatch-btn"`, `"filters-dropdown"`, `job-{id}`, `pending-job-{id}`, `accepted-job-{id}`.

See `client/src/pages/WorkerDashboard.tsx` for where these are used.
