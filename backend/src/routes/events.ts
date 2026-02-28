import { Router, Request, Response } from "express";
import { pipelineEmitter } from "../lib/emitter";
import type { PipelineEvent } from "../lib/types";

const router = Router();

router.get("/", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  // Send an initial heartbeat so the client knows the connection is live
  res.write(`data: ${JSON.stringify({ connected: true })}\n\n`);

  const onUpdate = (event: PipelineEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  pipelineEmitter.on("update", onUpdate);

  req.on("close", () => {
    pipelineEmitter.off("update", onUpdate);
  });
});

export default router;
