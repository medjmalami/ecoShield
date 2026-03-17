import { Router, Request, Response } from "express";
import { pipelineEmitter } from "../lib/emitter";
import type { PipelineEvent } from "../lib/types";

const router = Router();

// Keepalive comment sent every 15 s to prevent proxy/load-balancer idle timeouts.
// SSE comment lines (": ...\n\n") are ignored by EventSource clients.
const KEEPALIVE_INTERVAL_MS = 15_000;

router.get("/", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send an initial heartbeat so the client knows the connection is live
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  // Keepalive ping — prevents proxy idle-timeout disconnects
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, KEEPALIVE_INTERVAL_MS);

  const onUpdate = (event: PipelineEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  pipelineEmitter.on("update", onUpdate);

  // Handle ungraceful TCP drops — detach listener and stop pinging so we do not
  // accumulate dead listeners or emit unhandled write errors.
  res.on("error", (err) => {
    console.error("[events] SSE write error (client likely dropped):", err.message);
    clearInterval(keepalive);
    pipelineEmitter.off("update", onUpdate);
  });

  // Clean shutdown on normal client disconnect
  req.on("close", () => {
    clearInterval(keepalive);
    pipelineEmitter.off("update", onUpdate);
  });
});

export default router;
